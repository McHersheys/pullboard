/** One shared compatibility snapshot, recorded through the board engine, never a person approval. */
import {
  atomic,
  logEvent,
} from './board.js';
import { Refused } from './refused.js';
import { parseSpec } from './spec.js';
import { COORDINATOR } from './config.js';

const KEY = 'spec_approval_baseline';

/** Distinguish a missing migration marker from an unreadable one without replacing either. */
export function specApprovalBaselineExists(board) {
  return Boolean(board.db.prepare('SELECT 1 FROM board_meta WHERE meta_key=?').get(KEY)
    || board.db.prepare('SELECT 1 FROM event WHERE event_kind=? LIMIT 1').get(KEY));
}

/** Validate the exact source carried by an ordered snapshot, including the empty initial set. */
function validBaseline(value) {
  if (!value || value.version !== 1 || typeof value.file !== 'string' || !value.file
    || !(value.anchor === null || /^[a-f0-9]{40,64}$/u.test(value.anchor)) || !Array.isArray(value.rows)) return false;
  const seen = new Set();
  return value.rows.every(row => {
    if (!row || typeof row.id !== 'string' || typeof row.text !== 'string' || typeof row.source !== 'string'
      || /[\r\n]/u.test(row.source) || seen.has(row.id)) return false;
    const parsed = parseSpec(`## Baseline\n${row.source}\n`).rows;
    seen.add(row.id);
    return parsed.length === 1 && parsed[0].id === row.id && parsed[0].text === row.text && parsed[0].status === 'approved';
  });
}

/** Compare the snapshot payload without incidental event attribution or JSON property order. */
function canonicalBaseline(baseline) {
  return { version: 1, file: baseline.file, anchor: baseline.anchor,
    rows: baseline.rows.map(({ id, text, source }) => ({ id, text, source })) };
}

/** Read the original snapshot without interpreting it as authenticated approval or reseeding it. */
export function specApprovalBaseline(board) {
  const stored = board.db.prepare('SELECT meta_value FROM board_meta WHERE meta_key=?').get(KEY);
  const events = board.db.prepare('SELECT event_by,event_detail FROM event WHERE event_kind=?').all(KEY);
  if (!stored && !events.length) return null;
  let value;
  let recorded;
  try {
    value = stored && JSON.parse(stored.meta_value);
    recorded = events.length === 1 && events[0].event_by === COORDINATOR && JSON.parse(events[0].event_detail);
  } catch { /* The same typed recovery covers malformed and incompatible records. */ }
  if (!validBaseline(value) || !validBaseline(recorded)
    || JSON.stringify(canonicalBaseline(value)) !== JSON.stringify(canonicalBaseline(recorded))) {
    throw new Refused('SPEC_APPROVAL_BASELINE', 'the approval baseline is unreadable or disagrees with its original event; restore it from a known-good board export');
  }
  return value;
}

/** Persist the first ordered snapshot once; later setup or competing replicas cannot expand it. */
export function recordSpecApprovalBaseline(board, { agentId, baseline }) {
  return atomic(board, () => {
    if (agentId !== COORDINATOR) {
      throw new Refused('COORDINATOR_ONLY', 'only the coordinator or person establishes the approval baseline from the main checkout; lane work may continue while it is pending');
    }
    if (!board.db.prepare('SELECT 1 FROM agent WHERE agent_id=?').get(agentId)) {
      throw new Refused('NOT_JOINED', 'join a lane before recording the board approval baseline');
    }
    const existing = specApprovalBaseline(board);
    if (existing) return existing;
    if (!validBaseline(baseline)) throw new Refused('SPEC_APPROVAL_BASELINE', 'an approval baseline needs its exact approved source rows; retry from the coordinator checkout');
    const value = canonicalBaseline(baseline);
    board.db.prepare('INSERT INTO board_meta(meta_key,meta_value) VALUES (?,?)').run(KEY, JSON.stringify(value));
    logEvent(board, agentId, 'spec_approval_baseline', null, value);
    return value;
  });
}
