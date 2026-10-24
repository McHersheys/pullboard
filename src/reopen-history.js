/**
 * True only after a no-verdict reopen followed by an explicit refreeze, or an edit that clears the
 * old frozen bar followed by a new claim. Reopening a verified landing failure is excluded.
 *
 * @param {any} board
 * @param {number} id
 * @param {string} commit
 * @returns {boolean}
 */
export function correctedNoVerdictReopen(board, id, commit) {
  const history = board.db.prepare(
    "SELECT event_id, event_kind, event_detail FROM event WHERE item_id = ? AND event_kind IN ('submit', 'reopen', 'edit', 'refreeze', 'claim') ORDER BY event_id DESC",
  ).all(id);
  const boundary = history.findIndex((entry) => entry.event_kind === 'submit' || entry.event_kind === 'reopen');
  if (boundary < 0 || history[boundary].event_kind !== 'reopen') return false;
  const reopened = JSON.parse(history[boundary].event_detail);
  if (reopened.judgment !== null || reopened.supersedes !== undefined) return false;

  const previousSubmission = history.slice(boundary + 1).find((entry) => {
    if (entry.event_kind !== 'submit') return false;
    const detail = JSON.parse(entry.event_detail);
    return detail.commit === commit;
  });
  if (!previousSubmission) return false;
  const afterReopen = history.slice(0, boundary);
  const latestBarChange = afterReopen.find((entry) => entry.event_kind === 'refreeze'
    || (entry.event_kind === 'edit' && Object.hasOwn(JSON.parse(entry.event_detail), 'unfrozen')));
  if (!latestBarChange) return false;
  if (latestBarChange.event_kind === 'refreeze') return true;
  return afterReopen.some((entry) => entry.event_kind === 'claim' && entry.event_id > latestBarChange.event_id
    && Boolean(JSON.parse(entry.event_detail).digest));
}
