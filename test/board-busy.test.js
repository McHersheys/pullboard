/** @pullboard-test-input source-tree */
/** @pullboard-test-loads src/board.js */
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { join, resolve } from 'node:path';
import { writeFileSync } from 'node:fs';
import { boardWriteHolderText } from '../src/board-write-lock.js';
import { exportBoard } from '../src/exchange.js';
import { createE2eHelpers } from './e2e-helpers.js';
import { runFixtureChild, startFixtureChild } from './fixture-child.js';

const e2e = createE2eHelpers();
after(e2e.cleanup);
const BIN = resolve(import.meta.dirname, '../bin/pullboard.js');

/** Snapshot the real private board without acquiring a write lock. */
function snapshot(file) {
  const db = new DatabaseSync(file, { readOnly: true });
  try { return exportBoard({ db }); }
  finally { db.close(); }
}

/** Hold only this test's SQLite write lock until the parent explicitly releases it. */
async function holdWriteLock(box, file) {
  const source = `
    import { DatabaseSync } from 'node:sqlite';
    const db = new DatabaseSync(process.argv[1]);
    db.exec('PRAGMA busy_timeout = 10000; BEGIN IMMEDIATE');
    /** Release the private lock on request or loss of its owning parent. */
    function release() {
      db.exec('ROLLBACK');
      db.close();
      process.removeListener('disconnect', release);
      if (process.connected) process.disconnect();
    }
    process.once('disconnect', release);
    process.once('message', release);
    process.send({ kind: 'locked' });
  `;
  const child = startFixtureChild(process.execPath, ['--input-type=module', '-e', source, file], {
    cwd: box.repo, env: box.env, stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  });
  const closed = new Promise((resolveClosed) => child.once('close', (code, signal) => resolveClosed({ code, signal })));
  await new Promise((resolveReady, rejectReady) => {
    child.once('error', rejectReady);
    child.once('close', (code, signal) => rejectReady(new Error(`private lock holder exited before readiness: ${code}/${signal}`)));
    child.on('message', (message) => { if (message?.kind === 'locked') resolveReady(); });
  });
  let released = false;
  return async () => {
    if (released) return;
    released = true;
    if (child.connected) child.send({ kind: 'release' });
    const result = await closed;
    assert.deepEqual(result, { code: 0, signal: null }, child.fixtureFailure);
  };
}

