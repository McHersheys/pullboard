/** Translate SQLite lock contention without coupling error reporting to the full board store [C7]. */
import { Refused } from './refused.js';

/** Recognize SQLite's busy code, including extended busy result codes. */
function isBusy(error) {
  const sqliteCode = Number.isInteger(error.errcode) ? error.errcode & 0xff : null;
  return sqliteCode === 5 || error.code === 'SQLITE_BUSY' || /database is locked/iu.test(error.message ?? '');
}

/**
 * Replace SQLite's bare lock error with the board path and elapsed wait when the wait expires.
 *
 * @param {string} file
 * @param {number} startedAt
 * @param {Error & { errcode?: number }} error
 * @returns {Error}
 */
export function boardBusyError(file, startedAt, error) {
  if (!isBusy(error)) return error;
  return new Refused('BOARD_BUSY', `board file ${file} remained held by another process after ${Date.now() - startedAt}ms; wait for it to finish and retry`);
}

/** Name a failed write admission; resolve its board path only after real contention occurs. */
export function boardWriteBusyError(db, startedAt, error) {
  if (!isBusy(error)) return error;
  const file = db.prepare('PRAGMA database_list').all().find(row => row.name === 'main')?.file || ':memory:';
  return boardBusyError(file, startedAt, error);
}

