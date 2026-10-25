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
 * The bounded string-literal spelling in one confirmed dynamic import, or null for executable expressions.
 * Decoding is deferred so all literals share one compile-only V8 batch.
 *
 * @param {string} source
 * @param {number} at
 * @returns {string | null}
 */
function dynamicLiteralAt(source, at) {
  const argument = pastGap(pastGap(source, at + 'import'.length), 1);
  const literal = /^(['"])(?:\\[\s\S]|(?!\1)[^\\\n\r])*\1/.exec(argument);
  if (!literal) return null;
  const after = pastGap(argument, literal[0].length)[0];
  return after === ')' || after === ',' ? literal[0] : null;
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
  const edges = sources.map((source, index) => {
    if (!looks[index].compiles) throw new Error('source does not compile as an ES module');
    const dynamic = calls[index].filter(() => {
      const isCode = !looks[next].compiles;
      const isCall = looks[next + 1].compiles;
      next += 2;
      return isCode && isCall;
    });
    return { imports: looks[index].imports, literals: dynamic.map(at => dynamicLiteralAt(source, at)) };
  });
  const literals = [...new Set(edges.flatMap(edge => edge.literals.filter(Boolean)))];
  const decoded = literals.length ? look(literals.map(literal => `import ${literal};`)) : [];
  const values = new Map(literals.map((literal, index) => [literal, decoded[index].imports[0] ?? COMPUTED]));
  return edges.map(edge => [...edge.imports, ...edge.literals.map(literal => values.get(literal) ?? COMPUTED)]);
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

/** Fail closed for executable module loading or code generation whose registrations are not statically known. */
function opaqueLoadingIn(sources) {
  const occurrences = sources.map(source => [
    ...[...source.matchAll(IMPORT)].filter(match => pastGap(source, match.index + match[0].length).startsWith('(')),
    ...source.matchAll(/(?<![\p{ID_Continue}$\u200c\u200d#])(?:eval|Function)(?![\p{ID_Continue}$\u200c\u200d])/gu),
  ].map(match => match.index));
  const variants = sources.flatMap((source, index) => occurrences[index].map(at =>
    source.slice(0, at) + '\u0000' + source.slice(at)));
  const parsed = look([...sources, ...variants]);
  let next = sources.length;
  return sources.map((source, index) => {
    let found = !parsed[index].compiles || parsed[index].imports.some(name => ['node:vm', 'vm', 'node:module', 'module'].includes(name));
    for (const _at of occurrences[index]) {
      if (!parsed[next].compiles) found = true;
      next += 1;
    }
    return found;
  });
}

/** Decode bounded quoted keys by compiling static imports; repository expressions are never evaluated. */
function quotedProperties(source) {
  const candidates = [];
  // Examine each quote independently: a quote in a regex or comment must not hide a later real key.
  for (const quote of source.matchAll(/["']/gu)) {
    const literal = /^(?:"(?:[^"\\]|\\[\s\S])*"|'(?:[^'\\]|\\[\s\S])*')/u.exec(source.slice(quote.index))?.[0];
    if (!literal) continue;
    let tail = pastGap(source, quote.index + literal.length);
    if (tail.startsWith(']')) tail = pastGap(tail, 1);
    if (!tail.startsWith(':')) continue;
    const at = source.length - tail.length + 1;
    const value = pastGap(source, at);
    const disabled = /^false\b/u.test(value) && /^[,}]/u.test(pastGap(value, 5));
    candidates.push({ quote: quote.index, literal, at, disabled });
  }
  const parsed = candidates.length ? look(candidates.map(({ literal }) => `import ${literal};`)) : [];
  return new Map(candidates.map((candidate, index) => [candidate.quote,
    { ...candidate, key: parsed[index].compiles ? parsed[index].imports[0] : undefined }]));
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

/** Only an explicit true cpuLoad option in a test registration declares CPU work [C7]. */
function explicitCpuLoad(source) {
  const lexical = lex(source);
  const code = lexical.code;
  const quoted = quotedProperties(source);
  const names = new Set(['test', 'it', 'describe']);
  const clean = source.split('');
  for (const { start, end } of lexical.comments) for (let at = start; at < end; at++) {
    if (!'\n\r'.includes(clean[at])) clean[at] = ' ';
  }
  const declarations = [...clean.join('').matchAll(/\bimport\s+([^;]*?)\s+from\s*((?:"(?:[^"\\]|\\[\s\S])*"|'(?:[^'\\]|\\[\s\S])*'))/gu)]
    .filter(match => code.slice(match.index, match.index + 6) === 'import');
  const modules = look(declarations.map(match => `import ${match[2]};`));
  for (const [index, match] of declarations.entries()) {
    if (!modules[index].imports.includes('node:test')) continue;
    const binding = match[1].trim();
    const defaultName = /^([A-Za-z_$][\w$]*)(?:\s*,|\s*$)/u.exec(lex(binding).code)?.[1];
    if (defaultName) names.add(defaultName);
    const named = /\{([\s\S]*)\}/u.exec(binding);
    for (const entry of named?.[1].split(',') ?? []) {
      const part = /^\s*(test|it|describe|suite|default)(?:\s+as\s+([A-Za-z_$][\w$]*))?\s*$/u.exec(entry);
      if (part) names.add(part[2] ?? part[1]);
    }
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const match of code.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$]*)\b/gu)) {
      if (names.has(match[2]) && !names.has(match[1])) { names.add(match[1]); changed = true; }
    }
  }
  for (const match of code.matchAll(/\b([A-Za-z_$][\w$]*)\s*(?:\.\s*(?:only|skip|todo)\s*)?\(/gu)) {
    if (!names.has(match[1])) continue;
    const open = match.index + match[0].lastIndexOf('(');
    const call = sourceParts(code, open + 1, ')');
    if (!call) continue;
    const args = call.parts.filter(([from, to]) => source.slice(from, to).trim());
    const named = /^(?:['"`])/u.test(source.slice(...(args[0] ?? [0, 0])).trim());
    const option = args[named ? 1 : 0];
    if (!option) continue;
    let [from, to] = option;
    while (/\s/u.test(code[from] ?? '') && from < to) from++;
    while (/\s/u.test(code[to - 1] ?? '') && to > from) to--;
    if (code[from] !== '{') continue;
    const object = sourceParts(code, from + 1, '}');
    if (!object || object.end !== to - 1) continue;
    for (const [start, end] of object.parts) {
      const property = pastGap(source.slice(start, end), 0);
      const key = /^(?:[A-Za-z_$][\w$]*|"(?:[^"\\]|\\[\s\S])*"|'(?:[^'\\]|\\[\s\S])*')/u.exec(property)?.[0];
      if (!key) continue;
      const decoded = /^["']/u.test(key) ? quoted.get(end - property.length)?.key : key;
      if (decoded !== 'cpuLoad') continue;
      const tail = pastGap(property, key.length);
      if (tail.startsWith(':') && /^true\s*$/u.test(pastGap(tail, 1))) return true;
    }
  }
  return false;
}

/** CPU work needs an explicit declaration; opaque ordinary test code grants no CPU authority [C7]. */
export function cpuLoadOptionsIn(sources) {
  return sources.map(source => explicitCpuLoad(source));
}
