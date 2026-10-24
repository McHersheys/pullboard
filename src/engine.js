import { ITEM_SHOUT_ENGINE } from './item-shout-engine.js';
/** Versioned, deterministic replay through the CLI's existing board engine [H3,H16]. */
import {
  createHash,
  randomUUID,
} from 'node:crypto';
import * as store from './board.js';
import { COORDINATOR } from './config.js';
import { recordedRefusal } from './recorded-refusal.js';
import {
  BAR_ENGINE,
  carriesBarReason,
} from './bar-corrections.js';
import {
  carriesImplies,
  IMPLIES_ENGINE,
} from './implies.js';
import {
  carriesConflict,
  CONFLICT_ENGINE,
} from './trunk-conflict.js';
import { CHECK_ACCEPT_ENGINE } from './check-accept.js';
import { HEALTH_SENTINEL_ENGINE } from './health-receipts.js';
import { BOARD_SENTINEL_ENGINE } from './sentinels.js';
import { RECURRING_JOB_ENGINE } from './job-engine.js';
import { PEOPLE_ENGINE } from './people-engine.js';
import { SPEC_APPROVAL_ENGINE } from './spec-approval-engine.js';
import { GATE_RUN_ENGINE } from './gate-run-engine.js';
import { requireBound } from './quarantine.js';
import {
  REOPEN_FIRST_REFUSAL_ENGINE,
  CAUSE_ENGINE,
  ENGINE_VERSION,
  VERIFIER_STANDING_ENGINE,
  VERDICT_REVIEW_ENGINE,
  MILESTONE_RANK_ENGINE,
  ROW_DRAFT_ENGINE,
  SUBMITTED_CONFLICT_ENGINE,
} from './machine.js';
import {
  MILESTONE_SHIP_ENGINE,
  canonicalMilestoneTarget,
} from './milestones.js';
import { Refused } from './refused.js';
import { firstRefusal } from './claims.js';
import {
  requestMoveProblem,
  recordRequestMove,
  relayPerson,
  requestPerson,
} from './relay-requests.js';
import {
  relayMoveActor,
  relaySenderProblem,
  validRelaySender,
} from './relay-sender.js';
import {
  SUBMISSION_PROOF_ENGINE,
  submissionProof,
} from './submit-invariants.js';
import {
  CI_FLAKE_ENGINE,
  NATIVE_FLAKE_ENGINE,
  carriesFlakeDiagnostics,
} from './flake-engine.js';
import { LOCAL_LANDING_ENGINE } from './land-engine.js';
import { REVIEW_SKIP_ENGINE } from './review-skip-engine.js';
import { COORDINATOR_HOLD_ENGINE } from './coordinator-hold-engine.js';
import { requireCoordinatorHold } from './coordinator-hold.js';
import { LANDING_ENVIRONMENT_ENGINE } from './landing-environment-engine.js';
import { carriesLandingEnvironment } from './execution-environment.js';
import { LANDING_LEASE_ENGINE } from './landing-lease-engine.js';
import { PR_BRIDGE_ENGINE } from './pr-bridge-engine.js';

const ITEM_ID_FIRST_ARGUMENT = new Set(['acceptCheck', 'editItem', 'escalate', 'recordAttempt', 'claim', 'release', 'submit', 'reserveReview', 'verify', 'merged', 'withdraw', 'refreeze', 'reopen', 'appendFact']);

/** Only these public board operations may be requested by an encrypted move. */
export const ENGINE_OPERATIONS = Object.freeze([
  'register', 'ensureCoordinator', 'addItem', 'editItem', 'completeCheckBaseline', 'escalate', 'recordAttempt',
  'claim', 'release', 'submit', 'reserveReview', 'reserveNextReview', 'verify', 'merged',
  'withdraw', 'refreeze', 'reopen', 'shout', 'passDecision', 'answerDecision', 'holdLane', 'releaseLane', 'holdItem', 'releaseItemHold',
  'addMilestone', 'editMilestoneItems', 'orderMilestoneItems', 'moveMilestone', 'editMilestone', 'removeMilestone', 'shipMilestone',
  'recordRowDecisions', 'applyRowDecisions', 'draftSpecRow', 'appendFact', 'recordSpecApprovalBaseline',
  'recordLandingBatch', 'recordLandingWaiver', 'recordLandingFlake', 'recordLandingTestDefect', 'finishLandingBatch', 'acceptCheck',
  'recordHealthFindings', 'proposeSentinel', 'decideSentinel', 'beginSentinelRun', 'finishSentinelRun',
  'recordFlakeObservation', 'recordGateRun', 'declareJob', 'recordJobRun', 'takeCoordinator', 'landingLeaseMove',
  'recordPublishFinding',
]);

