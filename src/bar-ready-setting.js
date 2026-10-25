/** Read-only ordered bar state, usable without loading board operations [C7,H16]. */
/** Read a deterministic value kept by ordered moves; the event history retains its provenance. */
export function readBarState(board, key) {
  const row = board.db.prepare('SELECT meta_value FROM board_meta WHERE meta_key=?').get(key);
  return row ? JSON.parse(row.meta_value) : null;
}

/** Read the default-off board setting without consulting a replica's local configuration. */
export function barReadySetting(board) { return readBarState(board, 'bar_ready_setting') ?? { enabled: false, since: 0 }; }
