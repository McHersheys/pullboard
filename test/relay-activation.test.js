/** Indexed activation preserves the recorded prefix and exact grant floors [E21,H16,C7]. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as store from '../src/board.js';
import { agentGrantMinimum } from '../src/agent-grant.js';
import { AGENT_GRANT_ENGINE } from '../src/agent-grant-engine.js';
import { appliedSequence } from '../src/engine.js';
import { applyEngineMove } from '../src/engine.js';
import { prepareEngineMove } from '../src/engine.js';
import { exportBoard } from '../src/exchange.js';
import { importBoard } from '../src/exchange.js';

const AT = '2026-10-01T12:00:00.000Z';
const LEGACY = AGENT_GRANT_ENGINE - 1;

/** Execute real legacy receipts without activating grants merely by opening a newer writer. */
function fixture(t) {
  const board = store.openBoard(':memory:', { now: () => new Date(AT) });
  t.after(() => store.closeBoard(board));
  let number = 0;
  /** Use the actual engine, monotonically ordered positions and unique immutable move ids. */
  function move(operation, args, engine = LEGACY) {
    const request = { ...prepareEngineMove(board, operation, args, { id: `activation-${++number}` }), engine };
    const receipt = { sequence: appliedSequence(board) + 1, at: AT };
    const outcome = applyEngineMove(board, request, receipt);
    assert.equal(outcome.error, undefined, JSON.stringify(outcome));
    return { request, receipt, outcome };
  }
  move('register', [{ lane: 'coordinator', path: '/activation-fixture/main' }]);
  const actor = move('register', [{ lane: 'web', path: '/activation-fixture/web' }]).outcome.result;
  move('addItem', [{ by: 'coordinator', lane: 'web', title: 'Unmarked legacy item', criterion: 'Keep its original authority' }]);
  const probe = { ...prepareEngineMove(board, 'editItem', [1, { agentId: actor, title: 'A later edit' }]), engine: LEGACY };
  /** A real modern receipt is the witness, even when the activating operation is administrative. */
  const activate = () => move('shout', [{ from: 'coordinator', to: actor, text: 'Modern engine recorded', lanes: ['web'] }], AGENT_GRANT_ENGINE);
  return { board, actor, probe, move, activate };
}

/** Observe the real predicate's query plan without changing its SQL, bindings or result. */
function lookupPlan(board, probe) {
  const prepare = board.db.prepare.bind(board.db);
  const plans = [];
  board.db.prepare = sql => {
    if (sql.includes("meta_key GLOB 'relay_receipt_*'") && sql.includes('json_extract')) {
      plans.push(...prepare(`EXPLAIN QUERY PLAN ${sql}`).all(appliedSequence(board), AGENT_GRANT_ENGINE).map(row => row.detail));
    }
    return prepare(sql);
  };
  try { return { floor: agentGrantMinimum(board, probe), plans }; }
  finally { board.db.prepare = prepare; }
}

test('recorded activation preserves pre/post floors, acknowledged replay and administrative ordering [E21,H16]', t => {
  const box = fixture(t);
  const { board, actor, probe } = box;
  assert.equal(agentGrantMinimum(board, probe), 1);
  const old = box.move('shout', [{ from: actor, to: 'coordinator', text: 'Old acknowledged message', lanes: ['web'] }]);
  box.activate();
  assert.equal(agentGrantMinimum(board, probe), AGENT_GRANT_ENGINE);
  const cursor = appliedSequence(board);
  assert.throws(() => applyEngineMove(board, probe, { sequence: cursor + 1, at: AT }),
    error => error.code === 'RELAY_MOVE' && error.message.includes(String(AGENT_GRANT_ENGINE)));
  assert.equal(appliedSequence(board), cursor, 'a floor refusal does not advance the prefix');
  assert.deepEqual(applyEngineMove(board, old.request, old.receipt), old.outcome, 'acknowledged legacy replay remains exact');
  const administrative = { ...prepareEngineMove(board, 'shout', [{ from: actor, to: 'coordinator', text: 'Still administrative', lanes: ['web'] }]), engine: LEGACY };
  assert.equal(agentGrantMinimum(board, administrative), 1, 'current administrative early-return ordering is unchanged');
  assert.equal(applyEngineMove(board, administrative, { sequence: cursor + 1, at: AT }).error, undefined);
});

test('a rolled-back activation never becomes a witness [E21,H16]', t => {
  const box = fixture(t);
  const before = exportBoard(box.board);
  const original = new Error('rollback the genuine native activation');
  assert.throws(() => store.atomic(box.board, () => { box.activate(); throw original; }), error => error === original);
  assert.deepEqual(exportBoard(box.board), before, 'native events, receipts, cursor and identities roll back together');
  assert.equal(agentGrantMinimum(box.board, box.probe), 1);
  box.activate();
  assert.equal(agentGrantMinimum(box.board, box.probe), AGENT_GRANT_ENGINE, 'a later committed activation is visible');
});

test('import and replacement use their actual receipt witness rather than stale connection state [E21,H16]', t => {
  const box = fixture(t);
  const legacy = exportBoard(box.board);
  box.activate();
  const activated = exportBoard(box.board);
  const peer = store.openBoard(':memory:');
  t.after(() => store.closeBoard(peer));
  importBoard(peer, activated);
  assert.equal(agentGrantMinimum(peer, box.probe), AGENT_GRANT_ENGINE);
  importBoard(peer, legacy, { replace: true });
  assert.equal(agentGrantMinimum(peer, box.probe), 1, 'replacement removes the old witness on the same connection');
  importBoard(peer, activated, { replace: true });
  assert.equal(agentGrantMinimum(peer, box.probe), AGENT_GRANT_ENGINE);
});

test('a receipt beyond the applied cursor cannot activate the recorded prefix [E21,H16]', t => {
  const box = fixture(t);
  const before = appliedSequence(box.board);
  box.activate();
  // Disposable-fixture metadata models a stored receipt outside the restored applied prefix.
  box.board.db.prepare("UPDATE board_meta SET meta_value=? WHERE meta_key='relay_applied_sequence'").run(String(before));
  assert.equal(agentGrantMinimum(box.board, box.probe), 1, 'the witness must satisfy sequence <= the applied cursor');
  box.board.db.prepare("UPDATE board_meta SET meta_value=? WHERE meta_key='relay_applied_sequence'").run(String(before + 1));
  assert.equal(agentGrantMinimum(box.board, box.probe), AGENT_GRANT_ENGINE, 'the exact boundary includes its witness');
});

test('activation lookup seeks the engine index as genuine old receipts grow [E21,C7]', t => {
  const box = fixture(t);
  const observations = [];
  for (const population of [8, 1024]) {
    while (appliedSequence(box.board) < population) {
      box.move('shout', [{ from: box.actor, to: 'coordinator', text: `Legacy receipt ${appliedSequence(box.board)}`, lanes: ['web'] }]);
    }
    const lookup = lookupPlan(box.board, box.probe);
    observations.push({ receipts: population, ...lookup });
  }
  t.diagnostic(JSON.stringify({ method: 'actual predicate EXPLAIN QUERY PLAN at two native receipt populations; no wall-time inference', observations }));
  for (const { floor, plans } of observations) {
    assert.equal(floor, 1);
    assert.ok(plans.some(plan => /SEARCH board_meta USING INDEX board_meta_grant_activation_v1.*<expr>>\?/u.test(plan)),
      `lookup must seek qualifying engines instead of scanning every receipt: ${JSON.stringify(plans)}`);
  }
  box.activate();
  assert.equal(lookupPlan(box.board, box.probe).floor, AGENT_GRANT_ENGINE);
});
