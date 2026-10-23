/** Test the CI-like test runner against real Git and PATH behavior [C7, S13]. */
import assert from 'node:assert/strict';
import { runFixtureExecFile as execFileSync, runFixtureChild as spawnSync } from './fixture-child.js';
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { importsIn } from '../src/module-imports.js';

test('tests run without inherited Git identity or config and refuse ambient pullboard [C7, S13]', (t) => {
  assert.equal(process.env.GIT_CONFIG_GLOBAL, '/dev/null');
  assert.equal(process.env.GIT_CONFIG_NOSYSTEM, '1');
  assert.equal(process.env.GIT_CONFIG_COUNT, '3');
  assert.equal(process.env.GIT_CONFIG_KEY_0, 'user.useConfigOnly');
  assert.equal(process.env.GIT_CONFIG_VALUE_0, 'true');
  assert.equal(process.env.GIT_CONFIG_KEY_1, 'gc.auto');
  assert.equal(process.env.GIT_CONFIG_VALUE_1, '0');
  assert.equal(process.env.GIT_CONFIG_KEY_2, 'maintenance.auto');
  assert.equal(process.env.GIT_CONFIG_VALUE_2, 'false');
  assert.equal(process.env.GIT_AUTHOR_NAME, undefined);
  assert.equal(process.env.GIT_AUTHOR_EMAIL, undefined);
  assert.equal(process.env.GIT_COMMITTER_NAME, undefined);
  assert.equal(process.env.GIT_COMMITTER_EMAIL, undefined);
  assert.equal(process.env.SSH_CONNECTION, undefined);
  assert.equal(process.env.SSH_CLIENT, undefined);
  assert.equal(process.env.SSH_TTY, undefined);
  assert.equal(process.env.HOME, process.env.PULLBOARD_HOME);
  assert.ok(process.env.PULLBOARD_MACHINE_HOME.startsWith(join(process.env.TMPDIR, 'machine')));
  assert.ok(process.env.PULLBOARD_TEST_FILE.endsWith('test/test-runner.test.js'));

  const root = mkdtempSync(join(tmpdir(), 'pullboard-runner-git-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync('git', ['init', '-q', root]);
  const identity = spawnSync('git', ['var', 'GIT_AUTHOR_IDENT'], { cwd: root, encoding: 'utf8' });
  assert.notEqual(identity.status, 0, 'Git refuses to infer an author identity from the machine');
  assert.match(identity.stderr, /author identity unknown/i);
  const autoGc = spawnSync('git', ['config', '--get', 'gc.auto'], { cwd: root, encoding: 'utf8' });
  const autoMaintenance = spawnSync('git', ['config', '--get', 'maintenance.auto'], { cwd: root, encoding: 'utf8' });
  assert.equal(autoGc.status, 0, autoGc.stderr);
  assert.equal(autoGc.stdout.trim(), '0');
  assert.equal(autoMaintenance.status, 0, autoMaintenance.stderr);
  assert.equal(autoMaintenance.stdout.trim(), 'false');

  const refused = spawnSync('pullboard', ['init'], { cwd: root, encoding: 'utf8' });
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /pullboard is not installed/);
  assert.match(refused.stderr, /test-runner\.test\.js/);

  const fixtureShims = join(root, 'fixture-bin');
  mkdirSync(fixtureShims);
  const fixture = join(fixtureShims, 'pullboard');
  writeFileSync(fixture, '#!/bin/sh\nprintf "fixture shim first\\n"\n');
  chmodSync(fixture, 0o755);
  const preferred = spawnSync('pullboard', ['init'], {
    cwd: root,
    env: { ...process.env, PATH: `${fixtureShims}${delimiter}${process.env.PATH}` },
    encoding: 'utf8',
  });
  assert.equal(preferred.status, 0);
  assert.match(preferred.stdout, /fixture shim first/);
});

test('runner removes its private home after test workers exit [C7, S13]', (t) => {
  const scratch = mkdtempSync(join(tmpdir(), 'pullboard-runner-cleanup-'));
  t.after(() => rmSync(scratch, { recursive: true, force: true }));
  const probe = join(scratch, 'runner-probe.test.js');
  const report = join(scratch, 'sandbox-path');
  writeFileSync(probe, `import { test } from 'node:test';
import { writeFileSync } from 'node:fs';
test('reports its sandbox and person-terminal markers', () => writeFileSync(${JSON.stringify(report)}, JSON.stringify({ sandbox: process.env.TMPDIR, ssh: [process.env.SSH_CONNECTION, process.env.SSH_CLIENT, process.env.SSH_TTY] })));
`);
  const runner = fileURLToPath(new URL('../bin/run-tests.js', import.meta.url));
  const launchEnv = { ...process.env };
  Object.assign(launchEnv, {
    SSH_CONNECTION: '192.0.2.1 1234 192.0.2.2 22',
    SSH_CLIENT: '192.0.2.1 1234 22',
    SSH_TTY: '/dev/pts/4',
  });
  delete launchEnv.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, [runner, probe], { encoding: 'utf8', env: launchEnv });
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
  assert.ok(existsSync(report), `${result.stdout}${result.stderr}`);
  const resultEnv = JSON.parse(readFileSync(report, 'utf8'));
  const sandbox = resultEnv.sandbox;
  assert.deepEqual(resultEnv.ssh, [null, null, null], 'the runner removes every SSH transport marker before test workers act as the person');
  assert.equal(existsSync(sandbox), false, 'the private sandbox is removed after Node exits');

  const failingProbe = join(scratch, 'runner-failure.test.js');
  writeFileSync(failingProbe, "import { test } from 'node:test';\ntest('fails', () => { throw new Error('forward this failure'); });\n");
  const failed = spawnSync(process.execPath, [runner, failingProbe], { encoding: 'utf8' });
  assert.equal(failed.status, 1, `${failed.stdout}${failed.stderr}`);
  assert.match(failed.stdout, /forward this failure/);
});