/** Prove a real ordered CLI move refuses contention atomically, then succeeds exactly once. */
async function proveBusyWrite(t, args, table) {
  const box = e2e.project();
  const file = join(box.repo, '.git', 'pullboard', 'board.sqlite');
  const before = snapshot(file);
  const release = await holdWriteLock(box, file);
  t.after(release);
  const refused = runFixtureChild(process.execPath, [BIN, ...args, '--json'], {
    cwd: box.repo, env: box.env, encoding: 'utf8',
  });
  assert.equal(refused.status, 1, refused.context);
  const output = `${refused.stdout}\n${refused.stderr}`;
  assert.match(output, /BOARD_BUSY/u, output);
  const document = JSON.parse(refused.stdout);
  assert.equal(document.error.code, 'BOARD_BUSY');
  assert.match(document.error.message, /remained held by another process after \d+ms/u);
  assert.ok(document.error.message.includes(file), document.error.message);
  assert.match(document.error.next, /retry/u);
  assert.doesNotMatch(output, /Error: database is locked|\n\s+at (?:\S+\s+\()?file:|ERR_SQLITE_ERROR/u);
  assert.deepEqual(snapshot(file), before, 'refused move must not partially change any board table');
  await release();
  const retried = runFixtureChild(process.execPath, [BIN, ...args, '--json'], {
    cwd: box.repo, env: box.env, encoding: 'utf8',
  });
  assert.equal(retried.status, 0, retried.context);
  const after = snapshot(file);
  assert.equal(after.tables[table].length, before.tables[table].length + 1, 'one retry makes exactly one move');
  assert.equal(after.tables.event.length, before.tables.event.length + 1, 'only the successful retry records an event');
}

test('a board write that outwaits the busy timeout is refused by name, never a stack trace [C7,P4,B2]', async (t) => {
  await proveBusyWrite(t, ['shout', 'all', 'private busy shout'], 'shout');
});

test('a busy ordered item addition leaves no partial item and retries once [C7,P4,B2]', async (t) => {
  await proveBusyWrite(t, ['add', 'web', 'private busy item', '--specs', 'G1', '--criterion', 'the page renders'], 'item');
});

/** Hold a public store transaction, with an explicit diagnostic identity, until its owner releases it. */
async function holdNamedWriter(box, file) {
  const releaseFile = join(box.dir, 'release-named-board-writer');
  const source = `
    import * as store from ${JSON.stringify(new URL('../src/board.js', import.meta.url).href)};
    import { existsSync } from 'node:fs';
    const board = store.openBoard(process.argv[1], undefined, {
      writeContext: { command: 'private-lock-holder', seat: 'coordinator' },
    });
    try {
      store.atomic(board, () => {
        process.send({ kind: 'locked' });
        const deadline = Date.now() + 30_000; // budget: bound an owned fixture covering the real 10 s SQLite busy timeout.
        while (!existsSync(process.argv[2])) {
          if (Date.now() >= deadline) throw new Error('private lock owner was not released');
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
        }
      });
    } finally {
      store.closeBoard(board);
      if (process.connected) process.disconnect();
    }
  `;
  const child = startFixtureChild(process.execPath, ['--input-type=module', '-e', source, file, releaseFile], {
    cwd: box.repo, env: box.env, stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  });
  let stderr = '';
  child.stderr?.on('data', chunk => { stderr += chunk; });
  const closed = new Promise(resolveClosed => child.once('close', (code, signal) => resolveClosed({ code, signal })));
  let released = false;
  /** Close and drain only the private holder started above, never another writer or SQLite lock file. */
  async function release() {
    if (!released) { released = true; writeFileSync(releaseFile, 'release\n'); }
    const result = await closed;
    assert.deepEqual(result, { code: 0, signal: null }, stderr || child.fixtureFailure);
  }
  try {
    await new Promise((resolveReady, rejectReady) => {
      child.once('error', rejectReady);
      child.once('close', (code, signal) => rejectReady(new Error(`private named writer exited before readiness: ${code}/${signal}`)));
      child.on('message', message => { if (message?.kind === 'locked') resolveReady(); });
    });
  } catch (error) {
    await release();
    throw error;
  }
  return { pid: child.pid, release, stderr: () => stderr };
}

test('a refused writer names the board lock holder [C7,P4,B2]', async t => {
  const box = e2e.project();
  const file = join(box.repo, '.git', 'pullboard', 'board.sqlite');
  const before = snapshot(file);
  const holder = await holdNamedWriter(box, file);
  t.after(holder.release);
  let message;
  try {
    const refused = runFixtureChild(process.execPath, [BIN, 'shout', 'all', 'private named-holder contention', '--json'], {
      cwd: box.repo, env: box.env, encoding: 'utf8',
    });
    assert.equal(refused.status, 1, refused.context);
    const document = JSON.parse(refused.stdout);
    assert.equal(document.error.code, 'BOARD_BUSY');
    message = document.error.message;
    assert.deepEqual(snapshot(file), before, 'contention leaves all native board tables unchanged');
  } finally {
    await holder.release();
  }
  assert.match(message, /private-lock-holder/u, 'the refusal names the real instrumented command');
  assert.match(message, /coordinator/u, 'the refusal names the real holder seat');
  assert.match(message, new RegExp(String.raw`\b${holder.pid}\b`, 'u'), 'the refusal names the live holder PID');
  const lines = holder.stderr().split('\n').filter(line => line.startsWith('pullboard: long board write '));
  assert.equal(lines.length, 1, 'only the outer transaction emits one long-write line');
  const record = JSON.parse(lines[0].slice('pullboard: long board write '.length));
  assert.equal(record.command, 'private-lock-holder');
  assert.equal(record.seat, 'coordinator');
  assert.equal(record.pid, holder.pid);
  assert.ok(record.durationMs > 2_000, 'the real busy timeout held the writer longer than the declared 2 s threshold'); // budget: declared #1197 over-2s logging threshold.
});


/** Read only the product's structured long-write diagnostic, leaving other stderr intact. */
function longWrites(stderr) {
  return stderr.split('\n').filter(line => line.startsWith('pullboard: long board write '))
    .map(line => JSON.parse(line.slice('pullboard: long board write '.length)));
}

test('a nested rolled-back writer logs once and leaves no live advisory record [C7,P4,B2]', () => {
  const box = e2e.project();
  const file = join(box.repo, '.git', 'pullboard', 'board.sqlite');
  const before = snapshot(file);
  const source = `
    import * as store from ${JSON.stringify(new URL('../src/board.js', import.meta.url).href)};
    const board = store.openBoard(process.argv[1], undefined, { writeContext: { command: 'private-rollback', seat: 'coordinator' } });
    try {
      store.atomic(board, () => store.atomic(board, () => {
        // budget: a genuine held write must cross the product's two-second diagnostic threshold.
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2_100);
        throw new Error('private rollback control');
      }));
    } catch (error) {
      if (error.message !== 'private rollback control') throw error;
    } finally { store.closeBoard(board); }
  `;
  const result = runFixtureChild(process.execPath, ['--input-type=module', '-e', source, file], {
    cwd: box.repo, env: box.env, encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.context);
  const records = longWrites(result.stderr);
  assert.equal(records.length, 1, 'nested savepoints do not duplicate the outer hold');
  assert.equal(records[0].command, 'private-rollback');
  assert.equal(records[0].outcome, 'rolled-back');
  assert.ok(records[0].durationMs > 2_000); // budget: declared #1197 over-2s logging threshold.
  assert.equal(boardWriteHolderText(file), '', 'released writers do not remain current');
  assert.deepEqual(snapshot(file), before, 'diagnostic metadata never changes native board state');
  const stale = join(file + '.write-holders', `${process.pid}-deadbeef.json`);
  writeFileSync(stale, JSON.stringify({ version: 1, pid: process.pid, started: 'not this process start',
    processSha256: 'a'.repeat(64), command: 'stale-private-writer', seat: 'coordinator', acquiredAt: Date.now() }));
  assert.equal(boardWriteHolderText(file), '', 'a reused PID without matching identity is not a current holder');
});

test('a real CLI writer labels its long transaction without changing JSON or native counts [C7,P4,B2]', () => {
  const box = e2e.project();
  const file = join(box.repo, '.git', 'pullboard', 'board.sqlite');
  const before = snapshot(file);
  const preload = join(box.dir, 'hold-private-shout.mjs');
  writeFileSync(preload, `
    import { DatabaseSync } from 'node:sqlite';
    const prepare = DatabaseSync.prototype.prepare;
    let delayed = false;
    /** Delay one actual private shout insertion after its outer transaction has acquired the lock. */
    DatabaseSync.prototype.prepare = function(sql, ...args) {
      const statement = prepare.call(this, sql, ...args);
      if (!sql.includes('INSERT INTO shout')) return statement;
      const run = statement.run;
      statement.run = function(...values) {
        if (!delayed) {
          delayed = true;
          // budget: exercise the genuine long-hold diagnostic, not a performance assertion.
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2_100);
        }
        return run.apply(this, values);
      };
      return statement;
    };
  `);
  const result = runFixtureChild(process.execPath, ['--import', preload, BIN, 'shout', 'all', 'private timed shout', '--json'], {
    cwd: box.web, env: box.env, encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.context);
  assert.equal(JSON.parse(result.stdout).version, 1, 'the diagnostic stays off JSON stdout');
  const records = longWrites(result.stderr);
  assert.equal(records.length, 1);
  assert.equal(records[0].command, 'shout');
  assert.equal(records[0].seat, 'web-1');
  assert.equal(records[0].outcome, 'committed');
  assert.ok(Number.isSafeInteger(records[0].pid));
  assert.ok(records[0].durationMs > 2_000); // budget: declared #1197 over-2s logging threshold.
  const after = snapshot(file);
  assert.equal(after.tables.shout.length, before.tables.shout.length + 1);
  assert.equal(after.tables.event.length, before.tables.event.length + 1);
  assert.equal(boardWriteHolderText(file), '');
});
