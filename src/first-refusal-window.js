/** Pure recorded first-refusal reader shared by move declarations [B13,H16,C7]. */
/** Read the latest return's window, ignoring review releases and earlier submissions. */
export function firstRefusal(board, id, at = board.clock.now()) {
  const history = board.db.prepare("SELECT event_kind, event_detail, event_by FROM event WHERE item_id = ? AND event_kind IN ('reject', 'reopen', 'submit', 'release') ORDER BY event_id DESC").all(id);
  const releases = [];
  for (const event of history) {
    const detail = JSON.parse(event.event_detail);
    if (event.event_kind === 'release') { releases.push(event); continue; }
    if (event.event_kind === 'submit') return null;
    const window = detail.reopenFirstRefusal;
    if (!window || !window.builder || !Number.isFinite(Date.parse(window.until))) return null;
    if (releases.some(release => release.event_by === window.builder && JSON.parse(release.event_detail).review !== true)) return null;
    return at.getTime() < Date.parse(window.until) ? window : null;
  }
  return null;
}

