/**
 * The gate's digest (V10): what an agent reads of a red run. And submit's own run of the gate (V16):
 * no stamp stands in for it, and the tree must hold still while it runs.
 */
import assert from 'node:assert/strict';
import { runFixtureExecFile as execFileSync, runFixtureChild as spawnSync, runFixtureChild, runFixtureGit, startFixtureChild as spawn } from './fixture-child.js';
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { digestOf, testConcurrency } from '../src/gate.js';
import { BROWSER_SLOT_HELD_ENV, GATE_SLOT_HELD_ENV, GATE_SLOT_POOL_ENV, GATE_SLOT_TOKEN_ENV } from '../src/resources.js';

const PRIVATE_WORKER = resolve(import.meta.dirname, '../src/private-check-worker.js');

const BIN = resolve(import.meta.dirname, '../bin/pullboard.js');
const dirs = [];
after(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

/** Read the real file bodies' start/finish records to measure overlap without sampling process names. */
function fileOverlap(file) {
  const active = new Map();
  const starts = [];
  let files = 0, browser = 0;
  for (const line of readFileSync(file, 'utf8').trim().split('\n')) {
    const event = JSON.parse(line);
    if (event.start) {
      assert.equal(active.has(event.id), false, 'a file begins once');
      active.set(event.id, event.browser);
      starts.push(event.id);
      files = Math.max(files, active.size);
      browser = Math.max(browser, [...active.values()].filter(Boolean).length);
    } else {
      assert.equal(active.delete(event.id), true, 'every finish has a start');
    }
  }
  assert.equal(active.size, 0, 'every selected file finishes');
  return { files, browser, starts };
}

test('the landing gate bounds its own concurrency [C7]', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'pullboard-file-caps-')));
  dirs.push(root);
  cpSync(resolve(import.meta.dirname, '../src'), join(root, 'src'), { recursive: true });
  mkdirSync(join(root, 'bin'));
  cpSync(resolve(import.meta.dirname, '../bin/run-tests.js'), join(root, 'bin/run-tests.js'));
  writeFileSync(join(root, 'package.json'), '{"type":"module"}\n');
  const config = join(root, 'pullboard.json');
  assert.deepEqual(testConcurrency(root, 7), { files: 7, browser: 2 }, 'the default file budget is the detected core budget');
  const selected = [];
  for (let id = 0; id < 9; id += 1) {
    const browser = id < 4;
    const folder = join(root, 'test', browser ? 'cockpit' : 'ordinary');
    mkdirSync(folder, { recursive: true });
    const file = join(folder, `overlap-${id}.test.js`);
    selected.push(file);
    writeFileSync(file, `import {appendFileSync} from 'node:fs';
import {test} from 'node:test';
/** Keep controlled work alive briefly so concurrent file bodies leave overlapping records. */
test('record real file ${id} [C7]', async () => {
  appendFileSync(process.env.PULLBOARD_CAP_CAPTURE, JSON.stringify({start:true,id:${id},browser:${browser}})+'\\n');
  await new Promise(resolve => setTimeout(resolve, 200)); // budget: controlled fixture work, not a readiness deadline or production wait.
  appendFileSync(process.env.PULLBOARD_CAP_CAPTURE, JSON.stringify({start:false,id:${id}})+'\\n');
});\n`);
  }
  for (const setting of [{ files: 3, browser: 2 }, { files: 2, browser: 1 }]) {
    writeFileSync(config, JSON.stringify({ testConcurrency: setting }));
    assert.deepEqual(testConcurrency(root, 7), setting, 'pullboard.json overrides the shared policy');
    const cases = [
      { name: 'spawnSync explicit large integer', args: ['--test-concurrency=9'], landing: false },
      { name: 'landing default', args: [], landing: true },
      { name: 'landing true override', args: ['--test-concurrency=true'], landing: true },
      { name: 'landing large integer override', args: ['--test-concurrency=9'], landing: true },
      { name: 'landing serial override', args: ['--test-concurrency=false'], landing: true, serial: true },
    ];
    for (const [caseIndex, example] of cases.entries()) {
      const capture = join(root, `overlap-${setting.files}-${caseIndex}.jsonl`);
      const env = { ...process.env, PULLBOARD_CAP_CAPTURE: capture,
        PULLBOARD_MACHINE_HOME: join(root, `machine-${setting.files}-${caseIndex}`) };
      env.PULLBOARD_LANDING_RUN = example.landing ? '1' : '0';
      const result = runFixtureChild(process.execPath, [join(root, 'bin/run-tests.js'), ...example.args, ...selected], {
        cwd: root, env, encoding: 'utf8',
      });
      assert.equal(result.status, 0, `${example.name}: ${result.stdout}${result.stderr}`);
      const peak = fileOverlap(capture);
      assert.ok(peak.files <= setting.files, `${example.name}: file-body overlap ${peak.files} exceeds ${setting.files}`);
      assert.ok(peak.browser <= setting.browser, `${example.name}: browser-file overlap ${peak.browser} exceeds ${setting.browser}`);
      if (example.serial) assert.equal(peak.files, 1, 'false keeps the native runner serial');
      assert.deepEqual(peak.starts.sort((a, b) => a - b), Array.from({ length: 9 }, (_, id) => id),
        `${example.name}: every selected file runs once`);
      assert.match(result.stdout, /# tests 9\b/u);
      assert.match(result.stdout, /# fail 0\b/u);
    }
  }
  writeFileSync(config, JSON.stringify({ testConcurrency: { files: 3, browser: 2 } }));
  for (const value of ['4294967296', '9'.repeat(400)]) {
    const capture = join(root, `invalid-concurrency-${value.length}.jsonl`);
    const result = runFixtureChild(process.execPath, [join(root, 'bin/run-tests.js'),
      `--test-concurrency=${value}`, ...selected], {
      cwd: root, env: { ...process.env, PULLBOARD_LANDING_RUN: '1', PULLBOARD_CAP_CAPTURE: capture,
        PULLBOARD_MACHINE_HOME: join(root, `machine-invalid-${value.length}`) }, encoding: 'utf8',
    });
    assert.notEqual(result.status, 0, 'an invalid native concurrency value is refused');
    assert.match(result.stderr, /invalid --test-concurrency value/u);
    assert.equal(existsSync(capture), false, 'invalid concurrency is refused before any file body runs');
  }
  let isolationCase = 0;
  for (const flag of ['--test-isolation', '--test_isolation', '--experimental-test-isolation',
    '--experimental_test_isolation', '--experimental_test-isolation', '--experimental-test_isolation']) {
    for (const args of [[`${flag}=none`], [flag, 'none']]) {
      const capture = join(root, `isolation-${isolationCase++}.jsonl`);
      const result = runFixtureChild(process.execPath, [join(root, 'bin/run-tests.js'), ...args, selected.at(-1)], {
        cwd: root, env: { ...process.env, PULLBOARD_CAP_CAPTURE: capture,
          PULLBOARD_MACHINE_HOME: join(root, 'machine-isolation') }, encoding: 'utf8',
      });
      assert.notEqual(result.status, 0, `${args.join(' ')} must refuse non-isolated test files`);
      assert.match(result.stderr, /bounded browser test files require process isolation/u);
      assert.equal(existsSync(capture), false, 'a refused isolation mode never starts a test-file body');
    }
  }
  writeFileSync(config, JSON.stringify({ testConcurrency: { browser: 3 } }));
  assert.throws(() => testConcurrency(root, 7), /browser must be 1 or 2/);
});