/** Engine version at which each ordered operation first has stable replay semantics. */
const OPERATION_ENGINE = Object.freeze({ draftSpecRow: ROW_DRAFT_ENGINE, orderMilestoneItems: MILESTONE_RANK_ENGINE, reopen: 8, recordLandingBatch: 8, recordLandingWaiver: 8, recordLandingFlake: 8, finishLandingBatch: 8, acceptCheck: CHECK_ACCEPT_ENGINE,
  shipMilestone: MILESTONE_SHIP_ENGINE, recordSpecApprovalBaseline: SPEC_APPROVAL_ENGINE, takeCoordinator: COORDINATOR_HOLD_ENGINE });

/** Dependency edits, causes, sealed reviews, submission proofs, trunk conflicts, health observations and milestone targets retain distinct recorded engine meanings. */
function minimumOperationEngine(operation, args, board, at) {
  if (operation === 'recordPublishFinding') return PR_BRIDGE_ENGINE;
  if (operation === 'recordLandingTestDefect' || operation === 'verify' && args[1]?.environment !== undefined
    || operation === 'recordGateRun' && Object.hasOwn(args[0]?.receipt ?? {}, 'environment')
    || operation === 'recordLandingBatch' && carriesLandingEnvironment(args[0]?.batch)) return LANDING_ENVIRONMENT_ENGINE;
  if (board && ['recordLandingBatch', 'finishLandingBatch'].includes(operation)) {
    if (store.landingTestDefects(board).length) return LANDING_ENVIRONMENT_ENGINE;
    const id = operation === 'recordLandingBatch' ? args[0]?.batch?.id : args[0]?.id;
    if (store.landingBatches(board).some(batch => batch.id === id && carriesLandingEnvironment(batch))) return LANDING_ENVIRONMENT_ENGINE;
  }
  if (operation === 'shout' && args[0]?.item !== undefined) return ITEM_SHOUT_ENGINE;
  if (operation === 'landingLeaseMove' || args[0]?.landingFence !== undefined) return LANDING_LEASE_ENGINE;
  if (['verify', 'reopen'].includes(operation) && args[1]?.reopenFirstRefusalMinutes !== undefined
    || ['claim', 'release'].includes(operation) && board && firstRefusal(board, args[0], at)) return REOPEN_FIRST_REFUSAL_ENGINE;
  // A batch landed on the local trunk before it is published (#801).
  if (operation === 'recordLandingBatch' && args[0]?.batch?.state === 'trunk'
    || operation === 'finishLandingBatch' && board && store.landingBatches(board).find(batch => batch.id === args[0]?.id)?.state === 'trunk') return LOCAL_LANDING_ENGINE;
  if (operation === 'recordFlakeObservation') return args[0]?.observation?.kind === 'ci' ? CI_FLAKE_ENGINE : NATIVE_FLAKE_ENGINE;
  if (operation === 'recordLandingBatch' && carriesFlakeDiagnostics(args[0]?.batch)) return NATIVE_FLAKE_ENGINE;
  if (['proposeSentinel', 'decideSentinel', 'beginSentinelRun', 'finishSentinelRun'].includes(operation) || typeof args[1]?.cause === 'string' && args[1].cause.startsWith('sentinel:')) return BOARD_SENTINEL_ENGINE;
  if (['declareJob', 'recordJobRun'].includes(operation)) return RECURRING_JOB_ENGINE;
  if (operation === 'recordGateRun') return GATE_RUN_ENGINE;
  if (operation === 'recordHealthFindings') return HEALTH_SENTINEL_ENGINE;
  if (operation === 'reserveNextReview' && Array.isArray(args[0]?.skipIds) && args[0].skipIds.length) return REVIEW_SKIP_ENGINE;
  const options = args[1];
  if (carriesConflict(operation, args)) return board && store.itemById(board, args[0])?.item_status === 'submitted' ? SUBMITTED_CONFLICT_ENGINE : CONFLICT_ENGINE;
  if (operation === 'submit' && options?.submissionProof !== undefined
    || operation === 'recordLandingBatch' && args[0]?.batch?.invariantEvidence !== undefined) return SUBMISSION_PROOF_ENGINE;
  const given = (name) => Boolean(options && typeof options === 'object' && Object.hasOwn(options, name) && options[name] !== undefined && options[name] !== null && options[name] !== false);
  if (board && ['recordLandingBatch', 'finishLandingBatch'].includes(operation)) {
    const id = operation === 'recordLandingBatch' ? args[0]?.batch?.id : args[0]?.id;
    const prior = id && store.landingBatches(board).find(batch => batch.id === id);
    if (prior?.invariantEvidence) return SUBMISSION_PROOF_ENGINE;
    if (prior && ['items', 'candidates'].some(key => Array.isArray(prior[key]) && prior[key].some(entry => entry && Object.hasOwn(entry, 'reviewedCommit')))) return VERDICT_REVIEW_ENGINE;
  }
  if (operation === 'verify' && options && Object.hasOwn(options, 'review')) return VERDICT_REVIEW_ENGINE;
  if (operation === 'recordLandingBatch' && args[0]?.batch
    && ['items', 'candidates'].some(key => Array.isArray(args[0].batch[key]) && args[0].batch[key].some(entry => entry && typeof entry === 'object' && Object.hasOwn(entry, 'reviewedCommit')))) return VERDICT_REVIEW_ENGINE;
  if (['verify', 'reopen', 'appendFact'].includes(operation) && (given('cause') || given('neverAgain') || given('asPerson'))) return CAUSE_ENGINE;
  if (carriesImplies(operation, args)) return IMPLIES_ENGINE;
  if (carriesBarReason(operation, args)) return BAR_ENGINE;
  if (operation === 'editMilestone' && options && Object.hasOwn(options, 'target') && options.target !== undefined) return MILESTONE_SHIP_ENGINE;
  return operation === 'editItem' && options && Object.hasOwn(options, 'after') && options.after !== undefined
    ? 10 : OPERATION_ENGINE[operation] ?? 1;
}

