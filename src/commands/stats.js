/** The pullboard stats command, in its own module so an item adding another command never edits these lines. */
import {
  barStatsLines,
} from '../bar-corrections.js';
import * as store from '../board.js';
import { caughtLines } from '../caught.js';
import * as gateReceipt from '../gate-receipt.js';
import {
  flowLines,
} from '../stats-flow.js';
import {
  proofStats,
} from '../stats.js';
import {
  agentDisplayName,
  context,
  withBoard,
} from '../cli.js';

/** Run `pullboard stats` and return its exit code. */
export function run(io, { values }) {
  const ctx = context(io);
  const { stats, agents } = withBoard(ctx, (board) => ({ stats: proofStats(board, { since: values.since }), agents: store.listAgents(board) }));
  const waits = gateReceipt.gateWaitStats(ctx.info.root);
  io.result?.({ stats, gateWaits: waits.stats });
  io.say(`${stats.submissions} submissions · ${stats.rejections} rejections · ${(stats.rejectionShare * 100).toFixed(1)}% sent back`);
  io.say(`${stats.merged} items merged · ${stats.mergedWithoutAccept} merged without an accept`);
  io.say(`${stats.agentCount} agents · ${stats.familyCount} family buckets: ${stats.families.map((family) => `${family.name} (${family.agents} agents, ${family.moves} moves)`).join('; ') || 'none'}`);
  io.say(`agents: ${stats.agents.map((agent) => `${agentDisplayName(agents, ctx.config, agent.id)} (${agent.families.join('/')}; ${agent.moves} moves)`).join(', ') || 'none'}`);
  io.say(`events: ${stats.firstEventAt ?? 'none'} to ${stats.lastEventAt ?? 'none'}${stats.since ? ` (since ${stats.since})` : ''}`);
  for (const line of barStatsLines(stats.bars)) io.say(line);
  for (const line of caughtLines(stats.caught)) io.say(line);
  for (const line of flowLines(stats.flow)) io.say(line);
  for (const line of waits.lines) io.say(line);
  return 0;
}
