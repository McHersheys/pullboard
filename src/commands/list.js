import { withBoardRead } from '../board-read.js';
/** The pullboard list command, in its own module so an item adding another command never edits these lines. */
import * as store from '../board.js';
import {
  mainMergeFor,
} from '../trunk-conflict.js';
import {
  verdictProjector,
} from '../verdict-freshness.js';
import {
  agentDisplayName,
  context,
  itemLine,
} from '../cli-context.js';

/** Run `pullboard list` and return its exit code. */
export function run(io, { first, values }) {
  const ctx = context(io);
  const { items, agents, merging } = withBoardRead(ctx, (board) => {
    const rows = store.listItems(board, { lane: first, all: values.all });
    return { items: rows.map(verdictProjector(ctx.info.root, board).project), agents: store.listAgents(board),
      merging: new Set(rows.filter(item => !['verified', 'withdrawn'].includes(item.item_status) && mainMergeFor(board, item.item_id)).map(item => item.item_id)) };
  });
  const filtered = items.filter((item) => !values.route || item.item_route === values.route);
  if (values.json) io.result({ items: filtered });
  else if (!filtered.length) io.say(values.all ? 'no items yet' : 'nothing open; --all shows closed items');
  else filtered.forEach((item) => io.say(itemLine(item, (id) => agentDisplayName(agents, ctx.config, id), merging.has(item.item_id))));
  return 0;
}
