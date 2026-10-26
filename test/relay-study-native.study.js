/** Native view state against the sealed relay presentation, field by field [H5,H17]. Run it explicitly: the default gate skips *.study.js. */
import { join } from 'node:path';
import { test } from 'node:test';
import * as store from '../src/board.js';
import { serveApi } from '../src/api.js';
import { main } from '../src/cli.js';
import { relayPresentation } from '../src/relay-presentation.js';
import { presentationState } from '../relay/browser-model.js';
import { relayClientFixture } from './relay-client-fixture.js';
import { apiFetch } from './api-fixture.js';

/** Collect every key path, with array members folded to [], so shapes compare without board contents. */
function paths(value, prefix = '$', found = new Set()) {
  found.add(prefix);
  if (Array.isArray(value)) for (const member of value) paths(member, prefix + '[]', found);
  else if (value && typeof value === 'object') for (const [name, child] of Object.entries(value)) paths(child, prefix + '.' + name, found);
  return found;
}

/** Name the common scalar paths whose values differ between the two states, sampled by item and agent id. */
function valueDifferences(native, relay) {
  const found = new Set();
  /** Compare two values below one path, matching array members by their id when they carry one. */
  function walk(left, right, path) {
    if (Array.isArray(left) && Array.isArray(right)) {
      const key = member => member && typeof member === 'object' ? member.id ?? member.agent_id ?? member.shout_id ?? null : null;
      const byKey = new Map(right.map(member => [key(member), member]));
      left.forEach((member, index) => {
        const other = key(member) === null ? right[index] : byKey.get(key(member));
        if (other !== undefined) walk(member, other, path + '[]');
      });
      return;
    }
    if (left && right && typeof left === 'object' && typeof right === 'object') {
      for (const name of Object.keys(left)) if (Object.hasOwn(right, name)) walk(left[name], right[name], path + '.' + name);
      return;
    }
    if (JSON.stringify(left) !== JSON.stringify(right)) found.add(path);
  }
  walk(native, relay, '$');
  return [...found].sort();
}

test('relay study diffs the native view state and the relay reader state [H5,H17]', { timeout: 180_000 }, async t => {
  const box = await relayClientFixture(t);
  const board = store.openBoard(join(box.root, '.git', 'pullboard', 'board.sqlite'));
  t.after(() => store.closeBoard(board));
  const item = store.addItem(board, { by: 'coordinator', lane: box.lane, title: 'Study parity item',
    criterion: 'Every field reaches both readers.', brief: 'A seeded brief.', specIds: [] });
  store.appendFact(board, item, { agentId: 'coordinator', kind: 'measurement', text: 'Measured seed observation.' });
  const decision = store.shout(board, { from: 'coordinator', to: 'person', text: 'Seeded person decision?', lanes: [box.lane], decision: true });
  store.shout(board, { from: 'coordinator', to: 'all', text: 'Seeded answer.', lanes: [box.lane], answers: decision });
  store.shout(board, { from: 'coordinator', to: 'all', text: 'Open coordinator question?', lanes: [box.lane], decision: true });
  const project = { root: box.root, name: 'study', project: '', added: '2026-10-25T00:00:00.000Z' };
  const api = await serveApi({ runCommand: main, projects: () => [project], stateDetail: 'full' });
  t.after(() => api.close());
  const address = new URL(api.url);
  const fixture = { origin: address.origin, secret: address.searchParams.get('k') };
  const listing = await (await apiFetch(fixture, '/api/v1/boards')).json();
  const id = listing.boards[0].id;
  const native = (await (await apiFetch(fixture, '/api/v1/boards/' + id + '/state')).json()).state;
  const relay = presentationState(relayPresentation(box.root), id);
  const nativePaths = paths(native), relayPaths = paths(relay);
  const onlyNative = [...nativePaths].filter(path => !relayPaths.has(path)).sort();
  const onlyRelay = [...relayPaths].filter(path => !nativePaths.has(path)).sort();
  t.diagnostic(JSON.stringify({ phase: 'native-versus-relay-reader', node: process.versions.node,
    nativePaths: nativePaths.size, relayPaths: relayPaths.size, onlyNative, onlyRelay,
    differingValues: valueDifferences(native, relay),
    scope: 'One seeded board read twice at once: GET /api/v1/boards/:id/state (stateDetail full, the native view) and relayPresentation through presentationState (what a relay reader renders).' }));
});