/** Copy the runner and its transitive local imports without evaluating their code. */
function copyRunnerImports(sourceRoot, root) {
  const copied = new Set();
  let pending = ['bin/run-tests.js'];
  while (pending.length) {
    const files = [...new Set(pending)].filter((file) => !copied.has(file));
    pending = [];
    if (!files.length) continue;
    // Imported JSON is leaf data, not an ES module for V8 to parse.
    const sources = files.map((file) => file.endsWith('.json') ? 'export {};' : readFileSync(join(sourceRoot, file), 'utf8'));
    const imports = importsIn(sources);
    for (const [index, file] of files.entries()) {
      copied.add(file);
      mkdirSync(dirname(join(root, file)), { recursive: true });
      copyFileSync(join(sourceRoot, file), join(root, file));
      for (const request of imports[index]) {
        if (!request.startsWith('./') && !request.startsWith('../')) continue;
        const target = relative(sourceRoot, resolve(sourceRoot, dirname(file), request));
        assert.ok(target && target !== '..' && !target.startsWith('..' + sep) && !isAbsolute(target),
          `runner fixture import must stay in its source checkout: ${request}`);
        pending.push(target);
      }
    }
  }
}

/** Build the runner-discovery fixture from a source checkout. */
function discoveryFixture(t, sourceRoot = fileURLToPath(new URL('../', import.meta.url))) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'pullboard-runner-discovery-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bin = join(root, 'bin');
  const tests = join(root, 'test');
  mkdirSync(bin);
  mkdirSync(tests);
  writeFileSync(join(root, 'package.json'), JSON.stringify({ type: 'module' }));
  copyRunnerImports(sourceRoot, root);
  const marker = join(root, 'ran-once');
  writeFileSync(join(tests, 'one.test.js'), `import { test } from 'node:test';
import { appendFileSync } from 'node:fs';
test('one discovered test', () => appendFileSync(${JSON.stringify(marker)}, 'x'));
`);
  return { root, bin, marker };
}

/** Run default discovery and require exactly one fixture execution. */
function runDiscovery({ root, bin, marker }) {
  const launchEnv = { ...process.env };
  delete launchEnv.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, ['--test', '--import', join(bin, 'run-tests.js')], {
    cwd: root,
    encoding: 'utf8',
    env: launchEnv,
  });
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
  assert.equal(readFileSync(marker, 'utf8'), 'x', 'one test ran exactly once under default discovery');
}

test('default discovery runs one fixture and does not recurse into the runner [C7, S13]', (t) => {
  runDiscovery(discoveryFixture(t));
});

