/** Compare sealed actors with the relay's independently authenticated sender [H2,H16,B26]. */
import { VERIFIER_STANDING_ENGINE } from './machine.js';
import { Refused } from './refused.js';

/** Read only the actor field used by each public engine operation; unknown operations fail closed. */
export function relayMoveActor(move) {
  const args = move?.args;
  if (!Array.isArray(args)) return null;
  if (move.operation === 'register' && move.engine >= VERIFIER_STANDING_ENGINE) return args[0]?.createdBy === 'machine' ? null : args[0]?.createdBy ?? null;
  if (move.operation === 'intakeOutside') return args[0]?.agentId ?? null;
  if (move.operation === 'approveOutside') return args[1]?.agentId ?? null;
  if (move.operation === 'addItem') return args[0]?.by ?? null;
  if (move.operation === 'shout') return args[0]?.from ?? null;
  if (['proposeSentinel', 'decideSentinel', 'beginSentinelRun', 'finishSentinelRun'].includes(move.operation)) return args[0]?.agentId ?? null;
  if (['openHandoff', 'takeHandoff', 'setLineSetting', 'setBarReady', 'recordHealthFindings', 'recordFlakeObservation', 'recordGateRun', 'declareJob', 'recordJobRun', 'takeCoordinator', 'landingLeaseMove', 'setPersonSigning', 'proposePersonMove', 'recordPublishFinding'].includes(move.operation)) return args[0]?.agentId ?? null;
  if (['holdLane', 'releaseLane'].includes(move.operation) && args[1]?.asPerson) return 'person';
  if (move.operation === 'release') return args[1] ?? null;
  if (['reserveNextReview', 'addMilestone', 'recordRowDecisions', 'applyRowDecisions', 'draftSpecRow', 'recordSpecApprovalBaseline', 'recordLandingBatch', 'recordLandingWaiver', 'recordLandingFlake', 'recordLandingTestDefect', 'finishLandingBatch'].includes(move.operation)) return args[0]?.agentId ?? null;
  if (['signBar', 'acceptCheck', 'completeCheckBaseline', 'appendFact', 'editItem', 'escalate', 'recordAttempt', 'claim', 'submit', 'reserveReview', 'verify', 'merged', 'withdraw', 'refreeze',
    'passDecision', 'answerDecision', 'holdLane', 'releaseLane', 'holdItem', 'releaseItemHold', 'reopen', 'editMilestoneItems', 'orderMilestoneItems', 'moveMilestone', 'editMilestone', 'removeMilestone', 'shipMilestone'].includes(move.operation)) return args[1]?.agentId ?? null;
  return null;
}

/** Validate the complete relay-authenticated sender envelope before attributing a refusal. */
export function validRelaySender(sender) {
  return Boolean(sender && ['person', 'agent', 'machine'].includes(sender.kind) && typeof sender.userId === 'string' && sender.userId.length > 0 && sender.userId.length <= 256 &&
    (sender.kind !== 'agent' || (typeof sender.agent === 'string' && sender.agent.length > 0 && sender.agent.length <= 256)) &&
    (sender.kind !== 'machine' || (typeof sender.machine === 'string' && sender.machine.length > 0 && sender.machine.length <= 256)) &&
    (sender.policy === undefined || Number.isSafeInteger(sender.policy) && sender.policy > 0) &&
    (sender.root === undefined || sender.root === true) &&
    (sender.lineage === undefined || typeof sender.lineage === 'string' && sender.lineage.length > 0 && sender.lineage.length <= 64) &&
    (sender.login === undefined || typeof sender.login === 'string' && /^[A-Za-z0-9-]{1,39}$/u.test(sender.login)) &&
    (sender.approver === undefined || typeof sender.approver === 'boolean') &&
    (sender.engine === undefined || Number.isSafeInteger(sender.engine) && sender.engine > 0) &&
    (sender.presence === undefined || sender.kind === 'person' && validPresence(sender.presence)));
}

export { validPresence } from './person-presence.js';
import { validPresence } from './person-presence.js';
/** Person bar provenance follows the same authenticated authority as existing person moves. */
function personBarMove(move) {
  const at = move?.operation === 'addItem' ? 0 : ['editItem', 'signBar'].includes(move?.operation) ? 1 : null;
  return at !== null && move.args?.[at]?.barActor?.authority === 'person';
}

/**
 * True for a move only the person may make: a row decision, a sentinel decision, an answer or hold as the person, a
 * person fact or request, or any move whose actor is the person. On a board that names approvers, only an approver's
 * session makes one [E4].
 */
export function personAuthority(move) {
  return personBarMove(move) || personFact(move) || ['holdLane', 'releaseLane'].includes(move?.operation) && Boolean(move.args?.[1]?.asPerson) || ['recordRowDecisions', 'decideSentinel'].includes(move?.operation) || move?.operation === 'answerDecision' && Boolean(move.args?.[1]?.asPerson) ||
    move?.operation === 'shout' && Boolean(move.args?.[0]?.request) || relayMoveActor(move) === 'person';
}

