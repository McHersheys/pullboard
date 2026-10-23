/** The pullboard decisions command, in its own module so an item adding another command never edits these lines. */
import * as store from '../board.js';
import {
  agentDisplayName,
  context,
  firstLine,
  personMode,
  span,
  whoAmI,
  withBoardRead,
} from '../cli.js';

/** Run `pullboard decisions` and return its exit code. */
export function run(io, { values }) {
  const ctx = context(io);
  const { asks, agents } = withBoardRead(ctx, (board) => {
    const me = whoAmI(ctx, board);
    const asPerson = personMode(ctx, me, values);
    return { asks: store.openDecisions(board, asPerson ? 'person' : [me.id, me.lane]), agents: store.listAgents(board) };
  });
  io.result?.({ decisions: asks });
  if (!asks.length) io.say('no open decisions');
  for (const ask of asks) io.say(`#${ask.shout_id}  ${agentDisplayName(agents, ctx.config, ask.shout_from)} -> ${agentDisplayName(agents, ctx.config, ask.shout_to)}, ${span(ctx, ask.shout_at)} ago: ${firstLine(ask.shout_text)}`);
  return 0;
}
