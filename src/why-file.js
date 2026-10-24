/**
 * The decisions, rows and items behind a file or a line, from the commits that landed on it [N29].
 *
 * A commit pins its item with a `Pullboard-Item: #N` trailer; the items it names carry the rows they
 * serve and the answered decisions that imply them. One query over Git history and the board.
 */
import { tryGit } from './git.js';
import { Refused } from './refused.js';
import { decisionsBehind } from './decision-origin.js';

/**
 * Split `path` or `path:line` into the file and an optional line.
 *
 * @param {string} target
 * @returns {{ file: string, line: number | null }}
 */
export function parseFileTarget(target) {
  const match = /^(.+?):([1-9]\d*)$/u.exec(target);
  return match ? { file: match[1], line: Number(match[2]) } : { file: target, line: null };
}

/**
 * The item ids named by the landed commits that touched a file or line, oldest first.
 *
 * @param {string} root the repository root
 * @param {{ file: string, line: number | null }} target
 * @returns {number[]}
 */
export function itemsTouching(root, { file, line }) {
  const range = line === null ? ['--', file] : [`-L${line},${line}:${file}`, '-s'];
  const log = tryGit(root, ['log', '--reverse', '--format=%x01%B', ...range]);
  if (log.status !== 0) {
    if (line !== null && /no such path|file .* has only|there is no path/iu.test(log.stderr)) return [];
    if (/does not have any commits|unknown revision|bad revision|ambiguous argument/iu.test(log.stderr)) return [];
    throw new Refused('WHY_GIT', `git could not read the history of ${file}: ${log.stderr.split('\n')[0]}`);
  }
  const ids = [];
  for (const body of log.stdout.split('\x01')) {
    for (const match of body.matchAll(/^Pullboard-Item:\s*#(\d+)\s*$/gmu)) ids.push(Number(match[1]));
  }
  return [...new Set(ids)];
}

/**
 * Everything behind a file or line: its items, the rows they serve and the decisions that imply them.
 *
 * @param {any} board
 * @param {string} root
 * @param {string} target `path` or `path:line`
 * @returns {{ file: string, line: number | null, items: object[], rows: object[], decisions: object[] }}
 */
export function whyFile(board, root, target) {
  const parsed = parseFileTarget(target);
  const ids = itemsTouching(root, parsed);
  const found = ids.map((id) => board.db.prepare('SELECT item_id, item_title, item_status, item_spec_ids FROM item WHERE item_id = ?').get(id)).filter(Boolean);
  const items = found.map((item) => ({ id: item.item_id, title: item.item_title, status: item.item_status }));
  const rows = [...new Set(found.flatMap((item) => item.item_spec_ids.split(',').filter(Boolean)))]
    .map((id) => ({ id, items: found.filter((item) => item.item_spec_ids.split(',').includes(id)).map((item) => item.item_id) }));
  return { file: parsed.file, line: parsed.line, items, rows, decisions: decisionsBehind(board, items.map((item) => item.id)) };
}
