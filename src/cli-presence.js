/** One authenticated, machine-local heartbeat per command, independent of shared-board write locks [B3]. */
import { context } from './cli-read-context.js';
import {
  closeBoard,
  openBoardForRead,
} from './board-query.js';
import { heartbeatSeat } from './seat-presence.js';

const recorded = new WeakSet();

/** Observe only the registered local checkout after normal session binding; unknown callers gain no identity. */
export function heartbeatCommand(io) {
  if (recorded.has(io)) return;
  let board;
  try {
    const ctx = context(io);
    board = openBoardForRead(ctx.file, ctx.clock);
    if (!board) return;
    // Only the registered id is needed: projecting model/presence would reopen this same sidecar.
    const seat = board.db.prepare('SELECT agent_id FROM agent WHERE agent_path=?').get(ctx.info.root);
    if (seat && heartbeatSeat(board, seat.agent_id)) recorded.add(io);
  } catch (error) {
    if (!['NO_CONFIG', 'NOT_A_REPO'].includes(error.code)) io.err(`presence heartbeat unavailable: ${error.message}`);
  } finally { if (board) closeBoard(board); }
}