/** Read a replica's committed prefix without trusting an independently saved transport cursor. */
export function appliedSequence(board) {
  const row = board.db.prepare('SELECT meta_value FROM board_meta WHERE meta_key=?').get('relay_applied_sequence');
  const value = row ? Number(row.meta_value) : 0;
  if (!Number.isSafeInteger(value) || value < 0) throw new Refused('RELAY_CURSOR', 'the local replay cursor is invalid; restore a consistent board snapshot');
  return value;
}

/** Store protocol metadata inside the same transaction as the move it describes. */
function metadata(board, name, value) {
  board.db.prepare('INSERT INTO board_meta(meta_key,meta_value) VALUES (?,?) ON CONFLICT(meta_key) DO UPDATE SET meta_value=excluded.meta_value')
    .run(name, value);
}

/** Advance a checkpoint made from an already-applied legacy mirror, without reexecuting its events. */
export function checkpointSequence(board, sequence) {
  if (!Number.isSafeInteger(sequence) || sequence < appliedSequence(board)) throw new Refused('RELAY_CURSOR', 'a checkpoint cannot move replay backwards; fetch the current relay snapshot');
  store.atomic(board, () => {
    metadata(board, 'relay_applied_sequence', String(sequence));
    metadata(board, 'relay_engine_version', String(ENGINE_VERSION));
  });
}

