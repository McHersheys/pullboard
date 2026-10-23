/** Append native events and their rebuildable proof projection in the same transaction [R2]. */
import { ENGINE_VERSION } from './machine.js';
import { agentModel } from './seats.js';
import { appendProofCounter } from './proof-counters.js';
import { ensureProofCounters } from './proof-counters.js';

/**
 * Append one move to the event log (R2), retaining its exact row for an API response (A2).
 * Exported for the board's own split modules, such as milestones.js, which record moves the same way.
 *
 * @param {any} board
 * @param {string} by
 * @param {string} kind
 * @param {number | null} itemId
 * @param {object} [detail]
 * @param {Date} [at] An enabled move may share one instant with its deadline.
 */
export function logEvent(board, by, kind, itemId, detail = {}, at) {
  board.db.exec('SAVEPOINT proof_event_append');
  try {
    ensureProofCounters(board);
    const model = agentModel(board, by);
    const isAgent = Boolean(board.db.prepare('SELECT 1 FROM agent WHERE agent_id = ?').get(by));
    const recorded = { ...detail, ...((board.executionEngineVersion ?? ENGINE_VERSION) >= 8 && isAgent ? { model: model ?? 'unknown' } : {}),
      ...(board.movePerson ? { person: board.movePerson } : {}) }; // The person behind a relayed move, from engine 73 (engine.js) [E3].
    const inserted = board.db
      .prepare('INSERT INTO event (event_at, event_by, event_kind, item_id, event_detail) VALUES (?, ?, ?, ?, ?)')
      .run(at ? at.toISOString() : board.clock.now().toISOString(), by, kind, itemId, JSON.stringify(recorded));
    const event = board.db.prepare('SELECT * FROM event WHERE event_id = ?').get(inserted.lastInsertRowid);
    appendProofCounter(board, event);
    board.db.exec('RELEASE proof_event_append');
    board.lastEvent = event;
    (board.emittedEvents ??= []).push(event);
  } catch (error) {
    board.db.exec('ROLLBACK TO proof_event_append; RELEASE proof_event_append');
    throw error;
  }
}

