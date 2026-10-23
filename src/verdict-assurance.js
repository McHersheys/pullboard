/** Immutable verdict assurance distinguishes recorded parent independence from procedural review [V1,B3]. */
import { ENGINE_VERSION } from './machine.js';
import { PARENT_SESSION_ENGINE } from './parent-session-engine.js';
import { itemAuthors } from './item-authors.js';
import { agentParent } from './seats.js';

/** Unknown parentage for any historical author limits assurance, even when review is procedurally allowed. */
export function reviewAssurance(board, item, reviewer) {
  const parent = agentParent(board, reviewer);
  const authors = itemAuthors(board, item);
  return parent && authors.length && authors.every(author => {
    const built = agentParent(board, author);
    return built && built !== parent;
  }) ? 'independent' : 'procedural';
}

/** Old verdicts without an assurance record never acquire independent status from later seat enrollment. */
export function verdictAssurance(board, verdict) {
  return board.db.prepare('SELECT meta_value FROM board_meta WHERE meta_key = ?')
    .get(`verdict_assurance:${verdict.verdict_id}`)?.meta_value === 'independent' ? 'independent' : 'procedural';
}

/** Insert the immutable native verdict and, under engine 90, its assurance in the same board transaction. */
export function recordVerdict(board, item, { agentId, decision, reason, note, digest, head }) {
  const family = board.db.prepare('SELECT agent_family FROM agent WHERE agent_id = ?').get(agentId)?.agent_family ?? null;
  const inserted = board.db.prepare(`INSERT INTO verdict (item_id, verdict_by, verdict_decision, verdict_reason, verdict_note,
    verdict_commit, verdict_digest, verdict_head, verdict_verifier_family, verdict_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(item.item_id, agentId, decision, reason, note.trim(), item.item_commit,
    digest, head, family, board.clock.now().toISOString());
  if ((board.executionEngineVersion ?? ENGINE_VERSION) < PARENT_SESSION_ENGINE) return null;
  const assurance = reviewAssurance(board, item, agentId);
  board.db.prepare('INSERT INTO board_meta (meta_key, meta_value) VALUES (?, ?)')
    .run(`verdict_assurance:${inserted.lastInsertRowid}`, assurance);
  return assurance;
}
