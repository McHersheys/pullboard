/** The pullboard whoami command, in its own module so an item adding another command never edits these lines. */
import {
  context,
  whoAmI,
  withBoard,
} from '../cli.js';

/** Run `pullboard whoami` and return its exit code. */
export function run(io) {
  const ctx = context(io);
  const me = withBoard(ctx, (board) => whoAmI(ctx, board));
  io.result?.({ ...me, path: ctx.info.root });
  io.say(`${me.displayName} (${me.lane} lane${me.route === 'light' ? ', light route' : ''}) at ${ctx.info.root}`);
  return 0;
}
