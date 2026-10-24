/** Ordered withdrawal preserves old reopen meanings and binds immutable review identities [V2,V6,H16]. */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import * as store from '../src/board.js';
import { applyRelayMove, prepareEngineMove } from '../src/engine.js';
import { exportBoard, importBoard } from '../src/exchange.js';
import { moveArgs } from '../src/api-moves.js';
import { VERDICT_WITHDRAW_ENGINE } from '../src/verdict-withdraw-engine.js';
import { createE2eHelpers } from './e2e-helpers.js';

const e2e = createE2eHelpers();
after(e2e.cleanup);

/** Obtain an accepted snapshot through actual joined Git checkouts and native submission/review. */
function acceptedSnapshot() {
  const box = e2e.project();
  assert.equal(box.run(box.repo, 'add', 'web', 'Withdrawal engine fixture', '--specs', 'G1', '--criterion', 'The page renders.').code, 0);
  assert.equal(box.run(box.web, 'claim', '1').code, 0);
  assert.equal(e2e.commitFile(box, box.web, 'web/page.html', '<h1>Page</h1>', 'feat(web): page [G1]').status, 0);
  assert.equal(box.run(box.web, 'submit', '1').code, 0);
  const reviewer = join(box.dir, 'reviewer');
  box.git(box.repo, 'worktree', 'add', '-q', reviewer, '-b', 'api/reviewer');
  assert.equal(box.run(reviewer, 'join', 'api').code, 0);
  assert.equal(box.run(reviewer, 'next', '--verify', '1').code, 0);
  box.git(reviewer, 'switch', '-q', '--detach', box.git(box.web, 'rev-parse', 'HEAD'));
  const accepted = box.run(reviewer, 'verify', '1', 'accept', '--note', 'native private check passed', '--json');
  assert.equal(accepted.code, 0, accepted.err + accepted.out);
  const board = store.openBoard(join(box.repo, '.git', 'pullboard', 'board.sqlite'));
  try { return exportBoard(board); } finally { store.closeBoard(board); }
}

test('withdrawal true is engine-fenced while false retains historical reopen meaning [V2,V6,H16]', t => {
  const snapshot = acceptedSnapshot(), directory = mkdtempSync(join(tmpdir(), 'pullboard-withdraw-engine-'));
  const boards = ['false', 'old-true', 'current'].map(name => {
    const board = store.openBoard(join(directory, name + '.sqlite'));
    importBoard(board, snapshot);
    return board;
  });
  t.after(() => { for (const board of boards) store.closeBoard(board); rmSync(directory, { recursive: true, force: true }); });
  const receipt = { sequence: 1, at: new Date().toISOString(), kind: 'move',
    sender: { kind: 'agent', userId: 'fixture-user', agent: 'coordinator' } };
  const ordinary = prepareEngineMove(boards[0], 'reopen', [1, { agentId: 'coordinator', note: 'ordinary correction', withdrawVerdict: false }],
    { id: 'legacy-false', actor: 'coordinator' });
  const oldResult = applyRelayMove(boards[0], { ...ordinary, engine: VERDICT_WITHDRAW_ENGINE - 1 }, receipt);
  assert.equal(oldResult.error.code, 'LANDING_FAILURE_REQUIRED');
  assert.equal(store.getItem(boards[0], 1).item_status, 'verified');
  assert.equal(store.verdictsFor(boards[0], 1)[0].withdrawn, undefined);
  const withdraw = prepareEngineMove(boards[1], 'reopen', [1, { agentId: 'coordinator', note: 'recorded ruling missed', withdrawVerdict: true }],
    { id: 'withdraw-current', actor: 'coordinator' });
  const before = exportBoard(boards[1]);
  assert.throws(() => applyRelayMove(boards[1], { ...withdraw, engine: VERDICT_WITHDRAW_ENGINE - 1 }, receipt), error => error.code === 'ENGINE_VERSION');
  assert.deepEqual(exportBoard(boards[1]), before, 'an impossible older tag refuses before any row or cursor changes');
  const current = applyRelayMove(boards[2], withdraw, receipt);
  assert.equal(current.error, undefined, JSON.stringify(current));
  assert.equal(store.getItem(boards[2], 1).item_status, 'open');
  assert.equal(store.verdictsFor(boards[2], 1)[0].withdrawn, true);
  const after = exportBoard(boards[2]);
  applyRelayMove(boards[2], withdraw, receipt);
  assert.deepEqual(exportBoard(boards[2]), after, 'a duplicate ordered withdrawal does not add another event');
});

test('the API carries withdrawal as a boolean without changing note boundaries [A2,H16]', () => {
  assert.deepEqual(moveArgs({ verb: 'reopen', item: 7, args: { 'withdraw-verdict': true, note: 'a note --conflict literal' } }),
    ['reopen', '7', '--note=a note --conflict literal', '--withdraw-verdict', '--json', '--']);
  assert.throws(() => moveArgs({ verb: 'reopen', item: 7, args: { 'withdraw-verdict': 'true', note: 'why' } }), /BAD_REQUEST/u);
});
