/** Recognize Chrome-bearing process arguments in executable code, not generated fixture programs [C7,O5]. */
import { lex } from './js-lex.js';

const PROCESS_CALLS = new Set(['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork',
  'runFixtureChild', 'runFixtureChildAsync', 'startFixtureChild', 'Worker', 'SharedWorker',
  'runInContext', 'runInNewContext', 'runInThisContext', 'compileFunction', 'SourceTextModule', 'Script']);
const CHROME = /PULLBOARD_CHROME|google-chrome|Google Chrome|chromium|puppeteer|playwright/iu;
const WORD = /[$A-Z_a-z][$\w]*/gu;

/** Decode only character escapes for a conservative executable-name comparison; never evaluate source. */
function browserText(text) {
  const plain = text.replace(/\\u\{([\da-f]+)\}|\\u([\da-f]{4})|\\x([\da-f]{2})/giu,
    (whole, point, unicode, byte) => {
      const value = parseInt(point ?? unicode ?? byte, 16);
      return value <= 0x10ffff ? String.fromCodePoint(value) : whole;
    });
  return CHROME.test(plain);
}

/** Find the end of a balanced argument/expression span in lexer's offset-preserving executable code. */
function closing(code, start) {
  const pairs = new Map([['(', ')'], ['[', ']'], ['{', '}']]);
  const stack = [];
  for (let at = start; at < code.length; at += 1) {
    const char = code[at];
    if (pairs.has(char)) stack.push(pairs.get(char));
    else if (')]}'.includes(char)) {
      if (stack.pop() !== char) return null;
      if (!stack.length) return at;
    }
  }
  return null;
}

/** Static aliases remain process calls; unknown imports are still handled by admission's existing graph walk. */
function callNames(source, code) {
  const names = new Set(PROCESS_CALLS);
  // A quoted generated import can add a name here, but cannot create an executable call in `code`.
  for (const match of source.matchAll(/\bimport\s*\{([^}]+)\}\s*from\s*(['"])(?:node:(?:child_process|worker_threads|cluster|vm|module)|[^'"\n]*fixture-child\.js)\2/gu)) {
    for (const binding of match[1].split(',')) {
      const [original, alias] = binding.trim().split(/\s+as\s+/u);
      if (names.has(original) && alias) names.add(alias);
    }
  }
  for (const match of code.matchAll(/\b(?:const|let|var)\s+([$\w]+)\s*=\s*(?:[$\w]+\s*\.\s*)?([$\w]+)\s*[;,]/gu)) {
    if (names.has(match[2])) names.add(match[1]);
  }
  return names;
}

/**
 * Determine whether executable process calls can reach a Chrome argument. Local literal bindings are
 * followed conservatively, without scope-sensitive elimination. A program supplied to a real process
 * (including node -e or a shell) remains an argument, unlike a program merely written to a fixture file.
 * Template interpolations remain executable in lex.code. This is not an arbitrary JavaScript evaluator.
 *
 * @param {string} source
 * @returns {boolean}
 */
export function sourceLaunchesBrowser(source) {
  const { code, strings } = lex(source);
  const names = callNames(source, code);
  const bindings = new Map();
  /** A span's literals or executable environment references can name a browser. */
  const browserIn = (start, end) => CHROME.test(code.slice(start, end))
    || strings.some(string => string.start >= start && string.start < end && browserText(string.text));
  // Record initializer dependencies without assigning authority to a variable name or executing a getter.
  for (const match of code.matchAll(/\b(?:const|let|var)\s+([$\w]+)\s*=/gu)) {
    const start = match.index + match[0].length;
    let end = start;
    while (end < code.length && !';\n'.includes(code[end])) {
      if ('([{'.includes(code[end])) {
        const close = closing(code, end);
        if (close === null) return CHROME.test(source);
        end = close + 1;
      } else end += 1;
    }
    const prior = bindings.get(match[1]) ?? { browser: false, dependencies: new Set() };
    prior.browser ||= browserIn(start, end);
    for (const word of code.slice(start, end).matchAll(WORD)) prior.dependencies.add(word[0]);
    bindings.set(match[1], prior);
  }
  /** Follow only the finite local binding graph, retaining a possible browser through aliases. */
  function namedBrowser(name, seen = new Set()) {
    if (seen.has(name)) return false;
    seen.add(name);
    const binding = bindings.get(name);
    return Boolean(binding && (binding.browser || [...binding.dependencies].some(next => namedBrowser(next, seen))));
  }
  for (const match of code.matchAll(/(?<![\w$])([$A-Z_a-z][$\w]*)\s*(?:\?\.)?\s*\(/gu)) {
    if (!names.has(match[1])) continue;
    const start = match.index + match[0].length - 1;
    const end = closing(code, start);
    if (end === null) return CHROME.test(source);
    if (browserIn(start + 1, end)) return true;
    if ([...code.slice(start + 1, end).matchAll(WORD)].some(word => namedBrowser(word[0]))) return true;
  }
  // Computed/dynamic process access has no complete static call binding: keep Chrome-capable sources bound.
  if (/\b(?:getBuiltinModule|eval|Function)\s*\(|\b(?:process|require)\s*\[|\]\s*(?:\?\.)?\s*\(|\.\s*(?:call|apply|bind)\s*\(|\\u(?:[\da-f]{4}|\{[\da-f]+\})/iu.test(code)
      && CHROME.test(source)) return true;
  return false;
}
