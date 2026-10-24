import { LAND_COLLISION_ENGINE } from '../landing-collision-engine.js';
import { RIGOR_AUTO_ENGINE } from '../rigor-auto-engine.js';
/** Routing metadata owned by setLineSetting, discovered without a shared registry edit [C7,V4,H16]. */
import { LANDING_LEASE_ENGINE } from '../landing-lease-engine.js';
import { LINE_ORDER_ENGINE } from '../line-order-engine.js';
import { LINE_SETTINGS_ENGINE } from '../line-settings-engine.js';
import { BOARD_SENTINEL_ENGINE } from '../sentinel-engine.js';
import { BAR_CHECK_ENGINE } from '../bar-check-engine.js';

/** Preserve this operation's historical first-matching engine conditions [H16]. */
function minimumEngine(args, board, at) {
  const barCheck = args[0]?.key === 'bar.check' ? BAR_CHECK_ENGINE : 1;
  if (typeof args[1]?.cause === 'string' && args[1].cause.startsWith('conflict:')) return Math.max(barCheck, RIGOR_AUTO_ENGINE);
  if (args[0]?.key === 'collisionFreeBatch') return Math.max(barCheck, LAND_COLLISION_ENGINE);
  if (args[0]?.key === 'order') return Math.max(barCheck, LINE_ORDER_ENGINE);
  if (args[0]?.landingFence !== undefined) return Math.max(barCheck, LANDING_LEASE_ENGINE);
  if (typeof args[1]?.cause === 'string' && args[1].cause.startsWith('sentinel:')) return Math.max(barCheck, BOARD_SENTINEL_ENGINE);
  return Math.max(barCheck, LINE_SETTINGS_ENGINE);
}

/** Read precisely the actor argument used by this operation [H2,H16]. */
function actor(move) { return move.args[0]?.agentId ?? null; }

export default Object.freeze({ operation: "setLineSetting", order: 53, engine: LINE_SETTINGS_ENGINE,
  itemIdFirstArgument: false, minimumEngine, actor,
  nextSteps: Object.freeze({
  "COORDINATOR_ONLY": "ask the coordinator to do it: pullboard shout coordinator \"<what you need>\"",
  "ENGINE_VERSION": "upgrade Pullboard: npm install -g pullboard@latest",
  "LINE_SETTING_REASON": "repeat the board setting change with --reason describing the measured window"
}) });
