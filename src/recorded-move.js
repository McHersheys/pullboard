/** A completed durable move must never be repeated because later command work refused [C6,N26]. */
import { Refused } from './refused.js';

/** Preserve the refusal code while distinguishing a partial recorded command from an unrecorded attempt. */
export function recordedMoveRefusal(io, error) {
  if (!io.recordedMove || !(error instanceof Refused) || !/^(?:RELAY_|AUTH_|TOKEN_)/u.test(error.code)) return error;
  if (/^(?:AUTH_|TOKEN_)/u.test(error.code)) return new Refused(error.code,
    error.message.replace(/^\[[A-Z0-9_]+\] /u, '') + '; a move from this command was already recorded; do not repeat the original command', error.next);
  return new Refused(error.code,
    'a move from this command was already recorded; any pending relay work remains queued locally. Do not repeat the command',
    'run pullboard status to inspect the recorded work and pending relay sync; do not repeat the original command');
}

/** Match the actual parsed command's requested effects, excluding check attempts and other preflight bookkeeping. */
export function requestedCommandMove(command, operation) {
  if (!command) return false;
  const forms = {
    add: ['addItem'], edit: ['editItem'], merged: ['merged'], submit: ['submit'],
    claim: ['claim'], release: ['release'], verify: ['verify'], withdraw: ['withdraw'],
    refreeze: ['refreeze'], reopen: ['reopen'], escalate: ['escalate'],
    next: ['claim', 'reserveReview', 'reserveNextReview'], run: ['claim', 'submit', 'reserveReview', 'reserveNextReview', 'verify'],
    join: ['register'], worktree: ['register'], takeover: ['takeCoordinator'],
    shout: ['shout'], answer: ['answerDecision'], pass: ['passDecision'], fact: ['appendFact'],
    hold: ['holdLane', 'releaseLane', 'holdItem', 'releaseItemHold'],
    bar: ['setBarReady', 'signBar'], settings: ['setLineSetting', 'setPersonSigning'], check: ['acceptCheck'],
    spec: ['recordRowDecisions', 'applyRowDecisions', 'draftSpecRow'],
    blueprint: ['draftSpecRow', 'addItem', 'appendFact'],
    milestone: ['addMilestone', 'editMilestoneItems', 'orderMilestoneItems', 'moveMilestone', 'editMilestone', 'removeMilestone', 'shipMilestone'],
    land: ['recordLandingBatch', 'recordLandingWaiver', 'finishLandingBatch'],
    sentinel: ['proposeSentinel', 'decideSentinel', 'beginSentinelRun', 'finishSentinelRun'],
    health: ['recordHealthFindings'], job: ['declareJob', 'recordJobRun'],
    intake: ['intakeOutside'], approve: ['approveOutside'], publish: ['recordPublishFinding'],
  };
  return Object.hasOwn(forms, command) && forms[command].includes(operation);
}
