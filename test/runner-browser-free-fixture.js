/** @pullboard-test-input source-tree */
/** A runner registered with no browser slots runs browser-free test files and never browser-bound ones [C7]. */
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { listResources, takeResource } from '../src/resources.js';
import { runFixtureChild, runFixtureChildAsync } from './fixture-child.js';
import { HOST, installSshStandIn } from './runner-ssh-fixture.js';

const SOURCE = resolve(import.meta.dirname, '..');

// Browser-bound only under the broad classifier: a Node child with no Chrome reference.
const FREE = "import { test } from 'node:test';\nimport { spawnSync } from 'node:child_process';\n"
  + "test('browser-free file ran', () => { if (spawnSync(process.execPath, ['-e', '0']).status !== 0) throw new Error('child failed'); });\n";
// Browser-bound under either classifier: a process starter beside a Chrome executable name.
const CHROME = "import { test } from 'node:test';\nimport { spawnSync } from 'node:child_process';\nconst chrome = 'google-chrome';\n"
  + "test('browser-bound file ran', () => { if (process.env.PULLBOARD_FIXTURE_NEVER_SET) spawnSync(chrome, ['--version']); });\n";
// A stand-in for a runner whose own run refuses the file for want of a browser slot.
const REFUSED = "import { test } from 'node:test';\n"
  + "test('refused file ran', () => { if (process.cwd().includes('.pullboard-runner')) throw new Error('[BROWSER_SLOT_REQUIRED] the runner held no browser slot for this file'); });\n";

/** Count the stand-in's dispatched and returned markers. */
function phases(file) {
  const lines = existsSync(file) ? readFileSync(file, 'utf8').split('\n') : [];
  return { dispatched: lines.filter(line => line === 'dispatched').length, returned: lines.filter(line => line === 'returned').length };
}

/** Poll a condition with a named hang ceiling. */
async function until(condition, what) {
  const deadline = Date.now() + 60_000; // budget: one runner round trip with checkout and npm setup.
  while (!condition()) {
    if (Date.now() >= deadline) throw new Error(`fixture wait timed out: ${what}`);
    await new Promise(resolveWait => setTimeout(resolveWait, 50)); // budget: polling interval for fixture state.
  }
}

