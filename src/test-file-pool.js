/**
 * One machine-wide pool of test-file tokens [C7]: every test-file process takes a token before its tests run,
 * so the files running at once on a machine never exceed its cores, however many runs share it.
 *
 * Measured 22 Oct: 28 runs at --test-concurrency=10 kept 54 file processes live on 14 cores, and passing files
 * ran 18.5 times slower in landings than alone. A per-run limit cannot see the other runs; this pool can.
 *
 * A test file that starts its own run-tests and waits on it lends its token to that nested run: while the nested
 * run lives, its parent counts as waiting, not running, so the nested files take the parent's place and never a
 * second core. Running files are holders minus lending parents, and that stays at or under the cores. Two nested
 * runs of one parent share its one place; neither can wait forever on the token its own parent holds.
 */
import { mkdirSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { join } from 'node:path';
import { machineHome } from './machine-home.js';

/** Names the pool a test-file process takes from, and the file process that started this run, as JSON. */
export const TEST_FILE_POOL_ENV = 'PULLBOARD_TEST_FILE_POOL';
/** Overrides the pool size; a test models a smaller machine with it. */
export const TEST_FILE_CORES_ENV = 'PULLBOARD_TEST_FILE_CORES';
// Budget: a waiting file looks again this often; admission is one short transaction.
const POLL_MS = 20;

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
    return pool;
  } catch { return null; }
}

/**
 * The pool value a run passes to its test files: an inherited one, so a nested run shares its parent's pool, or
 * this machine's pool sized to its cores.
 *
 * @param {NodeJS.ProcessEnv} env
 * @returns {string}
 */
export function testFilePoolValue(env = process.env) {
  const pool = testFilePool(env);
  if (pool) return JSON.stringify({ home: pool.home, cores: pool.cores });
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
  db.exec(`PRAGMA busy_timeout = 10000;
    CREATE TABLE IF NOT EXISTS file_holder(pid INTEGER PRIMARY KEY, since INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS file_waiter(ticket INTEGER PRIMARY KEY AUTOINCREMENT, pid INTEGER NOT NULL UNIQUE);
    CREATE TABLE IF NOT EXISTS file_loan(runner INTEGER PRIMARY KEY, lender INTEGER NOT NULL);`);
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

/** Drop rows whose process has gone, so a crashed file or run never holds a place. */
function prune(db) {
  for (const { pid } of db.prepare('SELECT pid FROM file_holder').all()) {
    if (!alive(pid)) db.prepare('DELETE FROM file_holder WHERE pid = ?').run(pid);
  }
  for (const { pid } of db.prepare('SELECT pid FROM file_waiter').all()) {
    if (!alive(pid)) db.prepare('DELETE FROM file_waiter WHERE pid = ?').run(pid);
  }
  for (const { runner } of db.prepare('SELECT runner FROM file_loan').all()) {
    if (!alive(runner)) db.prepare('DELETE FROM file_loan WHERE runner = ?').run(runner);
  }
}

/**
 * Admit this process when a core is free and every earlier waiter fits first. Running files are holders less the
 * holders lending to a live nested run.
 */
function admit(db, cores) {
  return immediate(db, () => {
    prune(db);
    const holders = db.prepare('SELECT count(*) AS n FROM file_holder').get().n;
    const lending = db.prepare('SELECT count(DISTINCT lender) AS n FROM file_loan WHERE lender IN (SELECT pid FROM file_holder)').get().n;
    const free = cores - (holders - lending);
    const mine = db.prepare('SELECT ticket FROM file_waiter WHERE pid = ?').get(process.pid)?.ticket;
    const ahead = db.prepare('SELECT count(*) AS n FROM file_waiter WHERE ticket < ?').get(mine).n;
    if (ahead >= free) return false;
    db.prepare('DELETE FROM file_waiter WHERE pid = ?').run(process.pid);
    db.prepare('INSERT OR REPLACE INTO file_holder(pid, since) VALUES (?, ?)').run(process.pid, Date.now());
    return true;
  });
}

/**
 * Take this test-file process's token and hold it until the process exits; then name this process as the lender
 * of anything it starts.
 *
 * @param {NodeJS.ProcessEnv} env - Changed in place: descendants see this file as their lender.
 * @returns {Promise<void>}
 */
export async function takeTestFileToken(env = process.env) {
  const pool = testFilePool(env);
  if (!pool) return;
  const db = await openPool(pool.home);
  immediate(db, () => db.prepare('INSERT OR IGNORE INTO file_waiter(pid) VALUES (?)').run(process.pid));
  while (!admit(db, pool.cores)) await new Promise(done => setTimeout(done, POLL_MS));
  process.once('exit', () => {
    try { db.prepare('DELETE FROM file_holder WHERE pid = ?').run(process.pid); db.close(); }
    catch { /* A row left behind is pruned once this process is gone. */ }
  });
  env[TEST_FILE_POOL_ENV] = JSON.stringify({ home: pool.home, cores: pool.cores, lender: process.pid });
}

/**
 * Mark this run as nested in a test file, so that file counts as waiting while the run lives. A run started
 * outside a test file lends nothing.
 *
 * @param {NodeJS.ProcessEnv} env
 * @returns {Promise<void>}
 */
export async function lendParentToken(env = process.env) {
  const pool = testFilePool(env);
  if (!pool?.lender) return;
  const db = await openPool(pool.home);
  immediate(db, () => db.prepare('INSERT OR REPLACE INTO file_loan(runner, lender) VALUES (?, ?)').run(process.pid, pool.lender));
  process.once('exit', () => {
    try { db.prepare('DELETE FROM file_loan WHERE runner = ?').run(process.pid); db.close(); }
    catch { /* A row left behind is pruned once this run is gone. */ }
  });
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