test('the gate stops before the suite on a missing clock-budget comment [C7]', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'pullboard-gate-clock-budget-')));
  dirs.push(root);
  mkdirSync(join(root, 'bin'));
  mkdirSync(join(root, 'test'));

  const actualPackage = JSON.parse(readFileSync(resolve(import.meta.dirname, '../package.json'), 'utf8'));
  const gateScript = actualPackage.scripts.gate;
  const fixturePackage = { ...actualPackage, scripts: { ...actualPackage.scripts, test: 'node test/suite-sentinel.js' } };
  assert.equal(fixturePackage.scripts.gate, gateScript, 'the real package gate command is preserved verbatim');
  writeFileSync(join(root, 'package.json'), JSON.stringify(fixturePackage, null, 2) + '\n');
  copyFileSync(resolve(import.meta.dirname, 'wall-clock-budgets.js'), join(root, 'test/wall-clock-budgets.js'));
  writeFileSync(join(root, 'bin/pullboard.js'), `if (process.argv.slice(2).join(' ') !== 'spec check') process.exit(2);
process.stdout.write('fixture spec check reached\\n');
`);
  const suiteMarker = join(root, 'suite-ran');
  writeFileSync(join(root, 'test/suite-sentinel.js'), `import { writeFileSync } from 'node:fs';
writeFileSync(${JSON.stringify(suiteMarker)}, 'ran');
`);
  const missingBudget = join(root, 'test/missing-budget.test.js');
  writeFileSync(missingBudget, `import assert from 'node:assert/strict';
const started = Date.now();
assert.ok(Date.now() - started < 500, 'planted assertion without a budget comment');
`);

  const env = { ...process.env, npm_config_update_notifier: 'false', npm_config_audit: 'false', npm_config_fund: 'false' };
  runFixtureGit(['init', '-q', '-b', 'main'], { cwd: root, env });
  runFixtureGit(['add', '-A'], { cwd: root, env });

  const refused = runFixtureChild('npm', ['run', 'gate'], { cwd: root, env, encoding: 'utf8' });
  const refusalOutput = `${refused.stdout ?? ''}\n${refused.stderr ?? ''}`;
  assert.notEqual(refused.status, 0, `${refused.context}\n${refusalOutput}`);
  assert.match(refusalOutput, /test\/missing-budget\.test\.js:3: literal elapsed-time margin/u,
    'the real scanner reports the tracked file and exact line');
  assert.match(refusalOutput, /elapsed-time margin|clock budget|wall-clock/u,
    'the refusal explains that the failure is a clock-budget violation');
  assert.ok(refused.elapsedMs < 5000, `${refused.elapsedMs}ms; scanner must refuse before the suite.`); // budget: declared #653 static-refusal ceiling is 5000ms.
  assert.equal(existsSync(suiteMarker), false, 'the suite sentinel did not run after the scanner refused');

  rmSync(missingBudget);
  runFixtureGit(['add', '-u'], { cwd: root, env });
  const clean = runFixtureChild('npm', ['run', 'gate'], { cwd: root, env, encoding: 'utf8' });
  assert.equal(clean.status, 0, `${clean.context}\n${clean.stdout ?? ''}\n${clean.stderr ?? ''}`);
  assert.equal(existsSync(suiteMarker), true, 'a clean scanner result continues into the suite');
});