/**
 * True for a fact move that claims the person's authority: a never-again, a cause key, or person
 * mode (#713). Only an authenticated person sender may make it, whatever channel it names, so no
 * agent, coordinator seat or machine credential can make rigor list a cause as the person's.
 */
function personFact(move) {
  const options = move?.operation === 'appendFact' ? move.args?.[1] : null;
  return Boolean(options && typeof options === 'object' && (options.asPerson || options.neverAgain || (options.cause !== undefined && options.cause !== null)));
}

/** Make the same authorization decision on every device, without inspecting its shell or checkout. */
export function relaySenderProblem(move, sender, kind, { phoneReceipt = false } = {}) {
  if (!validRelaySender(sender)) {
    return new Refused('RELAY_SENDER', 'this relay record has no authenticated sender; restore attribution before replaying it');
  }
  // The relay stamps its policy on every record it now stores; an older engine cannot skip it (#579).
  if (sender.policy >= VERIFIER_STANDING_ENGINE && kind !== 'snapshot' && !(move?.engine >= VERIFIER_STANDING_ENGINE)) {
    return new Refused('ENGINE_VERSION', `this relay stores engine-${VERIFIER_STANDING_ENGINE} records; upgrade pullboard before sending moves to it`);
  }
  if (move?.operation === 'shout' && move.args?.[0]?.answers != null) {
    return new Refused('RELAY_ANSWER', 'a sealed shout cannot answer or pass a decision; use pullboard answer <id> "<answer>" or pullboard pass <id> --note "<reason>" so the decision rules are checked');
  }
  if (sender.kind === 'person') {
    // The relay stamps whether the person is one of the board's approvers; a board that names none stamps nothing [E4,E20].
    return sender.approver === false && (kind === 'snapshot' || personAuthority(move))
      ? new Refused('NOT_APPROVER', `${sender.login ?? 'this person'} is not an approver of this board; only an approver it names answers person decisions, approves rows or replaces its snapshot`) : null;
  }
  if (personFact(move)) {
    return new Refused('RELAY_PERSON_ONLY', `${sender.kind === 'agent' ? `agent ${sender.agent}` : 'a machine'} cannot record the person's never-again; the person marks it from their own session`);
  }
  if (sender.kind === 'machine') {
    if (kind === 'snapshot') return null;
    if (kind === 'move' && move?.engine >= 6 && (phoneReceipt ||
        move.operation === 'register' && typeof move.args?.[0]?.lane === 'string' && move.args[0].lane !== 'person' &&
          (move.engine < VERIFIER_STANDING_ENGINE || move.args[0].createdBy === 'machine' && move.args[0].id === undefined) ||
        move.operation === 'ensureCoordinator' && typeof move.args?.[0] === 'string')) return null;
    return new Refused('RELAY_PERSON_ONLY', 'a machine cannot act as the person; approve this action on the paired phone');
  }
  if (personBarMove(move) || kind === 'snapshot' || move?.operation === 'recordRowDecisions' || move?.operation === 'decideSentinel' || move?.operation === 'answerDecision' && move.args?.[1]?.asPerson ||
    move?.operation === 'shout' && move.args?.[0]?.request || relayMoveActor(move) === 'person') {
    return new Refused('RELAY_PERSON_ONLY', `agent ${sender.agent} cannot make a person-only relay ${kind}; use the person's authenticated session`);
  }
  const actor = relayMoveActor(move);
  if (actor !== sender.agent) return new Refused('RELAY_SENDER_MISMATCH', `agent ${sender.agent} cannot act as ${typeof actor === 'string' ? actor : '(no declared agent)'}; send this operation as the authenticated agent`);
  return null;
}

/** Choose credentials only; main's relay sender policy remains the sole replay authorization. */
export function credentialActor(move) {
  const args = move.args;
  if (move.operation === 'register' && move.engine >= VERIFIER_STANDING_ENGINE) {
    const creator = args?.[0]?.createdBy;
    return typeof creator === 'string' && creator !== 'machine' ? creator : 'machine';
  }
  if (move.personRequest || ['register', 'ensureCoordinator'].includes(move.operation)) return 'machine';
  if (personBarMove(move) || ['recordRowDecisions', 'recordLandingWaiver'].includes(move.operation)
    || move.operation === 'answerDecision' && args[1]?.asPerson
    || move.operation === 'shout' && args[0]?.request) return 'person';
  return relayMoveActor(move);
}

/** Compare caller intent without executing frozen callbacks or allocating another operation id. */
export function operationIntent(operation, args) {
  const values = Array.isArray(args) ? args.map((value, index) => {
    if (!['claim', 'refreeze'].includes(operation) || index !== 1 || !value || typeof value !== 'object') return value;
    const options = { ...value };
    delete options.freeze;
    delete options.frozen;
    delete options.freezeError;
    return options;
  }) : args;
  return JSON.stringify({ operation, args: values }, (_key, value) => typeof value === 'function' ? undefined : value);
}
