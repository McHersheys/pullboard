/** Real public submission, Git conflict resolution and immutable verdict coverage [V1,V4,H16]. */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import * as store from '../src/board.js';
import { createE2eHelpers } from './e2e-helpers.js';
import { captureMergeOnly } from '../src/merge-only-source.js';
import { runFixtureGit, runFixtureChild } from './fixture-child.js';

const e2e = createE2eHelpers();
after(e2e.cleanup);

/** Require the public command to succeed, retaining its complete diagnostic on refusal. */
function succeeds(box, cwd, ...args) {
  const result = box.run(cwd, ...args);
  assert.equal(result.code, 0, `${args.join(' ')}\n${result.out}\n${result.err}`);
  return result;
}

/** Read authoritative native item state and its append-only receipts. */
function state(box, id) {
  const board = store.openBoard(join(box.repo, '.git', 'pullboard', 'board.sqlite'));
  try {
    return { item: store.getItem(board, id), verdicts: store.verdictsFor(board, id),
      events: store.events(board, { itemId: id }) };
  } finally { store.closeBoard(board); }
}

/** Commit an actual same-line change while leaving a separate behavior line outside the conflict. */
function content(box, cwd, value, message) {
  const committed = e2e.commitFile(box, cwd, 'web/feature.js',
    `export const choice = '${value}';\n\nexport const unrelated = 'unchanged';\n`, message);
  assert.equal(committed.status, 0, committed.stderr);
  return box.git(cwd, 'rev-parse', 'HEAD');
}

test('a merge-only resubmission keeps its accept and records the resolution diff [V1,V4,H16]', () => {
  const box = e2e.project();
  mkdirSync(join(box.repo, 'web'), { recursive: true });
  content(box, box.repo, 'base', 'feat(web): initial choice [G1]');
  box.git(box.web, 'merge', '-q', '--no-edit', 'main');
  const added = succeeds(box, box.repo, 'add', 'web', 'Preserve accepted choice', '--specs', 'G1',
    '--criterion', 'The accepted choice survives a trunk-only merge', '--check', 'node --check web/feature.js', '--json');
  const id = JSON.parse(added.out).item.item_id;
  succeeds(box, box.web, 'claim', String(id));
  const accepted = content(box, box.web, 'accepted', 'feat(web): accepted choice [G1]');
  succeeds(box, box.web, 'submit', String(id));
  box.git(box.repo, 'switch', '-q', '--detach', accepted);
  try {
    succeeds(box, box.repo, 'verify', String(id), 'accept', '--as', 'coordinator', '--note', 'checked the complete choice criterion');
  } finally { box.git(box.repo, 'switch', '-q', 'main'); }
  const original = state(box, id);
  const trunk = content(box, box.repo, 'trunk', 'feat(web): another accepted trunk choice [G1]');
  succeeds(box, box.repo, 'reopen', String(id), '--conflict', 'web/feature.js');
  succeeds(box, box.web, 'claim', String(id));
  assert.equal(state(box, id).item.item_frozen_digest, original.item.item_frozen_digest);
  assert.notEqual(box.tryGit(box.web, 'merge', '-q', '--no-edit', 'main').status, 0);
  const head = content(box, box.web, 'resolved', 'fix(web): resolve the accepted trunk merge [G1]');
  assert.deepEqual(box.git(box.web, 'show', '-s', '--format=%P', head).split(' '), [accepted, trunk]);
  succeeds(box, box.web, 'submit', String(id));
  const carried = state(box, id);
  assert.equal(carried.item.item_status, 'verified', 'a gated merge-only resubmission keeps its original acceptance');
  assert.equal(carried.item.item_commit, head);
  assert.equal(carried.item.item_verified_by, original.item.item_verified_by);
  assert.deepEqual(carried.verdicts, original.verdicts, 'carry-over must not manufacture a second reviewer verdict');
  const receipt = carried.events.findLast(event => event.event_kind === 'merge-only-accept');
  assert.ok(receipt, 'the native receipt records why the existing accept carries');
  const detail = JSON.parse(receipt.event_detail);
  assert.equal(detail.acceptedCommit, accepted);
  assert.equal(detail.commit, head);
  assert.equal(detail.trunk, trunk);
  assert.equal(detail.digest, original.item.item_frozen_digest);
  assert.equal(detail.verdict, original.verdicts.at(-1).verdict_id);
  assert.match(detail.resolutionDiff, /web\/feature\.js/u);
  assert.match(detail.resolutionDiff, /resolved/u);
  const shown = succeeds(box, box.repo, 'show', String(id));
  assert.match(shown.out, /verified/u);
  assert.doesNotMatch(shown.out, /re-review: main merge only/u);
});

/** Make a small real Git conflict without pretending these synthetic identities are live reviewers. */
function sourceFixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'pullboard-merge-only-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'Merge fixture', GIT_AUTHOR_EMAIL: 'fixture@example.com',
    GIT_COMMITTER_NAME: 'Merge fixture', GIT_COMMITTER_EMAIL: 'fixture@example.com' };
  /** Run only bounded private Git fixture commands. */
  const git = (...args) => runFixtureGit(args, { cwd: root, env, timeout: 5000 });
  /** Commit one literal private file and return its content-addressed commit. */
  const save = (choice, unrelated = 'unchanged', amend = false) => {
    writeFileSync(join(root, 'hot.js'), `const choice = '${choice}';\n${'// stable context\n'.repeat(12)}const behavior = '${unrelated}';\n`);
    git('add', 'hot.js'); git('commit', '-q', ...(amend ? ['--amend'] : []), '-m', 'fixture');
    return git('rev-parse', 'HEAD');
  };
  git('init', '-q', '-b', 'main'); save('base'); git('switch', '-q', '-c', 'candidate');
  const accepted = save('accepted'); git('switch', '-q', 'main'); const trunk = save('trunk');
  git('switch', '-q', 'candidate');
  const merge = runFixtureChild('git', ['merge', '-q', '--no-edit', 'main'], { cwd: root, env, encoding: 'utf8', timeout: 5000 });
  assert.notEqual(merge.status, 0);
  const commit = save('resolved');
  const basis = { acceptedCommit: accepted, acceptedHead: accepted, digest: 'synthetic frozen bar',
    verdict: 1, reopen: 2, conflict: { trunk, files: ['hot.js'] }, review: { paths: ['hot.js'] } };
  /** Capture the exact current commit and tree as the post-gate CLI does. */
  const capture = () => captureMergeOnly(root, basis, { commit: git('rev-parse', 'HEAD'),
    tree: git('rev-parse', 'HEAD^{tree}'), trunk });
  return { root, git, save, accepted, trunk, commit, basis, capture };
}

test('extra behavioral edits in the same conflicted file need outside review [V1,V4]', t => {
  const box = sourceFixture(t);
  assert.ok(box.capture(), 'the actual resolution is eligible');
  box.save('resolved', 'changed behavior', true);
  assert.equal(box.capture(), null, 'a merge commit cannot exempt the whole hot file');
});

test('amended non-merge and stale head or tree proofs cannot retain an accept [V1,V4]', t => {
  const box = sourceFixture(t);
  const proof = box.capture();
  assert.ok(proof);
  assert.equal(captureMergeOnly(box.root, box.basis, { commit: box.commit, tree: box.accepted, trunk: box.trunk }), null);
  box.git('reset', '--hard', box.accepted);
  box.save('resolved', 'unchanged', true);
  assert.equal(box.capture(), null, 'an amended commit without the exact merge parents needs review');
});
