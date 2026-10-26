/**
 * Change capture (#1013): while `captureBoardChanges` runs, every outermost board transaction records the exact
 * rows it changed as a SQLite changeset, so a local-first move made ahead of the relay's order can later be taken
 * back row for row instead of restoring the whole board.
 */

/** The capture lists of the calls running now, innermost last. */
const CAPTURES = [];

/**
 * Run `work`, collecting the changeset of every board transaction it commits, in order.
 *
 * @template T
 * @param {() => Promise<T> | T} work
 * @returns {Promise<{ result: T, changes: Uint8Array[] }>}
 */
export async function captureBoardChanges(work) {
  const changes = [];
  CAPTURES.push(changes);
  try { return { result: await work(), changes }; }
  finally { CAPTURES.splice(CAPTURES.lastIndexOf(changes), 1); }
}

/**
 * Start recording one outermost board transaction when a capture is running; returns how to finish it.
 * Why: a session sees only the rows its own connection changes, so each transaction opens its own on its board.
 *
 * @param {import('node:sqlite').DatabaseSync} db
 * @returns {{ commit: () => void, close: () => void } | null}
 */
export function beginCapture(db) {
  const into = CAPTURES.at(-1);
  if (!into) return null;
  const session = db.createSession();
  return {
    commit() {
      const changeset = session.changeset();
      if (changeset.length) into.push(changeset);
    },
    close() { session.close(); },
  };
}
