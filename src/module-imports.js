/** Parse import edges without evaluating repository code, using V8 rather than a JavaScript grammar guess [V4,C7]. */
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { lex } from './js-lex.js';

/**
 * A child Node that compiles each source in its private input file as an ES module and reports, for each, whether
 * it compiles and the modules it imports statically, as V8 lists them.
 */
const PARSER = [
  "import vm from 'node:vm';",
  "import { readFileSync } from 'node:fs';",
  "const sources = JSON.parse(readFileSync(process.argv[1], 'utf8'));",
  '/** Compile one source without executing repository code. */',
  'const look = (source) => {',
  '  try {',
  '    const module = new vm.SourceTextModule(source);',
  '    return { compiles: true, imports: module.moduleRequests ? module.moduleRequests.map((request) => request.specifier) : module.dependencySpecifiers };',
  '  } catch {',
  '    return { compiles: false, imports: [] };',
  '  }',
  '};',
  'process.stdout.write(JSON.stringify(sources.map(look)));',
].join('\n');

/**
 * What V8 makes of each source, all in one child process.
 *
 * @param {string[]} sources
 * @returns {{ compiles: boolean, imports: string[] }[]}
 */
function look(sources) {
  // The package parser has an observed stdin/EOF hang. Use a private regular file and bound V8 too.
  const directory = mkdtempSync(join(tmpdir(), 'pullboard-imports-'));
  const input = join(directory, 'sources.json');
  try {
    writeFileSync(input, JSON.stringify(sources), { mode: 0o600 });
    const child = spawnSync(process.execPath, ['--experimental-vm-modules', '--disable-warning=ExperimentalWarning', '--input-type=module', '-e', PARSER, input], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 2 ** 26, timeout: 10_000, killSignal: 'SIGKILL',
    });
    if (child.status !== 0) throw new Error('V8 import parser failed: ' + (child.error?.message ?? child.stderr));
    return JSON.parse(child.stdout);
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

/** Every place the whole word import appears, in code or not; Unicode letters count as part of a word. */
const IMPORT = /(?<![\p{ID_Continue}$\u200c\u200d#])import(?![\p{ID_Continue}$\u200c\u200d])/gu;
/** CommonJS loader words, matched with the same identifier boundaries as import. */
const COMMON_JS = /(?<![\p{ID_Continue}$\u200c\u200d#])(?:require|createRequire)(?![\p{ID_Continue}$\u200c\u200d])/gu;
/** Unicode escapes can spell any identifier character, so V8 probes them without decoding source. */
const UNICODE_ESCAPE = /\\u(?:[\da-fA-F]{4}|\{[\da-fA-F]{1,6}\})/gu;

/** Whitespace and comments, which may sit between import, its parenthesis and its argument. A line comment ends at any line terminator. */
const GAP = /^(?:\s|\/\/[^\n\r\u2028\u2029]*|\/\*[\s\S]*?\*\/)*/;

/** What a dynamic import of anything but a plain string loads: unknown, so never node: or relative. */
const COMPUTED = '(computed)';

/**
 * The text from `at` on, past whitespace and comments.
 *
 * @param {string} source
 * @param {number} at
 * @returns {string}
 */
function pastGap(source, at) {
  const rest = source.slice(at);
  return rest.slice(GAP.exec(rest)[0].length);
}

/**
 * What an import(...) call at `at` loads: its argument when that is one plain string, decoded, or
 * COMPUTED for anything else, a string whose escapes do not decode included. Only called on words
 * V8 has confirmed are import calls in code.
 *
 * @param {string} source
 * @param {number} at
 * @returns {string}
 */
function dynamicAt(source, at) {
  const argument = pastGap(pastGap(source, at + 'import'.length), 1);
  const literal = /^(['"])(?:\\[\s\S]|(?!\1)[^\\\n\r])*\1/.exec(argument);
  if (!literal) return COMPUTED;
  const after = pastGap(argument, literal[0].length)[0];
  if (after !== ')' && after !== ',') return COMPUTED;
  try {
    return new Function(`return ${literal[0]};`)();
  } catch {
    return COMPUTED;
  }
}

/**
 * Every module each source imports. V8 lists the static ones: import and export-from statements and
 * side-effect imports. For each import followed by a parenthesis, V8 also decides two things: a NUL
 * put before the word breaks the module only when the word is code, not text in a string, template,
 * comment or regular expression; and putting 1 in its place still compiles only when the word is a
 * call, not a property name after a dot. Only then is the argument read, and an argument that is not
 * one plain string is reported as COMPUTED, which no rule allows. A method named import, in a class
 * or object, still reads as a call: the scan errs toward a false alarm, never a miss.
 *
 * @param {string[]} sources - Each one a module that compiles.
 * @returns {string[][]}
 */
export function importsIn(sources) {
  const calls = sources.map((source) => [...source.matchAll(IMPORT)].map((match) => match.index).filter((at) => pastGap(source, at + 'import'.length)[0] === '('));
  const variants = sources.flatMap((source, index) =>
    calls[index].flatMap((at) => [`${source.slice(0, at)}\u0000${source.slice(at)}`, `${source.slice(0, at)}1${source.slice(at + 'import'.length)}`]),
  );
  const looks = look([...sources, ...variants]);
  let next = sources.length;
  return sources.map((source, index) => {
    if (!looks[index].compiles) throw new Error('source does not compile as an ES module');
    const dynamic = calls[index].filter(() => {
      const isCode = !looks[next].compiles;
      const isCall = looks[next + 1].compiles;
      next += 2;
      return isCode && isCall;
    });
    return [...looks[index].imports, ...dynamic.map((at) => dynamicAt(source, at))];
  });
}

/** Detect actual CommonJS loader words without executing source; invalid modules are conservatively unknown.
 *
 * @param {string[]} sources
 * @returns {boolean[]}
 */
export function commonJsIn(sources) {
  const occurrences = sources.map((source) => [...new Set([
    ...[...source.matchAll(COMMON_JS)].map((match) => match.index),
    ...[...source.matchAll(UNICODE_ESCAPE)].map((match) => match.index),
  ])]);
  const variants = sources.flatMap((source, index) =>
    occurrences[index].map((at) => {
      // Poison after an escape: before a range endpoint, NUL can invalidate a harmless regex range.
      const escaped = /^\\u(?:[\da-fA-F]{4}|\{[\da-fA-F]{1,6}\})/u.exec(source.slice(at));
      const cut = at + (escaped?.[0].length ?? 0);
      return `${source.slice(0, cut)}\u0000${source.slice(cut)}`;
    }),
  );
  const looks = look([...sources, ...variants]);
  let next = sources.length;
  return sources.map((source, index) => {
    if (!looks[index].compiles) return true;
    let found = false;
    for (const _at of occurrences[index]) {
      if (!looks[next].compiles) found = true;
      next += 1;
    }
    return found;
  });
}

/** Decode only a bounded quoted property literal, using the same literal-only grammar as dynamicAt. */
function quotedCpuOptions(source) {
  const points = [];
  // Examine each quote independently: a quote in a regex or comment must not hide a later real key.
  for (const quote of source.matchAll(/["']/gu)) {
    const literal = /^(?:"(?:[^"\\]|\\[\s\S])*"|'(?:[^'\\]|\\[\s\S])*')/u.exec(source.slice(quote.index))?.[0];
    if (!literal) continue;
    let tail = pastGap(source, quote.index + literal.length);
    if (tail.startsWith(']')) tail = pastGap(tail, 1);
    if (!tail.startsWith(':')) continue;
    let key;
    try { key = new Function(`return ${literal};`)(); }
    catch { continue; } // Invalid literals are covered by the whole-module compile failure below.
    if (key !== 'cpuLoad') continue;
    const at = source.length - tail.length + 1;
    const value = pastGap(source, at);
    const disabled = /^false\b/u.test(value) && /^[,}]/u.test(pastGap(value, 5));
    points.push({ at, disabled });
  }
  return points;
}

/** Split an executable argument/property list using balanced delimiters, never executing expressions. */
function sourceParts(code, start, closing) {
  const parts = [];
  let begin = start;
  const stack = [];
  for (let at = start; at < code.length; at++) {
    const char = code[at];
    if (!stack.length && char === closing) { parts.push([begin, at]); return { parts, end: at }; }
    if (!stack.length && char === ',') { parts.push([begin, at]); begin = at + 1; }
    else if ('([{'.includes(char)) stack.push({ '(': ')', '[': ']', '{': '}' }[char]);
    else if (')]}'.includes(char)) {
      if (stack.pop() !== char) return null;
    }
  }
  return null;
}

/** Only a directly written object with readable property names proves that no opaque option hides load. */
function opaqueOptions(source, code, from, to) {
  while (/\s/u.test(code[from] ?? '') && from < to) from++;
  while (/\s/u.test(code[to - 1] ?? '') && to > from) to--;
  if (code[from] !== '{') return true;
  const object = sourceParts(code, from + 1, '}');
  if (!object || object.end !== to - 1) return true;
  for (const [start, end] of object.parts) {
    const property = pastGap(source.slice(start, end), 0);
    if (!property) continue;
    // Computed keys, spreads and prototype inputs cannot be resolved without running code.
    if (property.startsWith('[') || property.startsWith('...') || /^(?:__proto__\b|"__proto__"|'__proto__')/u.test(property)) return true;
    if (!/^(?:[A-Za-z_$][\w$]*|"(?:[^"\\]|\\[\s\S])*"|'(?:[^'\\]|\\[\s\S])*')/u.test(property)) return true;
  }
  return false;
}

/** Recognize callback syntax only; an opaque function-producing expression can instead be options. */
function callbackSource(source) {
  const value = pastGap(source, 0);
  return /^(?:async\s+)?function\b/u.test(value)
    || /^(?:async\s+)?(?:[A-Za-z_$][\w$]*|\([^]*?\))\s*=>/u.test(value);
}

/** Unknown test option expressions are declarations under the conservative placement contract. */
function unreadableTestOptions(source) {
  const code = lex(source).code;
  const names = new Set(['test', 'it', 'describe']);
  for (const match of source.matchAll(/\bimport\s+([^;'"]+?)\s+from\s*(['"])node:test\2/gu)) {
    const bindings = match[1].replace(/[{}*]/gu, ' ').split(',');
    for (const binding of bindings) {
      const name = binding.trim().split(/\s+as\s+/u).at(-1)?.trim();
      if (/^[A-Za-z_$][\w$]*$/u.test(name ?? '')) names.add(name);
    }
  }
  // A direct alias retains the same conservative rule, including renamed imported test functions.
  let changed = true;
  while (changed) {
    changed = false;
    for (const match of code.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$]*)\b/gu)) {
      if (names.has(match[2]) && !names.has(match[1])) { names.add(match[1]); changed = true; }
    }
  }
  const imports = [...source.matchAll(/\bimport\s+(?:[A-Za-z_$][\w$]*\s*,?\s*)?(?:\{[^}]*\}|\*\s+as\s+[A-Za-z_$][\w$]*)?\s*from\s*(['"])[^'"]+\1/gu)]
    .map(match => [match.index, match.index + match[0].length]);
  for (const word of code.matchAll(/\b[A-Za-z_$][\w$]*\b/gu)) {
    if (!names.has(word[0]) || imports.some(([from, to]) => word.index >= from && word.index < to)) continue;
    const tail = pastGap(source, word.index + word[0].length);
    if (!/^(?:\(|\.\s*(?:only|skip|todo)\s*\()/u.test(tail)) return true;
  }
  for (const match of code.matchAll(/\b([A-Za-z_$][\w$]*)\s*(?:\.\s*(?:only|skip|todo)\s*)?\(/gu)) {
    if (!names.has(match[1])) continue;
    const open = match.index + match[0].lastIndexOf('(');
    const call = sourceParts(code, open + 1, ')');
    if (!call) return true;
    const args = call.parts.filter(([from, to]) => code.slice(from, to).trim());
    if (!args.length) continue;
    const [first, second] = args;
    const firstText = source.slice(...first).trim();
    const named = /^(?:['"`])/u.test(firstText);
    if (named && args.length === 1 || !named && args.length === 1 && callbackSource(firstText)) continue;
    if (named && args.length === 2 && callbackSource(source.slice(...second))) continue;
    const options = named ? second : first;
    if (!options || opaqueOptions(source, code, ...options)) return true;
  }
  return false;
}

/** Find CPU-load options without evaluating a test module; unknown identifier values require runner admission. */
export function cpuLoadOptionsIn(sources) {
  const occurrences = sources.map(source => [
    ...source.matchAll(/(?:\bcpuLoad\b|["']cpuLoad["'])/gu), ...source.matchAll(UNICODE_ESCAPE),
  ].flatMap(match => {
    const end = match.index + match[0].length;
    let tail = pastGap(source, end);
    const quoted = /^["']/u.test(match[0]);
    if (quoted && tail.startsWith(']')) tail = pastGap(tail, 1);
    const property = tail.startsWith(':');
    if (quoted && !property) return [];
    const at = property ? source.length - tail.length + 1 : end;
    const value = property ? pastGap(source, at) : '';
    const disabled = property && /^false\b/u.test(value) && /^[,}]/u.test(pastGap(value, 5));
    return [{ at, disabled }];
  }).concat(quotedCpuOptions(source)));
  const variants = sources.flatMap((source, index) => occurrences[index].map(({ at }) =>
    source.slice(0, at) + '\u0000' + source.slice(at)));
  const parsed = look([...sources, ...variants]);
  let next = sources.length;
  return sources.map((source, index) => {
    let found = !parsed[index].compiles || unreadableTestOptions(source);
    for (const { disabled } of occurrences[index]) {
      if (!parsed[next].compiles && !disabled) found = true;
      next += 1;
    }
    return found;
  });
}
