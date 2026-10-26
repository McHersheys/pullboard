/** One pure item lookup without loading the query facade [C7,H16]. */
import { Refused } from './refused.js';
/**
 * The item with this id, or a refusal naming the id.
 *
 * @param {any} board
 * @param {number} id
 * @returns {any}
 */
export function itemById(board, id) {
  const redirect = board.db.prepare('SELECT meta_value FROM board_meta WHERE meta_key=?').get(`item_redirect:${id}`);
  if (redirect) {
    const target = JSON.parse(redirect.meta_value);
    throw new Refused('NO_ITEM', `item #${id} moved to ${target.destinationHandle ?? target.destinationBoardId}#${target.destinationItemId}; use that destination reference`);
  }
  const item = board.db.prepare('SELECT * FROM item WHERE item_id = ?').get(id);
  if (!item) throw new Refused('NO_ITEM', `no item #${id}; see: pullboard list`);
  return item;
}