/** Start an explicitly relinked remote epoch while keeping all local board rows and history. */
export function startRelayEpoch(board) {
  store.atomic(board, () => {
    board.db.prepare("DELETE FROM board_meta WHERE meta_key LIKE 'relay_receipt_%'").run();
    board.db.prepare("DELETE FROM board_meta WHERE meta_key LIKE 'relay_refusal_%'").run();
    metadata(board, 'relay_applied_sequence', '0');
    metadata(board, 'relay_engine_version', String(ENGINE_VERSION));
  });
}

/** Turn caller-only callbacks into deterministic values before sealing an executable operation. */
export function prepareEngineMove(board, operation, args, { id = randomUUID(), actor } = {}) {
  if (!ENGINE_OPERATIONS.includes(operation) || !Array.isArray(args)) throw new Refused('RELAY_MOVE', 'use a supported board-engine operation with its argument array');
  if (operation === 'submit' && ENGINE_VERSION >= SUBMISSION_PROOF_ENGINE) submissionProof(args[1]?.submissionProof);
  const minimumEngine = minimumOperationEngine(operation, args, board);
  if (ENGINE_VERSION < minimumEngine) throw new Refused('ENGINE_VERSION', `${operation} requires engine version ${minimumEngine}; this pullboard uses engine ${ENGINE_VERSION}; upgrade before sending it`);
  // A gate run is sealed only as its gate's own receipt; a run made up by hand is refused before it reaches any replica.
  if (operation === 'recordGateRun') requireBound(board, args[0]?.receipt);
  const values = args.map((value) => value && typeof value === 'object' ? { ...value } : value);
  if (operation === 'release') {
    const problem = store.reviewReleaseNoteProblem(board, values[0], values[1], values[2]);
    if (problem) throw problem;
  }
  if (['claim', 'refreeze'].includes(operation)) {
    const options = values[1];
    const item = store.getItem(board, values[0]);
    if (typeof options?.freeze === 'function') {
      let frozen;
      let error;
      try { frozen = options.freeze(item); }
      catch (cause) {
        if (!(cause instanceof Refused)) throw cause;
        error = recordedRefusal(cause);
      }
      delete options.freeze;
      options.frozen = frozen ?? null;
      options.freezeError = error ?? null;
    }
  }
  // A target is fixed to one instant here, so replicas in other time zones read the same one.
  if (operation === 'editMilestone' && values[1] && 'target' in values[1]) values[1].target = canonicalMilestoneTarget(values[1].target);
  const move = { version: 1, engine: ENGINE_VERSION, id, operation, args: values, ...(actor === undefined ? {} : { actor }) };
  // JSON is the wire format: optional undefined fields become absent on every replica alike.
  return JSON.parse(JSON.stringify(move));
}

/** Stop before interpreting actors or operations that a newer engine may have changed. */
export function requireSupportedEngine(move) {
  if (Number.isSafeInteger(move?.engine) && move.engine > ENGINE_VERSION) throw new Refused('ENGINE_VERSION', `move engine version ${move.engine} is newer than this pullboard engine version ${ENGINE_VERSION}; upgrade pullboard before applying the relay order`);
}

/** Validate protocol identity before a future engine or malformed input can alter any replica. */
function validateMove(move) {
  if (!move || move.version !== 1 || !Number.isSafeInteger(move.engine) || move.engine < 1) throw new Refused('RELAY_MOVE', 'this executable move format is invalid; upgrade pullboard or restore a consistent relay snapshot');
  requireSupportedEngine(move);
  if (typeof move.id !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(move.id) || !ENGINE_OPERATIONS.includes(move.operation) || !Array.isArray(move.args)) throw new Refused('RELAY_MOVE', 'this sealed operation is invalid; use a supported board-engine operation');
  const minimumEngine = minimumOperationEngine(move.operation, move.args);
  if (move.engine < minimumEngine) throw new Refused('RELAY_MOVE', `${move.operation} cannot be replayed from engine version ${move.engine}; it was introduced in engine ${minimumEngine}; restore a consistent relay prefix`);
}

