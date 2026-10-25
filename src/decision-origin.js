/**
 * Where a decision came from: its statement, rationale, who decided, who relayed it and its origin [N29,B29,P6].
 *
 * The record lives in the answer's own event, so no schema changes. Only the board decides the person
 * origin: a real person answer carries it, and no caller can name it, so an agent's word is never shown
 * as the person's (P6). A decision with no recorded origin reads as unknown, never as the person's.
 */
import { DECISION_ORIGIN_ENGINE } from './decision-origin-engine.js';
import { ENGINE_VERSION } from './engine-metadata.js';
import { Refused } from './refused.js';

/** The origins an agent may name; `person` is reserved for a real person answer. */
export const NAMEABLE_ORIGINS = Object.freeze(['person-relayed', 'agent', 'inherited']);

/**
 * True when an answer move carries this engine's meaning, so older engines refuse it.
 *
 * @param {any[]} args the sealed move arguments
 * @returns {boolean}
 */
export function carriesOrigin(args) {
  const options = args?.[1];
  return Boolean(options && typeof options === 'object' && (options.origin !== undefined || options.rationale !== undefined));
}

/**
 * Build the provenance an answer records, or null on a board replaying an older engine.
 *
 * @param {any} board
 * @param {{ agentId: string, asPerson: boolean, text: string, origin?: string, rationale?: string }} answer
 * @returns {{ statement: string, rationale: string, decidedBy: string, relayedBy: string | null, origin: string } | null}
 */
export function answerProvenance(board, { agentId, asPerson, text, origin, rationale }) {
  const engine = board.executionEngineVersion ?? ENGINE_VERSION;
  const named = origin !== undefined && origin !== null;
  const reason = String(rationale ?? '').trim();
  if (engine < DECISION_ORIGIN_ENGINE) {
    if (named || reason) throw new Refused('ENGINE_VERSION', `recording an origin or a rationale requires engine ${DECISION_ORIGIN_ENGINE}; this board uses engine ${engine}; upgrade Pullboard first`);
    return null;
  }
  if (named && !NAMEABLE_ORIGINS.includes(origin)) {
    throw new Refused('BAD_ORIGIN', `an origin is ${NAMEABLE_ORIGINS.join(', ')}, not "${origin}"; only a real person answer is the person's origin: pullboard answer <id> <text> --origin person-relayed`);
  }
  if (asPerson && named) throw new Refused('BAD_ORIGIN', 'a person answer is its own origin; leave out --origin');
  const decidedBy = asPerson ? 'person' : agentId;
  const chosen = asPerson ? 'person' : (origin ?? 'agent');
  return { statement: String(text).trim(), rationale: reason, decidedBy, relayedBy: chosen === 'person-relayed' ? agentId : null, origin: chosen };
}

/**
 * The origin an answer event recorded; unknown when it recorded none.
 *
 * @param {{ provenance?: { origin?: string } }} detail an answer event's detail
 * @returns {string}
 */
export function originOf(detail) {
  const origin = detail?.provenance?.origin;
  return typeof origin === 'string' && origin ? origin : 'unknown';
}

/**
 * The answered decisions behind some items: answers that imply an item, or were addressed to it.
 *
 * @param {any} board
 * @param {number[]} itemIds
 * @returns {{ id: number, items: number[], statement: string, rationale: string, decidedBy: string, relayedBy: string | null, origin: string, at: string }[]}
 */
export function decisionsBehind(board, itemIds) {
  if (!itemIds.length) return [];
  const marks = itemIds.map(() => '?').join(',');
  const byShout = new Map();
  const note = (shout, item) => byShout.set(shout, [...new Set([...(byShout.get(shout) ?? []), item])].sort((a, b) => a - b));
  for (const row of board.db.prepare(`SELECT item_id, event_detail FROM event WHERE event_kind = 'fact' AND item_id IN (${marks}) AND json_extract(event_detail, '$.decision.source') = 'answer' AND json_extract(event_detail, '$.supersededBy') IS NULL`).all(...itemIds)) {
    note(JSON.parse(row.event_detail).decision.id, row.item_id);
  }
  for (const row of board.db.prepare(`SELECT item_id, event_detail FROM event WHERE event_kind = 'answer' AND item_id IN (${marks})`).all(...itemIds)) {
    note(JSON.parse(row.event_detail).shout, row.item_id);
  }
  return [...byShout].sort(([left], [right]) => left - right).map(([id, items]) => {
    const shout = board.db.prepare('SELECT shout_from, shout_text, shout_at FROM shout WHERE shout_id = ?').get(id);
    const event = board.db.prepare("SELECT event_detail FROM event WHERE event_kind = 'answer' AND json_extract(event_detail, '$.shout') = ?").get(id);
    const recorded = event ? JSON.parse(event.event_detail).provenance : undefined;
    return { id, items, statement: recorded?.statement ?? shout.shout_text, rationale: recorded?.rationale ?? '',
      decidedBy: recorded?.decidedBy ?? shout.shout_from, relayedBy: recorded?.relayedBy ?? null,
      origin: originOf({ provenance: recorded }), at: shout.shout_at };
  });
}
