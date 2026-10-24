import { RIGOR_AUTO_ENGINE } from '../rigor-auto-engine.js';
/** Routing metadata owned by applyRowDecisions, discovered without a shared registry edit [C7,V4,H16]. */
import { LANDING_LEASE_ENGINE } from '../landing-lease-engine.js';
import { BOARD_SENTINEL_ENGINE } from '../sentinel-engine.js';
import { SPEC_REVISION_ENGINE } from '../spec-revision-engine.js';
import { rowDecisions } from '../board-query.js';

/** Preserve this operation's historical first-matching engine conditions [H16]. */
function minimumEngine(args, board, at) {
  if (board?.db && Array.isArray(args[0]?.events) && rowDecisions(board).some(record => record.revision && args[0].events.includes(record.event))) {
    return Math.max(SPEC_REVISION_ENGINE, args[0]?.landingFence === undefined ? 0 : LANDING_LEASE_ENGINE,
      typeof args[1]?.cause === 'string' && args[1].cause.startsWith('conflict:') ? RIGOR_AUTO_ENGINE : 0,
      typeof args[1]?.cause === 'string' && args[1].cause.startsWith('sentinel:') ? BOARD_SENTINEL_ENGINE : 0);
  }
  if (typeof args[1]?.cause === 'string' && args[1].cause.startsWith('conflict:')) return RIGOR_AUTO_ENGINE;
  if (args[0]?.landingFence !== undefined) return LANDING_LEASE_ENGINE;
  if (typeof args[1]?.cause === 'string' && args[1].cause.startsWith('sentinel:')) return BOARD_SENTINEL_ENGINE;
  return 1;
}

/** Read precisely the actor argument used by this operation [H2,H16]. */
function actor(move) { return move.args[0]?.agentId ?? null; }

export default Object.freeze({ operation: "applyRowDecisions", order: 38, engine: 1,
  itemIdFirstArgument: false, minimumEngine, actor,
  nextSteps: Object.freeze({
  "COORDINATOR_ONLY": "ask the coordinator to do it: pullboard shout coordinator \"<what you need>\"",
  "ROW_DECISION": "pullboard spec approve <ids>, or pullboard spec decline <ids>",
  "STALE_ROW_DECISION": "ask the person to approve the current row again in pullboard view"
}) });
