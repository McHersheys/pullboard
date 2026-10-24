/** Durable first-refusal windows for reopened work [B13,B5]. */
import { Refused } from './refused.js';

/** Read the latest return's window, ignoring review releases and earlier submissions. */
export function firstRefusal(board, id, at = board.clock.now()) {
  const history = board.db.prepare("SELECT event_kind, event_detail, event_by FROM event WHERE item_id = ? AND event_kind IN ('reject', 'reopen', 'submit', 'release') ORDER BY event_id DESC").all(id);
  const releases = [];
  for (const event of history) {
    const detail = JSON.parse(event.event_detail);
    if (event.event_kind === 'release') { releases.push(event); continue; }
    if (event.event_kind === 'submit') return null;
    const window = detail.reopenFirstRefusal;
    if (!window || !window.builder || !Number.isFinite(Date.parse(window.until))) return null;
    if (releases.some(release => release.event_by === window.builder && JSON.parse(release.event_detail).review !== true)) return null;
    return at.getTime() < Date.parse(window.until) ? window : null;
  }
  return null;
}

/** Give the original builder first refusal while preserving every ordinary claim guard. */
export function firstRefusalProblem(board, id, agentId) {
  const reason = firstRefusalReason(board, id, agentId);
  return reason ? new Refused('REOPEN_HELD_FOR_BUILDER', reason) : null;
}

/** Explain ineligible build work without raising an item refusal from review selection. */
export function firstRefusalReason(board, id, agentId) {
  const window = firstRefusal(board, id);
  return window && window.builder !== agentId
    ? `item #${id} waits for ${window.builder} until ${window.until}; claim it after that time, or ask its builder to release it`
    : null;
}

/** Freeze an enabled reservation into the return event so replicas need no local configuration. */
export function firstRefusalDetail(board, item, minutes, at) {
  if (minutes === undefined || minutes === 0 || !item.item_built_by) return {};
  const until = (at ?? board.clock.now()).getTime() + minutes * 60_000;
  if (!Number.isSafeInteger(minutes) || minutes < 0 || !Number.isFinite(until) || Math.abs(until) > 8_640_000_000_000_000) {
    throw new Refused('BAD_CONFIG', 'claim.reopenFirstRefusalMinutes must be a non-negative whole number within the supported date range; set it to 0 to disable');
  }
  return { reopenFirstRefusal: { builder: item.item_built_by, until: new Date(until).toISOString() } };
}

/** Record one notice in the same transaction as the return and its frozen window. */
export function tellFirstRefusal(board, item, detail, persistShout) {
  const window = detail.reopenFirstRefusal;
  if (window) persistShout(board, { from: 'coordinator', to: window.builder,
    text: `Item #${item.item_id} waits for you until ${window.until}; claim it to resume, or run pullboard release ${item.item_id} to let another builder take it.` });
}

/** Copy only enabled coordinator policy into ordered moves before they are sealed for replay. */
export function firstRefusalArgs(operation, args, config) {
  const minutes = config.claim?.reopenFirstRefusalMinutes;
  if (!minutes || !['verify', 'reopen'].includes(operation)) return args;
  if (operation === 'verify' && args[1]?.decision !== 'REJECT') return args;
  return [args[0], { ...args[1], reopenFirstRefusalMinutes: minutes }, ...args.slice(2)];
}

/** Whether a manual landing note quotes a semicolon-delimited test name, including malformed attempts. */
export function manualLandingFailureQuoted(note) {
  if (typeof note !== 'string') return false;
  const generatedPrefix = /^Landing batch [a-z0-9_-]{1,80} failed /iu.exec(note);
  if (generatedPrefix) return false;
  const opening = /(?:^|;[ \t]*)(?:[\w.-]+\/)*[\w.-]+\.[a-z0-9]+:[ \t]*"/giu;
  for (const match of note.matchAll(opening)) {
    let escaped = false;
    let containsSeparator = false;
    for (let index = match.index + match[0].length; index < note.length; index += 1) {
      const character = note[index];
      if (character === ';') containsSeparator = true;
      if (character === '\r' || character === '\n') break;
      if (escaped) { escaped = false; continue; }
      if (character === '\\') { escaped = true; continue; }
      if (character === '"') break;
    }
    if (containsSeparator) return true;
  }
  return false;
}