test('discovery follows a new runner src import and its transitive dependency [C7, S13]', (t) => {
  const source = mkdtempSync(join(tmpdir(), 'pullboard-discovery-source-'));
  t.after(() => rmSync(source, { recursive: true, force: true }));
  mkdirSync(join(source, 'bin'));
  cpSync(fileURLToPath(new URL('../src', import.meta.url)), join(source, 'src'), { recursive: true });
  const runner = readFileSync(fileURLToPath(new URL('../bin/run-tests.js', import.meta.url)), 'utf8');
  writeFileSync(join(source, 'bin/run-tests.js'), runner.replace('\n', "\nimport '../src/discovery-extra.js';\n"));
  writeFileSync(join(source, 'src/discovery-extra.js'), "import { value } from './discovery-nested.js';\nif (value !== 'closure') throw new Error('transitive import failed');\n");
  writeFileSync(join(source, 'src/discovery-nested.js'), "export const value = 'closure';\n");
  runDiscovery(discoveryFixture(t, source));
});


test('a name pattern that matches no test fails with NO_TESTS_MATCHED [C7,S13]', (t) => {
  const box = discoveryFixture(t);
  const runner = join(box.bin, 'run-tests.js');
  const file = join(box.root, 'test', 'one.test.js');
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  /** Execute the copied real runner with fixture inputs and preserve its native output. */
  const execute = (...args) => spawnSync(process.execPath, [runner, ...args], { cwd: box.root, env, encoding: 'utf8' });
  const missing = execute('--test-name-pattern', 'no matching case 1018', file);
  assert.notEqual(missing.status, 0, `${missing.stdout}${missing.stderr}`);
  assert.match(missing.stderr, /NO_TESTS_MATCHED/u);
  assert.match(missing.stderr, /no matching case 1018/u);
  assert.ok(missing.stderr.includes(file), missing.stderr);
  assert.equal(existsSync(box.marker), false, 'a nonmatching case never executes');
  const matched = execute(file, '--test-name-pattern=one discovered test');
  assert.equal(matched.status, 0, `${matched.stdout}${matched.stderr}`);
  assert.equal(readFileSync(box.marker, 'utf8'), 'x');
  const whole = execute(file);
  assert.equal(whole.status, 0, `${whole.stdout}${whole.stderr}`);
  assert.equal(readFileSync(box.marker, 'utf8'), 'xx', 'whole-file behavior is preserved');
  const silent = join(box.root, 'silent.mjs');
  writeFileSync(silent, 'export default async function* (events) { for await (const event of events) {} }\n');
  const quietMissing = execute('--test-reporter', silent, '--test-name-pattern', 'another absent case 1018', file);
  assert.notEqual(quietMissing.status, 0, `${quietMissing.stdout}${quietMissing.stderr}`);
  assert.match(quietMissing.stderr, /NO_TESTS_MATCHED/u);
  const quietMatch = execute('--test-reporter', silent, '--test-name-pattern', 'one discovered test', file);
  assert.equal(quietMatch.status, 0, `${quietMatch.stdout}${quietMatch.stderr}`);
  assert.equal(quietMatch.stdout, '', 'observing selection adds no public reporter output');
  assert.equal(readFileSync(box.marker, 'utf8'), 'xxx');
});


test('a name pattern that matches no test fails with NO_TESTS_MATCHED in a landing [C7,S13]', (t) => {
  const box = discoveryFixture(t);
  const runner = join(box.bin, 'run-tests.js');
  const file = join(box.root, 'test', 'one.test.js');
  const env = { ...process.env, PULLBOARD_LANDING_RUN: '1' };
  delete env.NODE_TEST_CONTEXT;
  /** Exercise the real landing API and its independent reporter on private files. */
  const execute = (...args) => spawnSync(process.execPath, [runner, ...args], { cwd: box.root, env, encoding: 'utf8' });
  const missing = execute('--test-name-pattern=absent landing case 1018', file);
  assert.notEqual(missing.status, 0, `${missing.stdout}${missing.stderr}`);
  assert.match(missing.stderr, /NO_TESTS_MATCHED/u);
  assert.equal(existsSync(box.marker), false);
  const silent = join(box.root, 'silent.mjs');
  const output = join(box.root, 'selected-output.txt');
  writeFileSync(silent, 'export default async function* (events) { for await (const event of events) {} }\n');
  const matched = execute('--test-reporter', silent, '--test-reporter-destination', output,
    '--test-name-pattern', 'one discovered test', file);
  assert.equal(matched.status, 0, `${matched.stdout}${matched.stderr}`);
  assert.equal(readFileSync(output, 'utf8'), '', 'the selected reporter destination stays silent');
  assert.equal(readFileSync(box.marker, 'utf8'), 'x');
});
