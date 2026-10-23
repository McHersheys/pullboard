/** CLI proposal and exact person decisions for board-owned watches [A6,D3]. */
import { PERSON } from './board.js';
import { requirePersonChannel } from './person.js';
import { Refused } from './refused.js';
import { dueSentinels, sentinels } from './sentinels.js';
import { runDueSentinels, withSentinelTrunk } from './sentinel-runner.js';
import { healthSentinelEnabled } from './settings.js';

/** The watch command's existing string options, shared with the CLI parser. */
export const SENTINEL_OPTIONS = {
  every: { type: 'string' },
  owner: { type: 'string' },
  directory: { type: 'string' },
  timeout: { type: 'string' },
  next: { type: 'string' },
  sentinel: { type: 'boolean' },
};

/** Resume reports due watches in one line and never starts their commands. */
export function resumeSentinels({ ctx, withBoard }) {
  if (!healthSentinelEnabled(ctx.config)) return;
  return withBoard(ctx, board => {
    if (dueSentinels(board).length) ctx.io.say('Sentinels are due; schedule pullboard sentinel run to run them in a prepared trunk checkout.');
  });
}

/** Run due approved watches on pinned trunk, recording through the original caller's board. */
async function runSentinels({ ctx, withBoard, whoAmI, ordered }) {
  return withBoard(ctx, async board => {
    const me = whoAmI(ctx, board);
    if (!healthSentinelEnabled(ctx.config) || !dueSentinels(board).length) {
      ctx.io.result?.({ sentinels: [] });
      ctx.io.say('No enabled sentinel is due.');
      return 0;
    }
    const { results, trunk } = await withSentinelTrunk(ctx.info.root, root => runDueSentinels({ root, board, agentId: me.id,
      ordered: (operation, args) => ordered(ctx, board, operation, args) }));
    ctx.io.result?.({ sentinels: results, trunk });
    ctx.io.say(`Sentinels: ${results.length} run from trunk ${trunk.branch}@${trunk.commit.slice(0, 12)}.`);
    for (const row of results) ctx.io.say(`${row.name}: ${row.lastRun.green ? 'green' : 'red'}; owner ${row.owner}`);
    return 0;
  });
}

/** Keep command parsing separate from the CLI's process and server setup. */
export async function sentinelCommand({ ctx, words, values, withBoard, whoAmI, ordered }) {
  const [verb, name, ...extra] = words;
  if (verb === 'run' && !name && !extra.length) return runSentinels({ ctx, withBoard, whoAmI, ordered });
  if (extra.length || !['propose', 'approve', 'decline'].includes(verb) || !name) {
    throw new Refused('USAGE', 'use pullboard sentinel run, sentinel propose <name> --check "<command>" --every 10m --owner <seat or lane>, sentinel approve <name>, sentinel decline <name> --reason "<why>", or pullboard sentinels');
  }
  if (verb !== 'propose') requirePersonChannel(ctx.io.personChannel);
  return withBoard(ctx, async board => {
    const me = whoAmI(ctx, board);
    let row;
    if (verb === 'propose') {
      row = await ordered(ctx, board, 'proposeSentinel', [{ agentId: me.id, row: {
        name, check: values.check, every: values.every, owner: values.owner,
        directory: values.directory, timeoutMs: values.timeout === undefined ? undefined : Number(values.timeout), next: values.next,
      } }]);
    } else {
      if (!ctx.info.isMain || me.id !== 'coordinator') throw new Refused('B26_PERSON_APPROVAL', 'only the person from the main checkout approves or declines a sentinel; use their terminal or Pullboard View');
      const current = sentinels(board).find(entry => entry.name === name);
      if (!current) throw new Refused('STALE_SENTINEL', 'read the current proposals with pullboard sentinels');
      row = await ordered(ctx, board, 'decideSentinel', [{ agentId: PERSON, channel: ctx.io.personChannel ?? 'terminal',
        name, digest: current.digest, decision: verb, reason: values.reason }]);
    }
    ctx.io.result?.({ sentinel: row });
    ctx.io.say(`${name}: ${row.status}; ${row.every}; owner ${row.owner}; directory ${row.directory}\n  ${row.check}`);
    if (row.status === 'pending') ctx.io.say(`next: the person approves this exact row with pullboard sentinel approve ${name}, or declines it with --reason "<why>"`);
    return 0;
  });
}

/** Reject an extra list argument before opening the board, as the CLI does. */
export function sentinelListCommand(first, getContext, withBoard) {
  if (first) throw new Refused('USAGE', 'pullboard sentinels lists the current board watches');
  return sentinelList(getContext(), withBoard);
}

/** Show the current approval, latest outcome and owner without running any command. */
export function sentinelList(ctx, withBoard) {
  return withBoard(ctx, board => {
    const rows = sentinels(board);
    ctx.io.result?.({ sentinels: rows });
    for (const row of rows) {
      ctx.io.say(`${row.name}: ${row.status}; ${row.every}; owner ${row.owner}; last ${row.lastRun?.at ?? 'never'}; ${row.lastRun ? row.lastRun.green ? 'green' : 'red' : 'unrun'}\n  directory ${row.directory}; ${row.check}`);
    }
    if (!rows.length) ctx.io.say('no board watches; propose one with pullboard sentinel propose <name> --check "<command>" --every 10m --owner coordinator');
    return 0;
  });
}