/**
 * A repo whose coordinator holds item #1, with this gate. Every run of the gate first adds a line
 * to runs.log beside the repo, so a test can count the runs.
 *
 * @param {string} gate
 * @param {string} [check]
 */
function repoWithGate(gate, check = '') {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'pullboard-gate-')));
  dirs.push(dir);
  const repo = join(dir, 'repo');
  mkdirSync(repo);
  const env = {
    ...process.env,
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'Test Agent',
    GIT_AUTHOR_EMAIL: 'agent@example.com',
    GIT_COMMITTER_NAME: 'Test Agent',
    GIT_COMMITTER_EMAIL: 'agent@example.com',
    PULLBOARD_HOME: join(dir, 'home'),
    PULLBOARD_MACHINE_HOME: join(dir, 'home'),
  };
  const git = (...args) => runFixtureGit(args, { cwd: repo, env });
  const run = (...args) => runFixtureChild(process.execPath, [BIN, ...args], { cwd: repo, env, encoding: 'utf8' });
  git('init', '-q', '-b', 'main');
  writeFileSync(join(repo, 'pullboard.json'), JSON.stringify({ gate: `echo run >> ../runs.log; ${gate}` }));
  writeFileSync(join(repo, 'SPEC.md'), '# Demo\n\n## G · Goals\n- G1 [approved, must] It works. | gate: test\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'chore: a spec');
  const added = run('add', 'coordinator', 'Work', ...(check ? ['--check', check, '--wait'] : []));
  assert.equal(added.status, 0, `${added.stdout}${added.stderr}`);
  assert.equal(run('claim', '1').status, 0);
  const runs = () => {
    try {
      return readFileSync(join(dir, 'runs.log'), 'utf8').split('\n').filter(Boolean).length;
    } catch {
      return 0;
    }
  };
  return { dir, repo, env, git, run, runs };
}