/** Restore only the frozen criterion callback; no receiver runs another machine's Git or shell. */
export function executableArgs(move, board) {
  const args = structuredClone(move.args);
  if (move.operation === 'appendFact') {
    if (!args[1] || typeof args[1] !== 'object' || Array.isArray(args[1])) throw new Refused('RELAY_MOVE', 'a fact needs its typed arguments; use the current Pullboard engine');
    args[1].factId = move.id;
  }
  // Implied facts take their ids from the sealed move, so every replica writes the same ones.
  if (['answerDecision', 'verify'].includes(move.operation) && args[1] && typeof args[1] === 'object' && !Array.isArray(args[1])) args[1].impliesId = move.id;
  if (['claim', 'refreeze'].includes(move.operation)) {
    const options = args[1];
    if (!options || !Object.hasOwn(options, 'frozen')) throw new Refused('RELAY_MOVE', 'the claim has no frozen criterion; send it with the current pullboard engine');
    options.freeze = () => {
      if (options.freezeError) throw new Refused(options.freezeError.code, options.freezeError.message);
      if (!options.frozen || typeof options.frozen.text !== 'string' || typeof options.frozen.digest !== 'string') throw new Refused('RELAY_MOVE', 'the frozen criterion is invalid; send it with the current pullboard engine');
      return options.frozen;
    };
  }
  if (move.operation === 'verify') {
    const item = store.getItem(board, args[0]);
    const options = args[1];
    let frozen;
    try { frozen = JSON.parse(item.item_frozen ?? 'null'); }
    catch { throw new Refused('NO_POLICY', 'the frozen verify policy is invalid; ask the coordinator to refreeze this item before verifying it'); }
    const capturedPolicy = frozen?.policy;
    const captured = capturedPolicy?.verify;
    if (!options || typeof options !== 'object' || Array.isArray(options) ||
        capturedPolicy?.version !== 1 || !/^[0-9a-f]{40,64}$/.test(capturedPolicy.commit ?? '') ||
        !['any', 'coordinator'].includes(captured?.policy) || !['off', 'prefer', 'require'].includes(captured?.family)) {
      throw new Refused('NO_POLICY', 'the frozen verify policy is missing or invalid; ask the coordinator to refreeze this item before verifying it');
    }
    args[1] = { ...options, policy: captured.policy, familyPolicy: captured.family, impliesId: move.id };
  }
  return args;
}

/** Read the durable outcome used to recover an acknowledged move after a process interruption. */
export function engineReceipt(board, id) {
  const row = board.db.prepare('SELECT meta_value FROM board_meta WHERE meta_key=?').get('relay_receipt_' + id);
  return row ? JSON.parse(row.meta_value) : null;
}

/** Record one relay refusal and advance exactly one authenticated transport position atomically. */
export function refuseRelayMove(board, move, { sequence, at, sender, kind, code, digest = null, refusal = null }) {
  if (!Number.isSafeInteger(sequence) || sequence < 1 || !Number.isFinite(Date.parse(at))) throw new Refused('RELAY_ORDER', 'the refused relay position is invalid; fetch the ordered relay prefix');
  const normalizedBy = validRelaySender(sender) && sender.kind === 'agent' ? sender.agent : 'relay';
  const record = digest ?? createHash('sha256').update(JSON.stringify({ move, sender, kind })).digest('hex');
  const key = 'relay_refusal_' + sequence;
  return store.atomic(board, () => {
    const cursor = appliedSequence(board);
    const saved = board.db.prepare('SELECT meta_value FROM board_meta WHERE meta_key=?').get(key);
    if (sequence <= cursor) {
      const prior = saved && JSON.parse(saved.meta_value);
      if (!prior || prior.record !== record) throw new Refused('RELAY_CURSOR', 'this refused relay position has no matching receipt; fetch a consistent snapshot');
      return prior.outcome;
    }
    if (sequence !== cursor + 1) throw new Refused('RELAY_ORDER', `relay sequence ${sequence} does not follow applied sequence ${cursor}; fetch the missing prefix first`);
    const candidateItemId = ITEM_ID_FIRST_ARGUMENT.has(move?.operation) ? move?.args?.[0] : null;
    const itemId = Number.isSafeInteger(candidateItemId) && candidateItemId > 0 && board.db.prepare('SELECT 1 FROM item WHERE item_id=?').get(candidateItemId) ? candidateItemId : null;
    const reason = refusal ?? new Refused(code, 'this relay record was refused and logged; run pullboard relay to continue with the next ordered record');
    const outcome = { error: recordedRefusal(reason) };
    const clock = board.clock;
    board.clock = { now: () => new Date(at) };
    try {
      store.recordRelayRefusal(board, { by: normalizedBy, sequence, kind, operation: typeof move?.operation === 'string' ? move.operation : null,
        actor: typeof relayMoveActor(move) === 'string' ? relayMoveActor(move) : null, code, itemId, person: requestPerson(board, move) ?? relayPerson(sender) });
    } finally { board.clock = clock; }
    metadata(board, key, JSON.stringify({ record, outcome }));
    metadata(board, 'relay_applied_sequence', String(sequence));
    metadata(board, 'relay_engine_version', String(ENGINE_VERSION));
    return outcome;
  });
}

