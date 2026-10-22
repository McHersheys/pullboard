/** The pullboard inbox command, in its own module so an item adding another command never edits these lines. */
import * as store from '../board.js';
import {
  agentDisplayName,
  context,
  evidenceLine,
  whoAmI,
  withBoard,
} from '../cli.js';

/** Run `pullboard inbox` and return its exit code. */
export function run(io) {
  const ctx = context(io);
  const { shouts, agents } = withBoard(ctx, (board) => ({
    shouts: store.inbox(board, whoAmI(ctx, board).id),
    agents: store.listAgents(board),
  }));
  io.result?.({ shouts });
  if (!shouts.length) io.say('no new shouts');
  for (const shout of shouts) {
    const ask = shout.shout_decision ? `asks for a decision (#${shout.shout_id}; pullboard answer ${shout.shout_id} "..."): ` : '';
    const reply = shout.shout_answers ? `answers #${shout.shout_answers}: ` : '';
    const from = agentDisplayName(agents, ctx.config, shout.shout_from);
    const to = agentDisplayName(agents, ctx.config, shout.shout_to);
    io.say(`${shout.shout_at.slice(0, 16)}  ${from} -> ${to}: ${ask}${reply}${shout.shout_text}`);
    if (shout.shout_evidence_kind) io.say(`  ${evidenceLine(shout)}`);
  }
  return 0;
}
