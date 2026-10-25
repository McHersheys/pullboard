/** The pullboard shout command, in its own module so an item adding another command never edits these lines. */
import * as store from '../board.js';
import { requireReadableShout } from '../shout-readable.js';
import {
  COORDINATOR,
} from '../config.js';
import {
  laneNames,
} from '../lanes.js';
import {
  personShout,
} from '../person.js';
import {
  actOn,
  agentDisplayName,
  evidenceFrom,
  ordered,
} from '../cli.js';

/** Run `pullboard shout` and return its exit code. */
export async function run(io, { first, second, rest, values }) {
  const act = (work) => actOn(io, work);
  return act(async (ctx, board, me) => {
  const evidence = values.evidence === undefined ? null : evidenceFrom(ctx, values);
  const recipients = ['all', 'person', ...laneNames(ctx.config), ...board.db.prepare('SELECT agent_id FROM agent').all().map((agent) => agent.agent_id)];
  const hasRecipient = first && recipients.includes(first) && (values.item === undefined || second !== undefined);
  const to = values.item !== undefined ? `item:${values.item}` : hasRecipient ? first : values.decision ? (me.id === COORDINATOR ? 'person' : COORDINATOR) : first ?? '';
  const text = [hasRecipient ? second : first, ...(hasRecipient ? rest : [second, ...rest])].filter(Boolean).join(' ');
  requireReadableShout(text);
  const id = await ordered(ctx, board, 'shout', [{ from: personShout(io, me) ? store.PERSON : me.id, to, text, ...(values.item !== undefined ? { item: Number(values.item) } : {}), lanes: laneNames(ctx.config), decision: Boolean(values.decision), ...(values.news ? { news: true } : {}), evidence }]);
  io.result?.({ id, decision: Boolean(values.decision) });
  const agents = store.listAgents(board);
  const recipient = agents.some((agent) => agent.agent_id === to) ? agentDisplayName(agents, ctx.config, to) : to;
  io.say(values.decision ? `asked ${recipient} for a decision as #${id}; it stays open until someone runs: pullboard answer ${id} "<the decision>"` : `shouted to ${recipient}`);
  return 0;
});
}
