/** The relay lock has one holder at a time, even when many waiters find the same dead owner [H5]. */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { test } from 'node:test';

const LOCK_MODULE = new URL('../src/relay-lock.js', import.meta.url).href;

/** A process number that belonged to a process that has already exited. */
function deadPid() {
  return spawnSync(process.execPath, ['-e', '']).pid;
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

test('waiters on a dead owner leave exactly one holder at a time [H5]', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'pullboard-relay-lock-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (let round = 0; round < 15; round += 1) {
    const file = join(root, `relay-${round}.json`);
    const log = join(root, `log-${round}`);
    writeFileSync(log, '');
    // The lock a crashed command left behind: its owner's process is gone.
    mkdirSync(`${file}.lock`);
    writeFileSync(join(`${file}.lock`, 'pid'), String(deadPid()));
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
      assert.ok(holders <= 1, `round ${round}: two waiters held the lock at once:\n${lines.join('\n')}`);
    }
    assert.equal(lines.filter(line => line.startsWith('enter')).length, 6, `round ${round}: every waiter held the lock once`);
  }
});
