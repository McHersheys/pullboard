/** The block ledger: refusals that stopped someone's command. Not in refused.js, which the browser loads [C6]. */
import {
  appendFileSync,
  existsSync,
  readFileSync,
} from 'node:fs';
import { join } from 'node:path';
import {
  createHash,
  randomUUID,
} from 'node:crypto';
import { requirePersonChannel } from './person.js';
import { repoInfo } from './git.js';

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
  appendFileSync(join(commonDir, BLOCKS_FILE), JSON.stringify({ ...block, ...(block.moveKey ? { id: randomUUID() } : {}) }) + '\n');
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
  const blocks = new Map();
  let legacy = 0;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let block;
    try { block = JSON.parse(line); } catch { continue; /* A torn line from an interrupted append carries no block. */ }
    if (block?.kind === 'clear' && Array.isArray(block.ids)) {
      for (const id of block.ids) {
        const previous = blocks.get(id);
        const pending = previous?.moveKeys?.filter(move => !block.moveKeys?.includes(move));
        if (block.moveKeys && pending?.length) blocks.set(id, { ...previous, moveKeys: pending });
        else blocks.delete(id);
      }
    } else if (typeof block?.code === 'string') blocks.set(block.id ?? `legacy:${legacy++}`, block);
  }
  return [...blocks.values()].filter(block => Date.parse(block.at) >= from);
}

/** Hash a local matching key; command text, argument bodies and credentials never enter the ledger. */
function key(value) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }

/** The command branch and its target, excluding prose and option values. */
export function blockMoveKey(io) {
  const command = io.relayCommand;
  if (!command) return null;
  const name = command.cliOperation;
  const words = command.positionals ?? [];
  const branches = new Set(['spec', 'doctrine', 'sentinel', 'runner', 'relay', 'lane', 'milestone', 'hook', 'settings']);
  const verb = name === 'hold' ? command.values?.off ? 'off' : 'on'
    : name === 'land' && command.values?.waive !== undefined ? 'waive'
    : ['verify', 'fact'].includes(name) ? words[1] ?? ''
    : name === 'check' && words[0] === 'accept' ? 'accept' : branches.has(name) ? words[0] ?? '' : '';
  const targets = new Set(['answer', 'claim', 'submit', 'verify', 'check', 'show', 'release', 'withdraw', 'merged', 'fact', 'escalate', 'hold', 'shout']);
  let target = targets.has(name) || /^#?\d+$/u.test(words[0] ?? '') ? words[0] ?? '' : '';
  if (name === 'check' && verb === 'accept') target = words[1] ?? '';
  if (name === 'next' && command.values?.verifyId !== undefined) target = String(command.values.verifyId);
  if (name === 'spec' && ['approve', 'decline'].includes(verb)) {
    target = [...new Set(words.slice(1).flatMap(word => word.split(/[\s,]+/u)).filter(Boolean))].sort().join(',');
  } else if (name === 'spec' && verb === 'answer' || name === 'sentinel' || name === 'runner') target = words[1] ?? '';
  if (/^#?\d+$/u.test(target)) target = String(Number(target.replace(/^#/u, '')));
  return key({ command: name, verb, item: target });
}

/** A multirow refusal completes only after every target has its own later successful move. */
export function blockMoveKeys(io) {
  const command = io.relayCommand;
  if (command?.cliOperation === 'spec' && ['approve', 'decline'].includes(command.positionals?.[0])) {
    return [...new Set(command.positionals.slice(1).flatMap(word => word.split(/[\s,]+/u)).filter(Boolean))]
      .map(id => blockMoveKey({ relayCommand: { ...command, positionals: [command.positionals[0], id] } }));
  }
  const move = blockMoveKey(io);
  return move ? [move] : [];
}

/** Agent blocks belong to that checkout's seat; person and coordinator blocks belong to this board. */
export function blockOwner(audience, info) {
  return audience === 'agent' ? key({ audience, seat: info.root }) : audience;
}

/** Record only the matching completed move's clear, leaving later or unrelated blocks intact. */
export function clearCompletedBlocks(io, now = io.clock?.now?.() ?? new Date()) {
  let info;
  try { info = repoInfo(io.cwd); } catch { return; }
  const moveKeys = blockMoveKeys(io);
  if (!moveKeys.length) return;
  const owners = new Set([blockOwner('agent', info)]);
  if (info.isMain) owners.add('coordinator');
  try { requirePersonChannel(io.personChannel); owners.add('person'); } catch { /* An agent's success cannot clear a person's block. */ }
  try {
    const ids = readBlocks(info.commonDir).filter(block => block.id && (block.moveKeys ?? [block.moveKey]).some(move => moveKeys.includes(move))
      && owners.has(block.owner) && Date.parse(block.at) <= now.getTime()).map(block => block.id);
    if (!ids.length) return;
    appendFileSync(join(info.commonDir, BLOCKS_FILE), JSON.stringify({ kind: 'clear', at: now.toISOString(), ids, moveKeys }) + '\n');
  } catch (error) { io.err(`pullboard: the move completed, but its earlier block could not be cleared (${error.message})`); }
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
