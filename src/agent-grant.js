/** Derive authority from existing seats and claims; no mutable saved grant supplies permission [E21]. */
import { AGENT_GRANT_ENGINE } from './agent-grant-engine.js';
import { MOVE_REGISTRY } from './move-registry.js';
import { Refused } from './refused.js';

const ADMINISTRATIVE = new Set(['shout', 'claim', 'release', 'reserveReview']);

/** Bind only item mutations declared by the public operation, including item creation. */
function target(move) {
  if (move.operation === 'addItem') return { lane: move.args?.[0]?.lane, creating: true };
  if (MOVE_REGISTRY[move.operation]?.itemIdFirstArgument) return { item: move.args?.[0] };
  return null;
}

/** A version marker is not a grant: it only prevents an older engine bypassing a new seat or claim. */
export function agentGrantMinimum(board, move) {
  // Communication and review administration neither widen nor replace a claim. An old claim could erase its version marker.
  if (move.operation !== 'claim' && (ADMINISTRATIVE.has(move.operation) || !target(move))) return 1;
  const actor = MOVE_REGISTRY[move.operation]?.actor(move);
  if (typeof actor !== 'string' || ['person', 'coordinator', 'machine'].includes(actor)) return 1;
  const event = board.db.prepare("SELECT event_detail FROM event WHERE event_by=? AND event_kind IN ('join','claim','renew') ORDER BY event_id DESC LIMIT 1").get(actor);
  const item = target(move)?.item ?? (move.operation === 'claim' ? move.args?.[0] : null);
  const claimed = Number.isSafeInteger(item) ? board.db.prepare("SELECT event_detail FROM event WHERE item_id=? AND event_kind IN ('claim','renew') ORDER BY event_id DESC LIMIT 1").get(item) : null;
  return [event, claimed].some(row => {
    const version = row && JSON.parse(row.event_detail).grantEngine;
    return Number.isSafeInteger(version) && version >= AGENT_GRANT_ENGINE;
  }) ? AGENT_GRANT_ENGINE : 1;
}

/** Refuse out-of-grant item changes at the same ordered instant on every replica. */
export function requireAgentGrant(board, move, at = board.clock.now()) {
  if (move.engine < AGENT_GRANT_ENGINE || ADMINISTRATIVE.has(move.operation)) return;
  const actor = MOVE_REGISTRY[move.operation]?.actor(move);
  if (typeof actor !== 'string' || ['person', 'coordinator', 'machine'].includes(actor)) return;
  const seat = board.db.prepare('SELECT agent_lane FROM agent WHERE agent_id=?').get(actor);
  if (!seat) return; // Existing operation validation owns unknown-seat refusals.
  const scope = target(move);
  if (!scope) return;
  const item = Number.isSafeInteger(scope.item)
    ? board.db.prepare('SELECT * FROM item WHERE item_id=?').get(scope.item) : null;
  if (!scope.creating && !item) return; // Preserve the operation's own malformed/missing-item refusal.
  const now = at.toISOString();
  if (item?.item_review_by === actor && item.item_status === 'submitted' && item.item_review_until > now
    && ['verify', 'appendFact'].includes(move.operation)) return;
  const claims = board.db.prepare("SELECT item_id,item_lease_until FROM item WHERE item_owner=? AND item_status='claimed'").all(actor);
  const own = claims.find(claim => claim.item_id === scope.item);
  const live = claims.filter(claim => claim.item_lease_until > now);
  const previous = board.db.prepare("SELECT event_id FROM event WHERE event_by=? AND event_kind IN ('claim','renew') ORDER BY event_id DESC LIMIT 1").get(actor);
  if ((own && !(own.item_lease_until > now)) || (previous && !live.length)) {
    throw new Refused('AGENT_GRANT_EXPIRED', `${actor} has no live item claim; claim work before changing an item`,
      'claim the intended item, or shout the coordinator if its claim is unavailable');
  }
  if ((claims.length && !own) || (live.length && scope.creating)) {
    throw new Refused('AGENT_GRANT_ITEM', `${actor} may change only its live claimed item${live.length === 1 ? ` #${live[0].item_id}` : 's'}`,
      'finish or release the claim, then claim the intended item; use shout for coordination');
  }
  const lane = scope.creating ? scope.lane : item.item_lane;
  if (lane !== seat.agent_lane) {
    throw new Refused('AGENT_GRANT_LANE', `${actor} is in ${seat.agent_lane}, not ${lane}`,
      'join a seat in the intended lane or ask its owner to make the item change');
  }
}
