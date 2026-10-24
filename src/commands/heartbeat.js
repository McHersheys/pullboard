/** Agent session hooks observe activity without adding any shared board move [B3]. */
import { context } from '../cli-read-context.js';
import { withBoardRead } from '../cli-board-read.js';
import { agentAt } from '../board-query.js';

/** Report the heartbeat already recorded by the ordinary command entry point. */
export async function run(io) {
  const ctx = context(io);
  const seat = await withBoardRead(ctx, board => agentAt(board, ctx.info.root));
  io.result?.({ seat: seat?.agent_id ?? null, presence: seat?.presence ?? 'gone', heartbeatAt: seat?.heartbeatAt ?? null });
  return 0;
}
