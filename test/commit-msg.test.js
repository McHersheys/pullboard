/** A fresh board's real installed hook accepts only its live claimed item as a temporary citation [I1,N26]. */
import assert from 'node:assert/strict';
import {
  mkdirSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import {
  after,
  test,
} from 'node:test';
import { createE2eHelpers } from './e2e-helpers.js';

const e2e = createE2eHelpers();
after(e2e.cleanup);

/** Require a real CLI move to succeed before a dependent fixture step. */
function moved(box, root, ...args) {
  const result = box.run(root, ...args);
  assert.equal(result.code, 0, result.err || result.out);
  return result;
}

test('a fresh board accepts a first commit that cites its item [I1,N26]', () => {
  const box = e2e.sandbox();
  const repo = join(box.dir, 'fresh');
  mkdirSync(repo);
  box.git(repo, 'init', '-q', '-b', 'main');
  moved(box, repo, 'init');
  moved(box, repo, 'lane', 'add', 'app', '--owns', 'app/');
  mkdirSync(join(repo, 'app'));
  box.git(repo, 'add', '-A');
  box.git(repo, 'commit', '-q', '-m', 'chore: set up the fresh board');
  const rows = JSON.parse(moved(box, repo, 'spec', '--json').out).rows;
  assert.equal(rows.filter(row => row.file === 'SPEC.md' && row.status === 'approved').length, 0, 'the real fresh board has no approved row');
  for (const title of ['Own first feature', 'Another builder feature', 'Unclaimed feature']) {
    moved(box, repo, 'add', 'app', title, '--criterion', title + ' works.');
  }
  const own = join(box.dir, 'own');
  const other = join(box.dir, 'other');
  for (const root of [own, other]) {
    box.git(repo, 'worktree', 'add', '-q', '--detach', root, 'main');
    moved(box, root, 'join', 'app');
  }
  moved(box, own, 'claim', '1');
  moved(box, other, 'claim', '2');
  mkdirSync(join(own, 'app'));
  writeFileSync(join(own, 'app/first.txt'), 'first useful feature\n');
  box.git(own, 'add', 'app/first.txt');
  for (const citation of ['#999', '#3', '#2']) {
    const refused = box.tryGit(own, 'commit', '-q', '-m', `feat(app): build the first feature ${citation}`);
    assert.notEqual(refused.status, 0, citation + ' cannot replace an owned live claim');
    assert.match(refused.stderr, /pullboard commit-msg/iu, 'the actual installed message hook refuses the citation');
  }
  moved(box, own, 'release', '1');
  const released = box.tryGit(own, 'commit', '-q', '-m', 'feat(app): build the first feature #1');
  assert.notEqual(released.status, 0, 'a released claim cannot authorize a citation');
  moved(box, own, 'claim', '1');
  const first = box.tryGit(own, 'commit', '-q', '-m', 'feat(app): build the first feature #1');
  assert.equal(first.status, 0, first.failure || first.stderr || first.stdout);

  const drafted = JSON.parse(moved(box, repo, 'spec', 'draft', 'The first useful feature works.', '--json').out).id;
  moved(box, repo, 'spec', 'approve', drafted);
  moved(box, repo, 'spec', 'apply');
  box.git(repo, 'add', 'SPEC.md');
  box.git(repo, 'commit', '-q', '-m', 'docs: record the approved requirement');
  box.git(own, 'merge', '--no-edit', 'main');
  writeFileSync(join(own, 'app/first.txt'), 'first useful feature with an approved requirement\n');
  box.git(own, 'add', 'app/first.txt');
  for (const header of ['feat(app): extend the first feature', 'feat(app): extend the first feature #1']) {
    const refused = box.tryGit(own, 'commit', '-q', '-m', header);
    assert.notEqual(refused.status, 0, 'approved boards retain their spec-citation requirement');
    assert.ok(refused.stderr.includes(drafted), 'the refusal names a real usable approved row');
  }
  const approved = box.tryGit(own, 'commit', '-q', '-m', `feat(app): extend the first feature [${drafted}]`);
  assert.equal(approved.status, 0, approved.failure || approved.stderr || approved.stdout);
});
