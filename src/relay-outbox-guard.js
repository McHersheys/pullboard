/**
 * The outbox guard (#1013): a short local lock around the relay outbox and the board changes it stands for. A move
 * holds it while it queues and applies itself; the background sender holds it only while it rebuilds the board from
 * what the relay ordered. Neither holds it across a network call, so a move never waits on the relay.
 */
import {
  mkdirSync,
} from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import {
  dirname,
  join,
} from 'node:path';

// Budget: the guard is held only for local SQLite work (queue one move, or rebuild a board); a minute covers the
// largest board's rebuild with room, and a holder that died releases its lock with its process.
const GUARD_WAIT_MS = 60_000;

/** Guards this process holds now, by file, so a nested section inside one holder does not wait on itself. */
const HELD = new Map();

/** The guard file beside a relay link file. */
export function outboxGuardFile(linkFile) {
  return join(dirname(linkFile), 'relay-outbox.guard.sqlite');
}

/**
 * Run `work` holding the board's outbox guard, waiting while another process holds it.
 *
 * @template T
 * @param {string} linkFile - The board's relay link file.
 * @param {() => Promise<T> | T} work
 * @returns {Promise<T>}
 */
export function withOutboxGuard(linkFile, work) {
  return withFileLock(outboxGuardFile(linkFile), work);
}

/**
 * Run `work` holding an exclusive SQLite lock on `file`, waiting while another process holds it.
 * Why: SQLite's exclusive lock is released by the operating system when its holder dies, so a crashed command or
 * sender never leaves a board stuck; and it needs no polling, so a waiter starts the moment the holder finishes.
 *
 * @template T
 * @param {string} file
 * @param {() => Promise<T> | T} work
 * @returns {Promise<T>}
 */
export async function withFileLock(file, work) {
  if (HELD.get(file)) {
    HELD.set(file, HELD.get(file) + 1);
    try { return await work(); } finally { HELD.set(file, HELD.get(file) - 1); }
  }
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(file);
  try {
    db.exec(`PRAGMA busy_timeout = ${GUARD_WAIT_MS}`);
    db.exec('BEGIN EXCLUSIVE');
    HELD.set(file, 1);
    try { return await work(); }
    finally {
      HELD.delete(file);
      try { db.exec('COMMIT'); } catch { /* Nothing was written; closing releases the lock either way. */ }
    }
  } finally { db.close(); }
}
