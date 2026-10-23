/** Caller identity shared by read and write commands without loading their transports [C7,E18]. */
import * as store from './board.js';
import { COORDINATOR } from './config.js';
import { displayAgentName } from './agent-names.js';
import { Refused } from './refused.js';

/**
 * Who is asking: the coordinator in the main checkout, or the agent this worktree joined as.
 *
 * @param {any} ctx
 * @param {any} board
 * @returns {{ id: string, lane: string, route?: string, family: string | null, model: string | null, displayName: string }}
 */
export function identifyCaller(ctx, board, { environmentAgent, relayLinked }) {
  // A CI or cloud session works as the agent its environment token names, on that one board [E18].
  const seat = environmentAgent(ctx.info.root, board);
  if (seat) return { id: seat.agent_id, lane: seat.agent_lane, route: seat.agent_route, family: seat.agent_family ?? null, model: seat.agent_model ?? 'unknown', displayName: displayAgentName(seat, ctx.config.agents.names) };
  if (ctx.info.isMain) {
    ctx.io.caller?.('coordinator', ctx.info.root);
    const registered = store.agentById(board, COORDINATOR);
    const linked = relayLinked(ctx.info.root);
    if (linked && !registered) throw new Refused('NO_AGENT', 'the linked snapshot has no coordinator; restore a consistent relay snapshot before acting');
    const id = linked ? COORDINATOR : store.ensureCoordinator(board, ctx.info.root);
    const agent = registered ?? store.agentAt(board, ctx.info.root);
    return { id, lane: COORDINATOR, family: agent?.agent_family ?? null, model: agent?.agent_model ?? 'unknown', displayName: displayAgentName(agent ?? { agent_id: id }, ctx.config.agents.names) };
  }
  const agent = store.agentAt(board, ctx.info.root);
  if (!agent) {
    throw new Refused('NOT_JOINED', 'this worktree has not joined a lane: pullboard join <lane> --model "<model name>" (see: pullboard lanes)');
  }
  ctx.io.caller?.('seat', ctx.info.root);
  return { id: agent.agent_id, lane: agent.agent_lane, route: agent.agent_route, family: agent.agent_family ?? null, model: agent.agent_model ?? 'unknown', displayName: displayAgentName(agent, ctx.config.agents.names) };
}
