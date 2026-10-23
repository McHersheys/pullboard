/** The block ledger: refusals that stopped someone's command. Not in refused.js, which the browser loads [C6]. */
import {
  appendFileSync,
  existsSync,
  readFileSync,
} from 'node:fs';
import { join } from 'node:path';

/** The ledger of refusals that stopped someone's command, beside the board in Git's common folder. */
export const BLOCKS_FILE = join('pullboard', 'blocks.jsonl');

/**
 * Append one block: its code, the command, who was stopped, who can clear it, and the plain reason
 * and step. A ledger beside the board, not a board event, so recording a block never needs the
 * board's lock or changes what the event log replays.
 *
 * @param {string} commonDir
 * @param {{ at: string, code: string, command: string, by: string, path: string, audience: string, reason: string, step: string }} block
 */
export function recordBlock(commonDir, block) {
  const folder = join(commonDir, 'pullboard');
  // A repository without a board has no ledger yet; the refusal itself still prints.
  if (!existsSync(folder)) return false;
  appendFileSync(join(commonDir, BLOCKS_FILE), JSON.stringify(block) + '\n');
  return true;
}

/**
 * The blocks recorded at or after `since`, oldest first. A torn last line from a crash is skipped.
 *
 * @param {string} commonDir
 * @param {{ since?: Date }} [options]
 * @returns {any[]}
 */
export function readBlocks(commonDir, { since } = {}) {
  const file = join(commonDir, BLOCKS_FILE);
  if (!existsSync(file)) return [];
  const from = since ? since.getTime() : -Infinity;
  const blocks = [];
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let block;
    try { block = JSON.parse(line); } catch { continue; /* A torn line from an interrupted append carries no block. */ }
    if (typeof block?.code === 'string' && Date.parse(block.at) >= from) blocks.push(block);
  }
  return blocks;
}

/**
 * The last day's blocks only the person can clear, carrying only their plain words, never a local
 * path, for every Needs you projection: the CLI, the local API and the sealed relay page [C6].
 *
 * @param {string} commonDir
 * @param {Date} now
 */
export function personBlockWords(commonDir, now) {
  return readBlocks(commonDir, { since: new Date(now.getTime() - 86_400_000) })
    .filter(block => block.audience === 'person')
    .map(({ at, code, command, audience, reason, step }) => ({ at, code, command, audience, reason, step }));
}
