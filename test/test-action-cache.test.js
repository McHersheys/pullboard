/** @pullboard-test-input source-tree */
/** A test file whose inputs did not change reuses its green result; a changed import, a red result or a bad entry runs it [C7]. */
import assert from 'node:assert/strict';
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { runFixtureChild, runFixtureGit } from './fixture-child.js';
import { suiteProven } from '../src/test-action-cache.js';

const runner = fileURLToPath(new URL('../bin/run-tests.js', import.meta.url));
const source = fileURLToPath(new URL('../src', import.meta.url));

/** A fixture test that records its own name, then passes when its module says so. */
function fixtureTest(name, module) {
  return `import { appendFileSync } from 'node:fs';
import { test } from 'node:test';
import { value } from '../lib/${module}.js';
/** Record that this file ran, then check its module. */
function check() { appendFileSync(process.env.PULLBOARD_ACTION_CAPTURE, '${name}\\n'); if (value !== 'green') throw new Error('${name} is red'); }
test('${name} [C7]', check);
`;
}

/** A committed repository with the real runner, three tests and their modules: A imports shared, B and C stand alone. */
function makeFixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'pullboard-test-actions-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const folder of ['bin', 'lib', 'test']) mkdirSync(join(root, folder));
  copyFileSync(runner, join(root, 'bin', 'run-tests.js'));
  cpSync(source, join(root, 'src'), { recursive: true });
  writeFileSync(join(root, '.gitignore'), 'bin/\nsrc/\nmachine/\n');
  writeFileSync(join(root, 'package.json'), JSON.stringify({ type: 'module' }));
  writeFileSync(join(root, 'lib', 'shared.js'), "export const shared = 'green';\n");
  writeFileSync(join(root, 'lib', 'a.js'), "import { shared } from './shared.js';\nexport const value = shared;\n");
  writeFileSync(join(root, 'lib', 'b.js'), "export const value = 'green';\n");
  writeFileSync(join(root, 'lib', 'c.js'), "export const value = 'red';\n");
  for (const name of ['a', 'b', 'c']) writeFileSync(join(root, 'test', `${name}.test.js`), fixtureTest(name, name));
  const capture = join(root, 'machine', 'ran.txt');
  const env = { ...process.env, PULLBOARD_MACHINE_HOME: join(root, 'machine'), PULLBOARD_ACTION_CAPTURE: capture, PULLBOARD_LANDING_RUN: '0',
    GIT_AUTHOR_NAME: 'Action Fixture', GIT_AUTHOR_EMAIL: 'action@example.test', GIT_COMMITTER_NAME: 'Action Fixture', GIT_COMMITTER_EMAIL: 'action@example.test' };
  for (const key of ['PULLBOARD_GATE_SLOT_HELD', 'PULLBOARD_GATE_SLOT_POOL', 'PULLBOARD_GATE_SLOT_TOKEN', 'PULLBOARD_BROWSER_SLOT_HELD', 'PULLBOARD_TEST_STAGE', 'PULLBOARD_TEST_ACTIONS', 'PULLBOARD_TEST_REUSE']) delete env[key];
  mkdirSync(join(root, 'machine'));
  /** Run one fixture git command under the private environment. */
  const git = (...args) => runFixtureGit(args, { cwd: root, env });
  git('init', '-q', '-b', 'main');
  git('add', '.gitignore', 'package.json', 'lib', 'test');
  git('commit', '-q', '-m', 'fixture');
  /** Commit one module's new text. */
  const change = (path, text) => { writeFileSync(join(root, path), text); git('commit', '-q', '-m', `change ${path}`, '--', path); };
  /** Run the whole suite through the real runner; return its status, output and the files that ran. */
  const run = () => {
    writeFileSync(capture, '');
    const result = runFixtureChild(process.execPath, ['bin/run-tests.js'], { cwd: root, env, encoding: 'utf8', timeout: 25_000 });
    const ran = readFileSync(capture, 'utf8').trim().split('\n').filter(Boolean).sort();
    return { status: result.status, output: `${result.stdout}\n${result.stderr}`, ran, context: result.context };
  };
  const store = join(root, '.git', 'pullboard', 'test-actions');
  return { root, change, run, store };
}

