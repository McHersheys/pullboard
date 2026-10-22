/** The pullboard claim command, in its own module so an item adding another command never edits these lines. */
import {
  headCommit,
} from '../git.js';
import {
  MainSpecMerged,
  actOn,
  claimFreezer,
  claimOrdered,
  idArg,
  whoAmI,
} from '../cli.js';

/** Run `pullboard claim` and return its exit code. */
export async function run(io, { first }) {
  const act = (work) => actOn(io, work);
  return act(async (ctx, board, me) => {
  const id = idArg(first);
  let result;
  for (;;) {
    try {
      result = await claimOrdered(ctx, board, [id, { agentId: me.id, lane: me.lane, leaseMs: ctx.config.leaseMs, freeze: claimFreezer(ctx, board), head: headCommit(ctx.info.root) }]);
      break;
    } catch (error) {
      if (!(error instanceof MainSpecMerged)) throw error;
      io.say(`merged main before claiming #${id}: added spec rows ${error.rows.join(', ')}`);
      me = whoAmI(ctx, board);
    }
  }
  io.result?.({ id: idArg(first), ...result });
  io.say(`${result.renewed ? 'renewed' : 'claimed'} #${first} until ${result.leaseUntil}; criterion frozen as ${result.digest.slice(0, 12)}`);
  return 0;
});
}
