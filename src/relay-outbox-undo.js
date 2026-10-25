/**
 * Taking queued moves back (#1013): a local-first move is made on this machine before the relay orders it, and its
 * rows are captured as a SQLite changeset. When the relay's order arrives, the queued moves are taken back by their
 * inverted changesets, newest first, so the board is exactly as the relay last ordered it; replaying the relay's
 * records and making the queued moves again on top costs only the rows they touch, never a whole-board restore.
 */
import { storeTriggers } from './machine.js';
import { atomic } from './board-event-log.js';

/** SQLite's changeset conflict type for a row whose values changed, and the answers to a conflict. */
const CHANGED = 1;
const REPLACE = 1;
const ABORT = 2;
/** What each other conflict type means, for the line that says why an undo fell back. */
const CONFLICTS = { 2: 'a row it changed is gone', 3: 'a row it removed is back', 4: 'a constraint refused it', 5: 'a foreign key refused it' };

/** SQLite's changeset operation codes. */
const INSERT = 18;
const UPDATE = 23;
const DELETE = 9;

/** Read one SQLite varint at `at`; returns its value and the next offset. */
function varint(bytes, at) {
  let value = 0;
  for (let index = 0; index < 8; index += 1) {
    const byte = bytes[at + index];
    value = value * 128 + (byte & 0x7f);
    if (!(byte & 0x80)) return { value, next: at + index + 1 };
  }
  return { value: value * 256 + bytes[at + 8], next: at + 9 };
}

/** Read one changeset value; returns its encoded bytes, whether it is defined, and the next offset. */
function value(bytes, at) {
  const type = bytes[at];
  if (type === 0 || type === 5) return { bytes: bytes.subarray(at, at + 1), defined: type !== 0, next: at + 1 };
  if (type === 1 || type === 2) return { bytes: bytes.subarray(at, at + 9), defined: true, next: at + 9 };
  if (type === 3 || type === 4) {
    const length = varint(bytes, at + 1);
    return { bytes: bytes.subarray(at, length.next + length.value), defined: true, next: length.next + length.value };
  }
  throw new Error(`changeset value type ${type} is not one SQLite writes`);
}

/** Read a record of `columns` values. */
function record(bytes, at, columns) {
  const values = [];
  let next = at;
  for (let column = 0; column < columns; column += 1) {
    const read = value(bytes, next);
    values.push(read);
    next = read.next;
  }
  return { values, next };
}

/** The encoded bytes of an undefined value. */
const UNDEFINED = Uint8Array.of(0);

/**
 * Invert a SQLite changeset, as sqlite3changeset_invert does: an insert becomes a delete of the same row, a delete an
 * insert, and an update swaps its changed values, so applying the result takes the original change back.
 *
 * @param {Uint8Array} changeset
 * @returns {Uint8Array}
 */
export function invertChangeset(changeset) {
  const bytes = Buffer.from(changeset);
  const out = [];
  let columns = 0;
  for (let at = 0; at < bytes.length;) {
    const marker = bytes[at];
    if (marker === 0x54) { // 'T': a table header, copied as it is.
      const count = varint(bytes, at + 1);
      columns = count.value;
      const end = bytes.indexOf(0, count.next + columns);
      out.push(bytes.subarray(at, end + 1));
      at = end + 1;
      continue;
    }
    const indirect = bytes[at + 1];
    if (marker === INSERT || marker === DELETE) {
      const row = record(bytes, at + 2, columns);
      out.push(Uint8Array.of(marker === INSERT ? DELETE : INSERT, indirect), bytes.subarray(at + 2, row.next));
      at = row.next;
    } else if (marker === UPDATE) {
      const before = record(bytes, at + 2, columns);
      const after = record(bytes, before.next, columns);
      out.push(Uint8Array.of(UPDATE, indirect));
      // The inverted update expects each changed column at its new value and keys the row as before.
      for (let column = 0; column < columns; column += 1) out.push(after.values[column].defined ? after.values[column].bytes : before.values[column].bytes);
      for (let column = 0; column < columns; column += 1) out.push(after.values[column].defined ? before.values[column].bytes : UNDEFINED);
      at = after.next;
    } else throw new Error(`changeset operation ${marker} is not one SQLite writes`);
  }
  return Buffer.concat(out);
}

/**
 * Take queued moves back on `board`, newest first, in one transaction, and put the row counters back as they were
 * before the oldest. Returns null, or, changing nothing, why it could not: a row they made is gone or a row they
 * removed is back, so the caller rebuilds from a whole image instead.
 * Why: the board's lifecycle triggers refuse removing events or moving an item backwards, as any command should;
 * taking back an unordered move is the one exception, so they are lifted inside this transaction only, as a
 * snapshot restore lifts them.
 *
 * @param {any} board
 * @param {{ changes?: string[], sequences?: { name: string, seq: number }[] }[]} entries - Oldest first.
 * @returns {string | null}
 */
export function undoQueued(board, entries) {
  const db = board.db;
  let conflict = null;
  try {
    atomic(board, () => {
      // A move's rows come back table by table; references between them are checked once all are back.
      db.exec('PRAGMA defer_foreign_keys = ON');
      const triggers = db.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'machine_%'").all();
      for (const { name } of triggers) db.exec(`DROP TRIGGER "${name.replaceAll('"', '""')}"`);
      for (const entry of [...entries].reverse()) {
        for (const change of [...(entry.changes ?? [])].reverse()) {
          // A row changed again since, as a seat's read position is, is put back all the same (its newer read
          // position is kept by the caller); a row gone or taken is not this undo's to guess at.
          const applied = db.applyChangeset(invertChangeset(Buffer.from(change, 'base64')), {
            onConflict: (type) => { if (type === CHANGED) return REPLACE; conflict = CONFLICTS[type] ?? `conflict ${type}`; return ABORT; } });
          if (conflict || applied === false) { conflict ??= 'aborted'; throw new Error(`a queued move's rows changed since it was made: ${conflict}`); }
        }
      }
      const counters = entries.find((entry) => Array.isArray(entry.sequences))?.sequences;
      if (counters) {
        db.exec('DELETE FROM sqlite_sequence');
        const insert = db.prepare('INSERT INTO sqlite_sequence (name, seq) VALUES (?, ?)');
        for (const row of counters) insert.run(row.name, row.seq);
      }
      for (const { sql } of storeTriggers()) db.exec(sql);
    });
  } catch (error) {
    if (conflict) return conflict;
    throw error;
  }
  return null;
}
