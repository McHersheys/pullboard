/** Machine-local heartbeat observations never enter board events, export or relay [B3]. */
import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const memory = new WeakMap();

/** Locate a board's private observation sidecar without changing the shared board schema. */
function observationFile(board) {
  const file = board.db.prepare('PRAGMA database_list').all().find(row => row.name === 'main')?.file;
  return file ? `${file}.presence.sqlite` : null;
}

/** Update exactly one local seat row; registration and command activity are observations, not moves. */
export function heartbeatSeat(board, id) {
  if (!board.db.prepare('SELECT 1 FROM agent WHERE agent_id=?').get(id)) return false;
  const at = board.clock.now().toISOString();
  const file = observationFile(board);
  if (!file) {
    const rows = memory.get(board.db) ?? new Map();
    rows.set(id, at);
    memory.set(board.db, rows);
    return true;
  }
  const db = new DatabaseSync(file);
  try {
    db.exec('PRAGMA busy_timeout=250; CREATE TABLE IF NOT EXISTS heartbeat(seat TEXT PRIMARY KEY, at TEXT NOT NULL)');
    db.prepare('INSERT INTO heartbeat(seat,at) VALUES (?,?) ON CONFLICT(seat) DO UPDATE SET at=excluded.at').run(id, at);
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
  return seats.map(seat => {
    const heartbeatAt = rows.get(seat.agent_id) ?? null;
    const elapsed = heartbeatAt === null ? Infinity : Math.max(0, now - Date.parse(heartbeatAt));
    return { ...seat, heartbeatAt, presence: elapsed < 600_000 ? 'live' : elapsed < 1_800_000 ? 'idle' : 'gone' };
  });
}