test('pullboard gate status refuses instead of running the gate [C7,P4]', async () => {
  const box = repoWithGate('echo run >> ../runs.log');
  for (const name of [BROWSER_SLOT_HELD_ENV, GATE_SLOT_HELD_ENV, GATE_SLOT_POOL_ENV, GATE_SLOT_TOKEN_ENV]) delete box.env[name];
  assert.equal(box.run('settings', 'gateSlots', '1').status, 0, 'the fixture uses the holder pool\'s single gate slot');
  const resourceModule = pathToFileURL(resolve(import.meta.dirname, '../src/resources.js')).href;
  const holderSource = `import { takeResource } from ${JSON.stringify(resourceModule)};
const lease = await takeResource({ name: 'gate', capacity: 1, scope: 'machine', root: process.cwd(), agent: 'gate-argument-holder' });
try {
  process.stdout.write('held\\n');
  process.stdin.setEncoding('utf8');
  for await (const line of process.stdin) if (line.trim() === 'release') break;
} finally { lease.release(); }
`;
  let holderRun;
  let holderClosed;
  let commandRun;
  let commandClosed;
  let holderResult;
  try {
    holderRun = spawn(process.execPath, ['--input-type=module', '-e', holderSource], {
      cwd: box.repo, env: box.env, stdio: ['pipe', 'pipe', 'pipe'],
    });
    let holderOutput = '';
    holderRun.stdout.setEncoding('utf8');
    holderClosed = new Promise((resolveClosed) => holderRun.once('close', (status, signal) =>
      resolveClosed({ status, signal, stdout: holderOutput })));
    const holderReady = new Promise((resolveReady) => {
      holderRun.stdout.on('data', (part) => {
        holderOutput += part;
        if (holderOutput.includes('held\n')) resolveReady({ ready: true });
      });
      holderClosed.then((result) => resolveReady({ result }));
    });
    const ready = await holderReady;
    assert.equal(ready.ready, true, `the private gate holder did not start: ${JSON.stringify(ready.result ?? holderOutput)}`);

    for (const words of [['status'], ['run'], ['unexpected', 'word']]) {
      commandRun = spawn(process.execPath, [BIN, 'gate', ...words], {
        cwd: box.repo, env: box.env, stdio: ['ignore', 'pipe', 'pipe'],
      });
      let commandOutput = '';
      let commandError = '';
      commandRun.stdout.setEncoding('utf8');
      commandRun.stderr.setEncoding('utf8');
      commandRun.stdout.on('data', (part) => { commandOutput += part; });
      commandRun.stderr.on('data', (part) => { commandError += part; });
      commandClosed = new Promise((resolveClosed) => commandRun.once('close', (status, signal) =>
        resolveClosed({ status, signal, stdout: commandOutput, stderr: commandError })));
      const queued = new Promise((resolveQueued) => {
        commandRun.stdout.on('data', () => {
          if (commandOutput.includes('gate waiting:')) resolveQueued({ queued: true });
        });
      });
      const outcome = await Promise.race([
        queued,
        commandClosed.then((result) => ({ result })),
      ]);
      if (outcome.queued) {
        commandRun.kill('SIGTERM');
        await commandClosed;
        assert.fail(`the unexpected words ${words.join(' ')} entered the held gate queue: ${commandOutput}`);
      }
      assert.equal(outcome.result.status, 1, `${outcome.result.stderr}\n${outcome.result.stdout}`);
      assert.match(outcome.result.stderr, /\[GATE_ARGUMENT\]/u);
      assert.match(outcome.result.stderr, /pullboard resources for status/u);
      assert.match(outcome.result.stderr, /pullboard gate with no extra words to run the gate/u);
      assert.equal(box.runs(), 0, 'a refused extra word never starts the configured gate');
      const gate = JSON.parse(box.run('resources', '--json').stdout).resources.find(({ name }) => name === 'gate');
      assert.deepEqual(gate?.holders.map(({ agent }) => agent) ?? [], ['gate-argument-holder']);
      assert.equal(gate?.line.length ?? 0, 0, 'the refused command never becomes a gate waiter');
    }
    for (const words of [['status'], ['run'], ['unexpected', 'word']]) {
      const result = box.run('gate', ...words, '--json');
      assert.equal(result.status, 1, `${result.stderr}\n${result.stdout}`);
      const { error } = JSON.parse(result.stdout);
      assert.equal(error.code, 'GATE_ARGUMENT');
      assert.equal(error.next, 'use pullboard resources for status, or pullboard gate with no extra words to run the gate');
      assert.equal(box.runs(), 0, 'JSON refusal never starts the configured gate');
      const gate = JSON.parse(box.run('resources', '--json').stdout).resources.find(({ name }) => name === 'gate');
      assert.deepEqual(gate?.holders.map(({ agent }) => agent) ?? [], ['gate-argument-holder']);
      assert.equal(gate?.line.length ?? 0, 0, 'the refused JSON command never becomes a gate waiter');
    }
  } finally {
    if (commandRun && commandRun.exitCode === null && commandRun.signalCode === null) {
      commandRun.kill('SIGTERM');
    }
    if (commandClosed) await commandClosed;
    if (holderRun) {
      if (holderRun.exitCode === null && holderRun.signalCode === null) holderRun.stdin.end('release\n');
      holderResult = await holderClosed;
    }
  }
  assert.equal(holderResult?.status, 0, JSON.stringify(holderResult));
});

