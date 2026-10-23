/** Item status and verdict totals for board summaries. */

/**
 * Counts for the status line and the ledger's summary: items by status, verdicts by decision.
 *
 * @param {any} board
 * @returns {{ items: Record<string, number>, accepted: number, rejected: number }}
 */
export function stats(board) {
  const items = { open: 0, claimed: 0, submitted: 0, verified: 0, withdrawn: 0 };
  const counts = board.db.prepare(`SELECT CASE WHEN item_status='claimed' AND COALESCE(item_lease_until,'')<=?
    THEN 'open' ELSE item_status END AS status, COUNT(*) AS total FROM item GROUP BY status`).all(board.clock.now().toISOString());
  for (const row of counts) items[row.status] = row.total;
  const verdicts = board.db
    .prepare('SELECT verdict_decision AS decision, COUNT(*) AS total FROM verdict GROUP BY verdict_decision')
    .all();
  const count = (decision) => verdicts.find((row) => row.decision === decision)?.total ?? 0;
  return { items, accepted: count('ACCEPT'), rejected: count('REJECT') };
}
