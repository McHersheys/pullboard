/** @pullboard-test-loads src/board.js src/engine.js src/exchange.js src/machine.js */
/** Lifecycle activity retains its evidence without turning routine status into messages [B3,R2,N26,H16]. */
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { after, test } from 'node:test';
import * as store from '../src/board.js';
import { createE2eHelpers } from './e2e-helpers.js';
import { submitFixture } from './board-submit-fixture.js';

const e2e = createE2eHelpers();
after(e2e.cleanup);

/** Freeze a private item's exact requirement without claiming a test gate ran in this board-state fixture. */
function freeze() {
  return { text: JSON.stringify({ rows: [], policy: { version: 1, verify: { policy: 'any', family: 'off' } } }), digest: 'activity-fixture' };
}

test('status moves are feed events and the board sends no status shout [B3,R2,N26,H16]', t => {
  const box = e2e.project();
  const base = box.git(box.repo, 'rev-parse', 'HEAD');
  const committed = e2e.commitFile(box, box.web, 'web/activity.txt', 'private activity fixture\n', 'feat(web): activity fixture [G1]');
  assert.equal(committed.status, 0, committed.stderr);
  const commit = box.git(box.web, 'rev-parse', 'HEAD');
  const tree = box.git(box.web, 'rev-parse', 'HEAD^{tree}');
  const board = store.openBoard(join(box.repo, '.git', 'pullboard', 'board.sqlite'));
  t.after(() => store.closeBoard(board));
  const reviewer = store.register(board, { lane: 'api', path: join(box.dir, 'activity-reviewer') });
  const item = store.addItem(board, { by: 'coordinator', lane: 'web', title: 'Activity fixture' });
  const other = store.addItem(board, { by: 'coordinator', lane: 'web', title: 'Unrelated item' });
  const beforeShouts = board.db.prepare('SELECT * FROM shout ORDER BY shout_id').all();
  store.claim(board, item, { agentId: 'web-1', lane: 'web', leaseMs: 3600000, head: base, freeze });
  const evidence = { version: 1, files: [], full: false, deferred: true, reason: 'private lifecycle fixture, not gate evidence' };
  submitFixture(board, item, { agentId: 'web-1', commit, tree, note: 'The exact submit note stays in activity.', submissionProof: evidence });
  store.verify(board, item, { agentId: reviewer, decision: 'ACCEPT', note: 'Synthetic private lifecycle acceptance, not an execution claim.',
    head: commit, digest: freeze().digest, policy: 'any', familyPolicy: 'off', check: 'green',
    review: { commit, head: commit, trunk: base, paths: ['web/activity.txt'] } });
  const batch = { version: 1, id: 'activity-fixture', state: 'pushed', base, tip: commit,
    root: box.web, branch: 'refs/heads/main', owner: 'private-fixture', logPath: join(box.dir, 'activity.log'),
    items: [{ id: item, commit, merge: commit, reviewedCommit: commit }] };
  store.recordLandingBatch(board, { agentId: 'coordinator', batch });
  store.finishLandingBatch(board, { agentId: 'coordinator', id: batch.id, tip: commit });
  const thread = store.itemThread(board, item);
  assert.deepEqual(thread.filter(entry => ['claim', 'submit', 'accept', 'merged', 'main-moved'].includes(entry.kind)).map(entry => entry.kind),
    ['claim', 'submit', 'accept', 'merged', 'main-moved'], 'main moving reaches the landed item as activity');
  const submitted = thread.find(entry => entry.kind === 'submit');
  assert.equal(submitted.detail.note, 'The exact submit note stays in activity.');
  assert.deepEqual(submitted.detail.submissionProof, evidence);
  assert.equal(thread.find(entry => entry.kind === 'main-moved').detail.sha, commit);
  assert.equal(store.itemThread(board, other).some(entry => entry.kind === 'main-moved'), false, 'an unrelated item gets no landing activity');
  assert.deepEqual(board.db.prepare('SELECT * FROM shout ORDER BY shout_id').all(), beforeShouts, 'routine lifecycle writes no status shout');
  store.shout(board, { from: 'web-1', to: 'coordinator', lanes: ['web', 'api'], text: 'Who should coordinate the next review?' });
  assert.equal(board.db.prepare('SELECT shout_text FROM shout ORDER BY shout_id DESC LIMIT 1').get().shout_text,
    'Who should coordinate the next review?', 'agent-written coordination remains a shout');
});