test('gate before the first commit names the uncommitted config [I1,C7]', () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'pullboard-first-commit-')));
  dirs.push(dir);
  const repo = join(dir, 'repo');
  mkdirSync(repo);
  const env = {
    ...process.env,
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'Test Agent',
    GIT_AUTHOR_EMAIL: 'agent@example.com',
    GIT_COMMITTER_NAME: 'Test Agent',
    GIT_COMMITTER_EMAIL: 'agent@example.com',
    PULLBOARD_HOME: join(dir, 'home'),
    PULLBOARD_MACHINE_HOME: join(dir, 'home'),
  };
  const git = (...args) => runFixtureGit(args, { cwd: repo, env });
  const run = (...args) => runFixtureChild(process.execPath, [BIN, ...args], { cwd: repo, env, encoding: 'utf8' });
  git('init', '-q', '-b', 'main');
  const initialized = run('init', '--model', 'Test Coordinator');
  assert.equal(initialized.status, 0, `${initialized.stdout}${initialized.stderr}`);
  assert.equal(existsSync(join(repo, 'pullboard.json')), true, 'init wrote the coordinator config');

  const firstGate = run('gate', '--json');
  assert.equal(firstGate.status, 1, 'the gate cannot read a policy before the initial commit');
  const firstRefusal = JSON.parse(firstGate.stdout).error;
  assert.equal(firstRefusal.code, 'NO_POLICY');
  assert.match(firstRefusal.message, /pullboard\.json is not committed/u);
  assert.match(firstRefusal.message, /git add pullboard\.json/u, 'the refusal gives the concrete staging command');

  const committed = repoWithGate('true');
  committed.git('switch', '--detach', 'HEAD');
  const missingCoordinator = committed.run('gate', '--json');
  assert.equal(missingCoordinator.status, 1);
  const missingRefusal = JSON.parse(missingCoordinator.stdout).error;
  assert.equal(missingRefusal.code, 'NO_POLICY');
  assert.match(missingRefusal.message, /coordinator checkout is detached for review/u,
    'other genuine NO_POLICY failures keep their specific message');
});

