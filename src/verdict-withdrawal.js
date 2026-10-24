/** Append-only withdrawal bindings and derived review-history annotations [V2,V6,H16]. */
import { Refused } from './refused.js';
import { VERDICT_WITHDRAW_ENGINE } from './verdict-withdraw-engine.js';

/** Pair immutable verdict rows with their corresponding immutable acceptance/rejection events. */
function verdictPairs(board, id) {
  const verdicts = board.db.prepare('SELECT * FROM verdict WHERE item_id = ? ORDER BY verdict_id').all(id);
  const events = board.db.prepare("SELECT * FROM event WHERE item_id = ? AND event_kind IN ('accept', 'reject') ORDER BY event_id").all(id);
  return verdicts.map((verdict, index) => ({ verdict, event: events[index] }));
}

/** Only a later reopen naming both exact immutable identities marks an acceptance withdrawn. */
export function verdictWithdrawals(board, id) {
  const pairs = verdictPairs(board, id), result = new Map();
  for (const row of board.db.prepare("SELECT * FROM event WHERE item_id = ? AND event_kind = 'reopen' ORDER BY event_id").all(id)) {
    const detail = JSON.parse(row.event_detail), binding = detail.withdrawnVerdict;
    if (!binding) continue;
    const pair = pairs.find(({ verdict, event }) => verdict.verdict_id === binding.verdictId
      && verdict.verdict_decision === 'ACCEPT' && event?.event_id === binding.acceptEventId
      && event.event_kind === 'accept' && event.event_id < row.event_id
      && verdict.verdict_commit === detail.commit);
    if (!pair) continue;
    result.set(pair.verdict.verdict_id, { eventId: row.event_id, acceptEventId: pair.event.event_id,
      at: row.event_at, by: row.event_by, note: detail.note });
  }
  return result;
}

/** Bind the latest current acceptance and authorize only its own reviewer or the coordinator. */
export function verdictWithdrawalTarget(board, item, agentId) {
  if (item.item_status !== 'verified') throw new Refused('VERDICT_WITHDRAW_STATE', 'withdraw an accepted, unmerged item; use ordinary reopen for a submitted item');
  const withdrawn = verdictWithdrawals(board, item.item_id);
  const pair = verdictPairs(board, item.item_id).findLast(({ verdict, event }) => verdict.verdict_decision === 'ACCEPT'
    && verdict.verdict_commit === item.item_commit && event?.event_kind === 'accept' && !withdrawn.has(verdict.verdict_id));
  if (!pair) throw new Refused('VERDICT_WITHDRAW_STATE', 'this item has no current acceptance to withdraw; refresh its recorded history');
  if (agentId !== 'coordinator' && agentId !== pair.verdict.verdict_by) {
    throw new Refused('VERDICT_WITHDRAW_FORBIDDEN', 'only the accepting reviewer or coordinator can withdraw this verdict; ask that reviewer or the coordinator');
  }
  return { verdictId: pair.verdict.verdict_id, acceptEventId: pair.event.event_id };
}

/** Preserve withdrawal option refusals before any lifecycle mutation or review-history lookup. */
export function checkOptions(withdrawVerdict, forMerge, currentEngine) {
  if (withdrawVerdict !== undefined && typeof withdrawVerdict !== 'boolean') throw new Refused('BAD_VERDICT_WITHDRAW', 'withdrawVerdict must be a boolean; use --withdraw-verdict');
  if (withdrawVerdict === true && currentEngine < VERDICT_WITHDRAW_ENGINE) throw new Refused('ENGINE_VERSION', 'update Pullboard before withdrawing a verdict');
  if (withdrawVerdict === true && forMerge) throw new Refused('BAD_VERDICT_WITHDRAW', 'withdraw a verdict or report a trunk conflict, not both');
}