/**
 * Bind an engine-48 registration to the relay's receipt (#579). A seat made by another seat names
 * itself in the move (`id`) and arrives with the receipt the relay issued its first token under:
 * same target, the authenticated creator, this position and these exact sealed bytes. A join no
 * seat made is machine-sent and carries no receipt; a receipt on any other move is refused.
 *
 * @param {any} board
 * @param {any} move
 * @param {{ sender: any, registration?: any, sequence: number, digest: string | null }} record
 * @returns {Refused | null}
 */
function registrationProblem(board, move, { sender, registration, sequence, digest }) {
  const refuse = (why) => new Refused('RELAY_REGISTRATION', `${why}; register the seat again from its creating seat's checkout`);
  const options = move?.operation === 'register' && move.engine >= VERIFIER_STANDING_ENGINE ? move.args?.[0] : null;
  if (!options || sender?.kind === 'person') return registration === undefined || registration === null ? null : refuse('the relay attached a seat receipt to a move that registers no seat');
  const existing = typeof options.path === 'string' ? store.agentAt(board, options.path) : null;
  if (sender.kind === 'machine' || existing) {
    if (registration !== undefined && registration !== null) return refuse('a machine join or a returning seat carries no seat receipt');
    if (existing && sender.kind === 'agent' && existing.agent_id !== sender.agent) return refuse(`agent ${sender.agent} cannot register another seat's worktree`);
    return null;
  }
  if (options.createdBy === COORDINATOR && sender.root !== true) {
    return refuse('only the coordinator credential the person set up creates seats; run pullboard relay on in the main checkout once');
  }
  const receipt = registration ?? {};
  if (typeof options.id !== 'string' || receipt.target !== options.id || receipt.creator !== sender.agent || receipt.creator !== options.createdBy ||
      receipt.sequence !== sequence || typeof digest !== 'string' || receipt.digest !== digest) {
    return refuse('a new seat needs the relay receipt its creator received for exactly this sealed move');
  }
  return null;
}

/** Authorize each public relay position before replay, retaining refusals atomically with its cursor. */
export function applyRelayMove(board, move, { sequence, at, sender, kind, digest = null, registration }) {
  requireSupportedEngine(move);
  const phoneReceipt = sender?.kind === 'machine' && move?.engine >= 6 && Boolean(move.personRequest) && !requestMoveProblem(board, move, { checkExecutorLease: false });
  const problem = relaySenderProblem(move, sender, kind, { phoneReceipt }) ?? (kind === 'move' ? registrationProblem(board, move, { sender, registration, sequence, digest }) : null);
  if (!problem) {
    // Engine-48 relay moves run under linked verifier standing; older recorded moves replay as they did.
    // The person is above every seat; their own moves act with the coordinator's standing.
    const standing = move?.engine >= VERIFIER_STANDING_ENGINE ? { root: sender?.root === true || sender?.kind === 'person',
      person: sender?.kind === 'person', lineage: sender?.root === true && typeof sender.lineage === 'string' ? sender.lineage : null } : null;
    // The relay-authenticated GitHub login names the person behind the move, whoever sent it; a move that carries out
    // a phone request is the phone person's, though their computer sent it [E3].
    return applyEngineMove(board, move, { sequence, at, standing, enrollment: registration?.target ?? null,
      person: requestPerson(board, move) ?? (typeof sender?.login === 'string' ? sender.login : null) });
  }
  return refuseRelayMove(board, move, { sequence, at, sender, kind, code: problem.code, digest, refusal: problem });
}