test('gate after init in an existing repo says to commit the init files [I1,C7]', () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'pullboard-init-history-')));
  dirs.push(dir);
  const repo = join(dir, 'repo');
  mkdirSync(repo);
  const env = {
    ...process.env,
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'Test Agent',
    GIT_AUTHOR_EMAIL: 'agent@example.com',
    GIT_COMMITTER_NAME: 'Test Agent',
    GIT_COMMITTER_EMAIL: 'agent@example.com',
    PULLBOARD_HOME: join(dir, 'home'),
    PULLBOARD_MACHINE_HOME: join(dir, 'home'),
  };
  const git = (...args) => runFixtureGit(args, { cwd: repo, env });
  const run = (...args) => runFixtureChild(process.execPath, [BIN, ...args], { cwd: repo, env, encoding: 'utf8' });
  git('init', '-q', '-b', 'main');
  writeFileSync(join(repo, 'README.md'), '# Existing repository\n');
  git('add', 'README.md');
  git('commit', '-q', '-m', 'chore: create existing repository');
  assert.equal(run('init', '--model', 'Test Coordinator').status, 0);

  const refused = run('gate', '--json');
  assert.equal(refused.status, 1, 'the gate cannot read the policy until init files are committed');
  const refusal = JSON.parse(refused.stdout).error;
  assert.equal(refusal.code, 'NO_POLICY');
  const message = refusal.message;
  assert.match(message, /pullboard\.json and Pullboard's initialized setup files are uncommitted/u);
  assert.match(message, /git add(?: -f)? -- .*pullboard\.json/u, 'the refusal gives a scoped staging command');
  assert.match(message, /&& git commit -q -m "chore: set up pullboard"/u, 'the refusal explains the needed commit');
  for (const path of ['SPEC.md', 'DOCTRINE.md']) assert.ok(message.includes(path), message);
  assert.ok(!message.includes('README.md'), 'unrelated existing files are not included in the staging command');

  // The command the refusal prints is the one that fixes it.
  const fix = message.slice(message.indexOf('commit them before running the gate: ') + 'commit them before running the gate: '.length);
  // init installs hooks that call `pullboard`; a person has it installed, so the fixture provides it.
  const shims = join(dir, 'bin');
  mkdirSync(shims);
  writeFileSync(join(shims, 'pullboard'), `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(BIN)} "$@"\n`, { mode: 0o755 });
  const applied = runFixtureChild('/bin/sh', ['-c', fix], { cwd: repo, env: { ...env, PATH: `${shims}:${env.PATH ?? ''}` }, encoding: 'utf8' });
  assert.equal(applied.status, 0, `${applied.stdout}${applied.stderr}`);
  const afterFix = run('gate', '--json');
  assert.notEqual(afterFix.stdout ? JSON.parse(afterFix.stdout).error?.code : undefined, 'NO_POLICY', 'the printed commit lets the gate read its policy');

  // A policy missing for any other reason keeps its own refusal.
  git('switch', '-q', '--detach', 'HEAD');
  const detached = run('gate', '--json');
  assert.equal(detached.status, 1);
  const otherMissing = JSON.parse(detached.stdout).error;
  assert.equal(otherMissing.code, 'NO_POLICY');
  assert.doesNotMatch(otherMissing.message, /uncommitted/u, 'a committed config never gets the commit-your-setup message');

  // Git metadata kept outside the project (git init --separate-git-dir) gets the same advice.
  const separate = join(dir, 'separate');
  mkdirSync(separate);
  const separateGit = (...args) => runFixtureGit(args, { cwd: separate, env });
  const separateRun = (...args) => runFixtureChild(process.execPath, [BIN, ...args], { cwd: separate, env, encoding: 'utf8' });
  separateGit('init', '-q', '-b', 'main', '--separate-git-dir', join(dir, 'separate-metadata'));
  writeFileSync(join(separate, 'README.md'), '# Existing repository\n');
  separateGit('add', 'README.md');
  separateGit('commit', '-q', '-m', 'chore: create existing repository');
  assert.equal(separateRun('init', '--model', 'Test Coordinator').status, 0);
  const separateRefused = separateRun('gate', '--json');
  assert.equal(separateRefused.status, 1);
  const separateRefusal = JSON.parse(separateRefused.stdout).error;
  assert.equal(separateRefusal.code, 'NO_POLICY');
  assert.match(separateRefusal.message, /pullboard\.json and Pullboard's initialized setup files are uncommitted/u,
    'a separate Git directory still gets the commit-your-setup message');
  assert.ok(separateRefusal.message.includes('SPEC.md') && !separateRefusal.message.includes('README.md'), separateRefusal.message);
});

