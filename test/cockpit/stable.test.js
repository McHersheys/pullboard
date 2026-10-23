/** A test Chrome never outlives the test that started it: every launcher ties Chrome to its owner [C7]. */
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { findChromeExecutable, isRunnerCommand } from '../chrome-fixture.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const PROBE = join(ROOT, 'test/cockpit/chrome-owner-probe.mjs');
const DEATH_BUDGET_MS = 10_000; // budget: the item's declared bound for Chrome to exit after its owner dies.
const READY_BUDGET_MS = 600_000; // budget: hang ceiling for one real Chrome launch, including a wait for a gate browser slot.

/** The launchers the tests use, by the name the probe file takes. */
const LAUNCHERS = {
  startChrome: 'startChrome in test/chrome-fixture.js (relay, seal, journeys, README capture, perf)',
  launchChromeProcess: 'launchChromeProcess in test/chrome-fixture.js',
  openSnapshotChrome: 'openSnapshotChrome in test/cockpit/fixture.js (every cockpit story)',
};

/**
 * List the live processes of one Chrome by its private profile path.
 * The profile path is unique to this test, so nothing else matches it.
 */
function chromeProcesses(profile) {
  const rows = execFileSync('ps', ['-axo', 'pid=,pgid=,command='], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return rows.split('\n').filter((row) => row.includes(`--user-data-dir=${profile}`))
    .map((row) => row.trim().split(/\s+/u)).map(([pid, pgid]) => ({ pid: Number(pid), pgid: Number(pgid) }));
}

/** Wait for the probe's ready file, failing early if the process that should write it has ended. */
async function waitForReady(file, child, budgetMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < budgetMs) {
    if (existsSync(file)) return Number(readFileSync(file, 'utf8'));
    if (child.exitCode !== null || child.signalCode !== null) throw new Error('the owner ended before Chrome was ready');
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Chrome was not ready within ${budgetMs}ms`);
}

/** Wait until no process of this Chrome remains, returning the elapsed milliseconds, or null when the budget passes. */
async function waitForChromeGone(profile, budgetMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < budgetMs) {
    if (chromeProcesses(profile).length === 0) return Date.now() - startedAt;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return chromeProcesses(profile).length === 0 ? Date.now() - startedAt : null;
}

/** Stop only the process groups and pids this test recorded, never anything found by name. */
function stopRecorded(profile, pids) {
  for (const { pgid } of chromeProcesses(profile)) { try { process.kill(-pgid, 'SIGKILL'); } catch { /* Already gone. */ } }
  for (const pid of pids) { try { process.kill(pid, 'SIGKILL'); } catch { /* Already gone. */ } }
}

test('the runner is bin/run-tests.js with any options, and its workers are not [C7]', () => {
  const at = '/work/Code Space/repo';
  for (const command of [`node bin/run-tests.js test/a.test.js`, `node bin/run-tests.js --test-concurrency=1 test/a.test.js`,
    `/usr/local/bin/node ${at}/bin/run-tests.js --test-concurrency=1 ${at}/test/a.test.js`,
    `node --import ./instrumentation.mjs bin/run-tests.js test/a.test.js`, `node --import=./instrumentation.mjs ${at}/bin/run-tests.js`]) assert.equal(isRunnerCommand(command), true, command);
  for (const command of [`node --disable-warning=ExperimentalWarning --import ${at}/bin/run-tests.js ${at}/test/a.test.js`,
    `node --import=${at}/bin/run-tests.js ${at}/test/a.test.js`, `node --import ./trace.mjs --import ${at}/bin/run-tests.js ${at}/test/a.test.js`,
    `node --test test/a.test.js bin/run-tests.js`, `node test/a.test.js`]) assert.equal(isRunnerCommand(command), false, command);
});

/** How each killed process starts the probe: the owner directly, or the runner, with and without its own options. */
const VICTIMS = {
  owner: [],
  runner: ['bin/run-tests.js'],
  'runner started with --test-concurrency=1': ['bin/run-tests.js', '--test-concurrency=1'],
};

for (const [launcher, name] of Object.entries(LAUNCHERS)) {
  for (const killed of Object.keys(VICTIMS)) {
    test(`Chrome from ${name} exits within 10 s of its ${killed} dying by SIGKILL [C7]`, {
      timeout: READY_BUDGET_MS + DEATH_BUDGET_MS + 30_000,
      skip: !findChromeExecutable() && 'Chrome is not installed',
    }, async (t) => {
      const directory = mkdtempSync(join(tmpdir(), 'pullboard-owner-death-'));
      const profile = join(directory, 'profile');
      const readyFile = join(directory, 'ready');
      const recorded = [];
      t.after(() => { stopRecorded(profile, recorded); rmSync(directory, { recursive: true, force: true }); });
      const env = { ...process.env, PROBE_LAUNCHER: launcher, PROBE_PROFILE: profile, PROBE_READY: readyFile };
      // The runner case starts the probe the way the gate does, as a test file under bin/run-tests.js.
      const victim = killed === 'owner'
        ? spawn(process.execPath, [PROBE], { cwd: ROOT, env, stdio: 'ignore' })
        : spawn(process.execPath, [...VICTIMS[killed], 'test/cockpit/chrome-owner-probe.mjs'], { cwd: ROOT, env, stdio: 'ignore' });
      recorded.push(victim.pid);
      recorded.push(await waitForReady(readyFile, victim, READY_BUDGET_MS)); // budget: hang ceiling for Chrome to start, including a gate browser-slot wait; no speed claim.
      const before = chromeProcesses(profile);
      assert.ok(before.length > 0, 'the owner holds a live Chrome before it is killed');
      const ended = new Promise((resolve) => victim.once('exit', (code, signal) => resolve(signal)));
      process.kill(victim.pid, 'SIGKILL');
      assert.equal(await ended, 'SIGKILL', `the ${killed} died by SIGKILL`);
      const gone = await waitForChromeGone(profile, DEATH_BUDGET_MS); // budget: the item's declared bound on Chrome outliving its dead owner.
      assert.notEqual(gone, null, `Chrome (${before.length} processes, pids ${before.map(row => row.pid).join(',')}) survived its ${killed} for ${DEATH_BUDGET_MS}ms`); // budget: the item's declared 10 s bound.
    });
  }
}
