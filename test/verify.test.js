/** Historical item authors cannot judge their own work after another seat takes over [V1,B3,C7]. */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import * as store from '../src/board.js';
import { submitFixture } from './board-submit-fixture.js';
import { createE2eHelpers } from './e2e-helpers.js';

/** Read a successful JSON CLI response; setup failures must not masquerade as eligibility failures. */
function document(result) {
  assert.equal(result.code, 0, result.err || result.out);
  return JSON.parse(result.out);
}

/** A refusal leaves the submitted item and event stream untouched. */
function refused(box, board, cwd, args, expected) {
  const before = store.events(board);
  const result = box.run(cwd, ...args, '--json');
  assert.equal(result.code, 1, result.err || result.out);
  assert.equal(JSON.parse(result.out).error.code, expected, result.out);
  assert.deepEqual(store.events(board), before);
  assert.equal(store.getItem(board, 1).item_review_by, null);
}

test('a reviewer is refused for any item its session ever built [V1,B3,C7]', (t) => {
  const helpers = createE2eHelpers();
  t.after(helpers.cleanup);
  const box = helpers.project('true');
  const board = store.openBoard(join(box.repo, '.git', 'pullboard', 'board.sqlite'));
  t.after(() => store.closeBoard(board));
  const first = document(box.run(box.web, 'whoami', '--json')).id;
  // Bind an original seat without writing a claim digest. Native/legacy moves still name their agent in events.
  box.env.CODEX_THREAD_ID = 'historical-author-session-1085';
  document(box.run(box.web, 'shout', 'coordinator', 'the original author is here', '--json'));
  delete box.env.CODEX_THREAD_ID;
  const secondPath = join(box.dir, 'second-builder');
  box.git(box.repo, 'worktree', 'add', '-q', '--detach', secondPath, 'main');
  const second = document(box.run(secondPath, 'join', 'web', '--json')).agent;
  const id = store.addItem(board, { by:'coordinator', lane:'web', title:'A handed-over item', criterion:'The page is ready.', check:'true', specs:'G1' });
  const freeze = () => ({ text:JSON.stringify({ rows:[] }), digest:'historical-author-1085' });
  const claim = agentId => store.claim(board, id, { agentId, lane:'web', leaseMs:3_600_000, freeze });
  claim(first);
  const oldHead = box.git(box.web, 'rev-parse', 'HEAD');
  submitFixture(board, id, { agentId:first, commit:oldHead, tree:box.git(box.web, 'rev-parse', 'HEAD^{tree}') });
  store.reopen(board, id, { agentId:'coordinator', note:'Another builder will continue this item.' });
  claim(second);
  const committed = helpers.commitFile(box, secondPath, 'web/ready.txt', 'ready\n', 'feat(web): finish the handed-over item [G1]');
  assert.equal(committed.status, 0, committed.stderr);
  const head = box.git(secondPath, 'rev-parse', 'HEAD');
  submitFixture(board, id, { agentId:second, commit:head, tree:box.git(secondPath, 'rev-parse', 'HEAD^{tree}') });
  assert.equal(store.getItem(board, id).item_built_by, second);
  assert.equal(existsSync(join(box.repo, '.git', 'pullboard', 'item-sessions.jsonl')), false,
    'the regression exercises historical event authors, not an already-protective session ledger entry');
  const before = store.events(board);
  const who = { agentId:first, lane:'web', leaseMs:3_600_000, policy:'any' };
  assert.throws(() => store.reserveReview(board, id, who), error => error.code === 'SELF_VERIFY');
  assert.equal(store.reserveNextReview(board, who).item, null, 'the old builder is not offered its former work');
  assert.throws(() => store.verify(board, id, { agentId:first, decision:'REJECT', reason:'TEST_FAILURE', note:'synthetic review attempt', head, digest:freeze().digest, policy:'any' }), error => error.code === 'SELF_VERIFY');
  assert.deepEqual(store.events(board), before, 'raw board refusals add no reservations or verdicts');
  const review = join(box.dir, 'reviewer');
  box.git(box.repo, 'worktree', 'add', '-q', '--detach', review, head);
  box.env.CODEX_THREAD_ID = 'historical-author-session-1085';
  document(box.run(review, 'join', 'web', '--json'));
  refused(box, board, review, ['next','--verify',String(id)], 'SELF_SESSION_VERIFY');
  refused(box, board, review, ['next','--verify'], 'NOTHING_FREE');
  refused(box, board, review, ['verify',String(id),'reject','--reason','TEST_FAILURE','--note','synthetic review attempt'], 'SELF_SESSION_VERIFY');
  box.env.CODEX_THREAD_ID = 'unrelated-reviewer-session-1085';
  document(box.run(review, 'takeover', '--json'));
  const offered = document(box.run(review, 'next', '--verify', String(id), '--json'));
  assert.equal(offered.item.item_id, id, 'an unrelated session is offered the submitted work');
  assert.notEqual(store.getItem(board, id).item_review_by, first);
});
