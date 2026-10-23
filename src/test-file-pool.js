/**
 * One machine-wide pool of test-file tokens [C7]: every test-file process takes a token before its tests run,
 * so the files running at once on a machine never exceed its cores, however many runs share it.
 *
 * Measured 22 Oct: 28 runs at --test-concurrency=10 kept 54 file processes live on 14 cores, and passing files
 * ran 18.5 times slower in landings than alone. A per-run limit cannot see the other runs; this pool can.
 *
 * A test file that starts its own run-tests and waits on it lends its token to that nested run: the nested
 * files take the lent token one at a time, never a second token from the pool, so N saturated outer files
 * with nested runs still run at most N files at once, and a nested run can never wait on its own parent.
 */
import { availableParallelism } from 'node:os';
import { randomUUID } from 'node:crypto';
import { machineHome } from './machine-home.js';

/** Names the pool a test-file process takes from, and the token its parent lent, as JSON. */
export const TEST_FILE_POOL_ENV = 'PULLBOARD_TEST_FILE_POOL';
/** Overrides the pool size; a test models a smaller machine with it. */
export const TEST_FILE_CORES_ENV = 'PULLBOARD_TEST_FILE_CORES';
/** The resource row every top-level test file takes from. */
const POOL_NAME = 'test-files';

/**
 * Read the pool a test-file process belongs to, or null outside a run-tests run.
 *
 * @param {NodeJS.ProcessEnv} env
 * @returns {{ home: string, cores: number, loan?: string } | null}
 */
export function testFilePool(env = process.env) {
  const value = env[TEST_FILE_POOL_ENV];
  if (!value) return null;
  try {
    const pool = JSON.parse(value);
    if (typeof pool?.home !== 'string' || !Number.isSafeInteger(pool.cores) || pool.cores < 1) return null;
    if (pool.loan !== undefined && typeof pool.loan !== 'string') return null;
    return pool;
  } catch { return null; }
}

/**
 * The pool value a run passes to its test files: an inherited one (a nested run keeps its parent's pool and
 * loan), or this machine's pool sized to its cores. One variable carries both, so no copy of the environment
 * can keep the pool and drop the loan, which would let a nested file wait on a token its parent holds.
 *
 * @param {NodeJS.ProcessEnv} env
 * @returns {string}
 */
export function testFilePoolValue(env = process.env) {
  if (testFilePool(env)) return env[TEST_FILE_POOL_ENV];
  const override = Number(env[TEST_FILE_CORES_ENV]);
  const cores = Number.isSafeInteger(override) && override > 0 ? override : Math.max(1, availableParallelism());
  return JSON.stringify({ home: machineHome(), cores });
}

/**
 * Take this test-file process's token and hold it until the process exits. A file with a lent token takes
 * that one; any other takes one from the machine pool. The file then lends its own token to anything it starts.
 *
 * @param {NodeJS.ProcessEnv} env - Changed in place: descendants see this file's loan.
 * @returns {Promise<void>}
 */
export async function takeTestFileToken(env = process.env) {
  const pool = testFilePool(env);
  if (!pool) return;
  const { takeResource } = await import('./resources.js');
  // The test file runs with a private machine home; the pool lives in the real one, named by the run.
  const ownHome = env.PULLBOARD_MACHINE_HOME;
  env.PULLBOARD_MACHINE_HOME = pool.home;
  let lease;
  try {
    lease = await takeResource(pool.loan
      ? { name: pool.loan, capacity: 1, kind: 'test-file' }
      : { name: POOL_NAME, capacity: pool.cores, kind: 'test-file' });
  } finally {
    if (ownHome === undefined) delete env.PULLBOARD_MACHINE_HOME;
    else env.PULLBOARD_MACHINE_HOME = ownHome;
  }
  process.once('exit', () => lease.release());
  env[TEST_FILE_POOL_ENV] = JSON.stringify({ home: pool.home, cores: pool.cores, loan: `test-file-loan:${randomUUID()}` });
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
