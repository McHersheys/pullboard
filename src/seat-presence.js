/** Machine-local heartbeat observations never enter board events, export or relay [B3]. */
import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const memory = new WeakMap();
const HEARTBEAT_INTERVAL_MS = 60_000;

/** Read the native board identity once; an unidentifiable board supplies no local liveness. */
function observationIdentity(board) {
  const identity = board.db.prepare("SELECT meta_value FROM board_meta WHERE meta_key='board_id'").get()?.meta_value;
  return typeof identity === 'string' && /^[0-9a-f]{32}$/u.test(identity) ? identity : null;
}

/** Locate a board's private observation sidecar without changing the shared board schema. */
function observationFile(board) {
  const file = board.db.prepare('PRAGMA database_list').all().find(row => row.name === 'main')?.file;
  return file ? `${file}.presence.sqlite` : null;
}

/** Keep a persisted observation fresh for one minute; clock rollback must replace a future value. */
function observationIsFresh(at, now) {
  const elapsed = now - Date.parse(at);
  return Number.isFinite(elapsed) && elapsed >= 0 && elapsed < HEARTBEAT_INTERVAL_MS;
}

/** Read one existing observation without opening a writer or creating any sidecar schema. */
function persistedObservation(file, key) {
  if (!existsSync(file)) return null;
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    db.exec('PRAGMA busy_timeout=250');
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='heartbeat'").get()) return null;
    return db.prepare('SELECT at FROM heartbeat WHERE seat=?').get(key)?.at ?? null;
  } finally { db.close(); }
}

/** Observe authenticated activity, persisting at most once per seat/minute, never as a shared move. */
export function heartbeatSeat(board, id) {
  if (!board.db.prepare('SELECT 1 FROM agent WHERE agent_id=?').get(id)) return false;
  const identity = observationIdentity(board);
  if (identity === null) return false;
  const key = JSON.stringify([identity, id]);
  const at = board.clock.now().toISOString();
  const file = observationFile(board);
  if (!file) {
    const rows = memory.get(board.db) ?? new Map();
    if (!observationIsFresh(rows.get(key), Date.parse(at))) rows.set(key, at);
    memory.set(board.db, rows);
    return true;
  }
  if (observationIsFresh(persistedObservation(file, key), Date.parse(at))) return true;
  const db = new DatabaseSync(file);
  try {
    db.exec('PRAGMA busy_timeout=250; CREATE TABLE IF NOT EXISTS heartbeat(seat TEXT PRIMARY KEY, at TEXT NOT NULL)');
    // A peer may have refreshed after the read: recheck under this write transaction.
    db.prepare('INSERT INTO heartbeat(seat,at) VALUES (?,?) ON CONFLICT(seat) DO UPDATE SET at=excluded.at WHERE heartbeat.at<=? OR heartbeat.at>?')
      .run(key, at, new Date(Date.parse(at) - HEARTBEAT_INTERVAL_MS).toISOString(), at);
    return true;
  } finally { db.close(); }
}

/** Read all local observations once; an unseen seat is gone, never inferred alive from shared history. */
function heartbeatRows(board) {
  const file = observationFile(board);
  if (!file) return memory.get(board.db) ?? new Map();
  if (!existsSync(file)) return new Map();
  const db = new DatabaseSync(file, { readOnly: true });
  try { return new Map(db.prepare('SELECT seat,at FROM heartbeat').all().map(row => [row.seat, row.at])); }
  finally { db.close(); }
}

/** Project exact ten/thirty-minute boundaries while retaining the seat's permanent identity. */
export function withSeatPresence(board, seats) {
  const rows = heartbeatRows(board);
  const now = board.clock.now().getTime();
  const identity = observationIdentity(board);
  return seats.map(seat => {
    const heartbeatAt = identity === null ? null : rows.get(JSON.stringify([identity, seat.agent_id])) ?? null;
    const elapsed = heartbeatAt === null ? Infinity : Math.max(0, now - Date.parse(heartbeatAt));
    return { ...seat, heartbeatAt, presence: elapsed < 600_000 ? 'live' : elapsed < 1_800_000 ? 'idle' : 'gone' };
  });
}
