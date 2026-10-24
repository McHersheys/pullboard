/** Keep the cold event-format migration separate from normal board moves [C7]. */
import {
  EVENT_LOG_VERSION,
  SCHEMA,
} from './board-schema-source.js';
import { readEventLogVersion } from './board-read-open.js';
import {
  beginBoardWrite,
  finishBoardWrite,
  prepareBoardWriteIdentity,
} from './board-write-lock.js';

/** Refuse unknown future event records before migrating anything, and mark older boards current. */
export function migrateEventLogVersion(db, writeContext) {
  prepareBoardWriteIdentity();
  db.exec('BEGIN IMMEDIATE');
  const record = beginBoardWrite(db, writeContext);
  let released = false;
  try {
    db.exec(SCHEMA);
    const version = readEventLogVersion(db);
    if (version < EVENT_LOG_VERSION) {
      db.prepare('INSERT INTO board_meta (meta_key, meta_value) VALUES (?, ?) ON CONFLICT(meta_key) DO UPDATE SET meta_value = excluded.meta_value')
        .run('event_log_version', String(EVENT_LOG_VERSION));
    }
    db.exec('COMMIT');
    released = true;
  } catch (error) {
    db.exec('ROLLBACK');
    released = true;
    throw error;
  } finally {
    finishBoardWrite(record, released, 'migration-released');
  }
}

