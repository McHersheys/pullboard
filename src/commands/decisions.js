/** The pullboard decisions command, in its own module so an item adding another command never edits these lines. */
import { basename } from 'node:path';
import * as store from '../board.js';
import {
  projectPersonDecisions,
  projectSiblings,
} from '../project-decisions.js';
import {
  agentDisplayName,
  context,
  firstLine,
  personMode,
  span,
  whoAmI,
  withBoardRead,
} from '../cli.js';

/**
 * Run `pullboard decisions` and return its exit code. As the person, a repo that belongs to a
 * project lists every sibling repo's open decisions too, each named repo#id so `pullboard answer
 * repo#id` closes it on its own board [N34].
 */
export function run(io, { values }) {
  const ctx = context(io);
  const siblings = projectSiblings(ctx.info.root, ctx.config);
  const { asks, agents, project, asPerson } = withBoardRead(ctx, (board) => {
    const me = whoAmI(ctx, board);
    const asPerson = personMode(ctx, me, values);
    if (asPerson && siblings.length) {
      return { project: projectPersonDecisions(ctx.info.root, ctx.config.name ?? basename(ctx.info.root), board, siblings), asPerson };
    }
    return { asks: store.openDecisions(board, asPerson ? 'person' : [me.id, me.lane]), agents: store.listAgents(board), asPerson };
  });
  if (project) {
    io.result?.({ project: ctx.config.project, decisions: project.decisions.map((entry) => entry.ask), ...(project.unreadable.length ? { unreadable: project.unreadable } : {}) });
    if (!project.decisions.length) io.say('no open decisions');
    for (const { ask, repo, agents: repoAgents, config } of project.decisions) {
      io.say(`${repo}#${ask.shout_id}  ${agentDisplayName(repoAgents, config ?? ctx.config, ask.shout_from)} -> ${agentDisplayName(repoAgents, config ?? ctx.config, ask.shout_to)}, ${span(ctx, ask.shout_at)} ago: ${firstLine(ask.shout_text)}`);
    }
    for (const name of project.unreadable) io.err(`could not read ${name}'s board; its decisions are not listed`);
    return 0;
  }
  io.result?.({ decisions: asks });
  if (!asks.length) io.say('no open decisions');
  for (const ask of asks) io.say(`#${ask.shout_id}  ${agentDisplayName(agents, ctx.config, ask.shout_from)} -> ${agentDisplayName(agents, ctx.config, ask.shout_to)}, ${span(ctx, ask.shout_at)} ago: ${firstLine(ask.shout_text)}`);
  return 0;
}
