/** Translate SQLite lock contention without coupling error reporting to the full board store [C7]. */
import { Refused } from './refused.js';

/**
 * Replace SQLite's bare lock error with the board path and elapsed wait when the wait expires.
 *
 * @param {string} file
 * @param {number} startedAt
 * @param {Error & { errcode?: number }} error
 * @returns {Error}
 */
export function boardBusyError(file, startedAt, error) {
  const sqliteCode = Number.isInteger(error.errcode) ? error.errcode & 0xff : null;
  if (sqliteCode !== 5 && error.code !== 'SQLITE_BUSY' && !/database is locked/iu.test(error.message ?? '')) return error;
  return new Refused('BOARD_BUSY', `board file ${file} remained held by another process after ${Date.now() - startedAt}ms; wait for it to finish and retry`);
}

