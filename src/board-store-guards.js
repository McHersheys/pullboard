/** Install declared machine guards without confusing an approved old shape with manual drift [M3,A5,A6]. */
import { atomic, logEvent } from './board-event-log.js';
import { boardStanding, recordSchemaStamp } from './board-migrate.js';
import { SCHEMA_DIGEST, SCHEMA_VERSION } from './board-schema-source.js';
import { storeTriggers } from './machine.js';

const GUARDED = 1;

/** Compare exact persistent guard SQL with the current machine declaration. */
function differences(db, wanted) {
  const have = new Map(db.prepare("SELECT name, sql FROM sqlite_master WHERE type='trigger' AND name LIKE 'machine%'")
    .all().map(row => [row.name, row.sql]));
  return {
    missing: wanted.filter(({ name }) => !have.has(name)).map(({ name }) => name),
    changed: wanted.filter(({ name, sql }) => have.has(name) && have.get(name) !== sql).map(({ name }) => name),
    stale: [...have.keys()].filter(name => !wanted.some(trigger => trigger.name === name)),
  };
}

/** A matching declaration needs neither a transaction nor a new guard event. */
function isWhole({ missing, changed, stale }) {
  return !missing.length && !changed.length && !stale.length;
}

/** Install missing or changed guards during a version migration, retaining its original audit evidence. */
export function guardStore(board) {
  const wanted = storeTriggers();
  if (isWhole(differences(board.db, wanted))) {
    if (board.db.prepare('PRAGMA user_version').get().user_version < SCHEMA_VERSION) board.db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
    return;
  }
  atomic(board, () => {
    const found = differences(board.db, wanted);
    if (isWhole(found)) return;
    for (const name of [...found.changed, ...found.stale]) board.db.exec(`DROP TRIGGER IF EXISTS "${name}"`);
    for (const { name, sql } of wanted) if (found.missing.includes(name) || found.changed.includes(name)) board.db.exec(sql);
    if (board.db.prepare('PRAGMA user_version').get().user_version >= GUARDED) logEvent(board, 'board', 'guards', null, found);
    if (board.db.prepare('PRAGMA user_version').get().user_version < SCHEMA_VERSION) board.db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  });
}

/**
 * Refresh only a main-owned board whose installed shape still has its valid stamp. A new declaration may
 * differ without changing table versions; a hand-edited shape fails this check and remains untouched.
 */
export function refreshStoreDeclarations(board) {
  if (isWhole(differences(board.db, storeTriggers()))) return;
  atomic(board, () => {
    // Recheck after taking the write lock, before approving any declaration or replacing its guard SQL.
    if (boardStanding(board.db, SCHEMA_DIGEST, SCHEMA_VERSION) !== 'current') return;
    guardStore(board);
    recordSchemaStamp(board.db, SCHEMA_DIGEST);
  });
}
