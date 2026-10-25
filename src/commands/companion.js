/** Ask another lane for one durable child rather than starting duplicate companion work [B2,B12]. */
import * as store from '../board.js';
import { isLane } from '../lanes.js';
import { Refused } from '../refused.js';
import { idProblems, loadSpec } from '../spec.js';
import { checkBaseline, prepareCheckBaseline, refuseCheckSyntax, sayCheckBaseline } from '../check-baseline.js';
import { relayCommandReceipt, relayCommandReceiptReported } from '../relay.js';
import { actOn, barActorForCommand, briefArg, briefInLane, idArg, idList, launchBaseline, ordered, buildInFilelessLane } from '../cli.js';

/** Execute the normal authenticated request; only the coordinator may supply a check command. */
export async function run(io, { first, second, rest, values }) {
  return actOn(io, async (ctx, board, me) => {
    const recovered = await relayCommandReceipt(ctx.info.root, io.relayCommand);
    let result;
    if (recovered) {
      io.recordedMove = true;
      for (const event of recovered.events) io.onEvent?.(event);
      result = recovered.result;
    } else {
      if (!isLane(ctx.config, second)) throw new Refused('NO_LANE', `no lane "${second ?? ''}"; see pullboard lanes`);
      const specIds = idList(values.specs);
      const problems = idProblems(loadSpec(ctx.info.root, ctx.config), specIds, ctx.doctrine);
      if (problems.length) throw new Refused('UNKNOWN_SPEC', problems.join('; '));
      buildInFilelessLane(ctx.config, second, []);
      const request = { agentId: me.id, parentId: idArg(first), lane: second, key: values.key,
        title: rest.join(' '), criterion: values.criterion ?? '', specIds,
        brief: briefInLane(ctx, second, briefArg(io, values) ?? ''), route: values.route ?? 'strong', check: values.check,
        barActor: barActorForCommand(ctx, board, { asPerson: false }) };
      const plan = store.planCompanion(board, request);
      if (!plan.existing && plan.validated.command) {
        refuseCheckSyntax(plan.validated.command);
        request.checkBaseline = values.wait ? checkBaseline(ctx.info.root, plan.validated.command)
          : prepareCheckBaseline(ctx.info.root, plan.validated.command);
      }
      result = await ordered(ctx, board, 'requestCompanion', [request]);
      if (result.created && request.checkBaseline?.result === 'pending') await launchBaseline(ctx, board, result.item, request.checkBaseline);
    }
    const item = store.getItem(board, result.item);
    io.result?.({ item, created: result.created });
    io.say(`${result.created ? 'created' : 'existing'} companion #${item.item_id} in ${item.item_lane}; claim that item before building it`);
    sayCheckBaseline(io, item);
    if (recovered) await relayCommandReceiptReported(ctx.info.root, recovered.move.id);
    return 0;
  });
}
