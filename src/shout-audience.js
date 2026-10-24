/** Shared item-message addressing for the board's inbox, resume and live watch [B7,N19,A2]. */
import { Refused } from './refused.js';

/** Validate an explicit item address against this board before writing its message. */
export function itemShoutTarget(db, value) {
  if (!Number.isSafeInteger(value) || value < 1) throw new Refused('BAD_SHOUT_ITEM', 'an item message needs an existing positive item id; run pullboard shout --item <id> "text"');
  if (!db.prepare('SELECT 1 FROM item WHERE item_id = ?').get(value)) throw new Refused('NO_ITEM', `no item #${value}; run pullboard list, then address an existing item`);
  return `item:${value}`;
}

/** Decode only the canonical item address; ordinary seats and lanes keep their old names. */
export function shoutItemId(to) {
  const match = /^item:([1-9]\d*)$/u.exec(String(to));
  const id = match ? Number(match[1]) : null;
  return Number.isSafeInteger(id) ? id : null;
}

/** Whether a seat currently builds or reviews this item, or coordinates its work. */
export function itemShoutReader(db, id, agent) {
  const item = db.prepare('SELECT item_owner, item_built_by, item_review_by, item_verified_by FROM item WHERE item_id = ?').get(id);
  return Boolean(item && (agent === 'coordinator' || (item.item_owner ?? item.item_built_by) === agent
    || (item.item_review_by ?? item.item_verified_by) === agent));
}

/** Match one live shout against an explicit seat or lane audience, including its item roles. */
export function shoutMatchesAudience(db, to, audience) {
  if (audience.has(to)) return true;
  const item = shoutItemId(to);
  if (item === null) return false;
  return [...audience].some((agent) => itemShoutReader(db, item, agent));
}

/** Existing four inbox parameters stay cursor, seat, lane, seat; indexed parameters reuse the seat identity. */
export const UNREAD_SHOUT_SQL = `FROM shout WHERE shout_id > ?1 AND shout_from != ?2 AND
  (shout_to IN ('all', ?3, ?4) OR EXISTS (SELECT 1 FROM item WHERE shout_to = 'item:' || item_id AND
    (?2 = 'coordinator' OR COALESCE(item_owner, item_built_by) = ?2 OR COALESCE(item_review_by, item_verified_by) = ?2)))`;