test('a digest keeps the failures and the end within its cap, however long one line is [V10]', () => {
  const digest = digestOf(`not ok 1 - ${'x'.repeat(3500)}\n${'ok\n'.repeat(50)}# fail 1\nsummary: 1 failed`);
  assert.ok(digest.length <= 3000, `${digest.length} characters`);
  assert.match(digest, /^not ok 1 - x+…\n/);
  assert.match(digest, /# fail 1\nsummary: 1 failed$/);
});

test('a digest of many failures stays within its cap and still ends with the summary [V10]', () => {
  const failures = Array.from({ length: 200 }, (_, n) => `not ok ${n} - ${'y'.repeat(250)}`).join('\n');
  const digest = digestOf(`${failures}\n# tests 200\n# fail 200`);
  assert.ok(digest.length <= 3000, `${digest.length} characters`);
  assert.match(digest, /^not ok 0 - /);
  assert.match(digest, /# tests 200\n# fail 200$/);
});

test('a digest keeps the lines that say why a test failed, and skips passing tests however named [V10]', () => {
  const tap = [
    '# Subtest: a lane cannot commit outside its folders',
    'ok 1 - a lane cannot commit outside its folders',
    '# Subtest: an error in the store is reported',
    'ok 2 - an error in the store is reported',
    '# Subtest: add returns the new number',
    'not ok 3 - add returns the new number',
    '  ---',
    "  location: '/repo/test/store.test.js:12:1'",
    "  failureType: 'testCodeFailure'",
    '  error: |-',
    '    Expected values to be strictly equal:',
    '    2 !== 1',
    '  expected: 1',
    '  actual: 2',
    '  ...',
    ...Array.from({ length: 30 }, (_, n) => `ok ${n + 4} - filler ${n}`),
    '# tests 33',
    '# pass 32',
    '# fail 1',
  ].join('\n');
  const digest = digestOf(tap);
  assert.doesNotMatch(digest, /cannot commit|error in the store/, 'passing tests are not failures');
  assert.match(digest, /^not ok 3 - add returns the new number\n/);
  assert.match(digest, /store\.test\.js:12:1/);
  assert.match(digest, / {4}2 !== 1\n {2}expected: 1\n {2}actual: 2/);
  assert.match(digest, /# fail 1$/);
});

test('submit runs the gate itself: a stamp written by hand never stands in for a red gate [V16]', () => {
  const box = repoWithGate('test ! -f RED');
  writeFileSync(join(box.repo, 'RED'), 'red\n');
  box.git('add', 'RED');
  box.git('commit', '-q', '-m', 'chore: turn the gate red');
  writeFileSync(join(box.repo, box.git('rev-parse', '--git-path', 'pullboard-gate-green')), `${box.git('rev-parse', 'HEAD^{tree}')}\n`);
  const refused = box.run('submit', '1');
  assert.equal(refused.status, 1, refused.stdout);
  assert.match(refused.stderr, /GATE_RED/);
  assert.equal(box.runs(), 1, 'submit ran the gate instead of trusting the stamp');
});

test('submit runs the gate even on a tree an earlier run passed, which a plain gate run may skip [V16, C3]', () => {
  const box = repoWithGate('true');
  assert.equal(box.run('gate').status, 0);
  assert.equal(box.runs(), 1);
  assert.match(box.run('gate').stdout, /this tree already passed/);
  assert.equal(box.runs(), 1, 'outside submit, the stamp still saves a run');
  const submitted = box.run('submit', '1');
  assert.equal(submitted.status, 0, submitted.stderr);
  assert.match(submitted.stdout, /gate green in \d+s/);
  assert.equal(box.runs(), 2, 'submit ran the gate itself, stamp or no stamp');
});

test('submit refuses a tree its gate left changed: a new commit, or an edited tracked file [V16]', () => {
  for (const [moves, gate] of [
    ['a commit made during the gate', 'git commit -q --allow-empty -m "chore: moved under the gate"'],
    ['a tracked file edited during the gate', 'echo more >> SPEC.md'],
  ]) {
    const box = repoWithGate(gate);
    const head = box.git('rev-parse', 'HEAD');
    const refused = box.run('submit', '1');
    assert.equal(refused.status, 1, `${moves}: ${refused.stdout}`);
    assert.match(refused.stderr, /MOVED_DURING_GATE/, moves);
    assert.ok(refused.stderr.includes(head.slice(0, 12)), `${moves}: the refusal names the commit the gate was meant to check`);
    assert.equal(box.runs(), 1, moves);
  }
});


/** Quote a test executable or path as one shell word. */
function shellWord(value) {
  return "'" + String(value).replaceAll("'", "'\\''") + "'";
}

/** Run the production private-check worker with a real shell and durable output file. */
function privateCheck(box, command) {
  const logPath = join(box.dir, 'private-command.log');
  const pidFile = logPath + '.pid';
  const run = runFixtureChild(process.execPath, [PRIVATE_WORKER], {
    cwd: box.repo, env: box.env, encoding: 'utf8',
    input: JSON.stringify({ command, timeout: 30_000, pidFile, logPath }),
  });
  rmSync(pidFile, { force: true });
  assert.equal(run.status, 0, `${run.stdout}${run.stderr}`);
  return JSON.parse(run.stdout);
}

test('a piped gate fails on any red stage without changing its existing shell [V16,C7]', () => {
  const supported = runFixtureChild('set -o pipefail', { shell: true }).status === 0;
  const failing = repoWithGate('sh -c "exit 7" | tail -1');
  const red = failing.run('gate', '--json');
  assert.equal(red.status, 1, 'a failing producer cannot leave the gate green');
  if (supported) assert.equal(JSON.parse(red.stdout).green, false);
  else {
    const error = JSON.parse(red.stdout).error;
    assert.equal(error.code, 'PIPEFAIL_UNAVAILABLE');
    assert.match(error.message, /rewrite the gate without a pipe/u);
    assert.equal(failing.runs(), 0, 'an unsupported gate never starts');
  }
  const plain = repoWithGate('sh -c "exit 7"');
  assert.equal(plain.run('gate').status, 1, 'plain failure remains red');
  const passing = repoWithGate("printf 'pipeline-ok\\n' | grep -q pipeline-ok");
  const green = passing.run('gate', '--json');
  if (supported) assert.equal(green.status, 0, `${green.stdout}${green.stderr}`);
  else assert.equal(JSON.parse(green.stdout).error.code, 'PIPEFAIL_UNAVAILABLE');
  const ordinary = repoWithGate('true');
  assert.equal(ordinary.run('gate').status, 0, 'a plain passing gate needs no pipefail capability');
});

test('a piped gate fails safely while named-test item checks keep last-stage semantics [V16,C7]', () => {
  const box = repoWithGate('true');
  const fixture = join(box.dir, 'named-output.test.js');
  writeFileSync(fixture, `import {test} from 'node:test';
import {setTimeout} from 'node:timers/promises';
test('passing named item check', () => {});
test('output after the match', async () => {
  await setTimeout(25);
  process.stdout.write('x'.repeat(1024 * 1024));
});
`);
  const runner = resolve(import.meta.dirname, '../bin/run-tests.js');
  const named = `${shellWord(process.execPath)} ${shellWord(runner)} ${shellWord(fixture)} 2>&1`;
  const captured = (probe, assertion = `printf '%s\\n' "$out"`) => `out=$(${probe}) && ${assertion}`;
  const commands = [
    captured(named, `printf '%s\\n' "$out" | grep -Eq '^ok [0-9]+ - passing named item check'`),
    captured('yes | grep -q y'),
    captured('sh -c "exit 7" | tail -1'),
  ];
  for (const command of commands) {
    const item = repoWithGate('true', command);
    const baseline = JSON.parse(item.run('show', '1', '--json').stdout).item_check_baseline;
    assert.equal(baseline.result, 'green', 'background baselines preserve last-stage semantics');
    const checked = item.run('check', '1', '--yes');
    assert.equal(checked.status, 0, `${checked.stdout}${checked.stderr}`);
    const submitted = item.run('submit', '1', '--json');
    assert.equal(submitted.status, 0, `${submitted.stdout}${submitted.stderr}`);
    assert.equal(JSON.parse(submitted.stdout).gate.check.green, true, 'submission uses the same check semantics');
    const verified = privateCheck(item, command);
    assert.equal(verified.status, 0, JSON.stringify(verified));
    assert.equal(verified.error, null, 'the private verifier keeps its original shell behavior');
  }
});
