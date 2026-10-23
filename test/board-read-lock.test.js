/** @pullboard-test-input source-tree */
/** @pullboard-test-loads src/cli.js src/board.js src/board-migrate.js src/board-read.js src/commands/status.js src/commands/show.js */
/** A read command opens the board read-only, so a writer holding the lock never stalls it [C7]. */
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { after, test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { cpSync } from 'node:fs';
import { join, resolve } from 'node:path';
import * as store from '../src/board.js';
import { main } from '../src/cli.js';
import { createE2eHelpers } from './e2e-helpers.js';
import { runFixtureChild, startFixtureChild as spawn } from './fixture-child.js';

const e2e = createE2eHelpers();
after(e2e.cleanup);

/** Hold the board's write lock from another process for `ms`; resolves once it is held, with the holder's exit. */
async function holdWriteLock(file, ms) {
  const script = [
    "const { DatabaseSync } = require('node:sqlite');",
    'const [file, ms] = process.argv.slice(1);',
    'const db = new DatabaseSync(file);',
    "db.exec('BEGIN IMMEDIATE');",
    "db.exec(\"INSERT INTO shout (shout_from, shout_to, shout_text, shout_at) VALUES ('holder', 'all', 'held', '2026-10-22T00:00:00Z')\");",
    "process.stdout.write('held\\n');",
    'Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Number(ms));',
    "db.exec('COMMIT');",
  ].join('\n');
  const child = spawn(process.execPath, ['-e', script, file, String(ms)], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
  const closed = new Promise((done) => child.once('close', (code) => done({ code, stderr })));
  await new Promise((held, fail) => {
    child.stdout.setEncoding('utf8').on('data', (chunk) => { if (chunk.includes('held')) held(); });
    child.once('close', (code) => fail(new Error(`the lock holder exited ${code} before holding: ${stderr}`)));
  });
  return { closed };
}

const HOMES = ['PULLBOARD_HOME', 'PULLBOARD_MACHINE_HOME'];

/**
 * Run one CLI command in this process under the fixture's homes, with the time it took. Why in
 * process: a fresh node's startup varies by hundreds of ms on a loaded machine, the lock does not.
 */
async function timed(box, cwd, ...argv) {
  const saved = HOMES.map((name) => process.env[name]);
  for (const name of HOMES) process.env[name] = box.env[name];
  let out = '';
  let err = '';
  const startedAt = performance.now();
  try {
    const code = await main(argv, { cwd, stdout: { isTTY: false, write: (text) => { out += text; } }, stderr: { write: (text) => { err += text; } } });
    return { code, out, err, ms: performance.now() - startedAt };
  } finally {
    HOMES.forEach((name, index) => { if (saved[index] === undefined) delete process.env[name]; else process.env[name] = saved[index]; });
  }
}

/** The fastest of two runs of each read, so one scheduling stall is not read as the lock. */
async function reads(box) {
  const runs = [];
  for (let round = 0; round < 2; round += 1) runs.push([await timed(box, box.repo, 'status'), await timed(box, box.repo, 'show', '1')]);
  const fastest = (index) => runs.map((pair) => pair[index]).reduce((best, run) => (run.ms < best.ms ? run : best));
  return { status: fastest(0), show: fastest(1) };
}

test('a read answers while a writer holds the lock [C7]', async (t) => {
  const box = e2e.project();
  assert.equal(box.run(box.repo, 'add', 'web', 'Page', '--specs', 'G1', '--criterion', 'renders').code, 0);
  const file = join(box.repo, '.git', 'pullboard', 'board.sqlite');
  // Both reads without a writer first: what is left over under the lock is the lock's cost.
  const free = await reads(box);
  for (const [name, run] of Object.entries(free)) assert.equal(run.code, 0, `${name}: ${run.err}`);

  const holder = await holdWriteLock(file, 3000);
  const startedAt = performance.now();
  const { status, show } = await reads(box);
  const heldFor = performance.now() - startedAt;
  assert.equal((await holder.closed).code, 0, 'the holder kept the lock and committed');
  assert.ok(heldFor < 3000, `every read finished inside the 3 s hold (${Math.round(heldFor)} ms)`); // budget: ceiling is the 3 s hold declared above; a read that waits out the lock ends after it
  assert.equal(status.code, 0, status.err);
  assert.match(status.out, /board: 1 open/u);
  assert.equal(show.code, 0, show.err);
  assert.match(show.out, /^#1 /mu);
  for (const [name, run] of Object.entries({ status, show })) {
    const waited = run.ms - free[name].ms;
    t.diagnostic(`${name}: ${Math.round(run.ms)} ms under a held write lock, ${Math.round(free[name].ms)} ms unlocked`);
    assert.ok(run.ms < 200 || waited < 200, `${name} under a held write lock took ${Math.round(run.ms)} ms, ${Math.round(waited)} ms more than unlocked`);
  }

  // An older board is still migrated by the next command that writes. Only trunk code migrates a
  // shared board, so the write runs from a released copy outside any checkout.
  const db = new DatabaseSync(file);
  db.exec('PRAGMA user_version = 1');
  db.close();
  const release = join(box.dir, 'release');
  for (const path of ['src', 'bin', 'package.json']) cpSync(resolve(import.meta.dirname, '..', path), join(release, path), { recursive: true });
  const released = (...argv) => runFixtureChild(process.execPath, [join(release, 'bin', 'pullboard.js'), ...argv], { cwd: box.repo, env: box.env, encoding: 'utf8' });
  /** The board's PRAGMA user_version, read without touching it. */
  const version = () => {
    const board = store.openBoardReadOnly(file);
    try { return board.prepare('PRAGMA user_version').get().user_version; } finally { board.close(); }
  };
  // A read on the older board answers as it is and leaves it older, even from code that may migrate.
  const read = released('status');
  assert.equal(read.status, 0, read.failure ?? read.stderr);
  assert.match(read.stdout, /board: 1 open/u);
  assert.equal(version(), 1, 'status never migrates the board');
  const write = released('add', 'web', 'Footer', '--specs', 'G1', '--criterion', 'renders');
  assert.equal(write.status, 0, write.failure ?? write.stderr);
  assert.equal(version(), store.SCHEMA_VERSION, 'the next write command migrates it');
});
