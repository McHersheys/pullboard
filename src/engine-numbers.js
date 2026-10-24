/**
 * Engine numbers are given at landing, never picked by a builder (#1101).
 *
 * An item that adds a board move adds its own src/<name>-engine.js leaf as `export const NAME_ENGINE =
 * unassignedEngine();`. On its branch the leaf reads as the trunk's highest engine plus one, so its tests run; the
 * landing merge then writes the next number into the leaf, in landing order, inside the item's merge commit. Two
 * items can never take the same number and none waits on a stale one; a landed number never changes, so moves
 * recorded under it replay as they were written.
 */
import {
  existsSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import {
  ENGINE_CANDIDATE,
  ENGINE_FILE,
  discovered,
} from './discovery.js';

/** The one declaration a leaf holds: a landed number, or the placeholder a branch carries until it lands. */
export const ENGINE_LINE = /^export const ([A-Z][A-Z0-9_]*_ENGINE) = (?:(\d+)|unassignedEngine\(\));$/u;
/** The import a placeholder leaf needs, removed when the leaf gets its number. */
export const UNASSIGNED_IMPORT = "import { unassignedEngine } from './engine-next.js';";

/**
 * Read every engine leaf in a directory.
 *
 * @param {string} directory
 * @returns {{ file: string, name: string, number: number | null }[]} By file name; `number` is null until it lands.
 */
export function readEngineLeaves(directory) {
  return discovered(readdirSync(directory), ENGINE_CANDIDATE, ENGINE_FILE, 'feature engine').map((file) => {
    const lines = readFileSync(join(directory, file), 'utf8').split('\n').filter((line) => /^export const /u.test(line));
    const match = lines.length === 1 ? ENGINE_LINE.exec(lines[0]) : null;
    if (!match) throw new Error(`${file} must declare exactly one line \`export const NAME_ENGINE = <number>;\`, or \`= unassignedEngine();\` until it lands, so ENGINE_VERSION can read it`);
    return { file, name: match[1], number: match[2] === undefined ? null : Number(match[2]) };
  });
}

/**
 * The number an unlanded leaf reads as: one above the highest landed number.
 *
 * @param {{ number: number | null }[]} leaves
 * @returns {number}
 */
export function nextEngineNumber(leaves) {
  return Math.max(0, ...leaves.map((leaf) => leaf.number ?? 0)) + 1;
}

/**
 * Give each unlanded leaf under `root`/src its number, next above the landed ones in file-name order, and keep the
 * documented move engine in docs/formats.md equal to the result. A tree with no unlanded leaf is left untouched.
 *
 * @param {string} root
 * @returns {{ files: string[], assigned: { name: string, number: number }[] }} The changed paths, relative to root.
 */
export function assignEngineNumbers(root) {
  const directory = join(root, 'src');
  if (!existsSync(directory)) return { files: [], assigned: [] };
  const leaves = readEngineLeaves(directory);
  const unlanded = leaves.filter((leaf) => leaf.number === null);
  if (!unlanded.length) return { files: [], assigned: [] };
  let next = nextEngineNumber(leaves) - 1;
  const files = [];
  const assigned = [];
  for (const leaf of unlanded) {
    next += 1;
    const path = join(directory, leaf.file);
    const text = readFileSync(path, 'utf8').split('\n').filter((line) => line !== UNASSIGNED_IMPORT).join('\n')
      .replace(/^(export const [A-Z][A-Z0-9_]*_ENGINE = )unassignedEngine\(\);$/mu, `$1${next};`);
    writeFileSync(path, text);
    files.push(`src/${leaf.file}`);
    assigned.push({ name: leaf.name, number: next });
  }
  const formats = join(root, 'docs', 'formats.md');
  if (existsSync(formats)) {
    const text = readFileSync(formats, 'utf8');
    const updated = text.replace(/^(\| `move engine` \| `)\d+(` \|)/mu, `$1${next}$2`);
    if (updated !== text) { writeFileSync(formats, updated); files.push('docs/formats.md'); }
  }
  return { files, assigned };
}