/** Drive bin/run-tests.js against a stand-in SSH runner registered with --browser 0. */
export async function browserFreeRunnerCheck(t, { cli, git }) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'pullboard-runner-browser-free-')));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const [home, repo, worker, bin, remoteHome] = ['home', 'repo', 'second-machine', 'bin', 'worker-home'].map(name => join(dir, name));
  const machineHome = join(home, '.pullboard');
  const remoteMachineHome = join(remoteHome, '.pullboard');
  const requests = join(dir, 'ssh-requests.jsonl');
  for (const folder of [repo, worker, bin, machineHome, remoteMachineHome, join(repo, 'test')]) mkdirSync(folder, { recursive: true });
  // The controller classifies by launch; the runner machine has no settings file at all, as on a fresh host.
  writeFileSync(join(machineHome, 'settings.json'), JSON.stringify({ gateSlots: 1, gate: { browserByLaunch: true } }));
  const env = { ...process.env, HOME: home, PULLBOARD_HOME: home, PULLBOARD_MACHINE_HOME: machineHome,
    PATH: `${bin}:${process.env.PATH}`, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'Runner Fixture', GIT_AUTHOR_EMAIL: 'runner-fixture@example.invalid',
    GIT_COMMITTER_NAME: 'Runner Fixture', GIT_COMMITTER_EMAIL: 'runner-fixture@example.invalid' };
  // This file runs under the suite's own lease and launch guard; the fixture's runs take their own.
  for (const key of Object.keys(env)) if (/^PULLBOARD_(GATE|BROWSER|TEST|LANDING)_/u.test(key) || key === 'NODE_OPTIONS' || key === 'NODE_TEST_CONTEXT') delete env[key];
  const initialized = runFixtureChild('git', ['init', '-q', '-b', 'main'], { cwd: repo, env, encoding: 'utf8' });
  assert.equal(initialized.status, 0, initialized.context);
  writeFileSync(join(repo, 'package.json'), JSON.stringify({ name: 'pullboard', version: '0.0.0-fixture', private: true, type: 'module' }) + '\n');
  writeFileSync(join(repo, 'pullboard.json'), JSON.stringify({ gate: 'true' }));
  cpSync(join(SOURCE, 'src'), join(repo, 'src'), { recursive: true });
  cpSync(join(SOURCE, 'bin'), join(repo, 'bin'), { recursive: true });
  writeFileSync(join(repo, 'test', 'free.test.js'), FREE);
  writeFileSync(join(repo, 'test', 'chrome.test.js'), CHROME);
  writeFileSync(join(repo, 'test', 'refused.test.js'), REFUSED);
  git(repo, env, 'add', 'package.json', 'pullboard.json', 'src', 'bin', 'test');
  git(repo, env, 'commit', '-q', '-m', 'test: commit a browser-free runner fixture');
  installSshStandIn({ bin, worker, home: remoteHome, machineHome: remoteMachineHome, requests });
  const added = cli(repo, env, 'runner', 'add', HOST, '--slots', '1', '--browser', '0', '--json');
  assert.equal(added.status, 0, added.context);

  const previousHome = process.env.PULLBOARD_HOME;
  const previousMachineHome = process.env.PULLBOARD_MACHINE_HOME;
  process.env.PULLBOARD_HOME = home;
  process.env.PULLBOARD_MACHINE_HOME = machineHome;
  const marks = `${requests}.phases`;
  const runTests = file => runFixtureChildAsync(process.execPath, ['bin/run-tests.js', file], { cwd: repo, env });
  const show = result => `${result.context}\nstdout:\n${result.stdout}`;
  let held;
  try {
    // Fill the controller's only gate slot so a remote-capable run goes to the runner.
    const hold = () => takeResource({ name: 'gate', capacity: 1, scope: 'machine', root: repo,
      agent: 'browser-free-local-holder', item: 'local-holder', kind: 'force-registered-runner' });
    held = await hold();

    const free = await runTests('test/free.test.js');
    assert.doesNotMatch(free.stdout + free.stderr, /BROWSER_SLOT_REQUIRED/u, show(free));
    assert.equal(free.status, 0, show(free));
    assert.match(free.stdout, /^ok 1 - browser-free file ran/mu, show(free));
    assert.deepEqual(phases(marks), { dispatched: 1, returned: 1 }, 'the browser-free file ran on the no-browser runner');

    // A runner's BROWSER_SLOT_REQUIRED answer reruns the file here once a local slot frees.
    const refused = runTests('test/refused.test.js');
    await until(() => phases(marks).returned === 2, 'the runner answers the refused file');
    held.release();
    held = undefined;
    const rerun = await refused;
    assert.equal(rerun.status, 0, show(rerun));
    assert.match(rerun.stderr, /BROWSER_SLOT_REQUIRED.*rerunning it locally/u, show(rerun));
    assert.match(rerun.stdout, /^ok 1 - refused file ran/mu, show(rerun));
    assert.deepEqual(phases(marks), { dispatched: 2, returned: 2 }, 'the local rerun never went back to the runner');

    // A browser-bound file waits for a local slot rather than going to a runner with no browser slots.
    held = await hold();
    const bound = runTests('test/chrome.test.js');
    const waiting = () => listResources({ scope: 'machine', root: repo }).find(resource => resource.name === 'gate')?.line.length === 1;
    await until(waiting, 'the browser-bound run queues');
    await new Promise(resolveWait => setTimeout(resolveWait, 1_000)); // budget: several admission polls in which a runner could take it.
    assert.equal(waiting(), true, 'the browser-bound run still waits for a local slot');
    held.release();
    held = undefined;
    const local = await bound;
    assert.equal(local.status, 0, show(local));
    assert.match(local.stdout, /^ok 1 - browser-bound file ran/mu, show(local));
    assert.deepEqual(phases(marks), { dispatched: 2, returned: 2 }, 'the browser-bound file never reached the runner');
  } finally {
    held?.release();
    if (previousHome === undefined) delete process.env.PULLBOARD_HOME; else process.env.PULLBOARD_HOME = previousHome;
    if (previousMachineHome === undefined) delete process.env.PULLBOARD_MACHINE_HOME; else process.env.PULLBOARD_MACHINE_HOME = previousMachineHome;
  }
}
