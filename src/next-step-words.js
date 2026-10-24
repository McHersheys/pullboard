import { withMoveNextSteps } from './move-registry.js';
import { DEFAULT_NEXT_STEPS } from './next-step-defaults.js';
/** Pure refusal guidance shared by JSON and CLI output without loading ledger or Git [P4,W4,C7]. */
import { RECORDED_GENERIC_NEXT } from './recorded-refusal.js';

/** The coordinator carries every seat's request for a person decision [B26]. */
export const COORDINATOR_PERSON_REQUEST = 'ask the coordinator to bring it to the person: pullboard shout coordinator "<what is needed>" --decision';

/**
 * Route presentation-only person requests for a known seat; unknown callers retain existing text.
 * This does not change a refusal receipt, actor identity or permission to make the person's move.
 *
 * @param {string} step
 * @param {{ caller?: 'seat'|'coordinator'|'person'|'unknown' }} [options]
 * @returns {string}
 */
export function personRequestStep(step, { caller } = {}) {
  return caller === 'seat' && /\bask the person\b/iu.test(step) ? COORDINATOR_PERSON_REQUEST : step;
}

/** Keep quoted user text out of generated repair-clause rewriting. */
function quotedAt(text, at) {
  let quoted = false;
  let escaped = false;
  for (let index = 0; index < at; index += 1) {
    if (escaped) { escaped = false; continue; }
    if (text[index] === '\\') { escaped = true; continue; }
    if (text[index] === '"') quoted = !quoted;
  }
  return quoted;
}

/**
 * Present a generated person-request clause for a seat, keeping its reason and requested action.
 * Only the explanatory first line and an explicit final next footer are guidance; raw diagnostic
 * lines and quoted user text remain intact. Setup questions opt in to a leading imperative.
 *
 * @param {string} message
 * @param {{ caller?: 'seat'|'coordinator'|'person'|'unknown', leading?: boolean }} [options]
 * @returns {string}
 */
export function personRequestGuidance(message, { caller, leading = false } = {}) {
  if (caller !== 'seat') return message;
  const lines = String(message).split('\n');
  /** Route only an unquoted imperative, preserving clauses that explain the refusal. */
  const route = line => line.replace(/(^|[;.:]\s+|\b(?:or|and)\s+)ask the person(?=$|[\s:;])([^;\n]*)/giu,
    (whole, before, action, at) => {
      if ((!before && !leading) || quotedAt(line, at + before.length)) return whole;
      const request = action.trim().replace(/^:?\s*(?:to\s+|for\s+)?/iu, '');
      const needed = request.replace(/\bask the person(?:\s+to)?\s*/giu,
        (words, offset) => quotedAt(request, offset) ? words : '');
      return `${before}${COORDINATOR_PERSON_REQUEST}${needed ? ` (needed: ${needed})` : ''}`;
    });
  lines[0] = route(lines[0]);
  if (lines.length > 1 && /^next:[ \t]*\S/u.test(lines.at(-1))) lines[lines.length - 1] = route(lines.at(-1));
  return lines.join('\n');
}

/** @type {Readonly<Record<string, string>>} */
export const NEXT_STEPS = withMoveNextSteps(DEFAULT_NEXT_STEPS);

/**
 * Take the step a message already spells out: the clause from its first repair word to the end of
 * that line. One line only, so a multi-line report (a gate digest) is never repeated as the step.
 *
 * @param {string} message
 * @returns {string | undefined}
 */
function stepInMessage(message) {
  const line = String(message).split('\n')[0];
  const match = /(?:^|; |\. |: )((?:run|install|upgrade|fix|restore|commit|merge|test|check out|set|give|use|reject|ask your coordinator|answer from the main checkout|the coordinator(?= (?:runs?|sets?|restores?|either|must)\b)|to keep looking|never work around)\b.*)/i.exec(line);
  const step = match?.[1];
  // UNKNOWN_MOVE contains a documentation placeholder, not a supported reason value.
  return step && !/--reason\s+CODE\b/u.test(step) ? step : undefined;
}

/**
 * The next step for one refusal: its existing final next line, else the step its raise site passed,
 * else prose guidance or this code's row. Unknown remote codes name the service owner and rule.
 *
 * @param {{ code?: string, next?: string } | null | undefined} error
 * @param {string} message
 * @param {{ caller?: 'seat'|'coordinator'|'person'|'unknown' }} [options]
 * @returns {string}
 */
export function nextStepFor(error, message, options = {}) {
  if (personRequestGuidance(String(message), options) !== String(message)) return COORDINATOR_PERSON_REQUEST;
  const code = typeof error?.code === 'string' ? error.code : '';
  const finalStep = /(?:^|\r?\n)next:[ \t]*([^\r\n]*\S)[ \t]*(?:\r?\n)*$/u.exec(String(message))?.[1];
  if (finalStep) return personRequestStep(finalStep.trim(), options);
  if (typeof error?.next === 'string' && error.next.trim() && error.next.trim() !== RECORDED_GENERIC_NEXT) return personRequestStep(error.next.trim(), options);
  if (code === 'SPEC_BEHIND_MAIN') return NEXT_STEPS.SPEC_BEHIND_MAIN;
  return personRequestStep(stepInMessage(message) ?? NEXT_STEPS[code]
    ?? `ask the service owner about refusal code ${code || '(unknown)'}, including the displayed refusal`, options);
}

