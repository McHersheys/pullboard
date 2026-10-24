/** Local heartbeat and foreign shared fencing use independent physical SQLite replicas [Q1,Q3,H16,E19]. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import * as store from '../src/board.js';
import { applyEngineMove, prepareEngineMove } from '../src/engine.js';
import { exportBoard, importBoard, semanticBoardDigest } from '../src/exchange.js';
import { assertLandingLease } from '../src/landing-lease.js';
import { LANDING_LOCAL_PREFIX } from '../src/landing-local-lease.js';
import { takeLandingResource } from '../src/landing-resource.js';

/** Give each test two physical boards and a private receipt clock, never a live coordinator credential. */
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'pullboard-local-heartbeat-'));
  let at = Date.parse('2026-01-01T00:00:00Z');
  const boards = [0, 1].map(index => store.openBoard(join(dir, `${index}.sqlite`), { now: () => new Date(at) }));
  store.register(boards[0], { lane: 'coordinator', path: dir });
  let sequence = 0;
  /** Apply a real ordered private engine receipt with the declared coordinator machine. */
  const move = (board, operation, args, lineage = 'private-lineage-a', machine = 'private-machine-a') => {
    const prepared = { ...prepareEngineMove(board, operation, args), holder: machine };
    const result = applyEngineMove(board, prepared, { sequence: ++sequence, at: new Date(at).toISOString(), standing: { root: true, lineage } });
    assert.equal(result.error, undefined, JSON.stringify(result.error));
    return result.result;
  };
  t.after(() => { for (const board of boards) store.closeBoard(board); rmSync(dir, { recursive: true, force: true }); });
  return { boards, move, advance(ms) { at += ms; } };
}

/** Drain promise continuations after advancing only this test's heartbeat intervals. */
async function settle() { for (let turn = 0; turn < 12; turn += 1) await Promise.resolve(); }

test('a relay stalled for 120 seconds cannot block the holder local landing heartbeat [Q1,Q3,H16]', async t => {
  const box = fixture(t); const [board, replica] = box.boards;
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: Date.parse('2026-01-01T00:00:00Z') });
  const actions = [];
  const lease = await takeLandingResource({ board, branch: 'refs/heads/main',
    write: async (operation, args) => {
      actions.push(args[0].action);
      if (args[0].action === 'renew') return new Promise(() => {}); // stand-in relay never acknowledges renewal.
      return box.move(board, operation, args);
    } });
  try {
    const shared = exportBoard(board);
    const digest = semanticBoardDigest(shared);
    for (let step = 0; step < 24; step += 1) {
      box.advance(5000); t.mock.timers.tick(5000); await settle();
    }
    await lease.assertHeld();
    assert.deepEqual(actions, ['request'], '120 seconds of heartbeats never invoked the stalled relay writer');
    assert.equal(semanticBoardDigest(exportBoard(board)), digest, 'local deadlines do not change shared semantic state');
    assert.ok(Date.parse(lease.assertCurrent().until) > board.clock.now().getTime());
    assert.equal(shared.tables.board_meta.some(row => row.meta_key.startsWith(LANDING_LOCAL_PREFIX)), false);
    importBoard(replica, shared);
    assert.equal(replica.db.prepare('SELECT count(*) AS n FROM board_meta WHERE meta_key GLOB ?').get(LANDING_LOCAL_PREFIX + '*').n, 0);
    importBoard(board, shared, true);
    assertLandingLease(board, lease.fence); // checkpoint replacement retains only this physical board's local heartbeat.
    const foreign = { agentId: 'coordinator', action: 'request', token: randomUUID(), branch: 'refs/heads/main', pid: process.pid };
    assert.equal(store.landingLeaseMove(replica, foreign).acquired, false, 'a replica cannot grant past unseen local renewals using its expired shared clock');
    store.landingLeaseMove(replica, { agentId: 'coordinator', action: 'release', ...lease.fence });
    assert.equal(store.landingLeaseMove(replica, foreign).acquired, true, 'explicit release admits the foreign waiter');
  } finally { await lease.release(); }
});

test('coordinator takeover fences an unreleased foreign landing without inventing a new expiry [Q1,Q3,E19]', t => {
  const box = fixture(t); const [board, replica] = box.boards;
  const first = { agentId: 'coordinator', action: 'request', token: randomUUID(), branch: 'refs/heads/main', pid: process.pid };
  const grant = box.move(board, 'landingLeaseMove', [first]);
  importBoard(replica, exportBoard(board));
  box.advance(120_000);
  const second = { ...first, token: randomUUID() };
  assert.equal(store.landingLeaseMove(replica, second).acquired, false);
  box.move(replica, 'takeCoordinator', [{ agentId: 'coordinator', machine: 'private-machine-b' }], 'private-lineage-b', 'private-machine-b');
  assert.throws(() => assertLandingLease(replica, { ...first, generation: grant.generation }), error => error.code === 'LAND_LEASE_LOST');
  const successor = box.move(replica, 'landingLeaseMove', [second], 'private-lineage-b', 'private-machine-b');
  assert.equal(successor.acquired, true);
  assert.ok(successor.generation > grant.generation);
});
