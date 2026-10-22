/** The pullboard release command, in its own module so an item adding another command never edits these lines. */
import * as store from '../board.js';
import * as seatCheckout from '../seat-checkout.js';
import {
  actOn,
  idArg,
  ordered,
  textArg,
} from '../cli.js';

/** Run `pullboard release` and return its exit code. */
export async function run(io, args) {
  const { first, values } = args;
  const act = (work) => actOn(io, work);
  return act(async (ctx, board, me) => {
  const args = [idArg(first), me.id, textArg(io, values, 'note') ?? ''];
  seatCheckout.refuseHeldElsewhere(ctx.info, store.listAgents(board), store.getItem(board, args[0]), 'release');
  const problem = store.reviewReleaseNoteProblem(board, ...args);
  if (problem) throw problem;
  const review = await ordered(ctx, board, 'release', args);
  io.result?.({ id: idArg(first) });
  io.say(review ? `released the review of #${first}; the review is free again` : `released #${first}`);
  return 0;
});
}
