/**
 * One machine-wide pool of test-file tokens [C7]: every test-file process takes a token before its tests run,
 * so the files running at once on a machine never exceed its cores, however many runs share it.
 *
 * Measured 22 Oct: 28 runs at --test-concurrency=10 kept 54 file processes live on 14 cores, and passing files
 * ran 18.5 times slower in landings than alone. A per-run limit cannot see the other runs; this pool can.
 *
 * A test file that starts a nested run with a synchronous call is blocked until that call returns, so it lends its
 * place for the call: the call's files fill that place one at a time and never take a second core, and the call
 * returns only after the last of them exits, so the file resumes into its own place. Nothing it starts can wait
 * forever on the token it holds. A run started asynchronously, or left behind by the call, borrows nothing.
 */
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { availableParallelism } from 'node:os';
import { join } from 'node:path';
import { machineHome } from './machine-home.js';

/** Names the pool a test-file process takes from, and the file process that started this run, as JSON. */
export const TEST_FILE_POOL_ENV = 'PULLBOARD_TEST_FILE_POOL';
/** Overrides the pool size; a test models a smaller machine with it. */
export const TEST_FILE_CORES_ENV = 'PULLBOARD_TEST_FILE_CORES';
// Budget: a waiting file looks again this often with one read; it takes the write lock only when a place looks
// free, or once a second to prune rows of processes that have gone.
const POLL_MS = 25;
const PRUNE_MS = 1_000;
// Budget: a new pool's one-time setup waits out other files setting it up this long before it fails.
const SETUP_LOCK_MS = 10_000;

/**
 * Read the pool a test-file process belongs to, or null outside a run-tests run.
 *
 * @param {NodeJS.ProcessEnv} env
 * @returns {{ home: string, cores: number, lender?: number } | null}
 */
export function testFilePool(env = process.env) {
  const value = env[TEST_FILE_POOL_ENV];
  if (!value) return null;
  try {
    const pool = JSON.parse(value);
    if (typeof pool?.home !== 'string' || !Number.isSafeInteger(pool.cores) || pool.cores < 1) return null;
    if (pool.lender !== undefined && !Number.isSafeInteger(pool.lender)) return null;
    if (pool.call !== undefined && typeof pool.call !== 'string') return null;
    return pool;
  } catch { return null; }
}

/**
 * The pool value a run passes to its test files: an inherited one, so a nested run shares its parent's pool and
 * lender, or this machine's pool sized to its cores.
 *
 * @param {NodeJS.ProcessEnv} env
 * @returns {string}
 */
export function testFilePoolValue(env = process.env) {
  const pool = testFilePool(env);
  // A nested run's files keep the file that started it as their lender, so they take its place.
  if (pool) return JSON.stringify({ home: pool.home, cores: pool.cores, ...(pool.lender ? { lender: pool.lender, call: pool.call } : {}) });
  const override = Number(env[TEST_FILE_CORES_ENV]);
  const cores = Number.isSafeInteger(override) && override > 0 ? override : Math.max(1, availableParallelism());
  return JSON.stringify({ home: machineHome(), cores });
}

/**
 * Load SQLite without its experimental warning: the runner's own output must stay exactly what its tests pin,
 * and a run that never nests never loads it at all.
 */
async function databaseSync() {
  const emitWarning = process.emitWarning;
  process.emitWarning = (warning, ...rest) => {
    if (!String(warning).includes('SQLite is an experimental feature')) emitWarning.call(process, warning, ...rest);
  };
  try { return (await import('node:sqlite')).DatabaseSync; }
  finally { process.emitWarning = emitWarning; }
}

