/** Real loopback relay and complete native API observations for reader parity [H5,H15,H16,A2]. */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as store from '../src/board.js';
import { serveApi } from '../src/api.js';
import { main } from '../src/cli.js';
import { decodeBoardKey } from '../src/seal.js';
import { ENGINE_VERSION } from '../src/machine.js';
import { openPagedSnapshot } from '../src/relay-page-layout.js';
import { snapshotState } from '../relay/browser-model.js';
import { relayClientFixture } from './relay-client-fixture.js';

/** Only the native filesystem routing identity differs deliberately from the relay board identity. */
export const LOCAL_PARITY_FIELDS = Object.freeze([
  { path: 'root', reason: 'Native routing uses a local repository directory; a relay reader routes by persistent board id.' },
]);

/** Report the first undeclared field difference with both actual values, including missing keys. */
export function assertReaderParity(native, relay, localFields = LOCAL_PARITY_FIELDS) {
  const ignored = new Set(localFields.map(entry => entry.path));
  assert.ok(localFields.every(entry => entry.path && entry.reason?.trim()), 'every local-only field has a reason');
  /** Compare structure as well as values; a missing field is never equivalent to an explicit null. */
  function compare(left, right, path) {
    if (ignored.has(path)) return;
    const label = value => value === undefined ? '<missing>' : JSON.stringify(value);
    if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') {
      assert.deepEqual(left, right, `reader parity ${path}: native=${label(left)} relay=${label(right)}`);
      return;
    }
    assert.equal(Array.isArray(left), Array.isArray(right), `reader parity ${path}: native=${label(left)} relay=${label(right)}`);
    for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) compare(left[key], right[key], path ? `${path}.${key}` : key);
  }
  compare(native, relay, '');
}

/** Seed actual native writes, keeping the operation receipts available for the fail-closed coverage inventory. */
export function seedParityBoard(root, lane) {
  const board = store.openBoard(join(root, '.git', 'pullboard', 'board.sqlite'));
  const exercised = new Set(['register', 'ensureCoordinator']); // The real fixture init executes these operations.
  /** Record only an operation whose actual native call returned successfully. */
  function moved(operation, action) { const result = action(); exercised.add(operation); return result; }
  try {
    const item = moved('addItem', () => store.addItem(board, { by: 'coordinator', lane, title: 'Reader parity lifecycle', criterion: 'Same native and relay fields' }));
    moved('editItem', () => store.editItem(board, item, { agentId: 'coordinator', brief: 'Reader parity updated' }));
    moved('shout', () => store.shout(board, { from: 'coordinator', to: 'person', text: 'Reader parity question', decision: true }));
    moved('addMilestone', () => store.addMilestone(board, { agentId: 'coordinator', name: 'Reader parity release' }));
    return { exercised: [...exercised], item };
  } finally { store.closeBoard(board); }
}

/** Capture full API state and independently reconstruct the sealed API2 snapshot over actual authenticated HTTP. */
export async function parityRoundtrip(t) {
  const box = await relayClientFixture(t);
  const seeded = seedParityBoard(box.root, box.lane);
  await box.link();
  const link = JSON.parse(readFileSync(box.linkFile, 'utf8'));
  const key = decodeBoardKey(readFileSync(box.keyFile, 'utf8').trim());
  const secret = randomBytes(24).toString('base64url');
  const api = await serveApi({ secret, runCommand: main, projects: () => [{ root: box.root, name: 'parity' }], isMain: true, stateDetail: 'full' });
  t.after(api.close);
  const nativeResponse = await fetch(`http://127.0.0.1:${api.port}/api/v1/boards/${link.board}/state?detail=full`, { headers: { 'x-pullboard-key': secret } });
  assert.equal(nativeResponse.status, 200, 'complete native API state is available');
  const native = (await nativeResponse.json()).state;
  const session = await box.phoneSession();
  /** Request through a distinct authenticated person session, never a direct journal read. */
  async function request(path) {
    const response = await fetch(box.origin + path, { headers: { authorization: `Bearer ${session.token}`, 'x-pullboard-engine': String(ENGINE_VERSION) } });
    assert.equal(response.status, 200, `relay parity reader GET ${path.split('?')[0]}`);
    return response.json();
  }
  const document = await request(`/api/v2/boards/${link.board}/state`);
  assert.equal(document.apiVersion, 2, 'current snapshot transport is exercised');
  const saved = document.state;
  const page = await openPagedSnapshot(saved.root, { key, boardId: link.board, sequence: saved.sequence,
    /** Fetch only the pinned, reachable sealed object graph through its actual service boundary. */
    async get(id, parents) {
      const object = await request(`/api/v2/boards/${link.board}/objects/${id}?pin=${encodeURIComponent(saved.read.id)}&via=${parents.join(',')}`);
      return Uint8Array.from(Buffer.from(object.page.sealed, 'base64url'));
    },
  }, { maxEngine: ENGINE_VERSION });
  const restored = await page.native();
  const relay = snapshotState(restored, link.board);
  return { native, relay, exercised: seeded.exercised };
}
