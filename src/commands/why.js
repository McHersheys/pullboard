/** The pullboard why command, in its own module so an item adding another command never edits these lines. */
import * as store from '../board.js';
import {
  decisionsImplying,
  whyLine,
} from '../implies.js';
import {
  Refused,
} from '../refused.js';
import {
  context,
  idArg,
  withBoard,
} from '../cli.js';

/** Run `pullboard why` and return its exit code. */
export function run(io, { first, second, rest }) {
  if (!first || second || rest.length) throw new Refused('USAGE', 'pullboard why <id>: the decisions that imply an item, newest first');
  const ctx = context(io);
  const id = idArg(first);
  const decisions = withBoard(ctx, (board) => decisionsImplying(store.itemThread(board, id)));
  io.result?.({ id, decisions });
  if (!decisions.length) io.say(`no decision implies #${id}`);
  for (const entry of decisions) io.say(whyLine(entry));
  return 0;
}
