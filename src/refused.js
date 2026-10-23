import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A refused move: a rule said no. The code names the rule; the message says what to do next (P4).
 */
export class Refused extends Error {
  /**
   * @param {string} code - The rule that refused, in UPPER_SNAKE, e.g. SELF_VERIFY.
   * @param {string} message - Why, and the next step.
   * @param {string} [next] - A contextual recovery action, when the raise site knows it.
   */
  constructor(code, message, next) {
    super(`[${code}] ${message}`);
    this.name = 'Refused';
    this.code = code;
    if (typeof next === 'string' && next.trim()) this.next = next.trim();
  }
}

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
