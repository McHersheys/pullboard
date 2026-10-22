/** The pullboard takeover command, in its own module so an item adding another command never edits these lines. */
import {
  context,
  whoAmI,
  withBoard,
} from '../cli.js';

/** Run `pullboard takeover` and return its exit code. */
export function run(io) {
  const ctx = context(io);
  const me = withBoard(ctx, (board) => whoAmI(ctx, board));
  io.result?.({ agent: me.id, path: ctx.info.root });
  io.say(`${me.displayName} took over this checkout for the current agent session`);
  return 0;
}
