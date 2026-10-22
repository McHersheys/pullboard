/**
 * Shared parts of Pullboard's Rigor checks [D1,C7]: the file walk, a small JavaScript lexer and the
 * report. Each check prints one line per problem as `path:line: text`, sorted by path and line, and
 * exits 0 with no problems or 1 with some, so a doctrine row's `gate: check` can count it and blame
 * a changed file by the repo path at the start of each line.
 *
 * The walk starts at the directory given as the first argument, or the working directory, and skips
 * node_modules, work and every directory whose name starts with a dot (.git among them). Paths are
 * repo-relative with forward slashes, and nothing depends on the order the file system lists them.
 */
import { readdirSync, readFileSync, realpathSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const SKIPPED = new Set(['node_modules', 'work']);

/**
 * Every file under the root whose repo-relative path matches `pattern`, sorted.
 *
 * @param {string} root
 * @param {RegExp} pattern
 * @returns {string[]}
 */
export function walk(root, pattern) {
  const found = [];
  const pending = [resolve(root)];
  while (pending.length) {
    const directory = pending.pop();
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!SKIPPED.has(entry.name) && !entry.name.startsWith('.')) pending.push(path);
        continue;
      }
      if (!entry.isFile()) continue;
      const name = relative(root, path).split(sep).join('/');
      if (pattern.test(name)) found.push(name);
    }
  }
  return found.sort(byText);
}

/** Compare by UTF-16 code units, so the order never depends on the machine's locale. */
function byText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * Read one walked file as text.
 *
 * @param {string} root
 * @param {string} path - repo-relative
 * @returns {string}
 */
export function readText(root, path) {
  return readFileSync(join(root, path), 'utf8');
}

/** The root a check scans: its first argument, else the working directory. */
export function rootOf(argv = process.argv) {
  return resolve(argv[2] ?? process.cwd());
}

/**
 * Run a check and report when its file is the program Node started; importing it runs nothing.
 * Why: the test imports each check, so the affected-test selection sees an import edge to it.
 *
 * @param {ImportMeta} meta - the check's `import.meta`
 * @param {(root: string) => { path: string, line: number, text: string }[]} find
 */
export function runCheck(meta, find) {
  // Node resolves symlinks in a module's URL but not in argv, so compare real paths.
  if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(meta.url))) report(find(rootOf()));
}

/**
 * Print problems sorted by path, then line number, then text, and set the exit status: 0 with no
 * problems, 1 with some. One line each, as `path:line: text`.
 *
 * @param {{ path: string, line: number, text: string }[]} problems
 */
export function report(problems) {
  const sorted = [...problems].sort((a, b) => byText(a.path, b.path) || a.line - b.line || byText(a.text, b.text));
  if (sorted.length) process.stdout.write(sorted.map((problem) => `${problem.path}:${problem.line}: ${problem.text}\n`).join(''));
  process.exitCode = sorted.length ? 1 : 0;
}

export {
  lex,
  lineAt,
} from '../../src/js-lex.js';

/** A test file, as the affected-test selection names one: `*.test.js` or `*.spec.js`, also .mjs and .cjs. */
export const TEST_FILE = /\.(?:test|spec)\.[cm]?js$/u;
