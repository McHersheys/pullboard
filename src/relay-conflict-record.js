/** Computed-conflict evidence at the authenticated relay replay and sending boundaries [V4,H16]. */
import { createHash } from 'node:crypto';
import { requirePreparedComputedConflict } from './computed-conflict-receipt.js';
import { withRecordedConflictContext } from './recorded-conflict-context.js';

/** Apply an already decrypted, engine-checked relay record inside its exact synchronous position. */
export function replay(board, move, record, apply) {
  const position = { sequence: record.event_id, at: record.event_at, sender: record.sender, kind: record.kind,
    digest: createHash('sha256').update(record.sealed).digest('hex'), registration: record.registration };
  return withRecordedConflictContext(board, move, position, () => apply(board, move, position));
}

/** Recheck a fresh computed return before opening its unchanged authenticated actor transport. */
export function transport(root, move, localRecords, open) {
  if (move.operation === 'reopen' && move.args[1]?.computedConflict !== undefined) {
    localRecords(root, board => requirePreparedComputedConflict(board, move.args[0], move.args[1].agentId, move.args[1].computedConflict));
  }
  return open();
}
