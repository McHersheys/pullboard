/** The pullboard status command, in its own module so an item adding another command never edits these lines. */
import * as store from '../board.js';
import { personNeedsSummary } from '../needs-state.js';
import { projectRowDecisions } from '../row-decisions.js';
import { ruleProofCounts } from '../rule-proof-counts.js';
import {
  reviewQueueLine,
} from '../next-steps.js';
import {
  productLine,
  productSummaries,
} from '../products.js';
import * as relayOutput from '../relay-output.js';
import {
  originRepository,
  relayStatus,
} from '../relay.js';
import {
  loadSpec,
} from '../spec.js';
import {
  submitInvariantLine,
  submitInvariantProposals,
} from '../submit-invariants.js';
import {
  context,
  span,
  whoAmI,
  withBoardRead,
} from '../cli.js';

/** Run `pullboard status` and return its exit code. */
export function run(io, { values }) {
  const ctx = context(io);
  const summary = withBoardRead(ctx, (board) => {
    const me = whoAmI(ctx, board);
    const mine = store.itemsInStatus(board, 'claimed', me.id);
    const approvalState = personNeedsSummary(ctx.info.root, { board, config: ctx.config });
    const rows = projectRowDecisions(store.rowDecisions(board), { root: ctx.info.root, spec: loadSpec(ctx.info.root, ctx.config).rows }).spec;
    return { me, mine, ruleCounts: ruleProofCounts(ctx.info.root, board, rows), needs: approvalState.needs, specApprovalBaseline: approvalState.specApprovalBaseline, specApprovalEvidenceErrors: approvalState.specApprovalEvidenceErrors, stats: store.stats(board), reviewQueue: { ...store.reviewQueue(board), ...store.reviewQueueBreakdown(board) }, unread: store.unreadCount(board, me.id), relay: relayStatus(ctx.info.root),
      submitInvariantProposals: submitInvariantProposals(store.submitInvariantEvents(board, ctx.config), ctx.config) };
  });
  if (values.json) {
    io.result(summary);
    return 0;
  }
  for (const line of relayOutput.briefLines(summary.relay)) io.say(line);
  const { items, accepted, rejected } = summary.stats;
  io.say(`${summary.me.displayName}: ${summary.unread} unread shouts; holding ${summary.mine.map((item) => `#${item.item_id}`).join(', ') || 'nothing'}`);
  io.say(`board: ${items.open} open, ${items.claimed} claimed, ${items.submitted} awaiting verification, ${items.verified} verified, ${items.withdrawn} withdrawn`);
  io.say(`verdicts: ${accepted} accepted, ${rejected} rejected`);
  if (summary.specApprovalBaseline?.pending) io.say('approval baseline pending: the next coordinator or person command in the main checkout records the existing approved rows; lane work may continue and none are flagged until then');
  if (summary.specApprovalBaseline?.invalid) io.say('approval baseline unreadable: existing rows need approval evidence; restore a known-good board export to recover the original baseline');
  io.say(reviewQueueLine(ctx, summary.reviewQueue, span));
  for (const proposal of summary.submitInvariantProposals) io.say(submitInvariantLine(proposal));
  for (const need of summary.needs.filter(need => need.kind === 'agent-approved')) io.say(`${need.text}; ${need.what}`);
  if (!summary.relay.linked && !originRepository(ctx.info.root, { optional: true })) {
    io.say('optional: add a GitHub origin and run pullboard relay on to link this board');
  }
  if (Object.keys(ctx.config.products).length) {
    const all = withBoardRead(ctx, (board) => store.listItems(board, { all: true }));
    productSummaries(ctx.config, loadSpec(ctx.info.root, ctx.config), all).forEach((product) => io.say(productLine(product)));
  }
  return 0;
}
