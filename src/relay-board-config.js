/** pullboard.json names the repository's linked board, so every clone finds it [E12]. */
import { isDeepStrictEqual } from 'node:util';
import {
  existsSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import {
  CONFIG_FILE,
  loadConfig,
} from './config.js';

/** The board id this checkout's pullboard.json names, or null. */
export function namedBoard(root) {
  if (!existsSync(join(root, CONFIG_FILE))) return null;
  return loadConfig(root).relay?.board ?? null;
}

/**
 * Write the linked board's id into pullboard.json as "relay": { "board": ... }. The edit is textual, so the person's
 * layout survives; if the text is laid out in a way the edit cannot follow, the file is written out plainly instead.
 */
export function writeNamedBoard(root, board) {
  const file = join(root, CONFIG_FILE);
  if (!existsSync(file)) return false;
  const text = readFileSync(file, 'utf8');
  const value = JSON.parse(text);
  if (value.relay?.board === board) return false;
  const expected = { ...value, relay: { ...(value.relay ?? {}), board } };
  const entry = `"board": ${JSON.stringify(board)}`;
  const edited = value.relay === undefined
    ? text.replace(/^\{(\s*)/u, (_, gap) => `{${gap || '\n  '}"relay": { ${entry} },${gap || '\n  '}`)
    : value.relay.board === undefined
      ? text.replace(/("relay"\s*:\s*\{)(\s*)/u, (_, open, gap) => `${open}${gap || ' '}${entry}${Object.keys(value.relay).length ? ',' : ''}${gap || ' '}`)
      : text.replace(/("relay"\s*:\s*\{[^{}]*"board"\s*:\s*)"[0-9a-f]{32}"/u, (_, head) => head + JSON.stringify(board));
  let parsed;
  try { parsed = JSON.parse(edited); } catch { parsed = undefined; }
  writeFileSync(file, isDeepStrictEqual(parsed, expected) ? edited : JSON.stringify(expected, null, 2) + '\n');
  return true;
}
