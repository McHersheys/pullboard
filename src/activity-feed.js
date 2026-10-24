/** Read item activity without duplicating a landing's immutable board-wide receipt [R2,N26]. */

/** Include a batch's main-moving receipt only for the exact item ids that receipt records. */
export function itemActivity(board, id) {
  return board.db.prepare(`
    SELECT * FROM event WHERE item_id = ?
    UNION ALL
    SELECT * FROM event WHERE item_id IS NULL AND event_kind = 'main-moved'
      AND EXISTS (
        SELECT 1 FROM json_each(CASE WHEN json_valid(event_detail) THEN event_detail ELSE '{}' END, '$.items')
        WHERE type = 'integer' AND value = ?
      )
    ORDER BY event_id
  `).all(id, id);
}
