/** Real Git conflict inspection and landing share conservative mechanical resolutions [B3,R3,C7]. */
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { runFixtureChild, runFixtureGit } from './fixture-child.js';
import { cleanGitEnvironment } from '../src/git.js';
import { conflictFiles } from '../src/health.js';
import { recordedTrunkMerge, trunkMerge } from '../src/trunk-merge.js';
import { resolveMechanicalMerge } from '../src/train-mechanical-merge.js';

const directories = [];
after(() => directories.forEach(root => rmSync(root, { recursive: true, force: true })));

/** Build divergent real commits without inherited Git identity or repository selectors. */
function fixture(path, base, left, right, extra = {}) {
  const root = mkdtempSync(join(tmpdir(), 'pullboard-mechanical-'));
  directories.push(root);
  const env = { ...cleanGitEnvironment(), GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'Mechanical fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
    GIT_COMMITTER_NAME: 'Mechanical fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid' };
  /** Execute only fixture-owned Git commands. */
  const git = (...args) => runFixtureGit(args, { cwd: root, env });
  /** Write a real source file and its parent directories. */
  function write(file, source) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), source);
  }
  /** Commit the exact selected fixture version. */
  function commit(source, message) {
    write(path, source);
    git('add', '-A');
    git('commit', '-q', '-m', message);
    return git('rev-parse', 'HEAD');
  }
  git('init', '-q', '-b', 'main');
  for (const [file, source] of Object.entries(extra)) write(file, source);
  const ancestor = commit(base, 'chore: fixture base');
  git('checkout', '-q', '-b', 'candidate');
  const head = commit(right, 'feat: candidate');
  git('checkout', '-q', 'main');
  const trunk = commit(left, 'feat: trunk');
  return { root, env, git, write, path, ancestor, head, trunk };
}

/** Pin the actual checkout/index before all read-only conflict entry points. */
function inspect(box, expected) {
  const status = box.git('status', '--porcelain=v1', '-z');
  const index = readFileSync(join(box.root, '.git', 'index'));
  assert.deepEqual(conflictFiles(box.root, box.trunk, box.head), expected);
  assert.deepEqual(trunkMerge(box.root, box.head).files, expected.length ? expected : null);
  assert.deepEqual(recordedTrunkMerge(join(box.root, '.git'), box.head, box.trunk), expected.length ? expected : null);
  assert.equal(box.git('status', '--porcelain=v1', '-z'), status);
  assert.deepEqual(readFileSync(join(box.root, '.git', 'index')), index);
  assert.equal(box.git('rev-parse', 'HEAD'), box.trunk);
}

/** Resolve through the actual landing resolver and finish a real Git merge. */
function land(box, expected) {
  const merge = runFixtureChild('git', ['merge', '--no-ff', '--no-commit', box.head],
    { cwd: box.root, env: box.env, encoding: 'utf8' });
  assert.equal(merge.status, 1, `${merge.stdout}\n${merge.stderr}`);
  assert.ok(resolveMechanicalMerge(box.root, [box.path]));
  assert.equal(readFileSync(join(box.root, box.path), 'utf8'), expected);
  box.git('add', '--', box.path);
  box.git('commit', '-q', '-m', 'chore: land mechanical merge');
  assert.equal(box.git('show', `HEAD:${box.path}`), expected.trimEnd());
  assert.equal(box.git('merge-base', '--is-ancestor', box.head, 'HEAD'), '');
}

test('JSON snapshots keep independent keys, removals, null and raised counters through inspection and landing [B3,R3,C7]', () => {
  const box = fixture('test/move-registry-baseline.json',
    '{"keep":1,"remove":true,"counter":2,"list":["base"],"nullable":null}\n',
    '{"keep":1,"counter":3,"list":["base","left"],"nullable":null,"left":true}\n',
    '{"keep":1,"remove":true,"counter":4,"list":["base","right"],"nullable":null,"right":true}\n');
  inspect(box, []);
  const expected = { keep: 1, counter: 4, list: ['base', 'left', 'right'], nullable: null, left: true, right: true };
  land(box, JSON.stringify(expected) + '\n');
});

test('add-only Markdown retains both contributors without reopening [B3,R3,C7]', () => {
  const box = fixture('docs/api.md', '# API\n\nEnd.\n', '# API\n\nLeft.\nEnd.\n', '# API\n\nRight.\nEnd.\n');
  inspect(box, []);
  land(box, '# API\n\nLeft.\nRight.\nEnd.\n');
});

test('generated lifecycle is classified without executing item code and regenerated only by landing [B3,R3,C7]', () => {
  const box = fixture('docs/lifecycle.md', 'old\n', 'left\n', 'right\n', {
    'package.json': '{"type":"module"}\n',
    'bin/pullboard.js': "import {writeFileSync} from 'node:fs'; writeFileSync('executed', 'yes'); console.log('regenerated');\n",
  });
  inspect(box, []);
  assert.equal(box.git('status', '--porcelain'), '', 'inspection never runs the candidate generator');
  land(box, 'regenerated\n');
  assert.equal(readFileSync(join(box.root, 'executed'), 'utf8'), 'yes');
});

for (const [name, path, base, left, right] of [
  ['same-line edits', 'docs/api.md', 'Original.\n', 'Left edit.\n', 'Right edit.\n'],
  ['conflicting JSON scalars', 'snapshot.json', '{"value":"base"}\n', '{"value":"left"}\n', '{"value":"right"}\n'],
  ['a decreased counter', 'snapshot.json', '{"value":2}\n', '{"value":1}\n', '{"value":3}\n'],
  ['delete versus edit', 'snapshot.json', '{"value":null}\n', '{}\n', '{"value":1}\n'],
  ['an invalid JavaScript union', 'src/cli.js', 'export {};\n', 'const value = 1;\nexport {};\n', 'const value = 2;\nexport {};\n'],
]) {
  test(`${name} remains a real conflict [B3,R3,C7]`, () => {
    const box = fixture(path, base, left, right);
    inspect(box, [path]);
    assert.equal(runFixtureChild('git', ['merge', '--no-commit', box.head],
      { cwd: box.root, env: box.env, encoding: 'utf8' }).status, 1);
    const before = readFileSync(join(box.root, path));
    assert.equal(resolveMechanicalMerge(box.root, [path]), null);
    assert.deepEqual(readFileSync(join(box.root, path)), before, 'a refused resolution leaves the merge for normal conflict handling');
  });
}