/** Read a quoted test name and its end offset, refusing malformed escapes or multiline text. */
function quotedLandingTestName(text, start) {
  let escaped = false;
  for (let index = start + 1; index < text.length; index += 1) {
    const character = text[index];
    if (character === '\r' || character === '\n') return null;
    if (escaped) { escaped = false; continue; }
    if (character === '\\') { escaped = true; continue; }
    if (character !== '"') continue;
    let name;
    try { name = JSON.parse(text.slice(start, index + 1)); }
    catch { return null; }
    if (typeof name !== 'string' || !name.trim() || /[\r\n]/u.test(name)) return null;
    return { name, end: index + 1 };
  }
  return null;
}

/** Parse the manual failure list when its sealed move declares quoted names. */
function quotedManualLandingFailure(failureText, mergeCommit) {
  const tests = [];
  let offset = 0;
  while (offset < failureText.length) {
    const entry = /^(?<file>(?:[\w.-]+\/)*[\w.-]+\.[a-z0-9]+):[ \t]*/iu.exec(failureText.slice(offset));
    if (!entry) return null;
    offset += entry[0].length;
    let name;
    if (failureText[offset] === '"') {
      const quoted = quotedLandingTestName(failureText, offset);
      if (!quoted) return null;
      name = quoted.name;
      offset = quoted.end;
      while (failureText[offset] === ' ' || failureText[offset] === '\t') offset += 1;
    } else {
      const separator = failureText.indexOf(';', offset);
      const end = separator < 0 ? failureText.length : separator;
      name = failureText.slice(offset, end).trim();
      offset = end;
    }
    if (!name.trim() || /[\r\n]/u.test(name)) return null;
    tests.push({ file: entry.groups.file, name });
    if (offset === failureText.length) break;
    if (failureText[offset] !== ';') return null;
    offset += 1;
    while (failureText[offset] === ' ' || failureText[offset] === '\t') offset += 1;
    if (offset === failureText.length) return null;
  }
  return tests.length ? { tests, mergeCommit } : null;
}

/** Read test and merge-commit evidence from a hand-written landing note without checking Git. */
export function manualLandingFailure(note, { quoted = false } = {}) {
  const generatedPrefix = /^Landing batch [a-z0-9_-]{1,80} failed /iu.exec(note);
  const body = generatedPrefix ? note.slice(generatedPrefix[0].length) : note;
  const evidence = body.match(/;[ \t]*merge commit[ \t]+(?<mergeCommit>[a-f0-9]{40}|[a-f0-9]{64})$/iu);
  if (!evidence) return null;
  const failureText = body.slice(0, evidence.index);
  if (quoted) return quotedManualLandingFailure(failureText, evidence.groups.mergeCommit);
  const firstTest = /(?<file>(?:[\w.-]+\/)*[\w.-]+\.[a-z0-9]+):[ \t]*/iu.exec(failureText);
  if (!firstTest) return null;
  const tests = failureText.slice(firstTest.index).split(/;[ \t]*/u).map((entry) => {
    const test = entry.match(/^(?<file>(?:[\w.-]+\/)*[\w.-]+\.[a-z0-9]+):[ \t]*(?<name>[^;\r\n]+)$/iu);
    if (!test || !test.groups.name.trim()) return null;
    return { file: test.groups.file, name: test.groups.name.trim() };
  });
  if (!tests.length || tests.some((test) => !test)) return null;
  return { tests, mergeCommit: evidence.groups.mergeCommit };
}

