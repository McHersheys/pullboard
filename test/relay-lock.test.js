/** The relay lock has one holder at a time, even when many waiters find the same dead owner [H5]. */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { test } from 'node:test';

const LOCK_MODULE = new URL('../src/relay-lock.js', import.meta.url).href;

/**
 * A process number no process can hold: far above any system's limit. Not one that just exited, nor a free one in the
 * usual range: the system may hand either to one of the waiters, and the lock's owner would then look alive.
 */
function deadPid() {
  const pid = 2_147_483_000;
  try { process.kill(pid, 0); } catch (error) { if (error.code === 'ESRCH') return pid; throw error; }
  throw new Error('the dead owner\'s process number is in use');
}

/** One waiter: take the lock, note entry and exit in the shared log, and hold it briefly. */
const WAITER = `
import { appendFileSync } from 'node:fs';
const { locked } = await import(process.argv[1]);
const [log, file] = process.argv.slice(2);
await locked(file, async () => {
  appendFileSync(log, 'enter ' + process.pid + '\\n');
  await new Promise(done => setTimeout(done, 30));
  appendFileSync(log, 'exit ' + process.pid + '\\n');
});
`;

/** Run six waiters against a dead owner's lock, optionally with a dead reaper's reap lock too, and check one holder. */
async function round(root, index, { deadReaper = false } = {}) {
  const file = join(root, `relay-${index}.json`);
  const log = join(root, `log-${index}`);
  writeFileSync(log, '');
  // The lock a crashed command left behind: its owner's process is gone.
  mkdirSync(`${file}.lock`);
  writeFileSync(join(`${file}.lock`, 'pid'), String(deadPid()));
  if (deadReaper) {
    // And the reap lock of a waiter that died while clearing it.
    mkdirSync(`${file}.lock.reap`);
    writeFileSync(join(`${file}.lock.reap`, 'pid'), String(deadPid()));
  }
  const waiters = Array.from({ length: 6 }, () => new Promise((done, fail) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', WAITER, LOCK_MODULE, log, file], { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', part => { stderr += part; });
    child.once('exit', code => (code === 0 ? done() : fail(new Error(stderr))));
  }));
  await Promise.all(waiters);
  let holders = 0;
  const lines = readFileSync(log, 'utf8').trim().split('\n');
  for (const line of lines) {
    holders += line.startsWith('enter') ? 1 : -1;
    assert.ok(holders <= 1, `round ${index}: two waiters held the lock at once:\n${lines.join('\n')}`);
  }
  assert.equal(lines.filter(line => line.startsWith('enter')).length, 6, `round ${index}: every waiter held the lock once`);
}

test('waiters on a dead owner leave exactly one holder at a time [H5]', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'pullboard-relay-lock-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (let index = 0; index < 15; index += 1) await round(root, index);
});

test('a reaper that died clearing a lock is recovered, and still one waiter holds the lock at a time [H5]', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'pullboard-relay-lock-reaper-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (let index = 0; index < 10; index += 1) await round(root, index, { deadReaper: true });
});