test('an unchanged closure reuses its green result and a changed import reruns it [C7]', (t) => {
  const fixture = makeFixture(t);
  const first = fixture.run();
  assert.equal(first.status, 1, `C is red, so the first run fails\n${first.output}`);
  assert.deepEqual(first.ran, ['a', 'b', 'c'], 'every file runs when nothing is stored');

  // 1. A module only B imports changes: B runs, A is reused, C runs because a red result is never reused (3).
  fixture.change('lib/b.js', "export const value = 'green'; // edited\n");
  const second = fixture.run();
  assert.deepEqual(second.ran, ['b', 'c'], second.output);
  assert.match(second.output, /^# reused [0-9a-f]{64} from \S+ [0-9a-f]{40} \(test\/a\.test\.js\)$/mu);
  assert.doesNotMatch(second.output, /reused .*\(test\/(?:b|c)\.test\.js\)/u);

  // 2. A module A imports changes: A runs and B is reused; C still runs.
  fixture.change('lib/shared.js', "export const shared = 'green'; // edited\n");
  const third = fixture.run();
  assert.deepEqual(third.ran, ['a', 'c'], third.output);
  assert.match(third.output, /^# reused [0-9a-f]{64} from \S+ [0-9a-f]{40} \(test\/b\.test\.js\)$/mu);
  assert.equal(readdirSync(join(fixture.store, 'red')).length, 1, 'C has one red key, written once and kept');

  // 4. A missing entry (A) and a corrupt entry (B) both run their file; C turns green under a new key and runs.
  const entries = readdirSync(join(fixture.store, 'green'))
    .map(name => [name, JSON.parse(readFileSync(join(fixture.store, 'green', name), 'utf8')).file]);
  assert.deepEqual([...new Set(entries.map(([, file]) => file))].sort(), ['test/a.test.js', 'test/b.test.js'], 'only green files are stored');
  for (const [name, file] of entries) {
    if (file === 'test/a.test.js') rmSync(join(fixture.store, 'green', name));
    else writeFileSync(join(fixture.store, 'green', name), '{"version":1,"key":');
  }
  fixture.change('lib/c.js', "export const value = 'green';\n");
  const fourth = fixture.run();
  assert.equal(fourth.status, 0, fourth.output);
  assert.deepEqual(fourth.ran, ['a', 'b', 'c'], fourth.output);

  // Nothing changed since a green run: no file runs and the suite is proven from reused results alone.
  const fifth = fixture.run();
  assert.equal(fifth.status, 0, fifth.output);
  assert.deepEqual(fifth.ran, [], fifth.output);
  assert.equal(fifth.output.match(/^# reused /gmu)?.length, 3, fifth.output);
  assert.match(fifth.output, /^# all 3 test files reused; none ran$/mu);
});

test('only passing results under the current key prove the whole suite [C7]', () => {
  const files = ['test/a.test.js', 'test/b.test.js'];
  const fresh = { status: 'pass', source: 'fresh' };
  const reused = { status: 'pass', source: 'reused', key: 'k1', currentKey: 'k1' };
  assert.equal(suiteProven(files, new Map([[files[0], fresh], [files[1], reused]])).proven, true);
  assert.deepEqual(suiteProven(files, new Map([[files[0], fresh]])).missing, [files[1]]);
  assert.deepEqual(suiteProven(files, new Map([[files[0], fresh], [files[1], { ...fresh, status: 'fail' }]])).failed, [files[1]]);
  assert.deepEqual(suiteProven(files, new Map([[files[0], fresh], [files[1], { ...reused, currentKey: 'k2' }]])).stale, [files[1]]);
  assert.equal(suiteProven([], new Map()).proven, false, 'an empty suite proves nothing');
});
