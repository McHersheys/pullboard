import {
  activityMainFiles,
  activityWorkingFiles,
  readActivityCursor,
  saveActivityCursor,
} from '../activity-inbox.js';
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
  const { shouts, agents, activity, delivery } = withBoard(ctx, (board) => {
    const me = whoAmI(ctx, board);
    const delivery = readActivityCursor(ctx.info.root, me.id, store.boardId(board));
    const projected = store.agentActivity(board, me.id, { after: delivery.after, newsAfter: delivery.newsAfter,
      sessionStart: delivery.sessionStart,
      workingFiles: builds => activityWorkingFiles(ctx.info.root, builds),
      changesForMain: (commit, detail) => activityMainFiles(ctx.info.root, commit, detail,
        { rowFiles: [ctx.config.spec, ctx.config.practice] }) });
    const { newsShouts, shoutCursor, ...activity } = projected;
    return { shouts: store.inbox(board, me.id, { through: shoutCursor }).filter(shout => !newsShouts.includes(shout.shout_id)),
      agents: store.listAgents(board), activity, delivery };
  });
  io.result?.({ shouts, activity });
  if (!shouts.length && !activity.entries.length && !activity.digests.length) io.say('no new shouts or activity');
  for (const shout of shouts) {
    const ask = shout.shout_decision ? `asks for a decision (#${shout.shout_id}; pullboard answer ${shout.shout_id} "..."): ` : '';
    const reply = shout.shout_answers ? `answers #${shout.shout_answers}: ` : '';
    const from = agentDisplayName(agents, ctx.config, shout.shout_from);
    const to = agentDisplayName(agents, ctx.config, shout.shout_to);
    io.say(`${shout.shout_at.slice(0, 16)}  ${from} -> ${to}: ${ask}${reply}${shout.shout_text}`);
    if (shout.shout_evidence_kind) io.say(`  ${evidenceLine(shout)}`);
  }
  const delivered = new Set(shouts.map(shout => shout.shout_id));
  for (const entry of activity.entries) if (!delivered.has(entry.shout)) io.say(`${entry.at.slice(0, 16)}  ${entry.text}`);
  for (const digest of activity.digests) io.say(digest.text);
  if (!saveActivityCursor(delivery, activity.cursor)) io.err('activity cursor could not be saved; activity may repeat when you read inbox again');
  return 0;
}
