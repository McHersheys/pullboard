/** Board-bound computed conflict evidence is checked before sealing and replayed without Git [V4,H16]. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { join } from 'node:path';
import { Refused } from './refused.js';

const SHA = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;
const ID = /^[a-f0-9-]{36}$/u;

/** Resolve the evidence store from the board file, never from a caller-provided path. */
export function computedConflictStore(board) {
  const file = board.db.prepare('PRAGMA database_list').all().find(row => row.name === 'main')?.file;
  return file ? join(dirname(file), 'computed-conflicts') : null;
}

/** Read the canonical immutable record, rejecting altered, unknown or malformed fields. */
export function computedConflictFields(value) {
  if (!value || value.version !== 1 || !ID.test(value.id ?? '') || !/^[a-f0-9]{32}$/u.test(value.board ?? '')
    || !Number.isSafeInteger(value.item) || value.item < 1 || typeof value.actor !== 'string' || !value.actor || value.actor.length > 128 || /[\r\n\0]/u.test(value.actor)
    || !Number.isSafeInteger(value.submission) || value.submission < 1
    || !SHA.test(value.head ?? '') || !SHA.test(value.trunk ?? '') || !Array.isArray(value.files)
    || !value.files.length || value.files.length > 4096 || value.files.some(file => typeof file !== 'string' || !file || file.length > 4096 || file.includes('\0'))
    || new Set(value.files).size !== value.files.length || typeof value.at !== 'string' || !Number.isFinite(Date.parse(value.at))) return null;
  const fields = { version: 1, id: value.id, board: value.board, item: value.item, actor: value.actor,
    head: value.head, trunk: value.trunk, files: [...value.files], at: value.at, submission: value.submission };
  const digest = createHash('sha256').update(JSON.stringify(fields)).digest('hex');
  return value.digest === digest && Object.keys(value).length === Object.keys(fields).length + 1 ? { ...fields, digest } : null;
}

/** Refuse an unbound origin record; another machine validates its sealed canonical record on replay. */
export function requireComputedConflictBound(board, receipt) {
  const fields = computedConflictFields(receipt), directory = computedConflictStore(board);
  let stored;
  try { stored = fields && directory && readFileSync(join(directory, `${fields.id}.json`), 'utf8'); } catch { /* Missing evidence is not authority. */ }
  if (!fields || stored !== JSON.stringify(fields) + '\n') throw new Refused('COORDINATOR_ONLY',
    'automatic conflict return requires the native board computation; agents cannot supply conflict assertions');
  return fields;
}

/** Bind recorded evidence to this board's current submitted item and actual actor, on every replica. */
export function computedConflictProblem(board, item, actor, receipt) {
  const fields = computedConflictFields(receipt);
  const identity = board.db.prepare("SELECT meta_value FROM board_meta WHERE meta_key='board_id'").get()?.meta_value;
  const submission = board.db.prepare("SELECT event_id FROM event WHERE item_id=? AND event_kind='submit' ORDER BY event_id DESC LIMIT 1").get(item.item_id)?.event_id;
  if (!fields || fields.submission !== submission || fields.board !== identity || fields.item !== item.item_id || fields.actor !== actor
    || fields.head !== item.item_commit || item.item_status !== 'submitted') return new Refused('COORDINATOR_ONLY',
    'automatic conflict evidence must name this board, actor and current submitted head');
  if (board.executionEngineVersion === undefined) requireComputedConflictBound(board, fields);
  return null;
}

/** Derive merge fields from canonical evidence; malformed evidence remains a merge request that authority refuses. */
export function conflictValue(receipt, asserted) {
  if (receipt === undefined) return asserted;
  const fields = computedConflictFields(receipt);
  return fields ? { files: fields.files, trunk: fields.trunk } : {};
}