/**
 * Apply one relay position with the same board functions as the CLI, preserving its refusal.
 * A receipt and prefix commit atomically; duplicate ids return that receipt without another move.
 */
export function applyEngineMove(board, move, { sequence, at, standing = null, enrollment = null, person = null }) {
  validateMove(move);
  if (!Number.isSafeInteger(sequence) || sequence < 1 || !Number.isFinite(Date.parse(at))) throw new Refused('RELAY_MOVE', 'supply a valid relay sequence and receipt timestamp');
  return store.atomic(board, () => {
    const cursor = appliedSequence(board);
    const previous = engineReceipt(board, move.id);
    const encoded = JSON.stringify(move);
    if (previous && previous.move !== encoded) throw new Refused('RELAY_MOVE', 'this move id names different contents; restore a consistent relay prefix');
    if (sequence <= cursor) {
      if (!previous) throw new Refused('RELAY_CURSOR', 'this earlier move has no local receipt; fetch a consistent relay snapshot');
      return previous.outcome;
    }
    if (sequence !== cursor + 1) throw new Refused('RELAY_ORDER', `relay sequence ${sequence} does not follow applied sequence ${cursor}; fetch and apply the missing prefix first`);
    let outcome = previous?.outcome;
    if (!outcome) {
      // Existing receipts replay before consulting newer snapshot semantics.
      const minimumEngine = minimumOperationEngine(move.operation, move.args, board, new Date(at));
      if (move.engine < minimumEngine) throw new Refused('RELAY_MOVE', `${move.operation} cannot act on a checked-composition snapshot from engine ${move.engine}; use engine ${minimumEngine} or newer`);
      const clock = board.clock;
      const engineVersion = board.executionEngineVersion;
      board.clock = { now: () => new Date(at) };
      board.executionEngineVersion = move.engine;
      const firstEvent = board.emittedEvents?.length ?? 0;
      if (enrollment !== null) board.relayEnrollment = enrollment;
      // From engine 73 every event of the move names its person; an older move replays without one.
      if (person !== null && move.engine >= PEOPLE_ENGINE) board.movePerson = person;
      try {
        const execute = () => store.atomic(board, () => {
          const problem = requestMoveProblem(board, move);
          if (problem) throw problem;
          // One main checkout coordinates a linked board at a time; another is refused by name (#347).
          requireCoordinatorHold(board, move, standing?.lineage, at);
          return store[move.operation](board, ...executableArgs(move, board));
        });
        const result = standing ? store.withVerifierStanding(board, standing, execute) : execute();
        outcome = { result: result ?? null, events: (board.emittedEvents?.slice(firstEvent) ?? []).map((event) => ({ ...event })) };
      } catch (error) {
        if (!(error instanceof Refused)) throw error;
        const refusal = recordedRefusal(error);
        // Engine 8 stored generic merge-refusal guidance before the serializer recognized "merge".
        if (move.engine === 8 && move.operation === 'merged' && error.code === 'NOT_VERIFIED') {
          refusal.next = 'Run pullboard help, correct the reported problem, and retry the command.';
        }
        outcome = { error: refusal };
      } finally {
        board.clock = clock;
        delete board.relayEnrollment;
        delete board.movePerson;
        if (engineVersion === undefined) delete board.executionEngineVersion;
        else board.executionEngineVersion = engineVersion;
      }
      recordRequestMove(board, move, outcome, sequence, at);
      metadata(board, 'relay_receipt_' + move.id, JSON.stringify({ sequence, move: encoded, outcome }));
    }
    metadata(board, 'relay_applied_sequence', String(sequence));
    metadata(board, 'relay_engine_version', String(ENGINE_VERSION));
    return outcome;
  });
}
