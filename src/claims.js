import { takeoverReady } from './line-capacity.js';
/** Durable first-refusal windows for reopened work [B13,B5]. */
import { Refused } from './refused.js';

import { firstRefusal } from './first-refusal-window.js';
export { firstRefusal };

/** Give the original builder first refusal while preserving every ordinary claim guard. */
export function firstRefusalProblem(board, id, agentId) {
  const reason = firstRefusalReason(board, id, agentId);
  return reason ? new Refused('REOPEN_HELD_FOR_BUILDER', reason) : null;
}

/** Explain ineligible build work without raising an item refusal from review selection. */
export function firstRefusalReason(board, id, agentId) {
  const window = firstRefusal(board, id);
  return window && window.builder !== agentId && !takeoverReady(board, id)
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

/** Read test and merge-commit evidence from a hand-written landing note without checking Git. */
export function manualLandingFailure(note) {
  const generatedPrefix = /^Landing batch [a-z0-9_-]{1,80} failed /iu.exec(note);
  const body = generatedPrefix ? note.slice(generatedPrefix[0].length) : note;
  const evidence = body.match(/;[ \t]*merge commit[ \t]+(?<mergeCommit>[a-f0-9]{40}|[a-f0-9]{64})$/iu);
  if (!evidence) return null;
  const failureText = body.slice(0, evidence.index);
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