/** Open the pool's database, creating its tables on first use. */
async function openPool(home) {
  mkdirSync(home, { recursive: true });
  const DatabaseSync = await databaseSync();
  const db = new DatabaseSync(join(home, 'test-file-pool.sqlite'));
  db.exec('PRAGMA busy_timeout = 10000');
  // Switching a new pool to WAL takes an exclusive lock that SQLite may refuse at once, without the busy wait,
  // when many files open the same new pool together; wait the lock out like any other.
  for (let deadline = Date.now() + SETUP_LOCK_MS; ; await new Promise(next => setTimeout(next, POLL_MS))) {
    try { db.exec('PRAGMA journal_mode = WAL'); break; }
    catch (error) { if (!/locked|busy/iu.test(error.message) || Date.now() > deadline) throw error; }
  }
  db.exec(`
    PRAGMA synchronous = NORMAL;
    CREATE TABLE IF NOT EXISTS file_holder(pid INTEGER PRIMARY KEY, since INTEGER NOT NULL, lender INTEGER);
    CREATE TABLE IF NOT EXISTS file_waiter(ticket INTEGER PRIMARY KEY AUTOINCREMENT, pid INTEGER NOT NULL UNIQUE);
    CREATE TABLE IF NOT EXISTS file_call(call TEXT PRIMARY KEY, lender INTEGER NOT NULL, closing INTEGER NOT NULL DEFAULT 0);`);
  // A pool made by an earlier build of this module gains the columns it lacks; a missing value reads as none.
  // Another file may add the same column first; its addition is as good as ours.
  const addColumn = (table, column, type) => {
    if (db.prepare(`PRAGMA table_info(${table})`).all().some(entry => entry.name === column)) return;
    try { db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`); }
    catch (error) { if (!/duplicate column/iu.test(error.message)) throw error; }
  };
  addColumn('file_holder', 'lender', 'INTEGER');
  addColumn('file_holder', 'call', 'TEXT');
  addColumn('file_call', 'closing', 'INTEGER NOT NULL DEFAULT 0');
  return db;
}

/** Whether a process is alive; a process another user owns still is. */
function alive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) { return error.code === 'EPERM'; }
}

/** Run one write transaction that no other process interleaves. */
function immediate(db, work) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = work();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

/** Drop rows whose process has gone, so a crashed file or call never holds a place. */
function prune(db) {
  for (const { pid } of db.prepare('SELECT pid FROM file_holder').all()) {
    if (!alive(pid)) db.prepare('DELETE FROM file_holder WHERE pid = ?').run(pid);
  }
  for (const { pid } of db.prepare('SELECT pid FROM file_waiter').all()) {
    if (!alive(pid)) db.prepare('DELETE FROM file_waiter WHERE pid = ?').run(pid);
  }
  for (const { lender } of db.prepare('SELECT DISTINCT lender FROM file_call').all()) {
    if (!alive(lender)) db.prepare('DELETE FROM file_call WHERE lender = ?').run(lender);
  }
}

/**
 * The places taken. A holder inside a synchronous call is blocked, so it takes no place of its own: it reserves one
 * place, which one file of that call fills. Every other holder takes one place. The reserved place comes back to the
 * caller when its file exits, and the call returns only after that (see lendThroughSyncCalls), so no other file can
 * take it in between and the caller resumes into its own place.
 */
function occupied(db) {
  return db.prepare(`WITH calling AS (SELECT DISTINCT lender AS pid FROM file_call WHERE lender IN (SELECT pid FROM file_holder))
    SELECT (SELECT count(*) FROM file_holder WHERE pid NOT IN (SELECT pid FROM calling))
      + (SELECT count(*) FROM calling WHERE NOT EXISTS (SELECT 1 FROM file_holder
          WHERE file_holder.call IN (SELECT call FROM file_call WHERE file_call.lender = calling.pid))) AS n`).get().n;
}

/** How many places are taken and how many waiters are ahead of this one, read without a write lock. */
function standing(db) {
  const mine = db.prepare('SELECT ticket FROM file_waiter WHERE pid = ?').get(process.pid)?.ticket;
  const ahead = db.prepare('SELECT count(*) AS n FROM file_waiter WHERE ticket < ?').get(mine).n;
  return { taken: occupied(db), ahead };
}

/**
 * The places taken in a pool, for a test that builds its rows by hand.
 *
 * @param {string} home
 * @returns {Promise<number>}
 */
export async function occupiedPlaces(home) {
  const db = await openPool(home);
  try { prune(db); return occupied(db); } finally { db.close(); }
}

/**
 * Admit this process when a place is free and every earlier waiter fits first. A file started inside its caller's
 * open synchronous call steps into the caller's reserved place when no other file of the caller holds it; that
 * leaves the count unchanged. Only a file admitted that way belongs to the call.
 */
function admit(db, cores, lender, call) {
  return immediate(db, () => {
    prune(db);
    const reserved = call && db.prepare(`SELECT 1 FROM file_call WHERE call = ? AND closing = 0 AND lender IN (SELECT pid FROM file_holder)
      AND NOT EXISTS (SELECT 1 FROM file_holder WHERE file_holder.call IN (SELECT call FROM file_call WHERE lender = ?))`).get(call, lender);
    if (!reserved) {
      const { taken, ahead } = standing(db);
      if (ahead >= cores - taken) return false;
    }
    db.prepare('DELETE FROM file_waiter WHERE pid = ?').run(process.pid);
    db.prepare('INSERT OR REPLACE INTO file_holder(pid, since, lender, call) VALUES (?, ?, ?, ?)')
      .run(process.pid, Date.now(), lender ?? null, reserved ? call : null);
    return true;
  });
}

/**
 * Take this test-file process's token and hold it until the process exits; then lend its place through its
 * synchronous child calls.
 *
 * @param {NodeJS.ProcessEnv} env - Changed in place: descendants see this file's pool, without a lender.
 * @returns {Promise<number>} How long this file waited for its token, in ms.
 */
export async function takeTestFileToken(env = process.env) {
  const pool = testFilePool(env);
  if (!pool) return 0;
  const asked = Date.now();
  const db = await openPool(pool.home);
  immediate(db, () => db.prepare('INSERT OR IGNORE INTO file_waiter(pid) VALUES (?)').run(process.pid));
  let pruned = 0;
  while (true) {
    const { taken, ahead } = standing(db);
    // A dead holder only goes in the write path, so look there at least once a second even when nothing looks free.
    if (pool.call || ahead < pool.cores - taken || Date.now() - pruned >= PRUNE_MS) {
      pruned = Date.now();
      if (admit(db, pool.cores, pool.lender, pool.call)) break;
    }
    await new Promise(done => setTimeout(done, POLL_MS));
  }
  process.once('exit', () => {
    try { db.prepare('DELETE FROM file_holder WHERE pid = ?').run(process.pid); db.close(); }
    catch { /* A row left behind is pruned once this process is gone. */ }
  });
  env[TEST_FILE_POOL_ENV] = JSON.stringify({ home: pool.home, cores: pool.cores });
  lendThroughSyncCalls(pool, env, db);
  return Date.now() - asked;
}

/** Block this thread for a moment without spinning: the caller is inside a synchronous call anyway. */
function pauseSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Lend this file's place only across a synchronous child call (spawnSync, execFileSync, execSync), which blocks this
 * file's JavaScript until the call returns. The call is a row: while it is open, one file it starts may fill the
 * place. When the child returns, the call closes to new files, and it returns to this file only once the file that
 * filled the place has exited, so this file never resumes beside it. A run the call leaves behind lends nothing.
 * A child started asynchronously gets no call: this file may keep computing, so it keeps its own token and the nested
 * files take theirs from the pool (#1046). A call whose environment no longer names this pool, as a test that
 * isolates its own pool does, is left exactly as written.
 */
function lendThroughSyncCalls(pool, env, db) {
  const ours = env[TEST_FILE_POOL_ENV];
  for (const name of ['spawnSync', 'execFileSync', 'execSync']) {
    const original = childProcess[name];
    childProcess[name] = function lendingSyncCall(...args) {
      const at = args.findIndex((arg, index) => index > 0 && arg && typeof arg === 'object' && !Array.isArray(arg));
      const options = at === -1 ? {} : args[at];
      const childEnv = options.env ?? env;
      if (childEnv[TEST_FILE_POOL_ENV] !== ours) return original.apply(this, args);
      const call = randomUUID();
      const lent = JSON.stringify({ home: pool.home, cores: pool.cores, lender: process.pid, call });
      const lending = { ...options, env: { ...childEnv, [TEST_FILE_POOL_ENV]: lent } };
      if (at === -1) args.push(lending); else args[at] = lending;
      db.prepare('INSERT INTO file_call(call, lender) VALUES (?, ?)').run(call, process.pid);
      try { return original.apply(this, args); }
      finally {
        db.prepare('UPDATE file_call SET closing = 1 WHERE call = ?').run(call);
        while (db.prepare('SELECT pid FROM file_holder WHERE call = ?').all(call).some(({ pid }) => alive(pid))) pauseSync(POLL_MS);
        db.prepare('DELETE FROM file_call WHERE call = ?').run(call);
      }
    };
  }
  syncBuiltinESMExports();
}

/**
 * Order test files longest-first by their last recorded wall time, so the slowest file never starts last.
 * A file with no record keeps its place after the timed ones; ties keep the given order.
 *
 * @param {string[]} files - As given to the runner, relative to `cwd` or absolute.
 * @param {Record<string, number>} times - Wall time in ms by repository-relative path.
 * @param {(file: string) => string} key - Maps a given file to its repository-relative path.
 * @returns {string[]}
 */
export function longestFirst(files, times, key) {
  const ms = file => times[key(file)];
  return files.map((file, index) => ({ file, index, time: ms(file) }))
    .sort((a, b) => (Number.isFinite(b.time) ? b.time : -1) - (Number.isFinite(a.time) ? a.time : -1) || a.index - b.index)
    .map(entry => entry.file);
}
