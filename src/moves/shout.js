import { RIGOR_AUTO_ENGINE } from '../rigor-auto-engine.js';
/** Routing metadata owned by shout, discovered without a shared registry edit [C7,V4,H16]. */
import { ITEM_SHOUT_ENGINE } from '../item-shout-engine.js';
import { LANDING_LEASE_ENGINE } from '../landing-lease-engine.js';
import { BOARD_SENTINEL_ENGINE } from '../sentinel-engine.js';

/** Preserve this operation's historical first-matching engine conditions [H16]. */
function minimumEngine(args, board, at) {
  if (typeof args[1]?.cause === 'string' && args[1].cause.startsWith('conflict:')) return RIGOR_AUTO_ENGINE;
  if (args[0]?.item !== undefined) return ITEM_SHOUT_ENGINE;
  if (args[0]?.landingFence !== undefined) return LANDING_LEASE_ENGINE;
  if (typeof args[1]?.cause === 'string' && args[1].cause.startsWith('sentinel:')) return BOARD_SENTINEL_ENGINE;
  return 1;
}

/** Read precisely the actor argument used by this operation [H2,H16]. */
function actor(move) { return move.args[0]?.from ?? null; }

export default Object.freeze({ operation: "shout", order: 23, engine: 1,
  itemIdFirstArgument: false, minimumEngine, actor,
  nextSteps: Object.freeze({
  "B26_PERSON_CHANNEL": "record it as the person through pullboard view or the person's own terminal",
  "B26_PERSON_DECISION": "ask your coordinator: pullboard shout coordinator \"<question>\" --decision",
  "BAD_EVIDENCE": "pass the evidence fields the message names, then retry",
  "BAD_REQUEST": "send the request body the message names as an application/json object",
  "COORDINATOR_ONLY": "ask the coordinator to do it: pullboard shout coordinator \"<what you need>\"",
  "EMPTY_SHOUT": "give the shout text: pullboard shout <to> \"<text>\"",
  "ENGINE_VERSION": "upgrade Pullboard: npm install -g pullboard@latest",
  "NOT_A_DECISION": "reply with a shout: pullboard shout <to> \"<text>\"",
  "NO_READER": "name a lane, an agent or all: pullboard shout all \"<text>\"",
  "NO_SHOUT": "name a shout id from pullboard inbox",
  "REQUEST_CLOSED": "read pullboard inbox before answering another request",
  "REQUEST_OUTCOME": "pullboard answer <id> done \"<reason>\", or pullboard answer <id> declined \"<reason>\"",
  "SELF_SHOUT": "name another agent, a lane or all: pullboard shout all \"<text>\""
}) });
