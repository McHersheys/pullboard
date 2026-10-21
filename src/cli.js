/**
 * The pullboard command line: every command, bound to who is asking (B3, R3). The main checkout is the
 * coordinator; every other worktree is the agent that joined from it.
 */
import {
  createHash,
  randomUUID,
} from 'node:crypto';
import {
  spawn,
  spawnSync,
} from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import {
  hostname,
} from 'node:os';
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import {
  mainLaneWork,
  reviewQueueLine,
  refuseNextIdle,
} from './next-steps.js';
import { reviewerStartup } from './next-steps.js';
import { judgeTrunkMove } from './verdict-trunk.js';
import * as gateReceipt from './gate-receipt.js';
import * as itemSessions from './item-sessions.js';
import * as seatCheckout from './seat-checkout.js';
import { submitPreflight } from './submit-preflight.js';
import * as store from './board.js';
import * as nativeFlakes from './native-flake-cli.js';
import {
  firstInputLine,
  hookRead,
  readStdin,
  traceServeStartup,
} from './cli-support.js';
import {
  CONFIG_FILE,
  COORDINATOR,
  DOCTRINE_FILE,
  LEGACY_DOCTRINE_FILE,
  loadConfig,
} from './config.js';
import { displayAgentName } from './agent-names.js';
import {
  doctrineHistory,
  loadDoctrine,
} from './doctrine.js';
import {
  agentDoctrine,
  proposeDoctrine,
  resumeDoctrineNotes,
  staleDoctrineRows,
} from './doctrine-rulings.js';
import {
  checkRulesAt,
  doctrineReport,
  hasSubmitRules,
  holdDoctrine,
  ruleLine,
} from './doctrine-checks.js';
import {
  AGENT_SESSION_IDS,
  agentSessionDigest,
  personCommand,
  requirePersonChannel,
  personShout,
} from './person.js';
import {
  bindLocalSession,
  HOOK_CHECKOUT_WAIT_MS,
  localSessionMatches,
  localSessionSeats,
} from './agent-session.js';
import {
  decisionAnswer,
  decisionProjection,
  handAnsweredQuestions,
  pendingAnswers,
  planRowApply,
  prepareRowDecisions,
  restoreRowApply,
  rowDecisionView,
  writeRowApply,
} from './row-decisions.js';
import { rowDecisionContext } from './row-decision-state.js';
import {
  digestOf,
  gateReport,
  refuseSandboxBlocked,
  runGate,
  runProfiledShell,
  runSubmitGate,
  runStaticChecks,
  submitGateReport,
  timingDigest,
  withGateSlot,
} from './gate.js';
import { draftRow } from './spec-draft.js';
import {
  clashingRowDrafts,
  pendingRowDrafts,
  trunkRowIds,
  withRowDrafts,
} from './row-drafts.js';
import { gateWaitReporter } from './gate-wait.js';
import * as gateConfig from './gate-config.js';
import {
  checkNeedsBrowser,
  explicitCheckFiles,
} from './browser-admission.js';
import {
  submitInvariantLine,
  submitInvariantProposals,
} from './submit-invariants.js';
import {
  bareWorktreeFinding,
  codeIsFromMain,
  contains,
  differFromHead,
  git,
  gitChildEnv,
  headCommit,
  headTree,
  invalidateGitFacts,
  isClean,
  mainCheckout,
  patchId,
  repoInfo,
  resolveCommit,
  tryGit,
  untracked,
  withGitFacts,
} from './git.js';
import {
  FIX_NOTE,
  applyFixers,
  commitMsgProblems,
  commitCitationWarnings,
  installHooks,
  preCommitProblems,
  prePushProblems,
  pushesTrunk,
  unwiredHookProblems,
} from './hooks.js';
import {
  askedLaneNotes,
  detectGate,
  initRepo,
  proposeLanes,
  starterLane,
  starterLaneNotes,
} from './init.js';
import {
  beginInitCommit,
  finishInitCommit,
  reportInitSetup,
  SETUP_COMMIT_LATER,
} from './init-finish.js';
import { lifecycleMarkdown } from './machine.js';
import {
  buildHelp,
  SETTING_FORMS,
  VERSION,
} from './help.js';
import {
  barCorrectionLine,
  barCorrections,
  barStatsLines,
} from './bar-corrections.js';
import {
  MAIN_MERGE_LABEL,
  mainMergeFor,
  mainMergeLines,
  mainMergesFor,
  reopenConflict,
  reopenedLine,
} from './trunk-conflict.js';
import {
  checkImplies,
  decisionsImplying,
  parseImplies,
  takeDecisionNotices,
  whyLine,
} from './implies.js';
import { defaultViewPort } from './view-port.js';
export { VERSION };
import {
  productLine,
  productProblems,
  productSummaries,
} from './products.js';
import {
  addLane,
  isLane,
  laneNames,
  laneOf,
  outOfLane,
} from './lanes.js';
import { Refused } from './refused.js';
import {
  applyStep,
  personAsk,
  requirementStep,
  setupDecisionRows,
  withStarterWork,
} from './setup-rows.js';
import { personNeeds } from './needs.js';
import { personNeedsState } from './needs-state.js';
import { startServeSentinel } from './serve-sentinel.js';
import {
  commitCitations,
  committedIds,
} from './history.js';
import {
  promptFor,
  skillProblems,
  updateSkills,
} from './skills.js';
import {
  frozenCriterion,
  idProblems,
  lintSpec,
  loadSpec,
  legacyDoctrineRenameBase,
  permanenceProblems,
  parseSpec,
  readSignoffs,
  signOff,
  standings,
  unmetRows,
} from './spec.js';
import {
  answerQuestion,
  bundledBlueprints,
  landBlueprint,
  planBlueprint,
  readBlueprint,
  repoAnswers,
  saveBlueprint,
} from './blueprints.js';
import { fitCommand } from './blueprint-fit-command.js';
import {
  fitSummary,
  readFitBatch,
} from './blueprint-fit.js';
import {
  blueprintStarterNote,
  combinedSummary,
  installedBlueprints,
  landEach,
  readBlueprints,
  sharedRowLines,
} from './blueprint-set.js';
import { briefFiles } from './brief.js';
import {
  commitFirst,
  commitOwnerLines,
  commitOwners,
  coordinatorInbox,
  coordinatorInboxLines,
  inboxFirst,
} from './resume.js';
import {
  checkBaseline,
  prepareCheckBaseline,
  refuseCheckSyntax,
  sayCheckBaseline,
} from './check-baseline.js';
import {
  checkAcceptCommand,
  refuseClaimProvesNothing,
  refuseProvesNothing,
} from './check-accept.js';
import {
  retryCheckBaselines,
  startCheckBaseline,
} from './check-baseline-worker.js';
import {
  startersCommand,
} from './blueprint-report.js';
import {
  compareMainFailures,
  mainRedMessage,
  mainRedReworkItems,
} from './main-red.js';
import { runItems } from './run.js';
import {
  parseProblems,
  sweepItems,
} from './sweep.js';
import { renderSpecView } from './view.js';
import { tour } from './tour.js';
import {
  commandOutput,
} from './json.js';
import {
  forgetProject,
  listApiProjects,
  registerProjectAndLink,
  registeredProjectRootsSnapshot,
} from './projects.js';
import * as roadmapView from './roadmap.js';
import * as queueView from './queue.js';
import * as relayOutput from './relay-output.js';
import {
  rigorLines,
  rigorReport,
} from './rigor.js';
import {
  listResources,
  memoryVerdict,
  readMachineMemory,
  runnerResourceStatus,
} from './resources.js';
import {
  citedTestFiles,
  rowEvidence,
  rowStage,
} from './evidence.js';
import {
  exportView,
  serveView,
} from './serve.js';
import {
  forgetView,
  busyViewPortRefusal,
  rememberView,
  runningView,
} from './view-session.js';
import {
  backgroundViewLine,
  keepViewRunning,
  launchBackgroundView,
  reportView,
} from './background-view.js';
import { rigorDraftCommand } from './rigor-draft.js';
import {
  conflictLines,
  conflictReport,
} from './rigor-conflicts.js';
import { draftConflictSplits } from './rigor-splits.js';
import { nextReview } from './next-review.js';
import { serveApi } from './api.js';
import { watchCommand } from './watch.js';
import { serveMcp } from './mcp.js';
import { scanHealthSentinel } from './health-sentinel.js';
import { SENTINEL_OPTIONS } from './sentinel-command.js';
import { resumeSentinels } from './sentinel-command.js';
import { sentinelCommand } from './sentinel-command.js';
import { sentinelListCommand } from './sentinel-command.js';
import {
  doctorProblems,
  doctrineProblems,
} from './doctor.js';
import {
  boardHealth,
  healthLines,
} from './health.js';
import {
  staleFrozenItems,
  staleItemFinding,
} from './approved-rows.js';
import {
  mainPolicy,
  policyAt,
  itemPolicy,
  submissionPaths,
  frozenCheck,
  checkAtCommit,
  dependencySnapshots,
  requireTrunkMerge,
  trunkMerge,
  trunkRef,
} from './trusted-policy.js';
import {
  composeReview,
  composesAtAdmission,
} from './verdict-admission.js';
import {
  captureVerdictReview,
  staleVerdictRefusal,
  verdictProjector,
  verdictTrunk,
} from './verdict-freshness.js';
import { proofStats } from './stats.js';
import {
  flowLines,
  flowAlertLine,
} from './stats-flow.js';
import { releaseHeadlinesBetween } from './changelog.js';
import {
  exportBoard,
  importBoard,
} from './exchange.js';
import { digestCommand } from './digest.js';
import {
  addSigner,
  assertRequiredSigners,
  defaultPrincipal,
  hasSignerFile,
} from './signature.js';
import {
  addRunner,
  browserFreeChecksEnabled,
  gateQueueSettings,
  gateShortSlots,
  loadMachineSettings,
  memoryFloorMB,
  relayOfferEnabled,
  setBrowserSlots,
  setGateShortSlots,
  setGateSlots,
} from './settings.js';
import {
  formatSnapshotLimit,
  pendingSnapshotSize,
  pendingCheckpointProblem,
  relayCommandReceipt,
  relayCommandReceiptReported,
  relayLinked,
  relayOff,
  relayOn,
  relayOperation,
  relayRecover,
  relayRecovered,
  relayRevoke,
  relayStatus,
  relayTokens,
  syncRelay,
} from './relay.js';
import {
  autoLinkProject,
  offerRelayAtInit,
  relayOnAllCommand,
  revokeRelayDevice,
  unlinkedRelayProjects,
} from './relay-setup.js';
import {
  relayRoster,
  rosterLines,
} from './relay-roster.js';
import {
  relayJoin,
  relayPair,
} from './relay-pairing-client.js';
import { executePersonRequests } from './relay-request-execution.js';
import { engineReceipt } from './engine.js';
import {
  accountedFailures,
  land,
  landingRemote,
  landingSubject,
  liveWaiverProjection,
  waivedFailures,
  waiverLine,
} from './land.js';
import { installStep } from './worktree.js';
import * as infraNotes from './infra-note.js';

export { gateWaitReporter };
const CHECKOUT_LEASES = new WeakMap();
const CHECKOUT_BOARD_ONLY = new WeakMap();
let startupMainTraced = false;

/**
 * Read the collision baseline from the primary branch, retained trunk, or detached HEAD default.
 *
 * @param {string} root
 * @param {string} path
 * @param {string} [revision]
 * @returns {{ status: number, stdout: string, baseline?: string }}
 */
function coordinatorFile(root, path, revision) {
  const commonDir = git(root, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
  const coordinatorRoot = dirname(commonDir);
  const env = { ...gitChildEnv(root), GIT_NO_REPLACE_OBJECTS: '1' };
  const primary = mainCheckout(coordinatorRoot);
  let ref = primary?.branch ?? trunkRef(coordinatorRoot);
  const detachedHeadDefault = !primary && !ref;
  if (detachedHeadDefault) ref = 'HEAD';
  if (ref !== 'HEAD' && !ref?.startsWith('refs/heads/')) {
    throw new Refused('NO_TRUNK', 'no trunk branch was recorded; check out the trunk branch in the main checkout once and run pullboard inbox');
  }
  if (!primary) {
    const tip = spawnSync('git', ['--no-replace-objects', 'rev-parse', '--verify', '--quiet', `${ref}^{commit}`], {
      cwd: coordinatorRoot, env, encoding: 'utf8',
    });
    if (tip.status !== 0) {
      throw new Refused('NO_TRUNK', 'the recorded trunk branch has no readable tip; check out the trunk branch in the main checkout once and run pullboard inbox');
    }
    ref = tip.stdout.trim();
  }
  const result = spawnSync('git', ['--no-replace-objects', 'show', `${revision ?? ref}:${path}`], {
    cwd: coordinatorRoot, env, encoding: 'utf8',
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    ...(detachedHeadDefault ? { baseline: 'collision baseline default: detached HEAD' } : {}),
  };
}

/** Find the nearest declared command for a useful typo hint. */
function closestHelpCommand(input) {
  const needle = input.toLowerCase();
  /** Measure edit distance between two command names for a useful typo hint. */
  const distance = (left, right) => {
    let row = Array.from({ length: right.length + 1 }, (_, index) => index);
    for (let i = 1; i <= left.length; i += 1) {
      const next = [i];
      for (let j = 1; j <= right.length; j += 1) {
        next[j] = Math.min(next[j - 1] + 1, row[j] + 1, row[j - 1] + (left[i - 1] === right[j - 1] ? 0 : 1));
      }
      row = next;
    }
    return row.at(-1);
  };
  return Object.keys(HELP.commands).sort((a, b) => distance(needle, a) - distance(needle, b) || a.localeCompare(b))[0];
}

/** Render one command's usage, one-line flags and a pasteable example from the help declaration. */
function commandHelp(name) {
  const entry = HELP.commands[name];
  if (!entry) return null;
  return [
    `Usage: ${entry.usages[0]}`,
    ...entry.usages.slice(1).map((usage) => `       ${usage}`),
    'Flags:',
    ...(entry.flags.length ? entry.flags.map((flag) => `  ${flag}`) : ['  none']),
    ...(name === 'spec' ? [
      'Subcommands:',
      '  pullboard spec --json — agent or person: print the parsed spec and practice rows',
      '  pullboard spec check — agent or person: lint the spec and practice files',
      '  pullboard spec view — agent or person: write the offline spec page',
      '  pullboard spec show <id> — agent or person: inspect one row and its sign-offs',
      '  pullboard spec unmet — agent or person: list approved rows without current sign-off',
      '  pullboard spec draft <text> [--section <letter>] [--aim] [--gate "<gate>"] — any agent: append a draft row; never approve it',
      '  pullboard spec signoff <ids> — person: sign rows with evidence',
      '  pullboard spec signers add — person: register an SSH signing key',
      '  pullboard spec approve <ids> — person: decide from their own terminal or Pullboard View',
      '  pullboard spec decline <ids> — person: decide from their own terminal or Pullboard View',
      '  pullboard spec answer <id> "<choice or text>" — person: answer a pending question from their own terminal or Pullboard View',
      '  pullboard spec apply — coordinator: apply recorded row decisions to the files',
    ] : []),
    'Example:',
    ...entry.example.split('\n').map((line) => `  ${line}`), ...entry.notes,
  ].join('\n');
}

/** Write a selected help view in text and the stable help:string JSON field. */
function printHelp(io, text) {
  io.result?.({ help: text });
  io.say(text);
  return 0;
}

/** Refuse an unknown command with its nearest declared spelling and a route to the full list. */
function unknownCommand(io, input) {
  const closest = closestHelpCommand(input);
  io.err(`pullboard: no command "${input}"; closest match is "${closest}". Run pullboard help --all for the full list.`);
  return 2;
}

/** Resolve overview, command detail or the preserved full list from one invocation. */
function selectedHelp(command, first, second, rest, values) {
  if (command === 'help') {
    if (values.all) return { text: HELP.all };
    const requested = [first, second, ...rest].filter(Boolean).join(' ');
    if (!requested || values.help && !first) return { text: HELP.overview };
    return { name: requested, text: commandHelp(requested) };
  }
  if (values.all && (!command || command === 'help')) return { text: HELP.all };
  if (!command) return { text: HELP.firstRun };
  if (values.help) {
    const words = [command, first, second, ...rest].filter(Boolean);
    const candidates = words.map((_, index) => words.slice(0, index + 1).join(' ')).filter((name) => HELP.commands[name]);
    const nested = candidates.at(-1) ?? command;
    return { name: nested, text: commandHelp(nested) };
  }
  return null;
}

const OPTIONS = {
  criterion: { type: 'string' },
  specs: { type: 'string' },
  parent: { type: 'string' },
  reason: { type: 'string' },
  off: { type: 'boolean' },
  port: { type: 'string' },
  slots: { type: 'string' },
  browser: { type: 'string' },
  node: { type: 'string' },
  root: { type: 'string' },
  project: { type: 'boolean' },
  export: { type: 'string' },
  'no-open': { type: 'boolean' },
  'no-permissions': { type: 'boolean' },
  note: { type: 'string' },
  infra: { type: 'string' },
  'note-file': { type: 'string' },
  by: { type: 'string' },
  key: { type: 'string' },
  out: { type: 'string' },
  watch: { type: 'boolean' },
  after: { type: 'string' },
  brief: { type: 'string' },
  'brief-file': { type: 'string' },
  text: { type: 'string' },
  gate: { type: 'string' },
  aim: { type: 'boolean' },
  doctrine: { type: 'boolean' },
  source: { type: 'string' },
  section: { type: 'string' },
  blueprint: { type: 'string', multiple: true },
  route: { type: 'string' },
  family: { type: 'string' },
  model: { type: 'string' },
  as: { type: 'string' },
  check: { type: 'string' },
  ...SENTINEL_OPTIONS,
  yes: { type: 'boolean' },
  landing: { type: 'boolean' },
  adopt: { type: 'boolean' },
  waive: { type: 'string' },
  until: { type: 'string' },
  agent: { type: 'string' },
  'agent-light': { type: 'string' },
  'agent-mid': { type: 'string' },
  'agent-strong': { type: 'string' },
  attempts: { type: 'string' },
  minutes: { type: 'string' },
  items: { type: 'string' },
  run: { type: 'string' },
  max: { type: 'string' },
  'dry-run': { type: 'boolean' },
  update: { type: 'boolean' },
  before: { type: 'string' },
  target: { type: 'string' },
  next: { type: 'string' },
  add: { type: 'string' },
  remove: { type: 'string' },
  name: { type: 'string' },
  title: { type: 'string' },
  url: { type: 'string' },
  skip: { type: 'string' },
  wait: { type: 'string' },
  verify: { type: 'boolean' },
  build: { type: 'boolean' },
  all: { type: 'boolean' },
  must: { type: 'boolean' },
  json: { type: 'boolean' },
  history: { type: 'boolean' },
  verbose: { type: 'boolean' },
  since: { type: 'string' },
  decision: { type: 'boolean' },
  evidence: { type: 'string' },
  outcome: { type: 'string' },
  item: { type: 'string' },
  kinds: { type: 'string' }, to: { type: 'string' }, work: { type: 'string' }, 'review-wait': { type: 'string' },
  commit: { type: 'string' },
  ref: { type: 'string' },
  supersedes: { type: 'string' },
  conflict: { type: 'string', multiple: true },
  cause: { type: 'string' },
  'never-again': { type: 'boolean' },
  'draft-splits': { type: 'boolean' },
  implies: { type: 'string' },
  owns: { type: 'string' },
  red: { type: 'string' },
  green: { type: 'string' },
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean', short: 'v' },
};

/** Parse --wait as a switch for add/edit and as minutes for next/run, preserving all other options. */
function parseCommandArgs(argv) {
  let command;
  for (const wait of [{ type: 'boolean' }, OPTIONS.wait]) {
    try {
      command = parseArgs({ args: argv, options: { ...OPTIONS, wait }, allowPositionals: true }).positionals[0];
      if (['add', 'edit'].includes(command)) break;
    } catch { /* The final parser supplies the existing actionable usage error. */ }
  }
  const options = ['add', 'edit'].includes(command) ? { ...OPTIONS, wait: { type: 'boolean' } } : OPTIONS;
  return parseArgs({ args: argv, options, allowPositionals: true });
}

/** Start an already-recorded request, recording an unavailable result if its child cannot start. */
async function launchBaseline(ctx, board, id, baseline) {
  try { await startCheckBaseline(ctx.info.root, id, baseline); }
  catch {
    await ordered(ctx, board, 'completeCheckBaseline', [id, { agentId: COORDINATOR, expected: baseline,
      baseline: { command: baseline.command, main: baseline.main, result: 'unavailable', reason: 'background worker could not start; set --check again from the coordinator' } }]);
  }
}

/**
 * A positive whole number from an argument, or a refusal naming what was expected.
 *
 * @param {string | undefined} text
 * @param {string} what
 * @returns {number}
 */
function idArg(text, what = 'an item id') {
  const id = Number(String(text ?? '').replace(/^#/, ''));
  if (!Number.isInteger(id) || id < 1) throw new Refused('USAGE', `expected ${what}, got "${text ?? ''}"`);
  return id;
}

/**
 * A comma list of spec ids from a flag.
 *
 * @param {string | undefined} text
 * @returns {string[]}
 */
const idList = (text) => (text ?? '').split(',').map((id) => id.trim()).filter(Boolean);

/** Parse an edit's dependency replacement, with the explicit word `none` meaning clear all. */
function editAfter(text) {
  if (text === undefined) return undefined;
  if (text.trim() === 'none') return [];
  const parts = text.split(',').map((part) => part.trim());
  if (!text.trim() || parts.some((part) => !part || part === 'none')) {
    throw new Refused('USAGE', 'use --after <id>[,<id>...] or --after none');
  }
  return parts.map((part) => idArg(part, 'an item id after --after'));
}

/**
 * Text a command was given as --<name> "..." or as --<name>-file <file>, or undefined when neither.
 * A file carries text past the shell exactly: backticks, dollar signs and quotes included.
 *
 * @param {any} io
 * @param {any} values
 * @param {string} name
 * @returns {string | undefined}
 */
function textArg(io, values, name) {
  const path = values[`${name}-file`];
  if (values[name] !== undefined && path !== undefined) {
    throw new Refused('USAGE', `give the ${name} once: --${name} "..." or --${name}-file <file>`);
  }
  if (path === undefined) return values[name];
  const file = resolve(io.cwd, path);
  if (!existsSync(file)) throw new Refused('NO_FILE', `no file ${path}`);
  return readFileSync(file, 'utf8');
}

/**
 * The brief a command was given, from --brief or --brief-file.
 *
 * @param {any} io
 * @param {any} values
 * @returns {string | undefined}
 */
const briefArg = (io, values) => textArg(io, values, 'brief');

/**
 * The start of a command an agent can paste anywhere: agent shells often start each command in the
 * main checkout, so every command pullboard suggests names its folder (I5).
 *
 * @param {string} root
 * @returns {string}
 */
const shellWord = (text) => (/^[\w@%+=:,./-]+$/.test(text) ? text : `'${text.replaceAll("'", "'\\''")}'`);

/**
 * `cd <folder> &&`, the folder quoted for any POSIX shell: single quotes, so a space, a quote or a
 * dollar sign in the path reaches cd as written (I7).
 *
 * @param {string} root
 * @returns {string}
 */
const cdTo = (root) => `cd ${shellWord(root)} &&`;

/**
 * Verifying from the main checkout files the verdict as the coordinator's (V9). An agent whose
 * shell started there would be taken for the coordinator, so the coordinator says so explicitly
 * and anyone else is sent back to a worktree.
 *
 * @param {any} ctx
 * @param {any} board
 * @param {any} values
 */
function checkMainVerifier(ctx, board, values) {
  if (values.as !== undefined && values.as !== COORDINATOR) throw new Refused('USAGE', '--as takes one value: coordinator');
  if (!ctx.info.isMain) {
    if (values.as) throw new Refused('USAGE', '--as coordinator works only in the main checkout; here you are the agent this worktree joined as');
    return;
  }
  if (values.as === COORDINATOR) return;
  const agents = store.listAgents(board).filter((agent) => agent.agent_id !== COORDINATOR);
  const listed = agents.length ? ` Agent worktrees: ${agents.slice(0, 6).map((agent) => `${displayAgentName(agent, ctx.config.agents.names)} at ${agent.agent_path}`).join('; ')}.` : '';
  const detached = tryGit(ctx.info.root, ['symbolic-ref', '-q', 'HEAD']).status !== 0 ? ' The main checkout is not on its branch; whoever switched it puts it back.' : '';
  throw new Refused('MAIN_IS_COORDINATOR',
    `this is the main checkout, so this verdict would be the coordinator's.${listed}${detached}`,
    reviewerStartup(ctx.info.root, ctx.config, values.verifyId),
  );
}

/**
 * Select the person actor only through the main checkout's explicit person mode (B26).
 *
 * @param {any} ctx
 * @param {{ id: string }} me
 * @param {{ as?: string }} values
 * @returns {boolean}
 */
function personMode(ctx, me, values) {
  if (values.as === undefined) return false;
  if (values.as !== 'person') throw new Refused('USAGE', '--as person is supported for answer, decisions and fact --never-again');
  if (!ctx.info.isMain || me.id !== COORDINATOR) {
    throw new Refused('B26_PERSON_ANSWER', 'only the main checkout can act as the person; ask your coordinator to answer or pass this decision');
  }
  return true;
}

/**
 * Refuse a build item in a lane that owns no files, such as review: whoever claims it there can
 * commit nothing, so the item strands its builder. A review item, one that waits on the work it
 * reviews with --after, still goes there. The refusal names the lanes that own files [I1].
 * Until some lane owns files, as right after init, there is nowhere else to point, so the item is
 * added as before.
 *
 * @param {any} config
 * @param {string} lane
 * @param {number[]} after
 */
function buildInFilelessLane(config, lane, after) {
  const owns = (name) => (config.lanes[name]?.owns ?? []).length > 0;
  if (lane === COORDINATOR || owns(lane) || after.length) return;
  const owning = Object.keys(config.lanes).filter(owns);
  if (!owning.length) return;
  throw new Refused('NO_FILES_LANE', `the ${lane} lane owns no files, so a build item there strands its builder; file it in a lane that owns files (${owning.join(', ')}), or pass --after <id> if it reviews that item`);
}

/**
 * A brief whose Files section stays inside the item's lane (B14), so a builder working from it
 * never runs into the lane check: an item's files sit in its lane.
 *
 * @param {any} ctx
 * @param {string} lane
 * @param {string} brief
 * @returns {string}
 */
function briefInLane(ctx, lane, brief) {
  const foreign = outOfLane(ctx.config, lane, briefFiles(brief));
  if (foreign.length) {
    throw new Refused('BRIEF_LANE', `the brief names files outside the ${lane} lane: ${foreign.join(', ')}; split the item by lane, or wait on the other lane's item with --after`);
  }
  return brief;
}

/**
 * Print an item's brief, indented under a heading, when it has one.
 *
 * @param {any} io
 * @param {string} brief
 */
function sayBrief(io, brief) {
  if (!brief) return;
  io.say('brief:');
  brief.split('\n').forEach((line) => io.say(`  ${line}`.trimEnd()));
}

/**
 * Everything a command needs: the repo, its config, the board's file, and where output goes.
 *
 * @param {any} io
 * @returns {any}
 */
function context(io) {
  const info = repoInfo(io.cwd);
  if (info.isMain) io.caller?.('coordinator', info.root);
  const allowSchemaUpgrade = codeIsFromMain();
  const config = configHere(info);
  const file = join(info.commonDir, 'pullboard', 'board.sqlite');
  return { info, config, file, allowSchemaUpgrade, doctrine: loadDoctrine(info.root, config), io, clock: io.clock ?? store.systemClock };
}

/**
 * This checkout's config. Init is the fix only where pullboard never was (C4): a config deleted
 * from a checkout whose last commit has it is restored, and a linked worktree made from a commit
 * that lacks it, beside a main checkout that has one, is made again from there.
 *
 * @param {{ root: string, commonDir: string, isMain: boolean }} info
 * @returns {any}
 */
function configHere(info) {
  try {
    return loadConfig(info.root);
  } catch (error) {
    if (!(error instanceof Refused) || error.code !== 'NO_CONFIG') throw error;
    if (tryGit(info.root, ['cat-file', '-e', `HEAD:${CONFIG_FILE}`]).status === 0) {
      throw new Refused('NO_CONFIG', `${CONFIG_FILE} is deleted here, though this checkout's last commit has it: restore it: ${cdTo(info.root)} git checkout HEAD -- ${CONFIG_FILE}`);
    }
    const mainRoot = resolve(info.commonDir, '..');
    if (info.isMain || !existsSync(join(mainRoot, CONFIG_FILE))) throw error;
    let setup;
    try {
      setup = uncommittedSetup(mainRoot, loadConfig(mainRoot));
    } catch {
      // Keep the existing recovery for invalid or incomplete main-checkout configuration.
    }
    if (setup) {
      throw new Refused(
        'NO_CONFIG',
        `this worktree has no ${CONFIG_FILE}, and the main checkout has uncommitted Pullboard setup files: ${setup.files.join(', ')}. Commit them in the main checkout first: ${setup.stage}`,
      );
    }
    throw new Refused(
      'NO_CONFIG',
      `this worktree's commit has no ${CONFIG_FILE}, though the main checkout has one: make a new worktree from the main checkout, which says what to commit first: ${cdTo(mainRoot)} pullboard worktree <lane> --model "<model name>"`,
    );
  }
}

/**
 * Open the board, run `work`, and always close it.
 *
 * @template T
 * @param {any} ctx
 * @param {(board: any) => T} work
 * @returns {T}
 */
function withBoard(ctx, work) {
  const board = store.openBoard(ctx.file, ctx.clock, { isMain: ctx.allowSchemaUpgrade });
  const firstEvent = board.emittedEvents?.length ?? 0;
  /** Forward committed events before releasing either synchronous or asynchronous work. */
  const finish = () => {
    for (const event of board.emittedEvents?.slice(firstEvent) ?? []) ctx.io.onEvent?.(event);
    store.closeBoard(board);
  };
  let result;
  try {
    // Reuse the already-open board to identify a registered seat, without another lock or migration.
    if (ctx.io.caller && !ctx.info.isMain && !ctx.io.callerKnown?.(ctx.info.root) && store.agentAt(board, ctx.info.root)) ctx.io.caller('seat', ctx.info.root);
    result = work(board);
  }
  catch (error) { finish(); throw error; }
  if (result && typeof result.then === 'function') return result.finally(finish);
  finish();
  return result;
}

/**
 * Reserve a new row's id on the board in one write transaction before any file names it, so writers
 * that plan the same id at the same moment get distinct ids (#878). written: the caller writes the row
 * into its own file now; otherwise it is a lane draft that spec apply writes. With no board yet there is
 * no other writer, and the planned id stands.
 */
async function reserveRow(ctx, row, written) {
  if (!existsSync(ctx.file)) return row;
  return withBoard(ctx, async (board) => ordered(ctx, board, 'draftSpecRow', [{ agentId: store.agentAt(board, ctx.info.root)?.agent_id ?? whoAmI(ctx, board).id, row, written }]));
}

/** Dispatch a board mutation locally, or seal it before any linked replica applies it. */
/** Note the session behind a claim or submit (#921): its ledger must be writable before the move, and record after it. */
async function withItemSession(info, operation, args, move) { const noted = operation === 'claim' || operation === 'submit'; if (noted) itemSessions.requireLedger(info); const result = await move(); if (noted) itemSessions.recordItemSession(info, args[0], operation); return result; }

async function ordered(ctx, board, operation, args) {
  // Every engine-27 registration records the seat that made it: the coordinator from the main
  // checkout, the joined agent from its worktree, or `machine` for a join no seat made (#579).
  if (operation === 'register' && args[0] && args[0].createdBy === undefined) {
    const joined = store.agentAt(board, ctx.info.root)?.agent_id;
    args = [{ ...args[0], createdBy: ctx.info.isMain ? COORDINATOR : joined ?? 'machine' }, ...args.slice(1)];
  }
  const command = ['add', 'edit', 'merged'].includes(ctx.io.relayCommand?.cliOperation) ? ctx.io.relayCommand : undefined;
  /** Dispatch while this session holds the checkout, including long-running next/run loops. */
  const execute = () => withItemSession(ctx.info, operation, args, () => relayLinked(ctx.info.root) || relayRecovered(ctx.info.root)
    ? relayOperation(ctx.info.root, operation, args, ctx.io, command, () => store[operation](board, ...args)) : store[operation](board, ...args));
  const digest = agentSessionDigest();
  const boardOnly = CHECKOUT_BOARD_ONLY.get(ctx.io);
  const boardOnlyOperation = (boardOnly === 'shout' && operation === 'shout') || (boardOnly === 'fact' && operation === 'appendFact');
  const boardOnlyAgent = ctx.info.isMain ? COORDINATOR : store.agentAt(board, ctx.info.root)?.agent_id ?? 'unjoined agent';
  if (boardOnlyOperation && digest && localSessionMatches(ctx.info, { agent: boardOnlyAgent, digest })) return execute();
  if (CHECKOUT_LEASES.has(ctx.io) || !digest || ctx.io.personChannel === 'view' || ctx.io.personRequest) return execute();
  const agent = ctx.info.isMain ? COORDINATOR : store.agentAt(board, ctx.info.root)?.agent_id ?? 'unjoined agent';
  const lease = await bindLocalSession(ctx.info, { agent, digest, keepLease: true });
  try { return await execute(); }
  finally { lease.release(); }
}

/** Order a claim on every route (claim, next, run) only after a check green on main is not held [V4]. */
async function claimOrdered(ctx, board, args) {
  refuseClaimProvesNothing(ctx.info.root, board, args[0]);
  return await ordered(ctx, board, 'claim', args);
}

/** Check ownership before sync or command side effects; reads and authenticated person channels keep their identity. */
async function bindCheckoutSession(io, positionals, values) {
  if (values.help || values.version || io.personChannel === 'view' || io.personRequest) return;
  const [command, first] = positionals;
  if (command === 'takeover' && (positionals.length !== 1 || Object.keys(values).some((key) => key !== 'json'))) {
    throw new Refused('USAGE', 'pullboard takeover takes no arguments; run pullboard takeover [--json]');
  }
  const writes = ['init', 'join', 'worktree', 'hooks', 'hook', 'skills', 'add', 'edit', 'fact', 'escalate', 'run', 'sweep',
    'next', 'claim', 'hold', 'release', 'submit', 'done', 'verify', 'check', 'merged', 'land', 'withdraw', 'refreeze', 'reopen', 'shout', 'answer', 'pass', 'import', 'milestone', 'takeover', 'forget'];
  if (!writes.includes(command) && !(command === 'lane' && first === 'add') && !(command === 'settings' && first) && !(command === 'spec' && first === 'apply') && !(command === 'relay' && ['on', 'off'].includes(first))) return;
  if (command === 'answer' && values.as === 'person') return;
  const digest = agentSessionDigest();
  if (!digest) {
    if (command === 'takeover') throw new Refused('AGENT_SESSION', 'takeover belongs to an agent session; run pullboard takeover from the agent’s shell');
    return;
  }
  if (command === 'check') {
    // Acceptance follows its person-channel path; it does not renew a build claim.
    if (first === 'accept') return;
    const ctx = context(io);
    const renewsOwnClaim = withBoard(ctx, (board) => {
      const agentId = ctx.info.isMain ? COORDINATOR : store.agentAt(board, ctx.info.root)?.agent_id;
      const item = first ? store.getItem(board, idArg(first)) : store.listItems(board)
        .find((entry) => entry.item_status === 'claimed' && entry.item_owner === agentId && entry.item_parent_id === null);
      return Boolean(agentId && item?.item_status === 'claimed' && item.item_owner === agentId);
    });
    // A named peer's check remains read-only. An owned check can renew, so acquire checkout
    // authority before joining the gate queue, in the same order as submit and verify.
    if (!renewsOwnClaim) return;
  }
  const info = repoInfo(io.cwd);
  let agent = info.isMain ? COORDINATOR : null;
  if (!info.isMain) {
    const ctx = context(io);
    agent = withBoard(ctx, (board) => store.agentAt(board, info.root)?.agent_id
      ?? (command === 'hook' && store.landingBatches(board).some((batch) => batch.root === info.root && !['landed', 'blocked'].includes(batch.state)) ? COORDINATOR : null));
    if (!agent && command !== 'join') throw withBoard(ctx, (board) => seatCheckout.unjoinedRefusal(info, store.listAgents(board)));
  }
  if (['shout', 'fact'].includes(command) && localSessionMatches(info, { agent: agent ?? 'unjoined agent', digest })) {
    CHECKOUT_BOARD_ONLY.set(io, command);
    return;
  }
  const lease = await bindLocalSession(info, { agent: agent ?? 'unjoined agent', digest, takeover: command === 'takeover', keepLease: !['run', 'next'].includes(command), waitLimitMs: command === 'hook' ? HOOK_CHECKOUT_WAIT_MS : 0,
    /** Use an existing ordered shout so takeover has a receipt without changing the board format. */
    recordTakeover: async () => {
      const ctx = context(io);
      await withBoard(ctx, async (board) => {
        const me = whoAmI(ctx, board);
        const message = { from: me.id, to: info.isMain ? 'person' : COORDINATOR,
          text: `${me.displayName} took over this checkout in a new agent session.`, lanes: laneNames(ctx.config) };
        if (relayLinked(info.root)) await relayOperation(info.root, 'shout', [message], io, undefined, () => store.shout(board, message));
        else store.shout(board, message);
      });
    },
  });
  if (agent) return { lease };
  /** Replace the temporary identity after a successful first join, retaining the winning session. */
  return { lease, finish: async () => {
    const ctx = context(io);
    const me = withBoard(ctx, (board) => whoAmI(ctx, board));
    lease.updateAgent(me.id);
  } };
}

/** Choose an explicitly supplied model or the standard environment fallback, refusing an unknown identity. */
function requiredModel(value, env = process.env, commandNext) {
  const model = (value ?? env.PULLBOARD_MODEL ?? '').trim();
  if (!model || /[\u0000-\u001f\u007f-\u009f]/u.test(model)) {
    const suffix = commandNext ? `; run pullboard ${commandNext} --model "<model name>"` : '';
    const message = commandNext
      ? `this session has not declared its model${suffix}`
      : 'give --model "<model name>" or set PULLBOARD_MODEL in this shell before joining';
    throw new Refused('MODEL_REQUIRED', message);
  }
  return model;
}

/** Resolve an optional coordinator declaration while preserving the legacy unknown identity. */
function optionalModel(value, env = process.env) {
  if (value === undefined && !env.PULLBOARD_MODEL) return undefined;
  return requiredModel(value, env);
}

/** Refuse to redeclare a coordinator whose linked board belongs to another checkout. */
function refuseRemoteCoordinatorModel(ctx, command) {
  const coordinator = withBoard(ctx, (board) => store.listAgents(board).find((agent) => agent.agent_id === COORDINATOR));
  if (!coordinator) throw new Refused('NO_AGENT', 'the linked snapshot has no coordinator; restore a consistent relay snapshot before initializing');
  if (ctx.info.isMain && coordinator.agent_path === ctx.info.root) return;
  const name = displayAgentName(coordinator, ctx.config.agents.names);
  throw new Refused('REMOTE_COORDINATOR_MODEL', `the coordinator's model is declared on the coordinator's own checkout (${name}); run pullboard ${command} there`);
}

/**
 * Who is asking: the coordinator in the main checkout, or the agent this worktree joined as.
 *
 * @param {any} ctx
 * @param {any} board
 * @returns {{ id: string, lane: string, route?: string, family: string | null, model: string | null, displayName: string }}
 */
function whoAmI(ctx, board) {
  if (ctx.info.isMain) {
    ctx.io.caller?.('coordinator', ctx.info.root);
    const registered = store.listAgents(board).find((agent) => agent.agent_id === COORDINATOR);
    const linked = relayLinked(ctx.info.root);
    if (linked && !registered) throw new Refused('NO_AGENT', 'the linked snapshot has no coordinator; restore a consistent relay snapshot before acting');
    const id = linked ? COORDINATOR : store.ensureCoordinator(board, ctx.info.root);
    const agent = registered ?? store.agentAt(board, ctx.info.root);
    return { id, lane: COORDINATOR, family: agent?.agent_family ?? null, model: agent?.agent_model ?? 'unknown', displayName: displayAgentName(agent ?? { agent_id: id }, ctx.config.agents.names) };
  }
  const agent = store.agentAt(board, ctx.info.root);
  if (!agent) {
    throw new Refused('NOT_JOINED', 'this worktree has not joined a lane: pullboard join <lane> --model "<model name>" (see: pullboard lanes)');
  }
  ctx.io.caller?.('seat', ctx.info.root);
  return { id: agent.agent_id, lane: agent.agent_lane, route: agent.agent_route, family: agent.agent_family ?? null, model: agent.agent_model ?? 'unknown', displayName: displayAgentName(agent, ctx.config.agents.names) };
}

/**
 * Freeze a criterion from committed policy, refreshing trunk policy only on an explicit refreeze.
 *
 * @param {any} ctx
 * @param {{ captureVerifyPolicy?: boolean }} [options]
 * @returns {(item: any) => { text: string, digest: string }}
 */
function freezer(ctx, { captureVerifyPolicy = false, board } = {}) {
  /** Freeze the criterion and, when requested, the trunk lane and verifier policy. */
  return (item) => {
    const prior = item.item_frozen ? JSON.parse(item.item_frozen) : null;
    const needsPinnedPolicy = !prior || captureVerifyPolicy;
    let policy = prior?.policy ?? null;
    if (needsPinnedPolicy && !(ctx.info.isMain && !headCommit(ctx.info.root))) {
      policy = { version: 1, commit: mainPolicy(ctx.info.root).commit };
    }
    let config;
    if (policy && needsPinnedPolicy) {
      const commit = /^[0-9a-f]{40,64}$/.test(policy.commit ?? '')
        ? policy.commit
        : (/^[0-9a-f]{40,64}$/.test(item.item_claim_head ?? '') ? item.item_claim_head : mainPolicy(ctx.info.root).commit);
      config = policyAt(ctx.info.root, commit).config;
      policy = { version: 1, commit, verify: { policy: config.verify.policy, family: config.verify.family } };
    } else {
      config = policy ? itemPolicy(ctx.info.root, { ...item, item_frozen: JSON.stringify({ policy }) }).config : ctx.config;
    }
    const doctrine = board ? agentDoctrine(ctx, board) : loadDoctrine(ctx.info.root, config);
    const frozen = frozenCriterion(loadSpec(ctx.info.root, config), item, doctrine);
    if (!policy) return frozen; // Legacy criteria retain their original digest and committed claim base.
    const text = JSON.stringify({ ...JSON.parse(frozen.text), policy });
    return { text, digest: createHash('sha256').update(text).digest('hex') };
  };
}

/** Merge a safe main fast-forward before freezing rows that only main has [V1].
 *
 * @param {any} ctx
 * @param {any} item
 * @returns {string[]|null} Missing rows merged from main, or null when no merge was needed.
 */
function prepareClaimSpec(ctx, item) {
  if (item.item_frozen) return null;
  const ids = (item.item_spec_ids ?? '').split(',').map((id) => id.trim()).filter((id) => id && !id.startsWith('doctrine:'));
  if (!ids.length) return null;
  const root = ctx.info.root;
  const main = mainCheckout(root);
  if (!main?.commit) return null;
  const policy = policyAt(root, main.commit);
  const mainSource = tryGit(root, ['show', `${main.commit}:${policy.config.spec}`]);
  if (mainSource.status !== 0) return null;
  const mainRows = new Set(parseSpec(mainSource.stdout).rows.map((row) => row.id));
  const localRows = new Set(loadSpec(root, ctx.config).rows.map((row) => row.id));
  const missing = [...new Set(ids)].filter((id) => mainRows.has(id) && !localRows.has(id));
  if (!missing.length) return null;

  const head = headCommit(root);
  const symbolic = tryGit(root, ['symbolic-ref', '--quiet', 'HEAD']);
  const canFastForward = Boolean(head && symbolic.status === 0 && isClean(root) && untracked(root).length === 0 && contains(root, head, main.commit));
  if (!canFastForward) throw specBehindMain(policy.config.spec, missing);
  try {
    git(root, ['merge', '--ff-only', main.commit]);
    if (headCommit(root) !== main.commit) throw new Error('main moved during the fast-forward');
  } catch {
    throw specBehindMain(policy.config.spec, missing);
  }
  Object.assign(ctx, context(ctx.io));
  return missing;
}

/** Carry a safe main fast-forward out of the board transaction so claim can retry at the new HEAD. */
class MainSpecMerged extends Error {
  /** Preserve the rows needed for the caller's one-line merge notice.
   * @param {string[]} rows
   */
  constructor(rows) {
    super('main advanced to include the claimed spec rows');
    this.rows = rows;
  }
}

/** Prepare the criterion after the board's other claim guards have passed.
 *
 * @param {any} ctx
 * @returns {(item: any) => { text: string, digest: string }}
 */
function claimFreezer(ctx, board) {
  return (item) => {
    const rows = prepareClaimSpec(ctx, item);
    if (rows) throw new MainSpecMerged(rows);
    return freezer(ctx, { board })(item);
  };
}

/** Explain why an out-of-date spec cannot be merged automatically.
 *
 * @param {string} specName
 * @param {string[]} rows
 * @returns {Refused}
 */
function specBehindMain(specName, rows) {
  return new Refused('SPEC_BEHIND_MAIN', `${specName} is missing rows ${rows.join(', ')} that exist on main; commit or resolve local work, then merge main and retry`);
}

/**
 * The evidence a shout carries, from its flags (B22). The commit is resolved here, in this repo,
 * so the board only ever stores a full SHA that names a real commit.
 *
 * @param {any} ctx
 * @param {any} values
 * @returns {{ kind: string, outcome: string, item: number, commit: string }}
 */
function evidenceFrom(ctx, values) {
  const rev = values.commit ?? '';
  const resolved = rev ? tryGit(ctx.info.root, ['rev-parse', '--verify', '--quiet', `${rev}^{commit}`]) : { status: 1, stdout: '' };
  if (resolved.status !== 0) throw new Refused('BAD_EVIDENCE', `evidence names a commit in this repo: --commit <rev> (saw "${rev}")`);
  const item = /^\d+$/.test(values.item ?? '') ? Number(values.item) : NaN;
  return { kind: values.evidence, outcome: values.outcome ?? '', item, commit: resolved.stdout };
}

/**
 * A shout's evidence as one line: its kind, outcome, item and commit (B22).
 *
 * @param {any} shout
 * @returns {string}
 */
const evidenceLine = (shout) => `${shout.shout_evidence_kind}: ${shout.shout_evidence_outcome}, #${shout.shout_evidence_item} at ${shout.shout_evidence_commit.slice(0, 12)}`;

/** How many characters of an earlier verdict's note show prints (N30). */
const NOTE_LINE = 120;

/**
 * A note's first line, cut to NOTE_LINE characters with … marking the cut. A line ends at any break
 * Unicode makes mandatory (UAX #14): LF, VT, FF, CR, CRLF, NEL, LS and PS. Characters are counted
 * as a reader sees them, so a cut never splits an emoji or an accented letter.
 *
 * @param {string} note
 * @returns {string}
 */
function firstLineOf(note) {
  const line = note.split(/[\n\v\f\r\x85\u2028\u2029]/)[0];
  const characters = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(line)];
  return characters.length > NOTE_LINE ? `${characters.slice(0, NOTE_LINE).map((part) => part.segment).join('')}…` : line;
}

/**
 * One item on one line: id, status and holder, lane, title, spec ids.
 *
 * @param {any} item
 * @returns {string}
 */
function itemLine(item, name = (id) => id, mainMerge = false) {
  const holder = item.item_status === 'claimed' ? ` ${name(item.item_owner)}` : '';
  const verifier = item.item_status === 'verified' ? ` by ${name(item.item_verified_by)}` : '';
  const specs = item.item_spec_ids ? `  [${item.item_spec_ids}]` : '';
  const parent = item.item_parent_id ? `  under #${item.item_parent_id}` : '';
  const after = item.item_after ? `  after ${item.item_after.split(',').map((id) => `#${id}`).join(',')}` : '';
  const rejected = item.item_status === 'open' && item.item_verdict === 'REJECT' ? ' (rejected)' : mainMerge ? ` (${MAIN_MERGE_LABEL})` : '';
  const light = item.item_route === 'strong' ? '' : `  ${item.item_route}`;
  const staleVerdict = item.item_verdict_state ? `  ${item.item_verdict_state.code}` : '';
  const hold = item.item_hold_reason ? `  held by ${name(item.item_hold_by)}: ${item.item_hold_reason}` : '';
  return `#${item.item_id}  ${item.item_status}${holder}${verifier}${rejected}  ${item.item_lane}  ${item.item_title}${specs}${parent}${after}${light}${hold}${staleVerdict}`;
}

/** Format a stable agent id for human-facing CLI output. */
function agentDisplayName(agents, config, id) {
  if (!id) return '';
  const agent = agents.find((entry) => entry.agent_id === id);
  if (agent) return displayAgentName(agent, config.agents.names);
  if (id === 'person' || id === 'all' || Object.hasOwn(config.lanes, id)) return id;
  return displayAgentName({ agent_id: id }, config.agents.names);
}

/** Render only declared actor positions in a refusal, preserving user text and stable JSON ids. */
function agentRefusalText(message, code, name) {
  const patterns = {
    ALREADY_JOINED: /^(\[ALREADY_JOINED\] this worktree is )(\S+)( in )/,
    HELD: /^(\[HELD\] item #\d+ is held by )(\S+)( until )/,
    ITEM_HELD: /^(\[ITEM_HELD\] item #\d+ is held by )(\S+)(: )/,
    LANE_HELD: /^(\[LANE_HELD\] )(\S+)( holds the )/,
    REVIEW_HELD: /^(\[REVIEW_HELD\] )(\S+)( holds the )/,
    NOT_YOURS: /^(\[NOT_YOURS\] only the coordinator or )(\S+)(, who )/,
    NO_AGENT: /^(\[NO_AGENT\] no (?:registered )?agent )(\S+)(;|$)/,
    NOT_YOUR_CHECKOUT: /^(\[NOT_YOUR_CHECKOUT\] this checkout belongs to )(\S+)( in )/,
    FACT_JUDGEMENT: /^(\[FACT_JUDGEMENT\] only the item's live holder \()(\S+)(\))/,
    RELAY_PERSON_ONLY: /^(\[RELAY_PERSON_ONLY\] agent )(\S+)( cannot )/,
    SELF_SHOUT: /^(\[SELF_SHOUT\] a shout cannot be addressed to its sender )(\S+)(;)/,
    NO_READER: /^(\[NO_READER\] nobody reads ")(.*?)(":)/,
  };
  if (code === 'RELAY_SENDER_MISMATCH') {
    return message.replace(/^(\[RELAY_SENDER_MISMATCH\] agent )(\S+)( cannot act as )(.*?)(; send this operation)/,
      (_, before, sender, middle, actor, after) => `${before}${name(sender)}${middle}${actor === '(no declared agent)' ? actor : name(actor)}${after}`);
  }
  if (code === 'NOT_YOUR_DECISION') {
    return message.replace(/^(\[NOT_YOUR_DECISION\] shout #\d+ is addressed to )(\S+)(, not your \S+ lane \(agent )(\S+)(\))$/,
      (_, before, to, middle, caller, after) => `${before}${name(to)}${middle}${name(caller)}${after}`);
  }
  return patterns[code] ? message.replace(patterns[code], (_, before, id, after) => `${before}${name(id)}${after}`) : message;
}

/** Render the refusal body without its existing final footer; structured errors retain the message. */
function displayedRefusal(io, error) {
  const message = io.guidance(error.message.replace(/\r?\nnext:[ \t]*[^\r\n]*\S[ \t]*(?:\r?\n)*$/u, ''));
  if (error.code === 'MODEL_REQUIRED') return message.replace(/; run pullboard .+$/u, '');
  if (!['ALREADY_JOINED', 'HELD', 'ITEM_HELD', 'LANE_HELD', 'REVIEW_HELD', 'NOT_YOURS', 'NOT_YOUR_DECISION', 'NO_AGENT', 'NOT_YOUR_CHECKOUT', 'FACT_JUDGEMENT', 'RELAY_PERSON_ONLY', 'RELAY_SENDER_MISMATCH', 'SELF_SHOUT', 'NO_READER'].includes(error.code)) return message;
  try {
    const ctx = context(io);
    const agents = withBoard(ctx, (board) => store.listAgents(board));
    return agentRefusalText(message, error.code, (id) => agentDisplayName(agents, ctx.config, id));
  } catch { return message; }
}

/** Label the holder at the start of a generated wait reason without rewriting its quoted reason. */
function displayedWait(reason, agents, config) {
  return reason.replace(/^(\S+)( holds the )/, (_, id, rest) => `${agentDisplayName(agents, config, id)}${rest}`)
    .replace(/^(#\d+ is held by )(\S+)(: )/, (_, before, id, after) => `${before}${agentDisplayName(agents, config, id)}${after}`);
}

/**
 * The files an agent has been working in (N20): what its latest three items touched, and what is
 * uncommitted in its worktree now.
 *
 * @param {any} ctx
 * @param {any} board
 * @param {{ id: string }} me
 * @returns {string[]}
 */
function warmFiles(ctx, board, me) {
  const recent = store
    .listItems(board, { all: true })
    .filter((item) => item.item_built_by === me.id)
    .sort((first, second) => second.item_updated_at.localeCompare(first.item_updated_at))
    .slice(0, 3)
    .flatMap((item) => store.itemFiles(item));
  return [...new Set([...recent, ...dirtyFiles(ctx.info.root)])];
}

/**
 * The paths with uncommitted changes in a worktree, untracked files included.
 *
 * @param {string} root
 * @returns {string[]}
 */
function dirtyFiles(root) {
  return tryGit(root, ['status', '--porcelain', '--untracked-files=all']).stdout.split('\n').filter(Boolean).map((line) => line.slice(3));
}

/**
 * The files an item's own commits changed since its claim (N21). First parents only, so main merged
 * into a lane branch is not counted as the item's work; and nothing another item submitted, such as
 * a verified dependency fast-forwarded in, which merges no commit to skip.
 *
 * @param {string} root
 * @param {number} id
 * @param {string | null} from
 * @param {string} to
 * @returns {string[]}
 */
function filesSince(root, id, from, to) {
  if (!from) return [];
  const others = [`--exclude=refs/pullboard/items/${id}/*`, '--glob=refs/pullboard/items/*'];
  const result = tryGit(root, ['log', '--first-parent', '--no-merges', '--no-renames', '--format=', '--name-only', to, '--not', from, ...others]);
  return result.status === 0 ? [...new Set(result.stdout.split('\n').filter(Boolean))].sort() : [];
}

/** Refuse a candidate containing another item's unverified submitted commit [V1].
 *
 * Trunk-reachable commits are already landed, including when the candidate is trunk itself.
 * Inspect all remaining reachable commits, including merged topic parents.
 *
 * @param {string} root
 * @param {any} board
 * @param {any} item
 * @param {string} commit
 * @param {{ ref: string, commit: string } | null} trunk
 * @returns {void}
 */
function refuseUnverifiedStack(root, board, item, commit, trunk) {
  const trunkRange = trunk?.commit
    ? tryGit(root, ['rev-list', `${trunk.commit}..${commit}`])
    : { status: 1, stdout: '' };
  if (trunkRange.status !== 0) {
    throw new Refused('NO_POLICY', 'the current trunk range cannot be read; restore Git history and retry the submit or verification');
  }
  const commits = new Set(trunkRange.stdout.split('\n').filter(Boolean));
  const stacked = store.unverifiedSubmissions(board)
    .find((other) => other.item_id !== item.item_id && commits.has(other.item_commit));
  if (stacked) {
    throw new Refused(
      'STACKED_ON_UNVERIFIED',
      `#${item.item_id} includes unverified item #${stacked.item_id} at ${stacked.item_commit}; wait for #${stacked.item_id} to be accepted or rebuild without its commits before continuing`,
    );
  }
}

/** Return the durable outcome only when a recovered move exactly matches its original receipt. */
function recordedRecovery(board, move) {
  const receipt = engineReceipt(board, move.id);
  return receipt?.move === JSON.stringify(move) ? receipt : null;
}

/**
 * How long ago an ISO time was, or how long until it, in the board's clock: 45m, 3h, 2d.
 *
 * @param {any} ctx
 * @param {string} iso
 * @returns {string}
 */
function span(ctx, iso) {
  const minutes = Math.round(Math.abs(ctx.clock.now().getTime() - Date.parse(iso)) / 60_000);
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 48 * 60) return `${Math.round(minutes / 60)}h`;
  return `${Math.round(minutes / 1440)}d`;
}

/**
 * A shout's text cut to one short line.
 *
 * @param {string} text
 * @returns {string}
 */
const firstLine = (text) => {
  const line = String(text).split('\n')[0];
  return line.length > 100 ? `${line.slice(0, 99)}…` : line;
};

/** The next step for an agent holding a claim: build it and submit. */
const buildNext = (card) => `build #${card.holding[0].item_id}, commit, then pullboard submit ${card.holding[0].item_id}`;

/** The next step for an agent whose work came back: rework it. */
const reworkNext = (card) => `pullboard claim ${card.sentBack[0].item.item_id}, fix what the verifier found, and submit again`;

/**
 * The coordinator's next step, from the board and the spec (N32): the spec with the person first,
 * then its own work in hand, then verdicts, merges, builders and the plan, so an agent that runs the
 * team by the run guide knows where it is. A working board with no spec rows can keep building.
 *
 * @param {any} card
 * @param {{ id: string, status: string }[]} rows
 * @returns {string}
 */
function coordinatorNext(card, rows) {
  if (card.requests.length) return `answer request #${card.requests[0].shout_id}: pullboard answer ${card.requests[0].shout_id} done, or declined <reason>`;
  const live = rows.filter((row) => !['wont', 'retired'].includes(row.status));
  if (!live.length && (rows.length || !card.all.length)) return "turn what the person wants into spec rows with them: the pullboard-decompose skill (pullboard prompt decompose)";
  const approved = live.filter((row) => row.status === 'approved');
  if (live.length && !approved.length) return 'the person approves rows in SPEC.md; then plan them: the pullboard-plan skill';
  if (card.holding.length) return buildNext(card);
  if (card.sentBack.length) return reworkNext(card);
  if (card.toVerify.length) return 'pullboard next --verify --as coordinator, or a verifier that built nothing: pullboard worktree review --model "<model name>"';
  if (card.toMerge.length) {
    const [first] = card.toMerge;
    return `merge #${first.item_id}: git merge --no-edit ${(first.item_checked_commit ?? first.item_commit).slice(0, 12)}, run the gate, then pullboard merged ${first.item_id} <merge commit>`;
  }
  if (card.staleVerdicts?.length) {
    const item = card.staleVerdicts[0];
    return staleVerdictRefusal(item, item.item_verdict_state).message.replace(/^\[STALE_VERDICT\] /u, '');
  }
  if (card.open.length) {
    const lanes = [...new Set(card.open.map((item) => item.item_lane))];
    return `start a builder for each lane with open items (${lanes.join(', ')}): pullboard worktree <lane> --model "<model name>", then the pullboard-run skill`;
  }
  const cited = new Set(card.all.flatMap((item) => (item.item_spec_ids ?? '').split(',').filter(Boolean)));
  const unplanned = approved.filter((row) => !cited.has(row.id));
  if (unplanned.length) {
    return `plan the approved rows no item cites (${unplanned.slice(0, 4).map((row) => row.id).join(', ')}${unplanned.length > 4 ? ', ...' : ''}): the pullboard-plan skill`;
  }
  return 'nothing open: report what was built to the person, or curate the queue: pullboard add, edit, hold';
}

/** Read each actor's newest structured integration attempt unless their later receipt closes it. */
function integrationClaims(root, item, shouts, now) {
  const actors = new Map();
  for (const shout of shouts) {
    if (shout.shout_evidence_item !== item.item_id) continue;
    if (shout.shout_evidence_kind === 'receipt') actors.delete(shout.shout_from);
    else if (shout.shout_evidence_kind === 'attempt' && shout.shout_evidence_outcome === 'integrating'
      && contains(root, item.item_checked_commit ?? item.item_commit, shout.shout_evidence_commit)) {
      actors.set(shout.shout_from, shout);
    }
  }
  const claims = [...actors.values()].map((shout) => ({ type: 'shout', by: shout.shout_from, at: shout.shout_at,
      text: shout.shout_text, commit: shout.shout_evidence_commit, id: shout.shout_id,
      expired: now - Date.parse(shout.shout_at) > 24 * 60 * 60 * 1000 }))
    .sort((a, b) => b.id - a.id);
  return { live: claims.find((claim) => !claim.expired) ?? null,
    expired: claims.find((claim) => claim.expired) ?? null };
}

/** Check verified, unmerged heads against the trunk without changing a worktree or trusting prose. */
function verifiedMergeGroups(root, items, shouts, now) {
  const groups = { clean: [], conflicts: [], integrating: [] };
  const staleIntegrations = [];
  for (const item of [...items].sort((a, b) => a.item_id - b.item_id)) {
    const claimed = integrationClaims(root, item, shouts, now);
    if (claimed.live) {
      const { expired, ...claim } = claimed.live;
      groups.integrating.push({ item, ...claim });
      continue;
    }
    if (claimed.expired) staleIntegrations.push({ item, ...claimed.expired });
    try {
      requireTrunkMerge(root, item.item_checked_commit ?? item.item_commit);
      groups.clean.push(item);
    } catch (error) {
      if (error.code !== 'MERGE_CONFLICT') throw error;
      const detail = / in ([\s\S]*); merge the trunk into/u.exec(error.message)?.[1] ?? '';
      let files = [];
      try { files = JSON.parse(`[${detail}]`); } catch { files = []; }
      groups.conflicts.push({ item, files });
    }
  }
  return { verifiedNotMerged: groups, staleIntegrations };
}

/** Capture coordinator-only decision sections with stable ages and answers from the board. */
function coordinatorDecisionSections(board, ctx) {
  const shouts = store.allShouts(board);
  const openDecisions = store.openDecisions(board, COORDINATOR).map((ask) => ({
    id: ask.shout_id, asker: ask.shout_from, question: ask.shout_text, at: ask.shout_at, age: span(ctx, ask.shout_at),
  }));
  const recentAnswers = shouts.filter((ask) => ask.shout_decision).flatMap((ask) => {
    const answer = store.shoutDetails(board, ask.shout_id).decision_answer;
    if (!answer) return [];
    const ageMs = ctx.clock.now().getTime() - Date.parse(answer.shout_at);
    if (ageMs < 0 || ageMs > 24 * 60 * 60 * 1000) return [];
    return [{ id: ask.shout_id, asker: ask.shout_from, question: ask.shout_text,
      answeredBy: answer.shout_from, answer: answer.shout_text, at: answer.shout_at, age: span(ctx, answer.shout_at) }];
  }).sort((a, b) => b.at.localeCompare(a.at));
  const personQuestions = store.openDecisions(board, 'person').map((ask) => ({
    id: ask.shout_id, asker: ask.shout_from, question: ask.shout_text, at: ask.shout_at, age: span(ctx, ask.shout_at),
  }));
  return { openDecisions, recentAnswers, personQuestions, shouts };
}

/** Read and update this checkout's last-run version, returning only newly released headlines. */
function resumeReleaseNotes(info) {
  const record = join(info.gitDir, 'pullboard-checkout', 'resume-version');
  let previous = '';
  try { previous = readFileSync(record, 'utf8').trim(); } catch { /* First resume in this checkout. */ }
  if (!/^\d+\.\d+\.\d+$/u.test(previous)) {
    mkdirSync(dirname(record), { recursive: true });
    writeFileSync(record, `${VERSION}\n`);
    return null;
  }
  if (previous === VERSION) return null;
  const releases = releaseHeadlinesBetween(previous, VERSION);
  mkdirSync(dirname(record), { recursive: true });
  writeFileSync(record, `${VERSION}\n`);
  return releases.length ? { releases: releases.slice(0, 3), omitted: Math.max(0, releases.length - 3), notes: 'CHANGELOG.md' } : null;
}

/** Identify setup from this board's coordinator enrollment, independently of agent flags. */
function setupIdentity(board) {
  return { boardId: store.boardId(board),
    setupStartedAt: store.listAgents(board).find(agent => agent.agent_id === COORDINATOR)?.agent_created_at };
}

/** Read only the view's typed successful-bind receipt for this board and setup. */
function viewBindComplete(ctx, board) {
  let receipt;
  try { receipt = JSON.parse(readFileSync(join(ctx.info.commonDir, 'pullboard', 'view-bind.json'), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT' || error instanceof SyntaxError) return false; throw error; }
  const identity = setupIdentity(board);
  return receipt?.type === 'pullboard.view.bound' && receipt.version === 1
    && receipt.boardId === identity.boardId && receipt.setupStartedAt === identity.setupStartedAt
    && Number.isFinite(Date.parse(receipt.boundAt))
    && Date.parse(receipt.boundAt) >= Date.parse(identity.setupStartedAt);
}

/** A separately typed, authenticated reuse also proves that this board's view was opened. */
function viewSetupComplete(ctx, board) {
  if (viewBindComplete(ctx, board)) return true;
  let receipt;
  try { receipt = JSON.parse(readFileSync(join(ctx.info.commonDir, 'pullboard', 'view-reuse.json'), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT' || error instanceof SyntaxError) return false; throw error; }
  const identity = setupIdentity(board);
  return receipt?.type === 'pullboard.view.reused' && receipt.version === 1
    && receipt.boardId === identity.boardId && receipt.setupStartedAt === identity.setupStartedAt
    && Number.isFinite(Date.parse(receipt.openedAt))
    && Date.parse(receipt.openedAt) >= Date.parse(identity.setupStartedAt);
}

/** Atomically record a successful real view bind, scoped to this board's current setup. */
function recordViewBind(ctx, board, boundAt) {
  const file = join(ctx.info.commonDir, 'pullboard', 'view-bind.json');
  const temporary = file + '.' + randomUUID() + '.tmp';
  const receipt = { type: 'pullboard.view.bound', version: 1, ...setupIdentity(board), boundAt };
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(temporary, JSON.stringify(receipt) + '\n', { mode: 0o600 });
  renameSync(temporary, file);
}

/** Record this board's authenticated reuse without claiming that its existing listener bound again. */
function recordViewReuse(ctx, board, view) {
  const file = join(ctx.info.commonDir, 'pullboard', 'view-reuse.json');
  const temporary = file + '.' + randomUUID() + '.tmp';
  const receipt = { type: 'pullboard.view.reused', version: 1, ...setupIdentity(board),
    openedAt: new Date().toISOString(), boundAt: view.boundAt, port: view.port, pid: view.pid };
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(temporary, JSON.stringify(receipt) + '\n', { mode: 0o600 });
  renameSync(temporary, file);
}

/** Read a typed setup receipt only for this board's current coordinator enrollment. */
function setupReceiptMatches(ctx, identity, state) {
  let receipt;
  try { receipt = JSON.parse(readFileSync(join(ctx.info.commonDir, 'pullboard', `setup-${state}.json`), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT' || error instanceof SyntaxError) return false; throw error; }
  return receipt?.type === `pullboard.setup.${state === 'complete' ? 'completed' : state}` && receipt.version === 1
    && receipt.boardId === identity.boardId && receipt.setupStartedAt === identity.setupStartedAt;
}

/** Atomically record a setup transition, scoped to this board enrollment. */
function recordSetupState(ctx, identity, state) {
  const file = join(ctx.info.commonDir, 'pullboard', `setup-${state}.json`);
  const temporary = file + '.' + randomUUID() + '.tmp';
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(temporary, JSON.stringify({ type: `pullboard.setup.${state === 'complete' ? 'completed' : state}`, version: 1, ...identity }) + '\n', { mode: 0o600 });
  renameSync(temporary, file);
}

/** Derive the next setup question from the real requirements, config, items and view receipt. */
function boardSetup(ctx, card, identity) {
  const rows = loadSpec(ctx.info.root, ctx.config).rows;
  const approved = rows.filter(row => row.status === 'approved');
  const decisions = withBoard(ctx, (board) => store.rowDecisions(board));
  const open = setupDecisionRows(ctx.info.root, ctx.config, decisions, rows);
  const toApply = open.filter(row => row.decision);
  const drafted = open.filter(row => !row.decision);
  const recordedComplete = setupReceiptMatches(ctx, identity, 'complete');
  const started = setupReceiptMatches(ctx, identity, 'started');
  const lanes = laneNames(ctx.config).filter(lane => !['review', COORDINATOR].includes(lane));
  const folders = readdirSync(ctx.info.root, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules')
    .map(entry => entry.name).sort();
  const lane = lanes[0] ?? folders[0] ?? 'app';
  // Older installations had no setup marker. Preserve their completed five-step state on upgrade.
  const legacyUnmarked = !existsSync(join(ctx.info.commonDir, 'pullboard', 'setup-started.json'))
    && !existsSync(join(ctx.info.commonDir, 'pullboard', 'setup-complete.json'));
  const legacyComplete = legacyUnmarked && approved.length > 0 && lanes.length > 0
    && Boolean(ctx.config.gate?.trim()) && card.all.length > 0 && card.viewOpened;
  const completed = recordedComplete || legacyComplete;
  const detectedGate = detectGate(ctx.info.root);
  /** Quote the exact suggested command safely for a shell. */
  const quote = value => "'" + String(value).replaceAll("'", "'\\''") + "'";
  /** Quote one shell word only when it needs it, so a plain lane command reads as typed. */
  const word = value => /^[A-Za-z0-9._/-]+$/u.test(String(value)) ? String(value) : quote(value);
  const steps = [
    requirementStep({ rows, drafted, toApply, completed: completed && !open.some(row => row.staleDecision), hasItems: card.all.length > 0 }),
    { number: 2, done: lanes.length > 0, question: `Ask the person: how should we divide the work? Suggested folders: ${folders.join(', ') || 'app/ (create it for the app)'}.`,
      command: `pullboard lane add ${word(lane)} --owns ${word(lane + '/')}` },
    { number: 3, done: Boolean(ctx.config.gate?.trim()),
      question: detectedGate
        ? `Ask the person: which command proves the build works? Suggested: ${detectedGate}.`
        : 'Ask the person: if this board has no build, use `pullboard spec check` to check its spec and practice files; a second agent review checks the actual work. Or choose a custom gate command.',
      command: gateConfig.settingCommand(ctx.info.root, detectedGate || 'pullboard spec check') },
    { number: 4, done: card.all.length > 0, question: 'Ask the person: what is the first small piece we should build?',
      command: `pullboard add ${quote(lane)} 'First small piece' --specs ${quote(approved[0]?.id ?? 'G1')} --criterion 'Describe what the person will be able to do'` },
    { number: 5, done: card.viewOpened,
      question: 'Ask the person: shall we open the board so you can follow the work?', command: 'pullboard view',
      afterAnswer: 'Run this in the person’s own terminal, or start it in the background as the agent so setup can continue. The view records its successful bind or authenticated reuse for this board.' },
  ].map(step => ({ ...step, question: ctx.io.guidance(step.question, { leading: true }) }));
  const current = steps.find(step => !step.done);
  if (!current && !recordedComplete) recordSetupState(ctx, identity, 'complete');
  else if (current && !completed && !started) recordSetupState(ctx, identity, 'started');
  const seat = ctx.io.callerRole() === 'seat';
  if (current?.number === 1 && !drafted.length && toApply.length) return { step: 1, total: 5, ...current, steps, ...applyStep(toApply.map(row => row.id), seat) };
  if (current?.number === 1 && drafted.length) {
    const rowIds = drafted.map(row => row.id);
    const names = rowIds.join(', ');
    const command = `pullboard spec show ${rowIds[0]}`;
    // A pending question takes an answer, a draft row an approval: each gets the command that decides it.
    const { personCommand, verb, seatQuestion, seatNext } = personAsk(drafted);
    return { step: 1, total: 5, ...current, steps, waitingOn: 'person-approval', rowIds, ...(toApply.length ? { approvedRowIds: toApply.map(row => row.id) } : {}),
      question: ctx.io.guidance((seat ? seatQuestion : `Waiting for the person to ${verb} ${names}.`) + drafted.filter(row => row.staleDecision).map(row => ` ${row.stage}`).join('')), command,
      personCommand,
      afterAnswer: (toApply.length ? `The person already approved ${toApply.map(row => row.id).join(', ')}; pullboard spec apply writes them. ` : '') + 'The person approves draft rows and answers questions in Pullboard View or their own terminal; then the coordinator runs pullboard spec apply.',
      agentNext: seat ? seatNext : (toApply.length ? 'pullboard spec apply for the approved rows; then ' : '') + `wait for the person to ${verb} ${names}; meanwhile ${command}` };
  }
  return current ? { step: current.number, total: 5, ...current, steps } : null;
}

/**
 * `pullboard resume` (N19): one short card that puts an agent back to work after a fresh start,
 * a restart or a compaction, from the board rather than from a summary.
 *
 * @param {any} io
 * @param {Awaited<ReturnType<typeof keepViewRunning>>} view what keeping the background view running did
 * @returns {number}
 */
async function resumeHere(io, view) {
  const ctx = context(io);
  await withBoard(ctx, async board => {
    const me = whoAmI(ctx, board);
    const observation = scanHealthSentinel(ctx.file, { root: ctx.info.root, config: ctx.config, now: ctx.clock.now() });
    if (observation) {
      try { await ordered(ctx, board, 'recordHealthFindings', [{ agentId: me.id, ...observation }]); }
      catch (error) { if (!(error instanceof Refused) || error.code !== 'HEALTH_SCAN_STALE') throw error; }
    }
  });
  await resumeSentinels({ ctx, withBoard, whoAmI, ordered });
  const { root, isMain } = ctx.info;
  const mainRoot = primaryCheckoutRoot(ctx.info);
  const worktreeConfig = mainRoot ? (isMain ? ctx.config : loadConfig(mainRoot)) : null;
  let setupScope;
  let doctrine;
  const card = withBoard(ctx, (board) => {
    setupScope = setupIdentity(board);
    doctrine = agentDoctrine(ctx, board);
    const me = whoAmI(ctx, board);
    const projector = verdictProjector(root, board);
    const all = store.listItems(board, { all: true }).map(projector.project);
    const pendingMerges = all.filter((item) => item.item_status === 'verified' && !item.item_merged_commit)
      .map(item => ({ ...item, item_checked_commit: store.checkedLandingCommit(board, item) }));
    const toMerge = pendingMerges.filter(item => !item.item_verdict_state);
    const staleVerdicts = pendingMerges.filter(item => item.item_verdict_state);
    const decisionSections = isMain ? coordinatorDecisionSections(board, ctx) : null;
    const { shouts = [], ...decisions } = decisionSections ?? {};
    const needsState = personNeedsState(root, { board, includeRigorUndrafted: me.id === COORDINATOR });
    return {
      me,
      all,
      needsYou: personNeeds(needsState),
      ...(me.id === COORDINATOR ? { rigor: { undrafted: needsState.rigorUndrafted } } : {}),
      ...(decisionSections ? { ...decisions, ...verifiedMergeGroups(root, pendingMerges, shouts, ctx.clock.now().getTime()),
        flow: proofStats(board, { now: ctx.clock.now().getTime() }).flow } : {}),
      requests: me.id === COORDINATOR ? store.openRequests(board) : [],
      holding: all.filter((item) => item.item_status === 'claimed' && item.item_owner === me.id),
      held: all.filter((item) => item.item_status === 'claimed' && item.item_owner === me.id)
        .map((item) => ({ item: item.item_id, facts: store.itemThread(board, item.item_id) })),
      sentBack: all
        .filter((item) => item.item_status === 'open' && item.item_verdict === 'REJECT' && item.item_built_by === me.id)
        .map((item) => ({ item, verdict: store.verdictsFor(board, item.item_id).at(-1) })),
      mainMerges: mainMergesFor(board, all.filter((item) => item.item_status === 'open' && item.item_built_by === me.id)),
      awaiting: all.filter((item) => item.item_status === 'submitted' && item.item_built_by === me.id),
      toVerify: all.filter((item) => item.item_status === 'submitted' && item.item_built_by !== me.id),
      toMerge,
      staleVerdicts,
      ...(isMain ? { landingBatches: store.landingBatches(board) } : {}),
      open: all.filter((item) => item.item_status === 'open'),
      hold: store.laneHold(board, me.lane),
      holds: store.laneHolds(board),
      unread: store.unreadCount(board, me.id),
      newest: store.peekShouts(board, me.id, 1),
      ...(me.id === COORDINATOR ? { inbox: coordinatorInbox(board, me.id, decisions.openDecisions ?? store.openDecisions(board, COORDINATOR)) } : {}),
      agents: store.listAgents(board),
      viewOpened: viewSetupComplete(ctx, board),
    };
  });
  card.relayProblems = unlinkedRelayProjects();
  card.hookProblems = unwiredHookProblems(root);
  card.newWorktreeLocation = mainRoot
    ? worktreeLocation(mainRoot, worktreeConfig)
    : unavailableWorktreeLocation();
  const { me } = card;
  const name = (id) => agentDisplayName(card.agents, ctx.config, id);
  card.stale = staleFrozenItems(card.all, loadSpec(root, ctx.config).rows, staleDoctrineRows(ctx, doctrine)).map((item) => ({ ...item, ...staleItemFinding(item) }));
  if (isMain) {
    card.staleFollowUps = { count: card.stale.length + card.staleIntegrations.length,
      list: 'pullboard resume --json', items: card.stale, integrations: card.staleIntegrations };
    delete card.staleIntegrations;
    card.reviewQueue = { items: card.toVerify, awaiting: card.awaiting };
  }
  const say = (line) => io.say(line);
  card.doctrineNotes = resumeDoctrineNotes(ctx.info, doctrine);
  for (const row of card.doctrineNotes) say(`new doctrine ${row.id} — ${row.text}`);
  const releaseNotes = card.whatsNew = resumeReleaseNotes(ctx.info);
  for (const note of (releaseNotes?.releases ?? [])) {
    say(`new in ${note.version} — ${note.headline}: ${note.paragraph}`);
  }
  if (releaseNotes?.omitted) say(`${releaseNotes.omitted} earlier release${releaseNotes.omitted === 1 ? '' : 's'} omitted; see the full notes in CHANGELOG.md`);
  else if (releaseNotes?.releases.length) say('Full release notes: CHANGELOG.md');
  for (const problem of card.relayProblems) say(problem.message);
  for (const problem of card.hookProblems) say(`${problem.message}; ${problem.next}`);
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  say(`resume: ${me.displayName}${me.family ? ` [family ${me.family}]` : ''}, ${me.lane} lane${isMain ? ', the main checkout' : ''}, at ${root}`);
  card.view = view;
  // A view left running needs no line at every session start; a start, a busy port or a failure does.
  if (view.state !== 'running' && backgroundViewLine(view)) say(backgroundViewLine(view));
  if (card.inbox) for (const line of coordinatorInboxLines(card.inbox, name, (at) => span(ctx, at), firstLine)) say(line);
  say(`New agent worktrees: ${card.newWorktreeLocation}`);
  card.setup = withBoard(ctx, board => withStarterWork(boardSetup(ctx, card, setupScope), { board, me, main: isMain, config: ctx.config, root, seat: ctx.io.callerRole() === 'seat' }));
  if (!loadSpec(root, ctx.config).rows.length && card.all.length) say('Spec rows are optional; add a requirement later: pullboard spec draft "<text>".');
  if (card.setup) {
    say(`Setting up: step ${card.setup.step} of 5`);
    say(card.setup.question);
    say(card.setup.personCommand ? `For the person: ${card.setup.personCommand}` : card.setup.waitingOn === 'coordinator-apply' ? `Next: ${card.setup.agentNext}` : `Record the answer: ${card.setup.command}`);
    if (card.setup.afterAnswer) say(card.setup.afterAnswer);
    if (card.setup.meanwhile) say(card.setup.meanwhile);
  }
  const dirty = dirtyFiles(root).length;
  if (!isMain) {
    const branch = tryGit(root, ['rev-parse', '--abbrev-ref', 'HEAD']).stdout || 'HEAD';
    // Against the main checkout's branch, not its HEAD, which is detached while the coordinator verifies.
    const mainRef = /^branch (.+)$/m.exec(tryGit(root, ['worktree', 'list', '--porcelain']).stdout.split('\n\n')[0])?.[1];
    const [behind = 0, ahead = 0] = mainRef ? tryGit(root, ['rev-list', '--left-right', '--count', `${mainRef}...HEAD`]).stdout.split(/\s+/).map(Number) : [];
    const against = mainRef ? `${ahead} ahead of main, ${behind} behind${behind ? ' (merge main before you submit)' : ''}` : 'main is detached for a verification, so ahead and behind are unknown';
    say(`branch ${branch}: ${against}${dirty ? `; ${plural(dirty, 'file')} uncommitted` : ''}`);
  } else if (dirty) {
    say(`${plural(dirty, 'file')} uncommitted in the main checkout`);
  }
  if (isMain) {
    card.commits = commitOwners(uncommittedSetup(root, ctx.config)?.differ ?? [], [ctx.config.spec, ctx.config.practice], root);
    for (const line of commitOwnerLines(card.commits)) say(line);
  }
  for (const request of card.requests) say(`request #${request.shout_id}: ${request.shout_text}; answer with pullboard answer ${request.shout_id} done, or declined <reason>`);
  card.decisions = takeDecisionNotices(ctx.info.gitDir, card.held);
  delete card.held;
  for (const notice of card.decisions) say(`decision for #${notice.item} ${notice.text}`);
  for (const item of card.holding) {
    say(`holding #${item.item_id} ${item.item_title}, lease ${span(ctx, item.item_lease_until)} left${item.item_check ? `; check: ${item.item_check}` : ''}`);
    const files = briefFiles(item.item_brief);
    if (files.length) say(`  files: ${files.join(', ')}`);
  }
  for (const { item, verdict } of card.sentBack) {
    say(`sent back: #${item.item_id} ${verdict ? `${verdict.verdict_reason} by ${name(verdict.verdict_by)}: ${firstLine(verdict.verdict_note)}` : 'rejected'}`);
  }
  for (const { item, merge } of card.mainMerges) say(mainMergeLines(item, merge, name).join('; '));
  if (isMain && card.staleFollowUps.count) say(`${plural(card.staleFollowUps.count, 'stale follow-up')}; list them with ${card.staleFollowUps.list}`);
  else if (!isMain) for (const item of card.stale) say(`stale: ${item.message}; next: ${item.next}`);
  for (const item of card.staleVerdicts) say(staleVerdictRefusal(item, item.item_verdict_state).message);
  if (card.awaiting.length) say(`awaiting a verdict: ${card.awaiting.map((item) => `#${item.item_id} (${span(ctx, item.item_updated_at)})`).join(', ')}`);
  if (isMain) {
    for (const batch of card.landingBatches.filter((entry) => !['landed', 'blocked'].includes(entry.state))) say(`landing ${batch.id}: ${batch.state}, owner ${batch.owner}, tip ${batch.tip}; log ${batch.logPath}; next: pullboard land --adopt`);
    /** Limit each text section; JSON keeps every record for a complete handoff. */
    const section = (entries, line) => {
      for (const entry of entries.slice(0, 3)) say(line(entry));
      if (entries.length > 3) say(`  ${entries.length - 3} more; list them with pullboard resume --json`);
    };
    section(card.openDecisions, (ask) => `open decision #${ask.id} from ${name(ask.asker)} (${ask.age}): ${firstLine(ask.question)}`);
    section(card.recentAnswers, (answer) => `recent decision #${answer.id}: ${name(answer.answeredBy)} answered ${name(answer.asker)} (${answer.age} ago): ${firstLine(answer.answer)}`);
    if (card.toMerge.length || card.staleVerdicts.length) {
      const groups = card.verifiedNotMerged;
      // Conflicts remain useful diagnostics even when the acceptance must be re-reviewed.
      const freshness = item => item.item_verdict_state ? ' [STALE_VERDICT]' : '';
      /** Keep merge groups on one line while retaining all entries in JSON. */
      const listed = (entries, line) => entries.slice(0, 3).map(line).join(', ')
        + (entries.length > 3 ? `, +${entries.length - 3} more (pullboard resume --json)` : '') || 'none';
      say(`verified, not merged — merges cleanly: ${listed(groups.clean, (item) => `#${item.item_id} ${firstLine(item.item_title)}${freshness(item)}`)}`);
      say(`verified, not merged — conflicts: ${listed(groups.conflicts, ({ item, files }) => `#${item.item_id} ${firstLine(item.item_title)} (${files.join(', ') || 'files unavailable'})${freshness(item)}`)}`);
      say(`verified, not merged — claimed for integration: ${listed(groups.integrating, ({ item, by, at, commit }) => `#${item.item_id} by ${name(by)} at ${at} (${commit.slice(0, 12)})${freshness(item)}`)}`);
    }
    section(card.needsYou, (need) => need.kind === 'decision'
      ? `waiting on the person: #${need.id} from ${need.ref} (${span(ctx, need.at)}): ${firstLine(need.text)}`
      : `needs the person: ${need.ref}: ${firstLine(need.text)} (${need.what})`);
    section(card.rigor?.undrafted ?? [], (cause) => `Rigor needs a proved draft: ${cause.key}, items ${cause.items.map(item => `#${item.id}`).join(', ')}; pullboard rigor draft "${cause.key.replaceAll('"', '\\"')}" "<rule>" --check "<command>" --red <commit> --green <commit>`);
    if (card.toVerify.length) say('review queue:');
    section(card.toVerify, (item) => `  to verify: #${item.item_id} ${item.item_lane} (${span(ctx, item.item_updated_at)})`);
    if (card.toMerge.length) say('merge verified work, run the gate, then record each with pullboard merged <id> <commit>');
    for (const hold of card.holds) say(`held: the ${hold.hold_lane} lane, ${hold.hold_reason}`);
    const byLane = Object.entries(Map.groupBy(card.open, (item) => item.item_lane)).map(([lane, items]) => `${lane} ${items.length}`);
    say(`open: ${card.open.length}${byLane.length ? ` (${byLane.join(', ')})` : ''}`);
  } else if (card.hold) {
    say(`the ${me.lane} lane is held by ${name(card.hold.hold_by)}: ${card.hold.hold_reason}`);
  }
  if (card.unread && !card.inbox) say(`${plural(card.unread, 'unread shout')}; newest from ${name(card.newest[0].shout_from)}: ${firstLine(card.newest[0].shout_text)} (pullboard inbox reads them)`);
  const inLane = card.open.filter((item) => item.item_lane === me.lane);
  const isVerified = (id) => card.all.find((other) => other.item_id === Number(id))?.item_status === 'verified';
  const ready = inLane.filter((item) => !item.item_after || item.item_after.split(',').every(isVerified)).length;
  let next;
  if (isMain) next = coordinatorNext(card, loadSpec(root, ctx.config).rows);
  else if (card.holding.length) next = buildNext(card);
  else if (card.sentBack.length) next = reworkNext(card);
  else if (card.hold) next = 'wait for the hold to lift: pullboard next --wait 9 (minutes)';
  else if (ready) next = `pullboard next (${ready} ready in your lane)`;
  else if (inLane.length) next = `pullboard next --wait 9 (minutes); ${inLane.length} in your lane ${inLane.length === 1 ? 'waits' : 'wait'} on other work`;
  else if (card.awaiting.length) next = 'pullboard next --wait 9 (minutes); a rejected item comes back to your lane';
  else next = 'nothing open in your lane; pullboard next --verify names work you can check';
  if (card.setup) next = card.setup.agentNext ?? card.setup.command;
  if (card.commits) next = commitFirst(card.commits, next);
  if (card.inbox) next = inboxFirst(card.inbox, next);
  io.result?.({ ...card, root, dirty, next });
  say(`next: ${next}`);
  const flowAlert = isMain ? flowAlertLine(card.flow) : null;
  if (flowAlert) say(flowAlert);
  return 0;
}

/**
 * \`pullboard view\` (N26): serve the micro site for every project on this machine until stopped,
 * registering the repo it starts in, and open it in the browser unless asked not to. With --export,
 * write the current board's read-only static snapshot instead, and return its folder.
 *
 * @param {any} io
 * @param {any} values
 * @returns {Promise<number>}
 */
async function viewHere(io, values) {
  if (values.export !== undefined) {
    if (values.project) throw new Refused('USAGE', 'choose either --project for a live scoped view or --export for a static snapshot');
    const exported = await exportView(io.cwd, resolve(io.cwd, values.export));
    io.result?.(exported);
    io.say(`wrote snapshot ${exported.path}`);
    return 0;
  }
  const projectRequested = Boolean(values.project);
  const port = values.port === undefined ? (projectRequested ? 0 : defaultViewPort()) : Number(values.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Refused('USAGE', '--port is a number from 0 to 65535; 0 picks a free one');
  let projectRoot;
  let scopeCommonDir;
  let info;
  try {
    info = repoInfo(io.cwd);
    if (projectRequested) {
      const projects = listApiProjects();
      const matches = projects.filter((project) => {
        try { return repoInfo(project.root).commonDir === info.commonDir; }
        catch { return false; }
      });
      if (matches.length !== 1) throw new Refused('PROJECT_NOT_REGISTERED', 'run pullboard view --project inside a registered project repository or linked worktree, or use plain pullboard view for every project');
      projectRoot = matches[0].root;
      scopeCommonDir = info.commonDir;
    } else if (info.isMain && existsSync(join(info.root, CONFIG_FILE))) {
      await registerProjectAndLink(info.root, new Date(), loadConfig(info.root), io);
    }
  } catch (error) {
    if (projectRequested && error instanceof Refused && error.code !== 'PROJECT_NOT_REGISTERED') {
      throw new Refused('PROJECT_NOT_REGISTERED', 'run pullboard view --project inside a registered project repository or linked worktree, or use plain pullboard view for every project');
    }
    if (!(error instanceof Refused)) throw error;
    if (projectRequested) throw error;
  }
  const internalForeground = process.env.PULLBOARD_VIEW_BACKGROUND_CHILD === '1'
    || process.env.PULLBOARD_VIEW_FOREGROUND === '1';
  if (!internalForeground) {
    const existing = port ? await runningView(port, scopeCommonDir) : null;
    if (existing) {
      if (info && existsSync(join(info.root, CONFIG_FILE))) {
        const ctx = context(io);
        withBoard(ctx, board => recordViewReuse(ctx, board, existing));
      }
      reportView(io, { ...existing, reused: true });
      return 0;
    }
    if (process.env.AI_AGENT !== undefined || !io.physicalStdoutIsTTY) return await launchBackgroundView(io, port, projectRoot);
  }
  let view;
  try {
    // The adapter override is carried only by the in-process command streams, for private CLI fixtures.
    view = await (io.serveView ?? serveView)({ port, isMain: codeIsFromMain(), ...(projectRoot ? { projectRoot } : {}) });
    const sentinel = startServeSentinel({ projectRoot });
    const boundAt = new Date().toISOString();
    const closeServer = view.close;
    view = {
      ...view,
      pid: process.pid,
      boundAt,
      close: async () => { await sentinel.close(); forgetView(view.port); await closeServer(); },
    };
    try {
      rememberView({ port: view.port, secret: new URL(view.url).searchParams.get('k'), pid: process.pid, boundAt,
        ...(scopeCommonDir ? { scopeCommonDir } : {}) }, { rememberPort: port === 0 && !scopeCommonDir });
    } catch (error) {
      throw new Refused('VIEW_STATE', `could not save the private view session: ${error.message}`);
    }
    // Only a successful fresh bind writes this board's typed setup receipt.
    let info;
    try { info = repoInfo(io.cwd); }
    catch (error) { if (!(error instanceof Refused)) throw error; }
    if (info && existsSync(join(info.root, CONFIG_FILE))) {
      const ctx = context(io);
      withBoard(ctx, board => recordViewBind(ctx, board, boundAt));
    }
  } catch (error) {
    if (view) await view.close();
    if (error instanceof Refused && error.code === 'PORT_BUSY') {
      // pullboard.dev only looks on the default port, so a busy default names the holder to stop.
      // The background child is handed --port explicitly, so the default is matched by number.
      let hosted = false;
      try { hosted = port !== 0 && port === defaultViewPort(); } catch { /* A malformed override names no default port. */ }
      error = busyViewPortRefusal(port, hosted);
    }
    if (process.env.PULLBOARD_VIEW_BACKGROUND_CHILD === '1' && process.send) {
      process.send({ type: 'startup-error', code: error.code ?? 'VIEW_START', message: error.message });
    }
    throw error;
  }
  reportView(io, { ...view, reused: false });
  if (process.env.PULLBOARD_VIEW_BACKGROUND_CHILD === '1' && process.send) {
    process.send({ type: 'ready', url: view.url, port: view.port, pid: process.pid, boundAt: view.boundAt });
  }
  io.flush?.(0);
  if (!values['no-open'] && process.env.PULLBOARD_VIEW_BACKGROUND_CHILD !== '1') {
    const opener = process.platform === 'darwin' ? ['open', [view.url]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', view.url]] : ['xdg-open', [view.url]];
    spawn(opener[0], opener[1], { detached: true, stdio: 'ignore' }).on('error', () => {}).unref();
  }
  await new Promise((stop) => {
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  });
  await view.close();
  return 0;
}

/**
 * Serve MCP over stdio as this checkout's agent (A9). Stdout carries only the protocol, so the command
 * takes no --json; each tool call runs its own CLI command, with its own relay sync, through main.
 * A person's move never comes through it (P6).
 */
async function mcpHere(io, { first, values }) {
  if (first) throw new Refused('USAGE', 'pullboard mcp takes no arguments; run pullboard mcp from the agent\'s worktree');
  if (values.json) throw new Refused('USAGE', 'pullboard mcp speaks MCP on stdout; run pullboard mcp without --json');
  context(io);
  return serveMcp({ cwd: io.cwd, input: io.stdin, output: io.stdout, log: io.stderr, runCommand: main });
}

/** Serve API v1 until a shutdown signal, printing its address before waiting (A2). */
async function serveHere(io, values) {
  traceServeStartup('serve-context-start');
  const ctx = context(io);
  traceServeStartup('serve-context-ready');
  const mainRoot = git(ctx.info.root, ['worktree', 'list', '--porcelain']).split('\n')[0].slice('worktree '.length);
  traceServeStartup('serve-registration-start');
  await registerProjectAndLink(mainRoot, new Date(), loadConfig(mainRoot), io);
  traceServeStartup('serve-registration-ready');
  const port = values.port === undefined ? 0 : Number(values.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Refused('USAGE', '--port is a number from 0 to 65535; use 0 to choose a free one');
  traceServeStartup('serve-listen-start');
  const api = await serveApi({ port, runCommand: main, isMain: ctx.allowSchemaUpgrade });
  traceServeStartup('serve-listen-ready');
  io.result?.({ url: api.url, port: api.port });
  io.say(`Pullboard API v1: ${api.url}`);
  io.say('Only this machine can reach it, with its session secret. Ctrl-C stops it.');
  io.flush?.(0);
  traceServeStartup('serve-ready-written');
  await new Promise((stop) => {
    const stopped = () => { process.off('SIGINT', stopped); process.off('SIGTERM', stopped); stop(); };
    process.once('SIGINT', stopped);
    process.once('SIGTERM', stopped);
  });
  await api.close();
  return 0;
}

/**
 * The commands that set a repo or a worktree up.
 *
 * @param {any} io
 * @param {{ first?: string }} args
 * @returns {Record<string, () => number | Promise<number>>}
 */
function setupCommands(io, { first, second, rest = [], values }) {
  return {
    init: async () => {
      const info = repoInfo(io.cwd);
      // Every blueprint is read and checked before anything is written: an unknown name, a broken file, a URL
      // or a second product leaves the repo untouched (#678, #720). Then each is added as blueprint add does.
      const blueprints = readBlueprints(values.blueprint ?? [], io.cwd, 'init', installedBlueprints(info.root));
      const model = optionalModel(values.model);
      const linked = relayLinked(info.root);
      const ctx = linked && model !== undefined ? context(io) : null;
      if (model !== undefined && linked) refuseRemoteCoordinatorModel(ctx, 'init');
      const setupPlan = beginInitCommit(info);
      const notes = initRepo({
        info,
        onWritten: setupPlan.written,
        model,
        permissions: !values['no-permissions'],
        openBoardHere: () => store.openBoard(join(info.commonDir, 'pullboard', 'board.sqlite'), io.clock, { isMain: codeIsFromMain() }),
        /** Keep a linked coordinator's canonical identity without writing a clone-local path. */
        register: (board, options) => {
          if (!linked) {
            const existing = board.db.prepare('SELECT 1 FROM agent WHERE agent_id=?').get(COORDINATOR);
            const registered = store.register(board, options);
            if (!existing) recordSetupState({ info }, setupIdentity(board), 'started');
            return registered;
          }
          if (!board.db.prepare('SELECT 1 FROM agent WHERE agent_id=?').get(COORDINATOR)) {
            throw new Refused('NO_AGENT', 'the linked snapshot has no coordinator; restore a consistent relay snapshot before initializing');
          }
          return COORDINATOR;
        },
        closeBoard: store.closeBoard,
      });
      if (linked && model !== undefined) await withBoard(ctx, (board) => ordered(ctx, board, 'register', [
        { lane: COORDINATOR, path: info.root, model },
      ]));
      // Keep blueprint initialization and the person's unwritten lane proposals in the same result.
      const landed = await landEach(blueprints, ({ reference, blueprint }, drafted) => addBlueprintHere(io, reference, { report: false, blueprint, drafted }));
      const { result } = reportInitSetup(io, info, notes, landed, Boolean(agentSessionDigest()));
      const setupCommit = await finishInitCommit(setupPlan, { io, yes: values.yes, landed, permissions: !values['no-permissions'] });
      result.setupCommit = setupCommit;
      if (await registerProjectAndLink(info.root, new Date(), loadConfig(info.root), io)) io.say('registered this project on this machine, so pullboard view lists it');
      // Once registered, a background view lists this board for pullboard.dev [H5,N26].
      const view = await keepViewRunning();
      io.result?.({ ...result, view });
      const viewLine = backgroundViewLine(view);
      if (viewLine) io.say(viewLine);
      // Sharing remains a separate choice; --yes confirms only the setup commit.
      const code = await offerRelayAtInit(info.root, io);
      if (setupCommit.skipped.length) io.say(`Your earlier changes remain uncommitted: ${setupCommit.skipped.join(', ')}.`);
      if (setupCommit.state === 'pending') io.say(SETUP_COMMIT_LATER);
      if (setupCommit.state === 'committed') io.say(`Committed ${setupCommit.skipped.length ? 'only unchanged Pullboard files' : 'Pullboard setup'} at ${setupCommit.commit.slice(0, 12)}.`);
      return code;
    },
    lane: () => {
      if (first !== 'add' || !second || rest.length || values.owns === undefined) {
        throw new Refused('USAGE', 'add a lane with: pullboard lane add <name> --owns <path>[,<path>]');
      }
      const info = repoInfo(io.cwd);
      if (!info.isMain) throw new Refused('NOT_MAIN', 'lanes are the coordinator\'s to declare; run pullboard lane add in the main checkout, or shout the coordinator to add it');
      const added = addLane(info.root, second, values.owns.split(','));
      io.result?.(added);
      io.say(`added lane ${added.lane}: owns ${added.owns.join(' ')}`);
      io.say(`Next: commit ${CONFIG_FILE} so new worktrees can join it, then: pullboard worktree ${added.lane} --model "<model name>"`);
      return 0;
    },
    hooks: () => {
      const notes = installHooks(repoInfo(io.cwd).root);
      io.result?.({ notes });
      notes.forEach((note) => io.say(note));
      return 0;
    },
    join: async () => {
      const ctx = context(io);
      if (ctx.info.isMain) {
        if (first !== COORDINATOR) throw new Refused('MAIN_IS_COORDINATOR', 'the main checkout is the coordinator; join from a worktree: git worktree add ../<dir>');
        const route = values.route ?? 'strong';
        const model = requiredModel(values.model, process.env, `join ${shellWord(COORDINATOR)}${values.route ? ` --route ${shellWord(values.route)}` : ''}${values.family ? ` --family ${shellWord(values.family)}` : ''}`);
        if (relayLinked(ctx.info.root)) refuseRemoteCoordinatorModel(ctx, 'join coordinator');
        const id = await withBoard(ctx, async (board) => await ordered(ctx, board, 'register', [
          { lane: COORDINATOR, path: ctx.info.root, route, family: values.family, model },
        ]));
        const displayName = displayAgentName({ agent_id: id, agent_model: model }, ctx.config.agents.names);
        io.result?.({ agent: id, lane: COORDINATOR, route, path: ctx.info.root, model, displayName });
        io.say(`declared ${displayName} in the coordinator lane`);
        return 0;
      }
      if (!first || first === COORDINATOR || !isLane(ctx.config, first)) {
        throw new Refused('NO_LANE', `no lane "${first ?? ''}"; lanes: ${laneNames(ctx.config).slice(1).join(', ') || 'none yet, declare them in pullboard.json'}`);
      }
      const route = values.route ?? 'strong';
      const model = requiredModel(values.model, process.env, `join ${shellWord(first)}${values.route ? ` --route ${shellWord(values.route)}` : ''}${values.family ? ` --family ${shellWord(values.family)}` : ''}`);
      const id = await withBoard(ctx, async (board) => await ordered(ctx, board, 'register', [{ lane: first, path: ctx.info.root, route, family: values.family, model }]));
      const displayName = displayAgentName({ agent_id: id, agent_model: model }, ctx.config.agents.names);
      io.result?.({ agent: id, lane: first, route, path: ctx.info.root, model, displayName });
      io.say(`joined as ${displayName} in the ${first} lane${route === 'light' ? ', on the light route' : ''}`);
      return 0;
    },
    worktree: () => worktreeFor(io, first, values.route ?? 'strong', values.family ?? null, values.model),
    takeover: () => {
      const ctx = context(io);
      const me = withBoard(ctx, (board) => whoAmI(ctx, board));
      io.result?.({ agent: me.id, path: ctx.info.root });
      io.say(`${me.displayName} took over this checkout for the current agent session`);
      return 0;
    },
  };
}

/**
 * Make a worktree for a new agent in a lane, beside the main checkout, on its own branch, already
 * joined: one command where a new agent would otherwise copy three with placeholders in them.
 *
 * @param {any} io
 * @param {string | undefined} lane
 * @param {string} route
 * @param {string | null} family
 * @param {string | undefined} model
 * @returns {Promise<number>}
 */
async function worktreeFor(io, lane, route, family = null, model) {
  const ctx = context(io);
  if (!lane || lane === COORDINATOR || !isLane(ctx.config, lane)) {
    throw new Refused('NO_LANE', `no lane "${lane ?? ''}"; lanes: ${laneNames(ctx.config).slice(1).join(', ') || 'none yet, declare them in pullboard.json'}`);
  }
  if (!store.ROUTES.includes(route)) {
    throw new Refused('BAD_ROUTE', `route "${route}" is strong (needs a frontier model) or light (any model can build it from the brief)`);
  }
  model = requiredModel(model, process.env, `worktree ${shellWord(lane)}${route === 'strong' ? '' : ` --route ${shellWord(route)}`}${family ? ` --family ${shellWord(family)}` : ''}`);
  const mainRoot = primaryCheckoutRoot(ctx.info);
  if (!mainRoot) throw new Refused('NO_POLICY', 'the primary checkout cannot be proven from Git metadata or the read-only project registry; restore the registry and retry');
  const mainConfig = loadConfig(mainRoot);
  refuseUncommittedSetup(mainRoot, mainConfig);
  const pathFor = (n) => mainConfig.worktrees === 'inside'
    ? join(mainRoot, '.claude', 'worktrees', `${lane}-${n}`)
    : join(dirname(mainRoot), `${basename(mainRoot)}-${lane}-${n}`);
  const isTaken = (n) => existsSync(pathFor(n)) || tryGit(mainRoot, ['rev-parse', '--verify', '--quiet', `refs/heads/${lane}/${n}`]).status === 0;
  let n = 1;
  while (isTaken(n)) n += 1;
  mkdirSync(dirname(pathFor(n)), { recursive: true });
  git(mainRoot, ['worktree', 'add', '-q', '-b', `${lane}/${n}`, pathFor(n), git(mainRoot, ['rev-parse', 'HEAD'])]);
  const root = git(pathFor(n), ['rev-parse', '--show-toplevel']);
  let id;
  try { id = await withBoard(ctx, async (board) => await ordered(ctx, board, 'register', [{ lane, path: root, route, family, model }])); }
  catch (error) {
    const registered = withBoard(ctx, (board) => store.agentAt(board, root));
    if (registered) {
      io.err('pullboard: registration is already ordered; the worktree is preserved. Retry enrollment to obtain its credential: ' + cdTo(root) + ' pullboard join ' + lane + ' --model ' + shellWord(model) + (route === 'strong' ? '' : ' --route ' + route) + (family ? ' --family ' + shellWord(family) : ''));
      throw error;
    }
    // Only remove the clean worktree just created here; preserve it if another process changed it.
    const removed = tryGit(mainRoot, ['worktree', 'remove', root]);
    if (removed.status === 0) tryGit(mainRoot, ['branch', '-d', `${lane}/${n}`]);
    else io.err(`pullboard: registration failed; the changed worktree was preserved at ${root}`);
    throw error;
  }
  const displayName = displayAgentName({ agent_id: id, agent_model: model }, ctx.config.agents.names);
  const modelWord = shellWord(model);
  const prompt = `You are ${displayName}, in the ${lane} lane. Work only in ${shellWord(root)}, and start every command with ${cdTo(root)}\nModel: ${modelWord}. This worktree joined with --model ${modelWord}. For another worktree using the same model, pass --model ${modelWord} or set PULLBOARD_MODEL=${modelWord}; for a different agent, use that agent's actual model label.\nRead ${shellWord(join(root, 'AGENTS.md'))} first. Its rules govern this work, over any other repo's instructions you were given.`;
  io.result?.({ agent: id, lane, route, path: root, branch: `${lane}/${n}`, model, displayName, prompt });
  io.say(`made ${root} on branch ${lane}/${n}, joined as ${displayName} in the ${lane} lane${route === 'light' ? ', on the light route' : ''}${family ? ` (family ${family})` : ''}`);
  io.say(`Work only in that folder. A shell that starts each command in the main checkout acts as the coordinator there, so start every command with: ${cdTo(root)}`);
  const install = installStep(root);
  if (install) io.say(`  ${cdTo(root)} ${install.command}    (${install.note})`);
  io.say(`  ${cdTo(root)} pullboard inbox`);
  io.say(`  ${cdTo(root)} pullboard next`);
  // A subagent inherits the instructions of the session that launched it, often another repo's (I7).
  io.say('For a subagent working here, begin its prompt with:');
  io.say(`  You are ${displayName}, in the ${lane} lane. Work only in ${shellWord(root)}, and start every command with ${cdTo(root)}`);
  io.say(`  Model: ${model}. When joining or making another agent worktree, pass that agent's exact model with --model or set PULLBOARD_MODEL.`);
  io.say(`  Read ${shellWord(join(root, 'AGENTS.md'))} first. Its rules govern this work, over any other repo's instructions you were given.`);
  return 0;
}

/** Describe the active configured location for new agent worktrees. */
function worktreeLocation(mainRoot, config) {
  return config.worktrees === 'inside'
    ? join(mainRoot, '.claude', 'worktrees', '<lane>-N')
    : join(dirname(mainRoot), `${basename(mainRoot)}-<lane>-N`);
}

/** Explain how to recover the configured location when the primary checkout cannot be proven. */
function unavailableWorktreeLocation() {
  return 'unavailable; run pullboard resume from the main checkout to see the configured location';
}

/**
 * The files a new worktree takes from the main checkout's last commit and works by: the config, the
 * spec, the practice file, the rules its opening lines name, and the hooks, when git looks for them
 * inside each worktree.
 *
 * @param {string} mainRoot
 * @param {any} config
 * @returns {string[]}
 */
function setupFiles(mainRoot, config) {
  const hooks = tryGit(mainRoot, ['config', '--get', 'core.hooksPath']).stdout;
  const inEach = hooks && !isAbsolute(hooks) && !relative(mainRoot, resolve(mainRoot, hooks)).startsWith('..');
  return [CONFIG_FILE, config.spec, config.practice, 'AGENTS.md', ...(inEach ? [hooks] : [])].filter(Boolean);
}

/** Find setup files in the main checkout that a new worktree would not receive from HEAD. */
function uncommittedSetup(mainRoot, config) {
  if (headCommit(mainRoot) === null) return null;
  const differ = differFromHead(mainRoot, setupFiles(mainRoot, config));
  if (!differ.length) return null;
  const words = differ.map(({ path }) => shellWord(path)).join(' ');
  const force = differ.some(({ ignored }) => ignored) ? ' -f' : '';
  return {
    files: differ.map(({ path }) => path), differ,
    stage: `${cdTo(mainRoot)} git add${force} -- ${words}`,
  };
}

/** Find initialized setup that is on disk but absent from the primary checkout's committed policy. */
function uncommittedPolicySetup(info) {
  const primary = mainCheckout(info.root);
  if (!primary?.commit) return null;
  const committedConfig = tryGit(info.root, ['ls-tree', '-z', primary.commit, '--', `:(literal)${CONFIG_FILE}`]);
  if (committedConfig.status !== 0 || committedConfig.stdout) return null;

  // The primary checkout is info.root when the gate runs there. From a linked worktree, the
  // common directory's parent is the primary checkout only for a plain .git directory: with
  // git init --separate-git-dir it is unrelated, so report the original refusal instead.
  const mainRoot = info.isMain ? info.root : basename(info.commonDir) === '.git' ? resolve(info.commonDir, '..') : null;
  if (!mainRoot) return null;
  let config;
  try { config = loadConfig(mainRoot); }
  catch { return null; }
  const setup = uncommittedSetup(mainRoot, config);
  return setup?.files.includes(CONFIG_FILE) ? setup : null;
}

/**
 * Refuse a worktree whose agent would start without pullboard's files as the main checkout has
 * them: no config, rules or hooks, or older ones (I4). Name each file and how it differs, and the
 * command that commits just those (C4).
 *
 * @param {string} mainRoot
 * @param {any} config
 */
function refuseUncommittedSetup(mainRoot, config) {
  const hasCommit = headCommit(mainRoot) !== null;
  const differ = differFromHead(mainRoot, setupFiles(mainRoot, config));
  if (hasCommit && !differ.length) return;
  const why = hasCommit
    ? `a new worktree starts from the last commit, and these differ from it here: ${differ.map(({ path, how }) => `${path} (${how})`).join(', ')}`
    : `this repo has no commit yet, and a new worktree starts from one; not committed: ${differ.map(({ path, ignored }) => (ignored ? `${path} (git ignores it)` : path)).join(', ')}`;
  const words = differ.map(({ path }) => shellWord(path)).join(' ');
  // No commit holds a file git ignores unless it is added by force.
  const force = differ.some(({ ignored }) => ignored) ? ' -f' : '';
  const subject = hasCommit ? 'chore: commit pullboard files' : 'chore: set up pullboard';
  throw new Refused('NOT_COMMITTED', `${why}. Commit them first: ${cdTo(mainRoot)} git add${force} -- ${words} && git commit -q -m "${subject}" -- ${words}`);
}

/**
 * The commands that read the board without changing it.
 *
 * @param {any} io
 * @param {any} args
 * @returns {Record<string, () => number>}
 */
function readCommands(io, { first, second, rest, values }) {
  return {
    flakes: () => nativeFlakes.command(context(io), { first, second, rest }, withBoard),
    doctrine: async () => {
      if (first !== 'check' || second || rest.length) throw new Refused('USAGE', 'pullboard doctrine check');
      const ctx = context(io);
      // Only a repo whose committed doctrine carries a check takes a machine slot for it.
      const rules = checkRulesAt(ctx.info.root, 'HEAD', ctx.config.practice).length
        ? await withGateSlot(ctx.info.root, () => doctrineReport(ctx.info.root, ctx.config), { itemCheck: true, agent: resourceAgent(ctx), kind: 'doctrine', onWait: gateWaitReporter(io) })
        : [];
      io.result?.({ rules });
      if (!rules.length) io.say('no committed doctrine rule carries a check; add one as | gate: check <command> | count: N');
      for (const rule of rules) io.say(ruleLine(rule));
      return rules.every((rule) => rule.holds) ? 0 : 1;
    },
    skills: () => {
      if (first || second || rest.length || !values.update) throw new Refused('USAGE', 'pullboard skills --update');
      const ctx = context(io);
      const result = updateSkills(ctx.info.root);
      io.result?.(result);
      if (result.updated.length) io.say(`updated Claude Code skills: ${result.updated.map((file) => file.split('/')[2]).join(', ')}`);
      else io.say('Claude Code skills are current or customized; no files were replaced');
      for (const item of result.customized) {
        const change = item.missing.length ? `; missing changes: ${item.missing.join('; ')}` : '';
        io.say(`kept customized skill ${item.path}${change}`);
      }
      return 0;
    },
    export: () => {
      if (first) throw new Refused('USAGE', 'pullboard export takes no arguments');
      const ctx = context(io);
      io.say(JSON.stringify(withBoard(ctx, (board) => exportBoard(board)), null, 2));
      return 0;
    },
    digest: () => digestCommand(io, { first, second, rest, values }, context(io)),
    import: () => {
      if (!first || second || rest.length) throw new Refused('USAGE', 'pullboard import <file>');
      const file = resolve(io.cwd, first);
      if (!existsSync(file)) throw new Refused('NO_FILE', `no export file ${first}`);
      let document;
      try {
        document = JSON.parse(readFileSync(file, 'utf8'));
      } catch {
        throw new Refused('IMPORT_FORMAT', `file ${first} is not a JSON export; use pullboard export to make one`);
      }
      const ctx = context(io);
      const imported = withBoard(ctx, (board) => importBoard(board, document));
      io.result?.({ tables: imported.tables });
      io.say(`imported version ${document.version} board tables: ${imported.tables.join(', ')}`);
      return 0;
    },
    resources: async () => {
      const ctx = context(io);
      const agents = withBoard(ctx, (board) => store.listAgents(board));
      const browserSlots = loadMachineSettings().browserSlots;
      const floorMB = memoryFloorMB();
      // The memory hold is opt-in: with no floor set, nothing reads the machine's memory.
      const memory = floorMB === null ? null : memoryVerdict(await readMachineMemory({ processes: true }), floorMB * 1024 ** 2);
      const resources = [
        ...listResources({ scope: 'machine' }).map((resource) => ({ ...resource, scope: 'machine' })),
        ...listResources({ scope: 'repo', root: ctx.info.root }).map((resource) => ({ ...resource, scope: 'repo' })),
      ];
      const runners = runnerResourceStatus(loadMachineSettings().runners ?? []);
      const queue = gateQueueSettings();
      const shortSlots = gateShortSlots();
      io.result?.({ resources, runners, browserSlots, queue, memory, shortSlots });
      io.say(`browserSlots (machine setting): ${browserSlots}`);
      io.say(`machine queue order (gate.queue.reviewsFirst ${queue.reviewsFirst}): ${queue.reviewsFirst ? `landing, review, submit, other; a waiting run moves up one class every ${queue.agingMinutes} minutes` : 'landings first, then arrival'}`);
      if (shortSlots) io.say(`gate.shortSlots (machine setting): ${shortSlots}; runs that name their test files may use them while every gate slot is busy`);
      if (memory) io.say(memory.line);
      if (!resources.length) io.say('no resources have been used');
      for (const resource of resources) {
        io.say(`${resource.name} (${resource.scope}, capacity ${resource.capacity})${resource.order === 'arrival' ? '; an older pullboard is waiting, so this line is in arrival order, landings first' : ''}`);
        for (const holder of resource.holders) io.say(`  held by ${agentDisplayName(agents, ctx.config, holder.agent)}${holder.repo ? ` in ${holder.repo}` : ''}${resourceRunLabel(holder, shortSlots)} since ${holder.since}`);
        resource.line.forEach((waiter, index) => io.say(`  ${index + 1}. waiting: ${agentDisplayName(agents, ctx.config, waiter.agent)}${waiter.repo ? ` in ${waiter.repo}` : ''}${resourceRunLabel(waiter, shortSlots)}; class ${waiter.queueClass}${waiter.agedFrom ? `, aged up from ${waiter.agedFrom}` : ''}`));
      }
      for (const runner of runners) io.say(`runner ${runner.host}: ${runner.inUse}/${runner.slots} slots, ${runner.browserInUse}/${runner.browser} browser${runner.unavailable ? ' (unavailable; re-register after checking the host)' : ''}`);
      return 0;
    },
    resume: async () => {
      repoInfo(io.cwd);
      return resumeHere(io, await keepViewRunning());
    },
    whoami: () => {
      const ctx = context(io);
      const me = withBoard(ctx, (board) => whoAmI(ctx, board));
      io.result?.({ ...me, path: ctx.info.root });
      io.say(`${me.displayName} (${me.lane} lane${me.route === 'light' ? ', light route' : ''}) at ${ctx.info.root}`);
      return 0;
    },
    lanes: () => {
      const { config } = context(io);
      io.result?.({ lanes: config.lanes, shared: config.shared, coordinator: COORDINATOR });
      io.say(`${COORDINATOR.padEnd(14)} everything no lane owns; verifies, merges, may change any path`);
      for (const [name, lane] of Object.entries(config.lanes)) {
        const specs = lane.specs?.length ? `  [${lane.specs.join(', ')}]` : '';
        const starts = lane.starts ? `  starts: ${lane.starts}` : '';
        io.say(`${name.padEnd(14)} ${lane.owns.length ? lane.owns.join(' ') : '(owns no folders)'}${specs}${starts}`);
      }
      if (config.shared.length) io.say(`${'shared'.padEnd(14)} ${config.shared.join(' ')} (any lane)`);
      return 0;
    },
    list: () => {
      const ctx = context(io);
      const { items, agents, merging } = withBoard(ctx, (board) => ({
        items: store.listItems(board, { lane: first, all: values.all }).map(verdictProjector(ctx.info.root, board).project),
        agents: store.listAgents(board), merging: new Set(store.listItems(board, { lane: first }).filter((item) => mainMergeFor(board, item.item_id)).map((item) => item.item_id)),
      }));
      const filtered = items.filter((item) => !values.route || item.item_route === values.route);
      if (values.json) io.result({ items: filtered });
      else if (!filtered.length) io.say(values.all ? 'no items yet' : 'nothing open; --all shows closed items');
      else filtered.forEach((item) => io.say(itemLine(item, (id) => agentDisplayName(agents, ctx.config, id), merging.has(item.item_id))));
      return 0;
    },
    queue: () => queueView.queueCommand(io, [first, second, ...rest], (work) => withBoard(context(io), work)),
    roadmap: () => {
      if (first || second || rest.length) throw new Refused('USAGE', 'pullboard roadmap takes no arguments');
      const ctx = context(io);
      const milestones = withBoard(ctx, (board) => roadmapView.milestoneRoadmap(ctx.info.root, board));
      io.result?.({ milestones });
      if (!milestones.length) io.say('no milestones yet; the coordinator can add one with pullboard milestone add');
      for (const milestone of milestones) {
        const when = milestone.shipped ? ` · shipped at ${milestone.shipped.commit.slice(0, 12)} on ${milestone.shipped.at}`
          : milestone.target ? ` · target ${milestone.target}${milestone.pastTarget ? ', past target' : ''}` : '';
        io.say(`${milestone.name}: ${milestone.landed}/${milestone.total} landed${when}`);
        if (!milestone.shipped) {
          const summary = milestone.summary;
          const estimate = roadmapView.roadmapEstimate(summary);
          io.say(`  ${summary.left} left of ${summary.total}: ${summary.landed} landed, ${summary.landing} landing, ${summary.review} in review, ${summary.building} building, ${summary.waiting} waiting, ${summary.held} held${estimate}`);
        }
        if (milestone.note) io.say(`  ${milestone.note}`);
        for (const item of milestone.items) {
          const id = typeof item.id === 'number' ? `#${item.id}` : item.id;
          io.say(`  ${id} ${item.title} — ${item.state}`);
        }
      }
      return 0;
    },
    why: () => {
      if (!first || second || rest.length) throw new Refused('USAGE', 'pullboard why <id>: the decisions that imply an item, newest first');
      const ctx = context(io);
      const id = idArg(first);
      const decisions = withBoard(ctx, (board) => decisionsImplying(store.itemThread(board, id)));
      io.result?.({ id, decisions });
      if (!decisions.length) io.say(`no decision implies #${id}`);
      for (const entry of decisions) io.say(whyLine(entry));
      return 0;
    },
    show: () => {
      const ctx = context(io);
      const id = idArg(first);
      const { item, verdicts, moves, thread, related, reviewer, agents, mainMerge, infra } = withBoard(ctx, (board) => ({
        item: verdictProjector(ctx.info.root, board).project(store.getItem(board, id)),
        verdicts: store.verdictsFor(board, id),
        moves: store.events(board, { itemId: id }).filter((event) => ['attempt', 'escalate'].includes(event.event_kind)),
        thread: store.itemThread(board, id),
        related: store.relatedItems(board, store.getItem(board, id)),
        reviewer: store.reviewHolder(board, store.getItem(board, id)),
        agents: store.listAgents(board), mainMerge: mainMergeFor(board, id), infra: infraNotes.infraNoteOf(store.events(board, { itemId: id })),
      }));
      const agentName = (id) => displayAgentName(agents.find((agent) => agent.agent_id === id) ?? { agent_id: id }, ctx.config.agents.names);
      if (values.json) {
        io.result({ ...item, verdicts, thread });
        return 0;
      }
      io.say(itemLine(item, agentName, Boolean(mainMerge)));
      if (item.item_verdict_state) io.say(staleVerdictRefusal(item, item.item_verdict_state).message);
      if (item.item_criterion) io.say(`criterion: ${item.item_criterion}`);
      if (item.item_check) io.say(`check: ${item.item_check}`);
      sayCheckBaseline(io, item);
      sayBrief(io, item.item_brief);
      for (const { item: other, shared } of related) {
        io.say(`related: #${other.item_id} ${other.item_title}: ${shared.slice(0, 4).join(', ')}${shared.length > 4 ? ', ...' : ''} (git log -p -1 ${other.item_commit.slice(0, 12)} -- ${shared[0]})`);
      }
      const attempts = moves.filter((event) => event.event_kind === 'attempt').map((event) => JSON.parse(event.event_detail).result);
      if (attempts.length) io.say(`unattended attempts: ${attempts.join(', ')}`);
      for (const event of moves.filter((entry) => entry.event_kind === 'escalate')) {
        const detail = JSON.parse(event.event_detail);
        io.say(`escalated ${detail.from} -> ${detail.to} by ${agentName(event.event_by)}${detail.attempt ? `, pinned at ${detail.attempt}` : ''}: ${detail.note.split('\n')[0]}`);
      }
      if (item.item_frozen) {
        const frozen = JSON.parse(item.item_frozen);
        io.say(`frozen at claim (${item.item_frozen_digest.slice(0, 12)}):`);
        frozen.rows.forEach((row) => io.say(`  ${row.id}: ${row.text}${row.gate ? `  | gate: ${row.gate}` : ''}`));
      }
      if (item.item_commit) io.say(`submitted by ${agentName(item.item_built_by)}${item.item_builder_family ? ` [family ${item.item_builder_family}]` : ''} at ${item.item_commit}`);
      if (infra) io.say(`infra note: ${infra.note} (files: ${infra.files.join(', ') || 'none'})`);
      if (reviewer) io.say(`under review by ${agentName(reviewer)} until ${item.item_review_until}`);
      // Earlier verdicts as one line each, so an item sent back several times stays short to read
      // (N30); --history prints every note in full.
      const verdictLine = (verdict) => `${verdict.verdict_decision} ${verdict.verdict_reason} by ${agentName(verdict.verdict_by)}${verdict.verdict_verifier_family ? ` [family ${verdict.verdict_verifier_family}]` : ''} at ${verdict.verdict_commit.slice(0, 12)}`;
      const notes = verdicts.map((verdict, index) => (values.history || index === verdicts.length - 1 ? verdict.verdict_note : firstLineOf(verdict.verdict_note)));
      verdicts.forEach((verdict, index) => {
        io.say(`${verdictLine(verdict)}${notes[index] ? `: ${notes[index]}` : ''}`);
        io.say(`  check: ${verdict.check ?? 'unknown'}`);
      });
      if (notes.some((note, index) => note !== verdicts[index].verdict_note)) io.say(`(earlier verdicts shortened; every note in full: pullboard show ${id} --history)`);
      for (const correction of barCorrections(thread)) io.say(barCorrectionLine(correction));
      for (const line of mainMerge ? mainMergeLines(item, mainMerge, agentName) : []) io.say(line);
      if (item.item_merged_commit) io.say(`merged as ${item.item_merged_commit}`);
      if (item.item_withdrawn_reason) io.say(`withdrawn: ${item.item_withdrawn_reason}`);
      io.say('thread:');
      for (const entry of thread) {
        const stamp = `  ${entry.at}  ${agentDisplayName(agents, ctx.config, entry.by)}  `;
        if (entry.type === 'fact') {
          io.say(`${stamp}fact ${entry.kind} ${entry.id}${entry.supersedes ? ' (supersedes ' + entry.supersedes + ')' : ''}: ${entry.text}`);
          if (entry.ref) io.say(`    ref: ${entry.ref.path}:${entry.ref.start}${entry.ref.end === entry.ref.start ? '' : '-' + entry.ref.end}@${entry.ref.commit}`);
        } else {
          const detail = entry.detail;
          io.say(`${stamp}${entry.kind}${detail.commit ? ' at ' + detail.commit : ''}${detail.reason ? ': ' + detail.reason : ''}${detail.note ? `: ${detail.note}` : ''}`);
        }
      }
      return 0;
    },
    status: () => {
      const ctx = context(io);
      const summary = withBoard(ctx, (board) => {
        const me = whoAmI(ctx, board);
        const mine = store.listItems(board).filter((item) => item.item_status === 'claimed' && item.item_owner === me.id);
        return { me, mine, stats: store.stats(board), reviewQueue: { ...store.reviewQueue(board), ...store.reviewQueueBreakdown(board) }, unread: store.unreadCount(board, me.id), relay: relayStatus(ctx.info.root),
          submitInvariantProposals: submitInvariantProposals(store.events(board), ctx.config) };
      });
      if (values.json) {
        io.result(summary);
        return 0;
      }
      for (const line of relayOutput.briefLines(summary.relay)) io.say(line);
      const { items, accepted, rejected } = summary.stats;
      io.say(`${summary.me.displayName}: ${summary.unread} unread shouts; holding ${summary.mine.map((item) => `#${item.item_id}`).join(', ') || 'nothing'}`);
      io.say(`board: ${items.open} open, ${items.claimed} claimed, ${items.submitted} awaiting verification, ${items.verified} verified, ${items.withdrawn} withdrawn`);
      io.say(`verdicts: ${accepted} accepted, ${rejected} rejected`);
      io.say(reviewQueueLine(ctx, summary.reviewQueue, span));
      for (const proposal of summary.submitInvariantProposals) io.say(submitInvariantLine(proposal));
      if (Object.keys(ctx.config.products).length) {
        const all = withBoard(ctx, (board) => store.listItems(board, { all: true }));
        productSummaries(ctx.config, loadSpec(ctx.info.root, ctx.config), all).forEach((product) => io.say(productLine(product)));
      }
      return 0;
    },
    doctor: () => {
      const bare = bareWorktreeFinding(io.cwd);
      if (bare) {
        const problems = [bare];
        io.result?.({ problems });
        for (const problem of problems) io.say(`problem: ${problem.message}; repair: ${problem.next}`);
        return 1;
      }
      const ctx = context(io);
      const problems = [...doctorProblems(ctx.file, ctx.info.root, tryGit, ctx.config, { isMain: ctx.allowSchemaUpgrade }), ...skillProblems(ctx.info.root), ...doctrineProblems(ctx.info.root, ctx.config), ...unlinkedRelayProjects()];
      const checkpointProblem = pendingCheckpointProblem(ctx.info.root);
      if (checkpointProblem) problems.push(checkpointProblem);
      const oversizedSnapshot = checkpointProblem ? null : pendingSnapshotSize(ctx.info.root);
      if (oversizedSnapshot) problems.push({ code: 'RELAY_SNAPSHOT_LIMIT',
        message: formatSnapshotLimit(oversizedSnapshot),
        next: 'reduce the sealed board snapshot below the relay limit, then run pullboard status' });
      io.result?.({ problems });
      if (!problems.length) {
        io.say('board is clean');
        return 0;
      }
      for (const problem of problems) if (problem !== checkpointProblem) io.say(`problem: ${problem.message}; repair: ${problem.next}`);
      return 1;
    },
    health: () => {
      const ctx = context(io);
      const report = boardHealth(ctx.file, { root: ctx.info.root, config: ctx.config, now: ctx.clock.now() });
      io.result?.(report);
      for (const line of healthLines(report)) io.say(line);
      return report.stuck.length ? 1 : 0;
    },
    inbox: () => {
      const ctx = context(io);
      const { shouts, agents } = withBoard(ctx, (board) => ({
        shouts: store.inbox(board, whoAmI(ctx, board).id),
        agents: store.listAgents(board),
      }));
      io.result?.({ shouts });
      if (!shouts.length) io.say('no new shouts');
      for (const shout of shouts) {
        const ask = shout.shout_decision ? `asks for a decision (#${shout.shout_id}; pullboard answer ${shout.shout_id} "..."): ` : '';
        const reply = shout.shout_answers ? `answers #${shout.shout_answers}: ` : '';
        const from = agentDisplayName(agents, ctx.config, shout.shout_from);
        const to = agentDisplayName(agents, ctx.config, shout.shout_to);
        io.say(`${shout.shout_at.slice(0, 16)}  ${from} -> ${to}: ${ask}${reply}${shout.shout_text}`);
        if (shout.shout_evidence_kind) io.say(`  ${evidenceLine(shout)}`);
      }
      return 0;
    },
    decisions: () => {
      const ctx = context(io);
      const { asks, agents } = withBoard(ctx, (board) => {
        const me = whoAmI(ctx, board);
        const asPerson = personMode(ctx, me, values);
        return { asks: store.openDecisions(board, asPerson ? 'person' : [me.id, me.lane]), agents: store.listAgents(board) };
      });
      io.result?.({ decisions: asks });
      if (!asks.length) io.say('no open decisions');
      for (const ask of asks) io.say(`#${ask.shout_id}  ${agentDisplayName(agents, ctx.config, ask.shout_from)} -> ${agentDisplayName(agents, ctx.config, ask.shout_to)}, ${span(ctx, ask.shout_at)} ago: ${firstLine(ask.shout_text)}`);
      return 0;
    },
    stats: () => {
      const ctx = context(io);
      const { stats, agents } = withBoard(ctx, (board) => ({ stats: proofStats(board, { since: values.since }), agents: store.listAgents(board) }));
      const waits = gateReceipt.gateWaitStats(ctx.info.root);
      io.result?.({ stats, gateWaits: waits.stats });
      io.say(`${stats.submissions} submissions · ${stats.rejections} rejections · ${(stats.rejectionShare * 100).toFixed(1)}% sent back`);
      io.say(`${stats.merged} items merged · ${stats.mergedWithoutAccept} merged without an accept`);
      io.say(`${stats.agentCount} agents · ${stats.familyCount} family buckets: ${stats.families.map((family) => `${family.name} (${family.agents} agents, ${family.moves} moves)`).join('; ') || 'none'}`);
      io.say(`agents: ${stats.agents.map((agent) => `${agentDisplayName(agents, ctx.config, agent.id)} (${agent.families.join('/')}; ${agent.moves} moves)`).join(', ') || 'none'}`);
      io.say(`events: ${stats.firstEventAt ?? 'none'} to ${stats.lastEventAt ?? 'none'}${stats.since ? ` (since ${stats.since})` : ''}`);
      for (const line of barStatsLines(stats.bars)) io.say(line);
      for (const line of flowLines(stats.flow)) io.say(line);
      for (const line of waits.lines) io.say(line);
      return 0;
    },
    ledger: () => {
      const ctx = context(io);
      const { items, stats, agents } = withBoard(ctx, (board) => ({
        items: store.listItems(board, { all: true }).map((item) => ({
          ...item,
          check: store.verdictsFor(board, item.item_id).at(-1)?.check ?? 'unknown',
        })),
        stats: store.stats(board),
        agents: store.listAgents(board),
      }));
      const built = items.filter((item) => item.item_built_by && item.item_status !== 'withdrawn').reverse();
      io.result?.({ items: built, stats });
      const cell = (text) => String(text ?? '').replace(/\|/g, '/').replace(/\s+/g, ' ');
      io.say(`${stats.items.verified} verified by a second agent · ${stats.items.submitted} awaiting verification · ${stats.rejected} rejection${stats.rejected === 1 ? '' : 's'} along the way`);
      io.say('');
      io.say('| # | Lane | Item | Spec | Built by | Verified by | Check | Commit | Merged |');
      io.say('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
      for (const item of built) {
        io.say(`| ${item.item_id} | ${item.item_lane} | ${cell(item.item_title)} | ${cell(item.item_spec_ids)} | ${agentDisplayName(agents, ctx.config, item.item_built_by)} | ${agentDisplayName(agents, ctx.config, item.item_verified_by)} | ${item.check === 'none' ? 'unchecked' : item.check} | ${(item.item_commit ?? '').slice(0, 12)} | ${(item.item_merged_commit ?? '').slice(0, 12)} |`);
      }
      return 0;
    },
    rigor: async () => {
      if (values['draft-splits'] && first) throw new Refused('USAGE', 'use pullboard rigor --draft-splits without a proof-bound draft subcommand');
      if (first === 'draft') { const ctx = context(io); return rigorDraftCommand(io, { second, rest, values }, { root: ctx.info.root, config: ctx.config, read: () => withBoard(ctx, (board) => ({ events: store.events(board), actor: whoAmI(ctx, board).id })), reserve: (row) => reserveRow(ctx, row, true), propose: (row, evidence) => withBoard(ctx, async (board) => ordered(ctx, board, 'proposeSentinel', [{ agentId: whoAmI(ctx, board).id, row, evidence }])) }); }
      if (first || second || rest.length) throw new Refused('USAGE', 'pullboard rigor takes no arguments; to draft a rule: pullboard rigor draft <key> "<rule>" --check "<command>" --red <commit> --green <commit>');
      const ctx = context(io);
      const report = withBoard(ctx, (board) => { const history = store.events(board); return { ...rigorReport(history, { person: store.PERSON }), ...conflictReport(history) }; });
      if (values['draft-splits']) report.splitDrafts = await draftConflictSplits(ctx, report, { read: () => withBoard(ctx, (board) => ({ coordinator: whoAmI(ctx, board).id === COORDINATOR, rows: store.rowDrafts(board), decisions: store.rowDecisions(board) })), reserve: row => reserveRow(ctx, row, true) });
      io.result?.(report);
      for (const line of [...rigorLines(report), ...conflictLines(report)]) io.say(line);
      for (const draft of report.splitDrafts ?? []) io.say(`${draft.id}: draft split proposal; person approval required`);
      return 0;
    },
    log: () => {
      const ctx = context(io);
      const itemId = first ? idArg(first) : undefined;
      const { rows, agents } = withBoard(ctx, (board) => ({ rows: store.events(board, { itemId }), agents: store.listAgents(board) }));
      io.result?.({ events: rows });
      rows.forEach((event) => io.say(`${event.event_at.slice(0, 19)}  ${agentDisplayName(agents, ctx.config, event.event_by).padEnd(24)} ${event.event_kind.padEnd(9)} ${event.item_id ? `#${event.item_id}` : ''} ${event.event_detail === '{}' ? '' : event.event_detail}`.trimEnd()));
      return 0;
    },
  };
}

/**
 * Submit: a clean tree, nothing untracked, the gate green at HEAD, then the board (V4).
 *
 * The cheap checks run before the gate, so a submit that cannot succeed fails fast.
 *
 * @param {any} ctx
 * @param {number} id
 * @returns {Promise<number>}
 */
async function submitHere(ctx, id, infra) {
  const { root } = ctx.info;
  const recovered = relayRecovered(root);
  if (recovered?.operation === 'submit' && recovered.args[0] === id) {
    const preflight = withBoard(ctx, (board) => {
      const me = whoAmI(ctx, board);
      if (recovered.args[1]?.agentId !== me.id) return null;
      if (recordedRecovery(board, recovered)) return { me, recorded: true };
      const item = store.getItem(board, id);
      const trunk = requireTrunkMerge(root, recovered.args[1].commit);
      refuseUnverifiedStack(root, board, item, recovered.args[1].commit, trunk);
      return { me, recorded: false };
    });
    if (preflight) {
      await withBoard(ctx, async (board) => await ordered(ctx, board, 'submit', recovered.args));
      return reportSubmission(ctx, id, recovered.args[1].commit,
        { green: true, report: 'recovered the original submission; its gate ran before the original send' });
    }
  }
  const held = withBoard(ctx, (board) => {
    const me = whoAmI(ctx, board);
    const item = store.getItem(board, id);
    seatCheckout.refuseHeldElsewhere(ctx.info, store.listAgents(board), item, 'submit');
    if (item.item_status !== 'claimed' || item.item_owner !== me.id) throw new Refused('NOT_YOURS', 'claim this item before submitting it');
    const correction = store.pendingRefreezeProblem(board, id);
    if (correction) throw correction;
    return item;
  });
  const policy = itemPolicy(root, held);
  const acceptedMain = mainPolicy(root);
  ctx = { ...ctx, config: policy.config };
  withBoard(ctx, (board) => refuseProvesNothing(() => acceptedMain.config, board, store.getItem(board, id)));
  const dependencies = withBoard(ctx, board => dependencySnapshots(board.db, held));
  submissionPaths(root, held, headCommit(root), { mainCommit: acceptedMain.commit, dependencies });
  const { me, claimHead } = withBoard(ctx, (board) => {
    const who = whoAmI(ctx, board);
    const item = store.getItem(board, id);
    if (item.item_status !== 'claimed' || item.item_owner !== who.id) {
      throw new Refused('NOT_YOURS', `item #${id} is not claimed by you; claim it first`);
    }
    // A bar that moved since claim can get no verdict (V3), so say so now, not after a verifier's run (V11).
    // A cited row taken out of force (retired, wont) cannot be frozen at all, and says so too.
    if (item.item_frozen_digest) {
      let digest = null;
      let unusable = '';
      try {
        digest = freezer(ctx, { board })(item).digest;
      } catch (error) {
        if (!(error instanceof Refused) || error.code === 'A5_GRAMMAR_VERSION') throw error;
        unusable = error.message.replace(/^\[\w+\] /, '').split(';')[0];
      }
      if (digest !== item.item_frozen_digest) {
        const step = unusable
          ? `the coordinator either restores the row and runs pullboard refreeze ${id}, or withdraws #${id}`
          : `${who.id === COORDINATOR ? '' : 'the coordinator runs '}pullboard refreeze ${id}, then you claim it and submit again`;
        throw new Refused('CRITERIA_CHANGED', `the spec rows #${id} cites changed after it was claimed${unusable ? ` (${unusable})` : ''}, so no verifier could judge it; ${step}`);
      }
    }
    return { me: who, claimHead: item.item_claim_head };
  });
  if (!isClean(root)) throw new Refused('DIRTY', 'commit your changes first; the gate must check what you submit');
  const stray = untracked(root);
  if (stray.length) throw new Refused('UNTRACKED', `commit or ignore ${stray.length} untracked file(s), e.g. ${stray[0]}`);
  const commit = headCommit(root);
  if (!commit) throw new Refused('NO_COMMIT', 'nothing committed yet');
  withBoard(ctx, (board) => submitPreflight(board, id, { agentId: me.id, commit, tree: headTree(root) ?? '' }));
  const trunk = requireTrunkMerge(root, commit);
  withBoard(ctx, (board) => refuseUnverifiedStack(root, board, held, commit, trunk));
  const infraRecord = infraNotes.infraNote({ root, claimHead, files: filesSince(root, id, claimHead, commit), gates: [ctx.config.gate, acceptedMain.config.gate], infra });
  // Doctrine counts only fall: accepted main's rules, at this exact commit (D1). No rule, no change.
  const doctrine = hasSubmitRules(root, acceptedMain.commit, acceptedMain.config.practice)
    ? await withGateSlot(root, () => holdDoctrine(root, { mainCommit: acceptedMain.commit, commit, practice: acceptedMain.config.practice, timeoutMs: acceptedMain.config.check?.timeoutMs }),
      { itemCheck: true, agent: me.id, item: String(id), kind: 'doctrine', onWait: queuedItemLease(ctx, held, me.id, 'build'), onReceipt: (receipt) => ctx.io.say(`doctrine hold ${gateReceipt.receiptLine(receipt)}`) })
    : [];
  for (const rule of doctrine) ctx.io.say(`doctrine: ${ruleLine(rule)}`);
  // Every submit proves its frozen check and reachable tests anew on this exact commit (V4,V16).
  // Empty frozen gates adopt accepted main setup; only a full fallback may stamp its tree.
  const submitConfig = { ...ctx.config, gate: ctx.config.gate.trim() ? ctx.config.gate : acceptedMain.config.gate, submitGate: acceptedMain.config.submitGate, staticChecks: acceptedMain.config.staticChecks,
    submitInvariants: acceptedMain.config.submitInvariants,
    // The accepted project runner interprets its current invariant files; candidate config cannot replace it.
    ...(acceptedMain.config.submitInvariants.length ? { affectedTests: acceptedMain.config.affectedTests } : {}) };
  const gate = await runSubmitGate(root, submitConfig, { base: claimHead, trunk: acceptedMain.commit, check: frozenCheck(held), agent: me.id, item: String(id), onWait: queuedItemLease(ctx, held, me.id, 'build'), onBrowserFallback: browserAdmissionReporter(ctx.io, ctx.io.relayJson),
    onFailure: nativeFlakes.observer(ctx, { kind: 'submit', main: acceptedMain.commit, config: submitConfig }, { ordered, withBoard, resourceAgent }) });
  // Only the person's live waivers can pass a red proof, failure by failure; the item's own check is never waived [B3].
  const waived = !gate.isGreen && gate.check?.green ? withBoard(ctx, (board) => waivedFailures(board, accountedFailures(gate, root))) : null;
  if (!gate.isGreen && !waived) {
    const message = `the submission proof is red at ${commit.slice(0, 12)}; fix it, commit, submit again. ${submitGateReport(gate)}`;
    // No submission can follow this verdict. Read-only main comparisons must not retain the seat's write lease.
    CHECKOUT_LEASES.get(ctx.io)?.release();
    CHECKOUT_LEASES.delete(ctx.io);
    let comparison = { main: null, files: [], unavailable: 'main comparison could not be completed' };
    try { comparison = await compareMainFailures(root, gate.profile, gateWaitReporter(ctx.io), gate.output); } catch { /* Keep the original gate refusal if main evidence is unavailable. */ }
    const mainNote = withBoard(ctx, board => mainRedMessage(root, board, gate.profile, comparison));
    throw new Refused('GATE_RED', `${message}${mainNote ? `\n${mainNote}` : ''}`, 'fix the reported test or gate, commit the change, and run pullboard submit <id> again');
  }
  if (headCommit(root) !== commit || !isClean(root)) {
    throw new Refused(
      'MOVED_DURING_GATE',
      `when the gate ended, HEAD or a tracked file differed from ${commit.slice(0, 12)}, the commit it started on, so the gate did not end on what you would submit; leave the worktree alone until the gate finishes, then submit again`,
    );
  }
  const currentTrunk = requireTrunkMerge(root, commit); // The trunk may have moved while the gate ran.
  const waivedLines = waived ? waived.map(waiverLine) : [];
  await withBoard(ctx, async (board) => {
    refuseUnverifiedStack(root, board, store.getItem(board, id), commit, currentTrunk);
    // The waived run is written to the item's thread before the submission, so no waived proof reads as green.
    if (waived) await ordered(ctx, board, 'appendFact', [id, { agentId: me.id, kind: 'measurement', text: `submission proof at ${commit.slice(0, 12)} was red and is recorded as waived, not green; every failure is covered by a live person waiver:\n${waivedLines.join('\n')}` }]);
    return await ordered(ctx, board, 'submit', [id, { agentId: me.id, commit, tree: headTree(root) ?? '', files: filesSince(root, id, claimHead, commit), policyCommit: acceptedMain.commit, ...(infraRecord ? { infra: infraRecord } : {}),
      submissionProof: { version: 1, files: gate.files, full: gate.full, deferred: gate.deferred, reason: gate.reason },
      ...(gate.deferred ? { note: 'full suite deferred to the landing gate' } : {}) }]);
  });
  const report = waived
    ? `submission proof waived, not green: ${waived.length} failure(s), each covered by a live person waiver; the whole output is in ${gate.log}\n${waivedLines.join('\n')}`
    : submitGateReport(gate);
  return reportSubmission(ctx, id, commit, { green: gate.isGreen, report, files: gate.files, full: gate.full, deferred: gate.deferred, deferFullFallback: gate.deferFullFallback, reason: gate.reason, check: gate.check,
    log: gate.log, profile: gate.profile, profilePath: gate.profilePath, proofLog: gate.proofLog, proofProfilePath: gate.proofProfilePath,
    ...(waived ? { waived: waived.map(({ file, name, waiver }) => ({ file, name, waiver: waiver.id, reason: waiver.reason, until: waiver.until })) } : {}) }, doctrine);
}

/** Report and pin the original submitted commit, including a recovered acknowledged outcome. */
function reportSubmission(ctx, id, commit, gate, doctrine = []) {
  const { root } = ctx.info;
  const pin = `refs/pullboard/items/${id}/${commit.slice(0, 12)}`;
  git(root, ['update-ref', pin, commit]);
  ctx.io.result?.({ id, commit, pin, gate, ...(doctrine.length ? { doctrine } : {}) });
  ctx.io.say(`submitted #${id} at ${commit.slice(0, 12)}; ${gate.report}`);
  ctx.io.say(`pinned as ${pin}, so this work can't be lost; keep your worktree until it is merged`);
  ctx.io.say(`next: ${reviewerStartup(primaryCheckoutRoot(ctx.info), ctx.config, id)}`);
  return 0;
}

/**
 * Add a blueprint to the board of the checkout io.cwd names, exactly as pullboard blueprint add
 * does; init --blueprint calls it after setting up the repo. With report false it prints nothing
 * and leaves the command's JSON result to the caller. A caller that already read the blueprint
 * passes it, so the file is read once: init checks it before writing anything and must add the
 * very blueprint it checked.
 *
 * @param {any} io
 * @param {string} reference - A bundled blueprint name or a path to a blueprint file, relative to io.cwd.
 * @param {{ report?: boolean, blueprint?: ReturnType<typeof readBlueprint>, drafted?: Map<string, string> }} [options] - drafted: see addBlueprint.
 * @returns {Promise<BlueprintAdded>}
 */
export async function addBlueprintHere(io, reference, { report = true, blueprint = readBlueprint(reference, io.cwd), drafted } = {}) {
  const ctx = context(io);
  return await withBoard(ctx, async (board) => await addBlueprint(ctx, board, whoAmI(ctx, board), blueprint, { report, drafted }));
}

/**
 * @typedef {object} BlueprintAdded
 * @property {{ name: string, title: string, version: number }} blueprint
 * @property {string} section - The SPEC.md section heading the rows are in.
 * @property {{ key: string, id: string, status: string, text: string, source?: string }[]} rows - New rows; each waits for the person, with the source its rule names.
 * @property {{ id: number, key: string, title: string, lane: string, askedLane?: string, specIds: string[], after: number[], check?: string }[]} items - New open items.
 * @property {string | null} gate - The gate set in pullboard.json, or null when it was left alone.
 * @property {boolean} marked - This blueprint version was already on the board, so nothing was added.
 * @property {number[]} checksNotRun - New items that carry a check; no check baseline ran for them.
 * @property {{ name: string, owns: string[] }[]} proposedLanes - Proposed, unwritten lanes new starters were filed in.
 * @property {{ key: string, id: string }[]} shared - Keys that cite a row an earlier blueprint in the same command drafted.
 */

/**
 * Add a blueprint to this board in one step (I1): its rules and questions as draft and pending rows
 * in a new SPEC.md section, its starter items as open items citing them, and its gate when
 * pullboard.json has none. Rows are written the way spec draft writes them, so nothing is approved;
 * a repeat of the same blueprint version adds nothing.
 *
 * @param {any} ctx
 * @param {any} board
 * @param {{ id: string }} me
 * @param {import('./blueprints.js').Blueprint} blueprint
 * @param {{ report?: boolean, result?: boolean, drafted?: Map<string, string> }} [options] - report false prints nothing and sets no
 *   JSON result; result false prints but sets none. drafted: rows earlier blueprints of this command drafted, by text (#720).
 * @returns {Promise<BlueprintAdded>}
 */
async function addBlueprint(ctx, board, me, blueprint, { report = true, result = report, drafted = new Map() } = {}) {
  const io = report ? (result ? ctx.io : { say: (text) => ctx.io.say(text) }) : { say: () => {} };
  const spec = loadSpec(ctx.info.root, ctx.config);
  if (!spec.exists) throw new Refused('NO_SPEC', `no ${ctx.config.spec}; run: pullboard init`);
  const malformed = [[spec.file, spec.problems], [ctx.doctrine.repo.file, ctx.doctrine.repo.problems]].find(([, problems]) => problems.length);
  if (malformed) throw new Refused('SPEC_INVALID', `fix the unparsed row in ${malformed[0]} before adding a blueprint; an existing id may be ambiguous`);
  const source = readFileSync(spec.file, 'utf8');
  const configFile = join(ctx.info.root, CONFIG_FILE);
  const configSource = readFileSync(configFile, 'utf8');
  // A question takes the answer this repo already shows as its default, read from package.json
  // only: nothing runs and nothing is fetched (#725).
  const plan = planBlueprint(landBlueprint(blueprint, repoAnswers(ctx.info.root)), { source, spec, doctrine: ctx.doctrine,
    existingItems: store.listItems(board, { all: true }).map((item) => ({ id: item.item_id, title: item.item_title, specIds: item.item_spec_ids ? item.item_spec_ids.split(',') : [] })),
    gate: String(JSON.parse(configSource).gate ?? ''), drafted, reserved: store.rowDrafts(board).map((draft) => draft.id) });
  for (const row of plan.rows) drafted.set(row.text, row.id);
  // Every starter is checked before anything is written, so a refusal leaves the board as it was.
  // Starters go to a build lane, never the coordinator's; a proposed lane is named, not written (#732).
  const proposals = proposeLanes(ctx.info.root, ctx.config);
  const lanes = plan.items.map((entry) => starterLane(entry.lane, ctx.config, proposals));
  const proposedLanes = proposals.filter((lane) => lanes.some((placed) => placed.proposal === lane));
  const starters = plan.items.map((entry, index) => ({ key: entry.key, afterKeys: entry.after, asked: lanes[index].asked, item: { by: me.id, lane: lanes[index].lane,
    title: entry.title, criterion: entry.criterion, specIds: entry.specIds, parentId: null, after: [], brief: entry.brief, route: entry.route,
    ...(entry.check === undefined ? {} : { check: entry.check }) } }));
  // The same checks pullboard add uses, before anything is written. A blueprint's item check is
  // stored, never run: no check baseline starts during add, so nothing a blueprint supplies executes.
  // Every bundled starter carries a check (#724), and only the coordinator sets one, so an agent's
  // add is refused with the step that works: add it from the coordinator's checkout.
  if (me.id !== COORDINATOR && starters.some(({ item }) => item.check !== undefined)) {
    throw new Refused('COORDINATOR_CHECK', `the ${blueprint.name} blueprint's starter items carry checks, and only the coordinator sets an item check; run pullboard blueprint add from the main checkout, or ask your coordinator: pullboard shout coordinator "please add the ${blueprint.name} blueprint"`,
      'run the same pullboard blueprint add from the main checkout, where the coordinator works');
  }
  for (const { item } of starters) store.validateItemAddition(board, item);
  // Each new row's id is reserved on the board before SPEC.md names it; if another writer took one first, this add runs again for the next ids (#878).
  for (const row of plan.rows) if ((await ordered(ctx, board, 'draftSpecRow', [{ agentId: me.id, row: { id: row.id, text: row.text, target: 'spec' }, written: true }])).id !== row.id) throw new Refused('ROW_ID_TAKEN', `${row.id} was just reserved by another writer; run the same pullboard blueprint add again for the next free id`);
  const files = [];
  if (plan.specRows !== source) files.push({ file: ctx.config.spec, before: source, after: plan.specRows });
  if (plan.gate) {
    const newline = configSource.includes('\r\n') ? '\r\n' : '\n';
    files.push({ file: CONFIG_FILE, before: configSource,
      after: `${JSON.stringify({ ...JSON.parse(configSource), gate: plan.gate }, null, 2).replaceAll('\n', newline)}${newline}` });
  }
  const write = { records: [], files, signoffs: { before: null, receipts: [] } };
  writeRowApply(ctx.info.root, write);
  const added = [];
  try {
    // A retry starts from the starters a failed add already put on the board.
    const byKey = { ...plan.existing };
    for (const { key, afterKeys, asked, item } of starters) {
      item.after = afterKeys.map((before) => byKey[before]).filter(Boolean);
      const id = await ordered(ctx, board, 'addItem', [item]);
      byKey[key] = id;
      // The starter keeps its blueprint's name, in the link #734 reads back (#720).
      await ordered(ctx, board, 'appendFact', [id, { agentId: me.id, kind: 'note', text: blueprintStarterNote(blueprint, key) }]);
      added.push({ id, key, title: item.title, lane: item.lane, ...(asked ? { askedLane: asked } : {}), specIds: item.specIds, after: item.after, ...(item.check ? { check: item.check } : {}) });
    }
  } catch (error) {
    // Items already added stay on the board; with no marker yet, a retry adds only what is missing.
    if (!added.length) restoreRowApply(ctx.info.root, write);
    throw error;
  }
  // The marker goes in last, once every row and item is on the board.
  if (plan.specAfter !== plan.specRows) {
    writeRowApply(ctx.info.root, { records: [], files: [{ file: ctx.config.spec, before: plan.specRows, after: plan.specAfter }], signoffs: { before: null, receipts: [] } });
  }
  if (plan.specAfter !== source && !files.some((file) => file.file === ctx.config.spec)) files.unshift({ file: ctx.config.spec });
  const rows = plan.rows.map(({ key, id, status, text, source }) => ({ key, id, status, text, ...(source ? { source } : {}) }));
  const summary = { blueprint: { name: blueprint.name, title: blueprint.title, version: blueprint.version },
    section: plan.section.name, rows, items: added.map((item) => ({ ...item, blueprint: blueprint.name })), gate: plan.gate, shared: plan.shared, marked: plan.marked, proposedLanes: added.length ? proposedLanes : [],
    // Item checks are stored and never run during add; the caller tells the reader so.
    checksNotRun: added.filter((item) => item.check).map((item) => item.id) };
  io.result?.(summary);
  if (plan.marked) {
    io.say(`${blueprint.title} (version ${blueprint.version}) is already on this board; nothing added; see its starters with pullboard blueprint starters ${blueprint.name}`);
    // A board an older Pullboard set up gets the blueprint's kind recorded beside its marker (#720).
    if (plan.specRows !== source) io.say(`  recorded its kind (${blueprint.kind ?? 'none'}) in ${ctx.config.spec}; commit ${ctx.config.spec}`);
    return summary;
  }
  io.say(`added ${blueprint.title} (version ${blueprint.version}) as drafts in ${ctx.config.spec}, section ${plan.section.name}`);
  for (const row of rows) io.say(`  ${row.id} ${row.status}  ${row.text}`);
  for (const item of added) io.say(`  #${item.id} open  ${item.title}${item.specIds.length ? `  cites ${item.specIds.join(', ')}` : ''}${item.after.length ? `  waits on #${item.after.join(', #')}` : ''}`);
  const checked = added.filter((item) => item.check);
  if (checked.length) io.say(`  checks stored, not run: ${checked.map((item) => `#${item.id}`).join(', ')}; no check baseline ran during add, so read each check before work starts: pullboard show <id>`);
  for (const note of [...askedLaneNotes(added, ctx.config), ...starterLaneNotes(summary.proposedLanes)]) io.say(`  ${note}`);
  if (plan.gate) io.say(`  gate set in ${CONFIG_FILE}: ${plan.gate}`);
  for (const line of sharedRowLines(summary)) io.say(`  ${line}`);
  const changed = files.map((file) => file.file);
  io.say(`next: the person approves the rows in pullboard view or with pullboard spec approve <ids>${changed.length ? `; commit ${changed.join(' and ')}` : ''}`);
  return summary;
}

/**
 * Verify from this checkout (V3, V7): the submitted commit must be here, at or under HEAD, and the
 * criterion is re-read from the spec, so a verdict is never given against a moved bar.
 *
 * @param {any} ctx
 * @param {number} id
 * @param {any} args
 * @returns {Promise<number>}
 */
async function verifyHere(ctx, id, { second, values }) {
  const decision = { accept: 'ACCEPT', reject: 'REJECT' }[String(second ?? '').toLowerCase()];
  if (!decision) throw new Refused('USAGE', 'pullboard verify <id> accept, or reject --reason CODE --note "..."');
  const implies = parseImplies(values.implies);
  const { root } = ctx.info;
  let verificationProfile = null;
  let accepted = null;
  let acceptedLandingCommit = null;
  /** Record one verdict on the open board. */
  const decide = async (board) => {
    checkMainVerifier(ctx, board, values);
    const me = whoAmI(ctx, board);
    const recovered = relayRecovered(root);
    const previous = recovered?.args[1];
    if (recovered?.operation === 'verify' && recovered.args[0] === id && previous?.agentId === me.id &&
        previous.decision === decision && previous.reason === values.reason &&
        previous.note === (textArg(ctx.io, values, 'note') ?? '') && previous.cause === (decision === 'REJECT' ? values.cause : undefined)) {
      if (decision === 'ACCEPT' && !recordedRecovery(board, recovered)) {
        const item = store.getItem(board, id);
        const commit = resolveCommit(root, item.item_commit);
        if (!commit) throw new Refused('NOT_AT_COMMIT', `check out the submitted commit first: ${cdTo(root)} git switch --detach ${item.item_commit.slice(0, 12)}`);
        const trunk = requireTrunkMerge(root, commit);
        refuseUnverifiedStack(root, board, item, commit, trunk);
      }
      return await ordered(ctx, board, 'verify', recovered.args);
    }
    const item = store.getItem(board, id);
    itemSessions.refuseSelfSession(ctx.info, item);
    const reReview = item.item_status === 'verified' && !item.item_merged_commit;
    const stale = reReview ? verdictProjector(root, board).state(item) : null;
    if (item.item_status !== 'submitted' && !stale) {
      throw new Refused('NOT_SUBMITTED', `item #${id} is ${item.item_status}, not submitted`);
    }
    // Name an unknown implied item before the frozen check runs, not after it.
    if (implies) checkImplies(board, implies);
    const policy = itemPolicy(root, item);
    ctx = { ...ctx, config: policy.config };
    const head = headCommit(root) ?? '';
    const commit = resolveCommit(root, item.item_commit);
    if (!commit || !contains(root, commit, head)) {
      throw new Refused('NOT_AT_COMMIT', `check out the submitted commit first: ${cdTo(root)} git switch --detach ${item.item_commit.slice(0, 12)}`);
    }
    let digest = 'missing';
    let check;
    let review;
    let unaffectedMove = '';
    try {
      digest = freezer(ctx, { board })(item).digest;
    } catch (error) {
      if (!(error instanceof Refused) || error.code === 'A5_GRAMMAR_VERSION') throw error;
    }
    if (decision === 'ACCEPT') {
      if (digest !== item.item_frozen_digest) throw new Refused('CRITERIA_CHANGED', 'the criterion changed; ask the coordinator to refreeze this item before checking it');
      const checkedCommit = reReview ? head : commit;
      const checkedLabel = reReview ? 'reviewed composition' : 'submitted commit';
      const composeNow = () => composeReview(root, board, item, checkedCommit, { reReview, head, stale, refuseUnverifiedStack });
      const admitted = composesAtAdmission(ctx.config) && Boolean(frozenCheck(item));
      let trunk = null;
      if (!admitted) ({ trunk, review } = composeNow());
      const checkedItem = reReview ? { ...item, item_commit: checkedCommit } : item;
      if (frozenCheck(item)) {
        const browser = !browserFreeChecksEnabled() || await checkNeedsBrowser(root, frozenCheck(item), { commit: checkedCommit, onFallback: browserAdmissionReporter(ctx.io, ctx.io.relayJson) });
        // A private checked composition needs this machine's live local gate markers [C7,V4].
        const shortEligible = Boolean(await explicitCheckFiles(root, frozenCheck(item), { commit: checkedCommit }));
        check = await withGateSlot(root, async (lease) => { if (admitted) ({ trunk, review } = composeNow()); return nativeFlakes.verify(ctx, checkedItem, frozenCheck(item), { board, main: trunk.commit, commit: checkedCommit }, { ordered, withBoard, resourceAgent })(lease); }, { browser, remote: false, agent: me.id, item: String(id), kind: 'review', itemCheck: true, shortEligible, onWait: queuedItemLease(ctx, item, me.id, 'review') });
      } else {
        check = checkAtCommit(root, checkedItem);
      }
      invalidateGitFacts(); // A private check can outlive changes in the reviewer's live checkout.
      refuseSandboxBlocked(check);
      verificationProfile = check.profile ?? null;
      const evidence = check.checked
        ? `\nlast output lines (up to 40):\n${(check.outputTail ?? '(no output)').split('\n').map((line) => `  ${line}`).join('\n')}\nfull output file: ${check.outputPath ?? `(unavailable${check.outputError ? `: ${check.outputError}` : ''})`}`
        : '';
      const checkTimings = timingDigest(check.profile);
      const timingEvidence = check.profilePath ? `\n${checkTimings}\ntiming profile: ${check.profilePath}` : '';
      if (check.state === 'unverified') throw new Refused('CHECK_UNVERIFIED', `the frozen ${check.stage} could not be verified at the ${checkedLabel}; restore the install or check environment, then retry verification; output digest:\n${check.report.replace(/^/gm, '  ')}${evidence}${timingEvidence}`);
      if (check.state === 'red') throw new Refused('CHECK_RED', `the frozen item check is red at the ${checkedLabel} (${check.stage}); check.install may be needed for dependencies; reject with the failing behavior or ask the builder to fix and resubmit; output digest:\n${check.report.replace(/^/gm, '  ')}${evidence}${timingEvidence}`);
      const receipt = store.events(board, { itemId: id }).filter(event => event.event_kind === 'submit').map(event => JSON.parse(event.event_detail)).find(event => event.commit === commit);
      submissionPaths(root, item, commit, { mainCommit: receipt?.policyCommit, dependencies: dependencySnapshots(board.db, item) });
      const currentTrunk = requireTrunkMerge(root, checkedCommit); // Re-read after the frozen check, before accepting.
      // With verify.unrelatedTrunkMoves on, a move through commits that touch nothing this review read keeps its verdict (#928).
      const judged = currentTrunk.commit === trunk.commit || ctx.config.verify.unrelatedTrunkMoves !== true ? null
        : await judgeTrunkMove(root, { from: trunk.commit, to: currentTrunk.commit, item, checkedCommit, check: frozenCheck(item) });
      if (currentTrunk.commit !== trunk.commit && (!judged || judged.overlap)) throw new Refused('VERDICT_TRUNK_MOVED', `main moved from ${trunk.commit} to ${currentTrunk.commit} during review${judged ? `, and the move reaches this review through ${judged.overlap}` : ''}; merge the latest main and re-review the clean composition`);
      if (judged) unaffectedMove = `\nmain moved during this review through ${judged.moved.map((sha) => sha.slice(0, 12)).join(', ')}, judged unaffected: none of them changes this item's files or a file its check and affected tests read`;
      if (headCommit(root) !== head || (reReview && (!isClean(root) || untracked(root).length))) {
        throw new Refused('NOT_AT_COMMIT', 'the reviewed checkout moved during its check; restore the clean reviewed HEAD and retry verification');
      }
      refuseUnverifiedStack(root, board, item, checkedCommit, currentTrunk);
    }
    review ??= captureVerdictReview(root, board, item, verdictTrunk(root));
    if (decision === 'ACCEPT') git(root, ['update-ref', `refs/pullboard/items/${id}/${review.head.slice(0, 12)}`, review.head]);
    return await ordered(ctx, board, 'verify', [id, {
      agentId: me.id,
      decision,
      reason: values.reason,
      note: (textArg(ctx.io, values, 'note') ?? '') + unaffectedMove,
      ...(decision === 'REJECT' && values.cause !== undefined ? { cause: values.cause } : {}),
      head,
      digest,
      policy: ctx.config.verify.policy,
      familyPolicy: ctx.config.verify.family,
      review,
      ...(decision === 'ACCEPT' ? { check: check.checked ? 'green' : 'none' } : {}),
      ...(implies ? { implies } : {}),
    }]);
  };
  const result = await withBoard(ctx, async (board) => {
    const verdict = await decide(board);
    if (verdict.decision === 'ACCEPT') {
      accepted = store.getItem(board, id);
      acceptedLandingCommit = store.checkedLandingCommit(board, accepted);
    }
    return verdict;
  });
  ctx.io.result?.({ id, ...result });
  const verifiedSummary = timingDigest(verificationProfile);
  const verifiedTiming = result.decision === 'ACCEPT' && verificationProfile && verifiedSummary ? `\n${verifiedSummary}\ntiming profile: ${verificationProfile.profilePath ?? '(not saved)'}` : '';
  ctx.io.say(result.decision === 'ACCEPT'
    ? `verified #${id}: ${result.reason}${result.check === 'none' ? '; no frozen check ran' : ''}${verifiedTiming}`
    : `rejected #${id}: ${result.reason}; it is open again for rework`);
  if (accepted) ctx.io.say(landNext(ctx.info, accepted, acceptedLandingCommit));
  return 0;
}

/**
 * Say the exact command that lands an accepted item in this repo [B3].
 * A repo with a push remote lands through pullboard land; one without merges by hand,
 * because pullboard land would refuse LAND_PUSH there.
 *
 * @param {any} info
 * @param {any} item
 * @param {string} [commit] - The exact checked composition the acceptance authorizes.
 * @returns {string}
 */
function landNext(info, item, commit = item.item_commit) {
  const mainRoot = primaryCheckoutRoot(info);
  const branch = mainCheckout(info.root)?.branch ?? '';
  const remote = landingRemote(info.root, branch);
  const command = remote
    ? 'pullboard land'
    : `git merge --no-ff ${commit} -m ${shellWord(landingSubject(item))} && pullboard merged ${item.item_id} HEAD`;
  if (!mainRoot) return `next: could not safely locate the primary checkout; run from the main checkout: ${command}`;
  if (remote) return `next: the coordinator lands it: ${cdTo(mainRoot)} ${command}`;
  return `next: this repo has no remote for pullboard land to push to, so the coordinator merges it on ${branch.replace(/^refs\/heads\//u, '') || 'the trunk'}: ${cdTo(mainRoot)} ${command}`;
}

/** Resolve a usable primary checkout without trusting the Git metadata directory as a path. */
function primaryCheckoutRoot(info) {
  if (info.isMain) return info.root;
  let commonDir;
  try { commonDir = realpathSync.native(info.commonDir); }
  catch { return null; }
  /** Return unique validated primary checkouts among candidate repository paths.
   *
   * @param {string[]} candidates
   * @returns {string[]}
   */
  const matches = (candidates) => {
    const roots = new Map();
    for (const candidate of candidates) {
      if (typeof candidate !== 'string' || !isAbsolute(candidate)) continue;
      try {
        const result = tryGit(candidate, ['rev-parse', '--path-format=absolute', '--show-toplevel', '--git-dir', '--git-common-dir']);
        const fields = result.stdout.split('\n');
        if (result.status !== 0 || fields.length !== 3 || fields.some((field) => !field)) continue;
        const [root, gitDir, candidateCommonDir] = fields;
        if (!existsSync(join(root, '.git'))
          || realpathSync.native(candidateCommonDir) !== commonDir
          || realpathSync.native(gitDir) !== realpathSync.native(candidateCommonDir)) continue;
        roots.set(realpathSync.native(root), root);
      } catch { /* A stale registry entry or Git metadata directory is not a usable checkout. */ }
    }
    return [...roots.values()];
  };
  const worktrees = tryGit(info.root, ['worktree', 'list', '--porcelain', '-z']);
  if (worktrees.status === 0) {
    const candidates = worktrees.stdout.split('\0')
      .filter((field) => field.startsWith('worktree '))
      .map((field) => field.slice('worktree '.length));
    const found = matches(candidates);
    if (found.length === 1) return found[0];
  }
  const registered = registeredProjectRootsSnapshot();
  if (registered === null) return null;
  const found = matches(registered);
  return found.length === 1 ? found[0] : null;
}

/** A real runtime session may route across its own local seats; marker-only shells stay isolated. */
function nextSessionSeats(ctx, board) {
  if (ctx.info.isMain || ctx.io.personChannel === 'view' || ctx.io.personRequest
    || !AGENT_SESSION_IDS.some((name) => Boolean(process.env[name]))) return null;
  const digest = agentSessionDigest();
  return digest ? localSessionSeats(ctx.info, { agents: store.listAgents(board), digest }) : null;
}

/** Choose or open the matching lane seat, retaining ordinary checkout ownership and lane guards. */
async function nextSeatContext(ctx, board, me, item, seats) {
  const available = seats.filter((agent) => agent.agent_lane === item.item_lane
    && store.ROUTES.indexOf(agent.agent_route) >= store.ROUTES.indexOf(item.item_route));
  const held = item.item_status === 'claimed';
  let agent = held ? available.find((seat) => seat.agent_id === item.item_owner)
    : available.find((seat) => seat.agent_id === me.id) ?? available[0];
  let created = false;
  if (!agent) {
    let opened;
    await worktreeFor({ ...ctx.io, say: () => {}, result: (value) => { opened = value; } }, item.item_lane, me.route, me.family, me.model);
    agent = store.agentAt(board, opened.path);
    created = true;
  }
  const target = agent.agent_path === ctx.info.root ? ctx : context({ ...ctx.io, cwd: agent.agent_path });
  if (target.info.commonDir !== ctx.info.commonDir) throw new Refused('NOT_YOUR_CHECKOUT', 'the selected lane seat no longer belongs to this board; run pullboard next again');
  await bindLocalSession(target.info, { agent: agent.agent_id, digest: agentSessionDigest() });
  return { context: target, seat: { agent: agent.agent_id, lane: agent.agent_lane, path: target.info.root, created } };
}

/**
 * One loop of `next`: claim the next free item, or reserve the next review (V15). A claim that loses
 * a race to another agent is not an error; the caller looks again. A review is looked for and
 * reserved in one transaction, so it cannot lose that race.
 *
 * @param {any} ctx
 * @param {any} values
 * @returns {{ item?: any, held?: boolean, retry?: boolean, reasons?: string[] }}
 */
async function nextOnce(ctx, values) {
  return await withBoard(ctx, async (board) => {
    if (values.verify) checkMainVerifier(ctx, board, values);
    const me = whoAmI(ctx, board);
    if (values.verify) return nextReview(ctx, board, me, values, { ordered: (operation, args) => ordered(ctx, board, operation, args), idArg, trunkMerge });
    const warm = warmFiles(ctx, board, me);
    const seats = nextSessionSeats(ctx, board);
    const owners = new Set(seats?.map((seat) => seat.agent_id));
    const heldItems = seats ? store.listItems(board).filter((item) => item.item_status === 'claimed'
      && item.item_parent_id === null && owners.has(item.item_owner)
      && store.ROUTES.indexOf(item.item_route) <= store.ROUTES.indexOf(me.route)) : [];
    const heldItem = heldItems.find((item) => item.item_owner === me.id) ?? heldItems[0];
    const { item, reasons, shared } = heldItem ? { item: heldItem, reasons: [], shared: [] }
      : store.nextFor(board, { agentId: me.id, lane: me.lane, runnable: values.runnable, routes: values.routes, warm,
        ...(seats ? { lanes: laneNames(ctx.config).filter((lane) => lane !== COORDINATOR) } : {}),
        priority: mainRedReworkItems(ctx.info.root, board) });
    const held = item?.item_status === 'claimed';
    /** Offer only reviews this seat may give; a linked board previews its engine-27 verifier standing (#579). */
    const findOffer = () => store.reviewOffer(board, { agentId: me.id, lane: me.lane, policy: ctx.config.verify.policy,
      familyPolicy: ctx.config.verify.family, ratio: ctx.config.verify.reviewRatio, runnable: values.runnable, routes: values.routes });
    const offer = held ? null : relayLinked(ctx.info.root) ? store.withVerifierStanding(board, { root: true }, findOffer) : findOffer();
    if (offer && !values.build) return { item: offer.item, offer, build: item ?? null };
    if (!item) return { reasons, laneWork: ctx.info.isMain ? mainLaneWork(store.listItems(board)) : null };
    const reviewSkipped = values.build && !held
      ? { offeredItem: offer?.item.item_id ?? null, ratio: ctx.config.verify.reviewRatio, ...store.reviewQueue(board) } : null;
    const routed = seats ? await nextSeatContext(ctx, board, me, item, seats) : { context: ctx };
    const target = routed.context;
    const holder = whoAmI(target, board);
    try {
      await claimOrdered(target, board, [item.item_id, { agentId: holder.id, lane: holder.lane, leaseMs: target.config.leaseMs, freeze: claimFreezer(target, board), head: headCommit(target.info.root), reviewSkipped }]);
    } catch (error) {
      if (error instanceof MainSpecMerged) return { retry: true, ...routed, specMerged: { item: item.item_id, rows: error.rows } };
      if (error instanceof Refused && ['HELD', 'ITEM_HELD', 'BLOCKED', 'ONE_CLAIM'].includes(error.code)) return { retry: true };
      throw error;
    }
    return { item: store.getItem(board, item.item_id), shared, held, reviewSkipped, reasons, ...routed };
  });
}


/** Print an unreserved review first, then the build available through an explicit opt-out. */
function sayReviewOffer(ctx, found) {
  const command = `pullboard next --verify ${found.item.item_id}${ctx.info.isMain ? ' --as coordinator' : ''}`;
  const offer = { item: found.item.item_id, command, queue: found.offer.queue, ratio: found.offer.ratio };
  ctx.io.result?.({ item: found.item, review: true, held: false, shared: [], offer, build: found.build });
  ctx.io.say(`${reviewQueueLine(ctx, offer.queue, span)}; ratio ${offer.ratio} reached (zero active reviewers counts as one)`);
  const agents = withBoard(ctx, (board) => store.listAgents(board));
  ctx.io.say(`review offered: #${found.item.item_id} ${found.item.item_title}, built by ${agentDisplayName(agents, ctx.config, found.item.item_built_by)}; reserve it explicitly: ${command}`);
  if (found.build) ctx.io.say(`build available: #${found.build.item_id} ${found.build.item_title}; claim it explicitly: pullboard next --build`);
  else ctx.io.say('no build is currently free in your lane; this review is available');
}


/**
 * A review search that found nothing while another agent is still building: say so, with the wait,
 * so a reviewer who starts first is not told NOTHING_FREE as if the board were idle [C7,P4].
 *
 * @param {any} ctx
 */
function refuseWhileBuilding(ctx) {
  const building = withBoard(ctx, (board) => {
    const me = whoAmI(ctx, board).id;
    const items = store.listItems(board);
    if (items.some((item) => item.item_status === 'submitted' && item.item_built_by !== me)) return [];
    return items.filter((item) => item.item_status === 'claimed' && item.item_owner !== me).map((item) => `#${item.item_id}`).reverse();
  });
  if (building.length) throw new Refused('REVIEW_NOT_READY', `nothing to review yet; the builder is still working on ${building.join(', ')}`);
}

/**
 * `pullboard next` (N2): the whole start of an agent's loop in one command. With --wait, it keeps
 * looking until something is free, so an agent blocked on other work needs no polling of its own.
 *
 * @param {any} io
 * @param {any} values
 * @returns {Promise<number>}
 */
async function nextHere(io, values) {
  let ctx = context(io);
  if (values.build && values.verify) throw new Refused('USAGE', 'choose a build or a review: pullboard next --build or pullboard next --verify');
  if (values.verifyId !== undefined && !values.verify) {
    throw new Refused('USAGE', 'give an item id only with --verify: pullboard next --verify <id>');
  }
  if (values.verifyId !== undefined) idArg(values.verifyId, 'an item id after --verify');
  const minutes = values.wait === undefined ? 0 : Number(values.wait);
  if (!Number.isFinite(minutes) || minutes < 0 || minutes > 240) {
    throw new Refused('USAGE', '--wait is a number of minutes from 0 to 240');
  }
  const deadline = Date.now() + minutes * 60_000;
  const origin = ctx.info.root;
  for (;;) {
    const found = await nextOnce(ctx, values);
    if (found.context) ctx = found.context;
    if (found.specMerged) {
      io.say(`merged main before claiming #${found.specMerged.item}: added spec rows ${found.specMerged.rows.join(', ')}`);
      ctx = context(io);
      continue;
    }
    if (found.item) {
      if (found.offer) { sayReviewOffer(ctx, found); return 0; }
      const item = found.item;
      const agents = withBoard(ctx, (board) => store.listAgents(board));
      io.result?.({ item, review: Boolean(values.verify), held: Boolean(found.held), shared: found.shared ?? [], reasons: found.reasons ?? [], ...(found.seat ? { seat: found.seat } : {}) });
      for (const reason of found.reasons ?? []) io.say(displayedWait(reason, agents, ctx.config));
      const here = cdTo(ctx.info.root);
      const as = ctx.info.isMain ? ' --as coordinator' : '';
      if (values.verify) {
        sayCheckBaseline(io, item);
        io.say(`next to verify: #${item.item_id} ${item.item_title}, built by ${agentDisplayName(agents, ctx.config, item.item_built_by)} at ${item.item_commit.slice(0, 12)}`);
        io.say(`reserved for you until ${item.item_review_until}: another agent's verdict on it is refused until then; pullboard next --verify again renews it`);
        io.say(`check out exactly that commit, here: ${here} git switch --detach ${item.item_commit}`);
        io.say(`then: ${here} pullboard verify ${item.item_id} accept${as} --note "how you proved it", or reject${as} --reason CODE --note "what failed"`);
      } else {
        if (found.seat && found.seat.path !== origin) io.say(seatCheckout.seatLeadLine(found.seat, item, found.held));
        if (found.reviewSkipped) io.say(`${reviewQueueLine(ctx, found.reviewSkipped, span)}; explicit build intent recorded with this claim`);
        io.say(`${found.held ? (found.seat && found.seat.path !== origin ? `${found.seat.agent} holds` : 'you hold') : 'claimed'} #${item.item_id}: ${item.item_title}`);
        if (found.seat) io.say(`${found.seat.created ? 'opened' : 'work in'} ${found.seat.agent}, ${found.seat.lane} lane: ${here}`);
        if (found.shared?.length) io.say(`it touches ${found.shared.length === 1 ? 'a file' : `${found.shared.length} files`} you worked in recently: ${found.shared.slice(0, 4).join(', ')}`);
        if (item.item_criterion) io.say(`criterion: ${item.item_criterion}`);
        if (item.item_check) io.say(`check: ${item.item_check}   (run it before you submit)`);
        for (const row of item.item_frozen ? JSON.parse(item.item_frozen).rows : []) io.say(`  ${row.id}: ${row.text}`);
        sayBrief(io, item.item_brief);
        io.say(`when it is built and committed: ${here} pullboard submit ${item.item_id}`);
      }
      return 0;
    }
    if (!found.retry && (found.laneWork || Date.now() >= deadline)) {
      if (values.verify) refuseWhileBuilding(ctx);
      const agents = withBoard(ctx, (board) => store.listAgents(board));
      return refuseNextIdle(io, found.reasons, found.reasons.map((reason) => displayedWait(reason, agents, ctx.config)), { minutes, verify: values.verify, laneWork: found.laneWork });
    }
    if (!found.retry) await new Promise((done) => setTimeout(done, 5000));
  }
}

/**
 * `pullboard sweep` (N15, N17): run a checker, then file one routed item per file it flags, each
 * with the problems in its brief and the checker on that file as its check. Each check runs once
 * first, on the file as it is: it must fail there, or it could never prove a fix.
 *
 * @param {any} ctx
 * @param {any} board
 * @param {{ id: string }} me
 * @param {any} values
 * @returns {Promise<number>}
 */
async function sweepHere(ctx, board, me, values) {
  if (me.id !== COORDINATOR) throw new Refused('COORDINATOR_ONLY', 'the coordinator files sweep items, from the main checkout');
  const report = String(values.run ?? '').trim();
  const check = String(values.check ?? '').trim();
  if (!report || !check.includes('{file}')) {
    throw new Refused('USAGE', 'pullboard sweep --run "<checker over the repo>" --check "<the checker on one file, with {file} where its path goes>"');
  }
  const max = values.max === undefined ? 20 : idArg(values.max, 'a number after --max');
  const ran = spawnSync(report, { cwd: ctx.info.root, shell: true, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  invalidateGitFacts();
  const problems = parseProblems(`${ran.stdout ?? ''}\n${ran.stderr ?? ''}`, ctx.info.root);
  if (!problems.length) {
    ctx.io.say(`the checker reported no problems I can read (exit ${ran.status}); nothing to file`);
    return 0;
  }
  const covered = new Set(store.listItems(board).filter((item) => item.item_title.startsWith('fix ')).flatMap((item) => briefFiles(item.item_brief)));
  const { items, skipped } = sweepItems(problems, {
    laneOf: (path) => laneOf(ctx.config, path),
    covered,
    check,
    report,
    route: values.route ?? 'light',
    max,
  });
  const blind = [];
  for (const item of items) {
    const canary = spawnSync(item.check, { cwd: ctx.info.root, shell: true, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    invalidateGitFacts();
    if (canary.status === 0) {
      blind.push(item.file);
      continue;
    }
    if (values['dry-run']) {
      ctx.io.say(`would file: ${item.title} (${item.lane} lane, ${item.route})`);
      continue;
    }
    const id = await ordered(ctx, board, 'addItem', [{ by: me.id, lane: item.lane, title: item.title, criterion: item.criterion, brief: item.brief, route: item.route, check: item.check }]);
    ctx.io.say(`#${id} ${item.title} (${item.lane} lane, ${item.route})`);
  }
  if (skipped.length) ctx.io.say(`already open: ${skipped.join(', ')}`);
  if (blind.length) {
    const refusal = new Refused('CHECK_CANNOT_FAIL', `the check passes on ${blind.join(', ')} although the checker flags problems there, so it could never prove a fix; not filed. A check ending in a pipe takes its exit status from the last command. Fix the check so flagged files make it fail, then run pullboard sweep again.`);
    ctx.io.refusal?.(refusal);
    ctx.io.err(`pullboard: ${refusal.message}`);
  }
  const filed = items.length - blind.length;
  ctx.io.say(`${problems.length} problems in ${new Set(problems.map((problem) => problem.file)).size} files; ${values['dry-run'] ? 'would file' : 'filed'} ${filed}`);
  return blind.length ? 1 : 0;
}

/**
 * The commands that change the board.
 *
 * @param {any} io
 * @param {any} args
 * @returns {Record<string, () => number>}
 */
function workCommands(io, args) {
  const { first, second, rest, values } = args;
  const act = (work) => {
    const ctx = context(io);
    return withBoard(ctx, (board) => work(ctx, board, whoAmI(ctx, board)));
  };
  return {
    blueprint: () => act(async (ctx, board, me) => {
      if (first === 'fit') return await fitCommand(ctx, board, me, 'propose', [second, ...rest].filter((value) => value !== undefined), values, { ordered, whoAmI });
      const references = [...(second ? [second] : []), ...(values.blueprint ?? [])];
      if (first !== 'add' || !references.length || rest.length) throw new Refused('USAGE', `pullboard blueprint add <name or file> [--blueprint <name or file>]... | save [file]; bundled: ${bundledBlueprints().join(', ')}`);
      // Several blueprints land in the order given, as one result; one lands exactly as before (#720).
      const listed = readBlueprints(references, io.cwd, 'blueprint add', installedBlueprints(ctx.info.root));
      const landed = await landEach(listed, ({ blueprint }, drafted) => addBlueprint(ctx, board, me, blueprint, { result: listed.length === 1, drafted }));
      if (listed.length > 1) io.result?.(combinedSummary(landed));
      return 0;
    }),
    fact: () => act(async (ctx, board, me) => {
      if (!first || !second || rest.length !== 1) throw new Refused('USAGE', 'pullboard fact <id> <kind> <text> [--supersedes <fact-id>] [--ref path:lines@full-sha] [--implies <ids>] [--cause <key> --never-again --as person]');
      const id = idArg(first);
      const implies = parseImplies(values.implies);
      const asPerson = values.as === 'person' && personMode(ctx, me, values);
      if (asPerson) requirePersonChannel(ctx.io.personChannel);
      const marked = asPerson || values['never-again'] || values.cause !== undefined
        ? { cause: values.cause ?? null, neverAgain: Boolean(values['never-again']), asPerson, channel: ctx.io.personChannel ?? 'terminal' } : {};
      const fact = await ordered(ctx, board, 'appendFact', [id, { agentId: me.id, kind: second,
        text: rest[0], supersedes: values.supersedes ?? null, ref: values.ref ?? null, ...(implies ? { implies } : {}), ...marked }]);
      io.result?.({ item: id, fact });
      io.say(`fact ${fact.id} appended to #${id} as ${fact.kind}`);
      return 0;
    }),
    milestone: () => act(async (ctx, board, me) => {
      const ids = (text) => (text ?? '').split(',').map((value) => value.trim()).filter(Boolean);
      let name;
      let entry;
      if (first === 'add') {
        if (!second || rest.length || values.before !== undefined || values.add !== undefined || values.remove !== undefined || values.name !== undefined) {
          throw new Refused('USAGE', 'pullboard milestone add <name> [--note ...] [--items 1,2,3]');
        }
        name = await ordered(ctx, board, 'addMilestone', [{ agentId: me.id, name: second, note: values.note ?? null, items: ids(values.items) }]);
      } else if (first === 'items') {
        if (!second || rest.length || Boolean(values.add) === Boolean(values.remove) || values.items !== undefined || values.note !== undefined || values.before !== undefined || values.name !== undefined) {
          throw new Refused('USAGE', 'pullboard milestone items <name> --add ids or --remove ids');
        }
        name = second;
        const next = await ordered(ctx, board, 'editMilestoneItems', [name, {
          agentId: me.id,
          add: values.add === undefined ? [] : ids(values.add),
          remove: values.remove === undefined ? [] : ids(values.remove),
        }]);
        entry = { ...store.milestones(board).find((value) => value.name === name), items: next };
      } else if (first === 'order') {
        if (!second || rest.length !== 1 || !rest[0].trim() || values.items !== undefined || values.note !== undefined || values.before !== undefined || values.name !== undefined || values.add !== undefined || values.remove !== undefined) {
          throw new Refused('USAGE', 'pullboard milestone order <name> <ids>');
        }
        name = second;
        await ordered(ctx, board, 'orderMilestoneItems', [name, { agentId: me.id, items: ids(rest[0]) }]);
      } else if (first === 'move') {
        if (!second || rest.length || !values.before || values.items !== undefined || values.note !== undefined || values.name !== undefined || values.add !== undefined || values.remove !== undefined) {
          throw new Refused('USAGE', 'pullboard milestone move <name> --before <other>');
        }
        name = second;
        await ordered(ctx, board, 'moveMilestone', [name, { agentId: me.id, before: values.before }]);
        entry = store.milestones(board).find((value) => value.name === name);
      } else if (first === 'edit') {
        if (!second || rest.length || (values.name === undefined && values.note === undefined && values.target === undefined) || values.items !== undefined || values.before !== undefined || values.add !== undefined || values.remove !== undefined || values.next !== undefined) {
          throw new Refused('USAGE', 'pullboard milestone edit <name> [--name <new name>] [--note <text>] [--target <date and time>|none]');
        }
        name = second;
        entry = await ordered(ctx, board, 'editMilestone', [name, { agentId: me.id, newName: values.name, note: values.note, ...(values.target === undefined ? {} : { target: store.canonicalMilestoneTarget(values.target) }) }]);
        name = entry.name;
      } else if (first === 'ship') {
        if (!second || rest.length || ['items', 'note', 'before', 'name', 'add', 'remove', 'target'].some((key) => values[key] !== undefined)) {
          throw new Refused('USAGE', 'pullboard milestone ship <name> [--next <name>]');
        }
        name = second;
        const shipped = await ordered(ctx, board, 'shipMilestone', [name, { agentId: me.id, commit: mainCheckout(ctx.info.root)?.commit ?? null, ...(values.next === undefined ? {} : { next: values.next }) }]);
        io.result?.(shipped);
        const outcome = shipped.moved.length ? `moved ${shipped.moved.map((id) => `#${id}`).join(', ')} into ${shipped.into}` : 'no local items moved';
        const external = shipped.notMoved.length ? `; not moved across boards: ${shipped.notMoved.join(', ')}` : '';
        io.say(`milestone shipped: ${name} at ${shipped.milestone.shipped.commit}; ${outcome}${external}`);
        return 0;
      } else if (first === 'remove') {
        if (!second || rest.length || values.items !== undefined || values.note !== undefined || values.before !== undefined || values.name !== undefined || values.add !== undefined || values.remove !== undefined) {
          throw new Refused('USAGE', 'pullboard milestone remove <name>');
        }
        name = second;
        await ordered(ctx, board, 'removeMilestone', [name, { agentId: me.id }]);
        entry = { name };
      } else {
        throw new Refused('USAGE', 'use pullboard milestone add, items, order, move, edit, ship or remove');
      }
      entry ??= store.milestones(board).find((value) => value.name === name);
      io.result?.({ milestone: entry });
      io.say(`milestone ${first === 'remove' ? 'removed' : first === 'add' ? 'added' : 'updated'}: ${name}`);
      return 0;
    }),
    add: () => act(async (ctx, board, me) => {
      const recovered = await relayCommandReceipt(ctx.info.root, io.relayCommand);
      if (recovered) {
        for (const event of recovered.events) io.onEvent?.(event);
        const id = recovered.result;
        io.result?.({ item: store.getItem(board, id) });
        io.say(`#${id}`);
        sayCheckBaseline(io, store.getItem(board, id));
        await relayCommandReceiptReported(ctx.info.root, recovered.move.id);
        return 0;
      }
      if (!first || !isLane(ctx.config, first)) throw new Refused('NO_LANE', `no lane "${first ?? ''}"; see: pullboard lanes`);
      const specIds = idList(values.specs);
      const problems = idProblems(loadSpec(ctx.info.root, ctx.config), specIds, ctx.doctrine);
      if (problems.length) throw new Refused('UNKNOWN_SPEC', `${problems.join('; ')}`);
      const parentId = values.parent ? idArg(values.parent, 'a parent item id') : null;
      const after = idList(values.after).map((text) => idArg(text, 'an item id after --after'));
      const title = [second, ...rest].filter(Boolean).join(' ');
      const item = {
        by: io.personRequest?.phase === 'execute' ? store.PERSON : me.id,
        lane: first,
        title,
        criterion: values.criterion ?? '',
        specIds,
        parentId,
        after,
        brief: briefInLane(ctx, first, briefArg(io, values) ?? ''),
        route: values.route ?? 'strong',
        check: values.check,
      };
      buildInFilelessLane(ctx.config, first, after);
      const { command } = store.validateItemAddition(board, item);
      if (command) refuseCheckSyntax(command);
      if (command) item.checkBaseline = values.wait ? checkBaseline(ctx.info.root, command) : prepareCheckBaseline(ctx.info.root, command);
      const id = await ordered(ctx, board, 'addItem', [item]);
      if (item.checkBaseline?.result === 'pending') await launchBaseline(ctx, board, id, item.checkBaseline);
      io.result?.({ item: store.getItem(board, id) });
      io.say(`#${id}`);
      sayCheckBaseline(io, store.getItem(board, id));
      return 0;
    }),
    edit: () => act(async (ctx, board, me) => {
      const id = idArg(first);
      const recovered = await relayCommandReceipt(ctx.info.root, io.relayCommand);
      if (recovered) {
        for (const event of recovered.events) io.onEvent?.(event);
        io.result?.({ item: store.getItem(board, id) });
        io.say(`edited #${id}`);
        sayCheckBaseline(io, store.getItem(board, id));
        await relayCommandReceiptReported(ctx.info.root, recovered.move.id);
        return 0;
      }
      const brief = briefArg(io, values);
      const change = {
        agentId: me.id,
        brief: brief === undefined ? undefined : briefInLane(ctx, store.getItem(board, id).item_lane, brief),
        route: values.route,
        criterion: values.criterion,
        check: values.check,
        after: editAfter(values.after),
        ...(values.reason !== undefined ? { reason: values.reason } : {}),
      };
      const { item, command } = store.validateItemEdit(board, id, change);
      if (command && command !== item.item_check) refuseCheckSyntax(command);
      if (command && command !== item.item_check) change.checkBaseline = values.wait ? checkBaseline(ctx.info.root, command) : prepareCheckBaseline(ctx.info.root, command);
      await ordered(ctx, board, 'editItem', [id, change]);
      if (change.checkBaseline?.result === 'pending') await launchBaseline(ctx, board, id, change.checkBaseline);
      io.result?.({ item: store.getItem(board, id) });
      io.say(`edited #${id}`);
      sayCheckBaseline(io, store.getItem(board, id));
      return 0;
    }),
    escalate: () => act(async (ctx, board, me) => {
      const id = idArg(first);
      const note = textArg(io, values, 'note') ?? '';
      const moved = await ordered(ctx, board, 'escalate', [id, { agentId: me.id, note }]);
      if (me.id !== COORDINATOR) {
        await ordered(ctx, board, 'shout', [{ from: me.id, to: COORDINATOR, text: `#${id} escalated ${moved.from} -> ${moved.to}: ${note}`, lanes: laneNames(ctx.config) }]);
      }
      io.result?.({ id, ...moved });
      io.say(`#${id} escalated ${moved.from} -> ${moved.to}; it is open for a ${moved.to} agent`);
      return 0;
    }),
    run: () => runItems(io, values, { context, withBoard, whoAmI, nextOnce, submitHere, freezer, ordered, claim: claimOrdered }),
    sweep: () => act((ctx, board, me) => sweepHere(ctx, board, me, values)),
    next: () => nextHere(io, { ...values, verifyId: first }),
    check: async () => {
      if (first === 'accept') return checkAcceptCommand(io, second, rest, { context, withBoard, whoAmI, ordered, idArg });
      const ctx = context(io);
      const { item, author, caller, agents } = withBoard(ctx, (board) => {
        const me = first ? (ctx.info.isMain ? { id: COORDINATOR } : { id: store.agentAt(board, ctx.info.root)?.agent_id }) : whoAmI(ctx, board);
        const held = first ? store.getItem(board, idArg(first))
          : store.listItems(board).find((entry) => entry.item_status === 'claimed' && entry.item_owner === me.id && entry.item_parent_id === null);
        if (!held) throw new Refused('NOT_HOLDING', 'you hold no item; name one, pullboard check <id>, or run the project gate: pullboard gate');
        seatCheckout.refuseHeldElsewhere(ctx.info, store.listAgents(board), held, 'check');
        return { item: held, author: store.itemCheckAuthor(board, held.item_id), caller: me.id, agents: store.listAgents(board) };
      });
      const check = frozenCheck(item);
      if (!check) throw new Refused('NO_CHECK', `#${item.item_id} has no check command; its proof is the project gate: pullboard gate`);
      const by = author || 'unknown (legacy)';
      const authorName = author ? agentDisplayName(agents, ctx.config, author) : by;
      const notice = `check #${item.item_id} set by ${authorName}: ${check}`;
      if (values.json) io.stderr.write(`${notice}\n`);
      else io.say(notice);
      if (!values.yes && (!author || author !== caller)) {
        if (values.json) io.stderr.write('Run this check? [y/N]\n');
        else io.err('Run this check? [y/N]');
        const answer = await firstInputLine(io.stdin);
        if (!/^y(?:es)?$/iu.test(answer.trim())) {
          throw new Refused('CHECK_CONFIRM', `the check set by ${authorName} was not run: ${check}; run pullboard check ${item.item_id} --yes after reading the command, or answer yes at the prompt`);
        }
      }
      await runStaticChecks(ctx.info.root, (item.item_claim_head ? itemPolicy(ctx.info.root, item) : mainPolicy(ctx.info.root)).config, { agent: caller, item: String(item.item_id), onWait: queuedItemLease(ctx, item, caller, 'build'), onBrowserFallback: browserAdmissionReporter(io, values.json) });
      const browser = !browserFreeChecksEnabled() || await checkNeedsBrowser(ctx.info.root, check, { onFallback: browserAdmissionReporter(io, values.json) });
      const shortEligible = Boolean(await explicitCheckFiles(ctx.info.root, check));
      const run = await withGateSlot(ctx.info.root, nativeFlakes.check(ctx, item, check, { ordered, withBoard, resourceAgent }), { browser, agent: caller, item: String(item.item_id), kind: 'check', itemCheck: true, shortEligible, onWait: queuedItemLease(ctx, item, caller, 'build') });
      refuseSandboxBlocked(run);
      io.result?.({ id: item.item_id, green: run.isGreen, seconds: run.seconds, check, by, receipt: run.profile?.receipt, report: run.isGreen ? '' : digestOf(run.output) });
      const timings = timingDigest(run.profile);
      const compact = timings && !run.profile.files.length
        ? `; ${timings.replaceAll('\n', '; ')}; timing profile: ${run.profilePath}` : '';
      io.say(`check ${run.isGreen ? 'green' : 'red'} in ${run.seconds}s: ${check}${compact}`);
      if (timings && run.profile.files.length) {
        io.say(timings);
        io.say(`timing profile: ${run.profilePath}`);
      }
      if (!run.isGreen) io.say(digestOf(run.output).replace(/^/gm, '  '));
      return run.isGreen ? 0 : 1;
    },
    claim: () => act(async (ctx, board, me) => {
      const id = idArg(first);
      let result;
      for (;;) {
        try {
          result = await claimOrdered(ctx, board, [id, { agentId: me.id, lane: me.lane, leaseMs: ctx.config.leaseMs, freeze: claimFreezer(ctx, board), head: headCommit(ctx.info.root) }]);
          break;
        } catch (error) {
          if (!(error instanceof MainSpecMerged)) throw error;
          io.say(`merged main before claiming #${id}: added spec rows ${error.rows.join(', ')}`);
          me = whoAmI(ctx, board);
        }
      }
      io.result?.({ id: idArg(first), ...result });
      io.say(`${result.renewed ? 'renewed' : 'claimed'} #${first} until ${result.leaseUntil}; criterion frozen as ${result.digest.slice(0, 12)}`);
      return 0;
    }),
    hold: () => act(async (ctx, board, me) => {
      const itemTarget = /^#?\d+$/u.test(first ?? '');
      if (itemTarget) {
        const id = idArg(first);
        const reason = values.reason ?? [second, ...rest].filter(Boolean).join(' ');
        if (values.off) {
          await ordered(ctx, board, 'releaseItemHold', [id, { agentId: me.id }]);
          io.say(`lifted the hold on #${id}`);
        } else {
          await ordered(ctx, board, 'holdItem', [id, { agentId: me.id, reason }]);
          io.say(`holding #${id}: ${reason}. Lift it with: pullboard hold ${id} --off`);
        }
        io.result?.({ id, lane: store.getItem(board, id).item_lane, held: !values.off, reason: values.off ? null : reason });
        return 0;
      }
      if (!first || !isLane(ctx.config, first)) throw new Refused('NO_LANE', `no lane "${first ?? ''}"; see: pullboard lanes`);
      if (values.off) {
        await ordered(ctx, board, 'releaseLane', [first, { agentId: me.id, asPerson: io.personChannel === 'view', channel: io.personChannel ?? 'terminal' }]);
        io.say(`released the ${first} lane`);
      } else {
        await ordered(ctx, board, 'holdLane', [first, { agentId: me.id, reason: values.reason ?? '', asPerson: io.personChannel === 'view', channel: io.personChannel ?? 'terminal' }]);
        io.say(`holding the ${first} lane: ${values.reason}. Release it with: pullboard hold ${first} --off`);
      }
      io.result?.({ lane: first, held: !values.off, reason: values.off ? null : values.reason });
      return 0;
    }),
    release: () => act(async (ctx, board, me) => {
      const args = [idArg(first), me.id, textArg(io, values, 'note') ?? ''];
      seatCheckout.refuseHeldElsewhere(ctx.info, store.listAgents(board), store.getItem(board, args[0]), 'release');
      const problem = store.reviewReleaseNoteProblem(board, ...args);
      if (problem) throw problem;
      const review = await ordered(ctx, board, 'release', args);
      io.result?.({ id: idArg(first) });
      io.say(review ? `released the review of #${first}; the review is free again` : `released #${first}`);
      return 0;
    }),
    submit: async () => submitHere(context(io), idArg(first), values.infra),
    done: async () => submitHere(context(io), idArg(first), values.infra),
    verify: () => verifyHere(context(io), idArg(first), args),
    land: () => act(async (ctx, board, me) => {
      if (me.id !== COORDINATOR || !ctx.info.isMain) throw new Refused('COORDINATOR_ONLY', 'only the coordinator lands verified batches; ask your coordinator to run pullboard land');
      if (first || second || rest.length) throw new Refused('USAGE', 'pullboard land [--max N] [--dry-run] [--adopt] | --waive <test> --until <date> --reason "why"');
      if (values.waive !== undefined) {
        requirePersonChannel(io.personChannel);
        const waiver = await ordered(ctx, board, 'recordLandingWaiver', [{ agentId: store.PERSON, channel: io.personChannel ?? 'terminal',
          id: randomUUID(), test: values.waive, until: values.until, reason: values.reason }]);
        io.result?.({ batch: null, landed: [], conflicts: [], blocked: [], culprits: [], flakes: [], waiver });
        io.say(`waived ${waiver.kind ?? store.landingWaiverKind(waiver.test)} ${waiver.test} until ${waiver.until}: ${waiver.reason}`);
        return 0;
      }
      if (values.until !== undefined || values.reason !== undefined || values.max !== undefined && (!/^[1-9][0-9]*$/u.test(values.max) || !Number.isSafeInteger(Number(values.max)))) throw new Refused('USAGE', 'use --max with a positive item count, or --waive with --until and --reason');
      const result = await land({ root: ctx.info.root, board, config: mainPolicy(ctx.info.root).config,
        write: (operation, parameters) => ordered(ctx, board, operation, parameters), say: io.say, owner: agentSessionDigest() ?? `pid-${process.pid}`,
        maximum: values.max === undefined ? Infinity : Number(values.max), dryRun: Boolean(values['dry-run']), adopt: Boolean(values.adopt), onWait: gateWaitReporter(io) });
      io.result?.(result);
      for (const blocked of result.blocked ?? []) if (blocked.code === 'STALE_VERDICT') io.say(staleVerdictRefusal({ item_id: blocked.id }, blocked).message);
      if (!result.batch) io.say(result.items ? `would land: ${result.items.map((id) => `#${id}`).join(', ') || 'none'}` : 'no verified items ready to land');
      return 0;
    }),
    merged: () => act(async (ctx, board, me) => {
      const recovered = await relayCommandReceipt(ctx.info.root, io.relayCommand);
      if (recovered) {
        for (const event of recovered.events) io.onEvent?.(event);
        const commit = recovered.move.args[1].commit;
        io.result?.({ id: idArg(first), commit });
        io.say(`#${first} merged as ${commit.slice(0, 12)}`);
        await relayCommandReceiptReported(ctx.info.root, recovered.move.id);
        return 0;
      }
      const commit = resolveCommit(ctx.info.root, second ?? '');
      if (!commit) throw new Refused('NO_COMMIT', `no commit "${second ?? ''}" in this repo`);
      const id = idArg(first);
      const note = (textArg(io, values, 'note') ?? '').trim();
      const item = store.getItem(board, id);
      if (item.item_status === 'verified') {
        const trunk = mainCheckout(ctx.info.root);
        const itemCommit = item.item_commit;
        const itemOnCandidate = contains(ctx.info.root, itemCommit, commit);
        const candidateOnTrunk = Boolean(trunk?.commit && contains(ctx.info.root, commit, trunk.commit));
        const parent = tryGit(ctx.info.root, ['rev-parse', '--verify', '--quiet', `${commit}^`]);
        const itemPatch = item.item_claim_head ? patchId(ctx.info.root, item.item_claim_head, itemCommit) : null;
        const candidatePatch = parent.status === 0 ? patchId(ctx.info.root, parent.stdout, commit) : null;
        const carriesPatch = Boolean(itemPatch && candidatePatch && itemPatch === candidatePatch);
        if (!note && !(candidateOnTrunk && (itemOnCandidate || carriesPatch))) {
          const trunkName = trunk?.branch ?? 'the unavailable primary trunk';
          const trunkAt = trunk?.commit ? ` at ${trunk.commit}` : '';
          throw new Refused('NOT_MERGED', `commit ${commit} is not on trunk ${trunkName}${trunkAt}, or does not contain item commit ${itemCommit} or carry its patch; merge that work onto ${trunkName}, or use --note "why"`);
        }
      }
      await ordered(ctx, board, 'merged', [id, { agentId: me.id, commit, note }]);
      io.result?.({ id: idArg(first), commit });
      io.say(`#${first} merged as ${commit.slice(0, 12)}`);
      return 0;
    }),
    withdraw: () => act((ctx, board, me) => roadmapView.withdrawWithMilestones(ctx, board, me, idArg(first),
      [second, ...rest].filter(Boolean).join(' '), ordered)),
    refreeze: () => act(async (ctx, board, me) => {
      const result = await ordered(ctx, board, 'refreeze', [idArg(first), { agentId: me.id, freeze: freezer(ctx, { captureVerifyPolicy: true, board }) }]);
      io.result?.({ id: idArg(first), ...result });
      io.say(`#${first} refrozen ${String(result.before).slice(0, 12)} -> ${result.after.slice(0, 12)}; ${result.retainedClaim ? 'claim retained' : 'open again'}`);
      return 0;
    }),
    reopen: () => act(async (ctx, board, me) => {
      const result = await ordered(ctx, board, 'reopen', [idArg(first), { agentId: me.id, note: textArg(io, values, 'note') ?? '',
        ...(values.cause !== undefined ? { cause: values.cause } : {}),
        ...(values.conflict === undefined ? {} : { conflict: reopenConflict({ item: store.getItem(board, idArg(first)), coordinator: me.id === COORDINATOR, values: values.conflict, trunkMerge: (commit) => trunkMerge(ctx.info.root, commit) }) }) }]);
      io.result?.(result);
      io.say(reopenedLine(first, result));
      return 0;
    }),
    shout: () => act(async (ctx, board, me) => {
      const evidence = values.evidence === undefined ? null : evidenceFrom(ctx, values);
      const recipients = ['all', 'person', ...laneNames(ctx.config), ...board.db.prepare('SELECT agent_id FROM agent').all().map((agent) => agent.agent_id)];
      const hasRecipient = first && recipients.includes(first);
      const to = hasRecipient ? first : values.decision ? (me.id === COORDINATOR ? 'person' : COORDINATOR) : first ?? '';
      const text = [hasRecipient ? second : first, ...(hasRecipient ? rest : [second, ...rest])].filter(Boolean).join(' ');
      const id = await ordered(ctx, board, 'shout', [{ from: personShout(io, me) ? store.PERSON : me.id, to, text, lanes: laneNames(ctx.config), decision: Boolean(values.decision), evidence }]);
      io.result?.({ id, decision: Boolean(values.decision) });
      const agents = store.listAgents(board);
      const recipient = agents.some((agent) => agent.agent_id === to) ? agentDisplayName(agents, ctx.config, to) : to;
      io.say(values.decision ? `asked ${recipient} for a decision as #${id}; it stays open until someone runs: pullboard answer ${id} "<the decision>"` : `shouted to ${recipient}`);
      return 0;
    }),
    answer: () => act(async (ctx, board, me) => {
      const asPerson = personMode(ctx, me, values);
      if (asPerson) requirePersonChannel(ctx.io.personChannel);
      const implies = parseImplies(values.implies);
      const supersedes = values.supersedes === undefined ? undefined : idArg(String(values.supersedes).replace(/^#/u, ''));
      const id = await ordered(ctx, board, 'answerDecision', [idArg(first), { agentId: me.id, text: [second, ...rest].filter(Boolean).join(' '), lanes: laneNames(ctx.config), asPerson, channel: ctx.io.personChannel ?? 'terminal',
        ...(implies ? { implies } : {}), ...(supersedes ? { supersedes } : {}) }]);
      const ask = store.getShout(board, idArg(first));
      io.result?.({ id, answers: ask.shout_id });
      if (asPerson) {
        const originalAsker = ask.shout_answers === null ? ask.shout_from : store.getShout(board, ask.shout_answers).shout_from;
        io.say(`person answered #${ask.shout_id}; notified ${agentDisplayName(store.listAgents(board), ctx.config, originalAsker)} as #${id}`);
      } else {
        io.say(`answered #${ask.shout_id} to ${agentDisplayName(store.listAgents(board), ctx.config, ask.shout_from)} as #${id}`);
      }
      return 0;
    }),
    pass: () => act(async (ctx, board, me) => {
      const id = await ordered(ctx, board, 'passDecision', [idArg(first), { agentId: me.id, note: [second, ...rest].filter(Boolean).join(' '), lanes: laneNames(ctx.config) }]);
      io.result?.({ id, answers: idArg(first) });
      io.say(`passed #${first} to the person as #${id}`);
      return 0;
    }),
  };
}

/** Label the kind and item of a queued run without hiding older queue-class labels.
 * With short slots on, a holder also names the slot it holds and a waiter says it may take a short one.
 */
function resourceRunLabel(entry, shortSlots = 0) {
  const priority = entry.landing ? 'landing' : entry.itemCheck ? 'item check' : entry.diagnostic ? 'diagnostic' : '';
  const slot = !shortSlots ? '' : entry.slot ? `${entry.slot} slot` : entry.requestedSlot === 'short-eligible' ? 'may use a short slot' : '';
  const details = [slot, entry.kind !== priority ? entry.kind : '', entry.item ? `#${entry.item}` : '', entry.leaseUntil ? `lease until ${entry.leaseUntil}` : '', entry.browser ? 'browser' : ''].filter(Boolean);
  return `${priority ? ` (${priority})` : ''}${details.length ? ` (${details.join(', ')})` : ''}`;
}

/** Name a known board seat for queue diagnostics without requiring an unjoined checkout to join. */
function resourceAgent(ctx) {
  return ctx.info.isMain ? COORDINATOR : withBoard(ctx, board => store.agentAt(board, ctx.info.root)?.agent_id);
}

/** Keep only this queued command's live item lease, using ordinary ordered board moves. */
function queuedItemLease(ctx, initial, agentId, kind) {
  const report = gateWaitReporter(ctx.io);
  // Naming somebody else's check remains read-only; it never extends their build claim.
  if (kind === 'build' && (initial.item_status !== 'claimed' || initial.item_owner !== agentId)) return report;
  const review = kind === 'review';
  // Accepted items retain their former reviewer as history, not a renewable reservation.
  if (review && (initial.item_status !== 'submitted' || initial.item_review_by !== agentId)) return report;
  const field = review ? 'item_review_until' : 'item_lease_until';
  const owner = review ? 'item_review_by' : 'item_owner';
  const status = review ? 'submitted' : 'claimed';
  const leaseMs = review ? ctx.config.reviewLeaseMs : ctx.config.leaseMs;
  const expected = { digest: initial.item_frozen_digest, commit: initial.item_commit };
  let confirmedLeaseUntil = '';
  return async (state) => {
    if (!state.admitted) report(state);
    const now = ctx.clock.now().getTime();
    // Queue polling is frequent; reopen the board only when renewal is due or admission starts.
    if (!state.admitted && Date.parse(confirmedLeaseUntil) - now > leaseMs / 2) {
      return { leaseUntil: confirmedLeaseUntil };
    }
    return await withBoard(ctx, async (board) => {
      const current = store.getItem(board, initial.item_id);
      const expires = Date.parse(current[field]);
      if (current.item_status !== status || current[owner] !== agentId || !Number.isFinite(expires) || expires <= now
        || current.item_frozen_digest !== expected.digest || current.item_commit !== expected.commit) {
        throw new Refused('ITEM_LEASE_LOST', `the queued ${review ? 'review' : 'build'} lease for #${initial.item_id} changed or expired; claim or reserve the item again before retrying`);
      }
      if (state.admitted || expires - now <= leaseMs / 2) {
        const result = await ordered(ctx, board, review ? 'reserveReview' : 'claim', [initial.item_id, {
          agentId, leaseMs,
          ...(review ? { policy: ctx.config.verify.policy, familyPolicy: ctx.config.verify.family }
            : { lane: current.item_lane, freeze: claimFreezer(ctx), head: headCommit(ctx.info.root) }),
        }]);
        confirmedLeaseUntil = review ? result.item_review_until : result.leaseUntil;
        return { leaseUntil: confirmedLeaseUntil };
      }
      confirmedLeaseUntil = current[field];
      return { leaseUntil: confirmedLeaseUntil };
    });
  };
}

/** Print the file and reason when conservative uncertainty reserves browser capacity.
 * @param {any} io
 * @param {boolean} jsonMode
 * @returns {(decision:{file:string,reason:string})=>void}
 */
function browserAdmissionReporter(io, jsonMode = false) {
  return ({ file, reason }) => {
    if (!jsonMode) io.stderr.write(`browser admission fallback: ${file}: ${reason}\n`);
  };
}

/** Read or update machine-wide gate capacity. */
function settingsCommand(io, { first, second, rest }) {
  if (!first && !second && !rest.length) {
    const settings = loadMachineSettings();
    const queue = gateQueueSettings();
    // The result names the queue order in effect, defaults included; the file keeps only what was set.
    const offerAtInit = relayOfferEnabled();
    const shortSlots = gateShortSlots();
    io.result?.({ settings: { ...settings, gate: { ...settings.gate, queue: { ...settings.gate?.queue, ...queue }, shortSlots }, relay: { ...settings.relay, offerAtInit } }, memoryFloorMB: memoryFloorMB() });
    io.say(`gateSlots: ${settings.gateSlots}`);
    io.say(`browserSlots: ${settings.browserSlots}`);
    io.say(`gate.queue.reviewsFirst: ${queue.reviewsFirst}${queue.reviewsFirst ? '' : ' (landings first, then arrival order)'}`);
    io.say(`gate.queue.currentReleaseFirst: ${queue.currentReleaseFirst}${queue.currentReleaseFirst ? '' : ' (release priority is off)'}`);
    io.say(`gate.queue.agingMinutes: ${queue.agingMinutes}${queue.reviewsFirst || queue.currentReleaseFirst ? '' : ' (used only while reviewsFirst or currentReleaseFirst is true)'}`);
    io.say(`gate.memoryFloorMB: ${memoryFloorMB() ?? 'off (the gate queue does not wait for memory)'}`);
    io.say(`view.background: ${settings.view?.background !== false}${settings.view?.background === false ? ' (init and resume leave the view to you)' : ' (init and resume keep pullboard view running for pullboard.dev)'}`);
    io.say(`relay.offerAtInit: ${offerAtInit}${offerAtInit ? ' (init asks once to share your boards with your phone)' : ' (init stays quiet about sharing)'}`);
    io.say(`gate.shortSlots: ${shortSlots}${shortSlots ? '' : ' (off; runs that name their test files wait for a gate slot)'}`);
    return 0;
  }
  if (!SETTING_FORMS.includes(first) || !second || rest.length) {
    throw new Refused('USAGE', 'pullboard settings gateSlots <n> | browserSlots <n> | gate.shortSlots <n>');
  }
  if (first === 'gate.shortSlots') {
    if (!/^(?:0|[1-9]\d*)$/u.test(second) || !Number.isSafeInteger(Number(second))) {
      throw new Refused('BAD_SHORT_SLOTS', 'gate.shortSlots must be a whole number, 0 or more; run pullboard settings gate.shortSlots <n>');
    }
    const settings = setGateShortSlots(Number(second));
    io.result?.({ settings });
    io.say(`gate.shortSlots set to ${settings.gate.shortSlots}`);
    return 0;
  }
  if (!/^[1-9]\d*$/u.test(second) || !Number.isSafeInteger(Number(second))) {
    if (first === 'gateSlots') throw new Refused('USAGE', 'pullboard settings gateSlots <positive integer>');
    throw new Refused(first === 'browserSlots' ? 'BAD_BROWSER_SLOTS' : 'BAD_GATE_SLOTS', `${first} must be a positive integer; run pullboard settings ${first} <n>`);
  }
  const settings = first === 'browserSlots' ? setBrowserSlots(Number(second)) : setGateSlots(Number(second));
  io.result?.({ settings });
  io.say(`${first} set to ${settings[first]}`);
  return 0;
}

/** Register machine-level SSH capacity without requiring a board identity or a runner account. */
function runnerCommand(io, { first, second, rest, values }) {
  if (first !== 'add' || !second || rest.length || !/^[1-9]\d*$/u.test(values.slots ?? '')
    || !/^(?:0|[1-9]\d*)$/u.test(values.browser ?? '')) {
    throw new Refused('USAGE', 'pullboard runner add <ssh-host> --slots <positive integer> --browser <integer from zero through slots>');
  }
  const runner = addRunner({ host: second, slots: Number(values.slots), browser: Number(values.browser),
    ...(values.node !== undefined ? { node: values.node } : {}), ...(values.root !== undefined ? { root: values.root } : {}) });
  io.result?.({ runner });
  io.say(`registered runner ${runner.host}: ${runner.slots} slots, ${runner.browser} browser`);
  return 0;
}

/**
 * Every spec id something cites (S8): commit headers since the spec's first commit, and every item
 * on the board, open or closed. The connection is read-only: spec lint never migrates a shared board. Each must still be in the spec. The board is shared by every
 * checkout, so at an older commit an item may cite a row a later commit added: that id is not lost
 * here, only not written yet, and it counts once any ref has committed it (S10).
 *
 * @param {any} ctx
 * @param {{ ids: Map<string, string>, since: string | null }} history - this checkout's.
 * @returns {Map<string, string>} Each id, with who cites it.
 */
function citations(ctx, { ids, since }) {
  const cited = since ? commitCitations(ctx.info.root, since) : new Map();
  if (!existsSync(ctx.file)) return cited;
  const byItems = new Map();
  for (const item of hookRead(ctx, (board) => store.listItems(board, { all: true }))) {
    for (const id of item.item_spec_ids ? item.item_spec_ids.split(',') : []) {
      if (!cited.has(id) && !byItems.has(id)) byItems.set(id, `item #${item.item_id}`);
    }
  }
  const unseen = [...byItems.keys()].some((id) => !ids.has(id));
  const elsewhere = unseen ? committedIds(ctx.info.root, ctx.config.spec, ['--all']).ids : new Map();
  for (const [id, where] of byItems) if (ids.has(id) || !elsewhere.has(id)) cited.set(id, where);
  return cited;
}

/** Current board evidence, with each item's accepting receipts included once. */
function specProof(ctx) {
  if (!existsSync(ctx.file)) return { items: [], verdicts: [] };
  return withBoard(ctx, (board) => {
    const items = store.listItems(board, { all: true });
    return { items, verdicts: items.flatMap((item) => store.verdictsFor(board, item.item_id)) };
  });
}

/**
 * The spec commands: reads, sign-offs and person decisions applied by the coordinator.
 *
 * @param {any} io
 * @param {any} args
 * @returns {Promise<number>}
 */
async function specCommand(io, { first, second, rest, values }) {
  const ctx = context(io);
  const commandFlags = {
    '--json': ['json'],
    check: ['json'],
    view: ['out'],
    show: [],
    unmet: ['must'],
    signoff: ['by', 'note', 'note-file'],
    signers: ['key', 'by'],
    draft: ['aim', 'gate', 'section', 'doctrine', 'source'],
    approve: ['by', 'text'],
    decline: ['reason'],
    answer: [],
    apply: [],
    fit: ['text', 'reason'],
  }[first ?? '--json'];
  if (!commandFlags) throw new Refused('USAGE', 'use pullboard spec --json | check | view | show <id> | unmet [--must] | draft "<text>" | signoff <ids> | approve <ids> | decline <ids> --reason "why" | answer <id> "<choice or text>" | apply');
  const allowedFlags = [...new Set([...commandFlags, 'json'])];
  for (const flag of Object.keys(values)) {
    if (!allowedFlags.includes(flag)) {
      const next = flag === 'must' ? 'use --must with spec unmet' : 'use a flag accepted by this spec command';
      throw new Refused('FLAG_NOT_ALLOWED', `spec ${first ?? '--json'} does not take --${flag}; ${next}`);
    }
  }
  if (first === 'fit') {
    return await withBoard(ctx, async (board) => await fitCommand(ctx, board, null, second ?? 'list', rest, values, { ordered, whoAmI }));
  }
  const spec = loadSpec(ctx.info.root, ctx.config);
  if (!spec.exists) throw new Refused('NO_SPEC', `no ${ctx.config.spec}; run: pullboard init`);
  const practice = ctx.doctrine;
  const signoffs = readSignoffs(ctx.info.root);
  if (first === 'draft') {
    if (second && /\|\s*gate\s*:/iu.test(second)) {
      throw new Refused('INLINE_GATE', 'move the gate after the requirement as --gate "<check>"');
    }
    if (!second?.trim() || rest.length || /[\r\n|]/u.test(second)) {
      throw new Refused('USAGE', 'give one nonempty, single-line requirement: pullboard spec draft "<text>"');
    }
    if (values.gate !== undefined && (!values.gate.trim() || /[\r\n|]/u.test(values.gate))) {
      throw new Refused('USAGE', 'give one nonempty, single-line gate without a field separator, or omit --gate to use review');
    }
    if (values.doctrine) {
      if (typeof values.source !== 'string' || !values.source.trim() || /[\r\n|]/u.test(values.source)) {
        throw new Refused('USAGE', 'a doctrine ruling needs its source; give --source "shout 42" or --source "chat, 2026-10-16"');
      }
      withBoard(ctx, (board) => {
        if (!ctx.info.isMain || whoAmI(ctx, board).id !== COORDINATOR) throw new Refused('COORDINATOR_ONLY', 'only the coordinator proposes standing rulings; ask your coordinator to run spec draft --doctrine --source');
      });
      const planned = proposeDoctrine(ctx, values, second, { reserved: (hookRead(ctx, (board) => store.rowDrafts(board)) ?? []).map((draft) => draft.id), write: false });
      const result = proposeDoctrine(ctx, values, second, { id: (await reserveRow(ctx, { ...planned.row, target: 'doctrine' }, true)).id });
      io.result?.(result);
      io.say(result.id);
      return 0;
    }
    if (values.source !== undefined) throw new Refused('FLAG_NOT_ALLOWED', 'spec draft --source belongs to --doctrine; use both when proposing a ruling');
    const tier = values.aim ? 'aim' : 'must';
    const plan = draftRow(ctx.info.root, ctx.config, { target: 'spec', text: second.trim(), gate: values.gate?.trim() ?? 'review', tier, section: values.section, write: false,
      taken: [...(hookRead(ctx, (board) => store.rowDrafts(board)) ?? []).map((draft) => draft.id), ...(ctx.info.isMain ? [] : trunkRowIds(ctx.info.root, primaryCheckoutRoot(ctx.info), ctx.config))] });
    // A lane cannot write SPEC.md, so its reservation is the draft, cited at once and written by spec apply; the main checkout writes its row now (#878).
    const entry = await reserveRow(ctx, plan.row, ctx.info.isMain);
    const { id, row } = ctx.info.isMain ? draftRow(ctx.info.root, ctx.config, { target: 'spec', text: plan.row.text, gate: plan.row.gate, tier, section: values.section, id: entry.id }) : { id: entry.id, row: entry };
    io.result?.({ id, row });
    io.say(id);
    return 0;
  }
  if (first === 'approve' || first === 'decline') {
    requirePersonChannel(io.personChannel);
    return withBoard(ctx, async (board) => {
      const me = whoAmI(ctx, board);
      if (!ctx.info.isMain || me.id !== COORDINATOR) throw new Refused('B26_PERSON_APPROVAL', 'only the person from the main checkout approves or declines rows; use pullboard view for the person to decide');
      const ids = [second, ...rest].filter(Boolean).flatMap((text) => text.split(/[\s,]+/u)).filter(Boolean);
      // An approve keeps a pending answer: plain, it approves the answered text; --text says what it replaces.
      const kept = first === 'approve' ? pendingAnswers(ctx.info.root, ctx.config, ids, store.rowDecisions(board)) : new Map();
      const decide = { decision: first, reason: values.reason, by: values.by, on: new Date().toISOString(), commit: headCommit(ctx.info.root) ?? '' };
      const records = values.text === undefined && kept.size ? ids.flatMap((id) => prepareRowDecisions(ctx.info.root, ctx.config, { ...decide, ids: [id], text: kept.get(id)?.text }))
        : prepareRowDecisions(ctx.info.root, ctx.config, { ...decide, ids, text: values.text });
      const decisions = await ordered(ctx, board, 'recordRowDecisions', [{ agentId: store.PERSON, channel: io.personChannel ?? 'terminal', decisions: records }]);
      io.result?.({ decisions });
      decisions.forEach((record) => {
        const old = record.kind === 'spec' ? kept.get(record.id) : undefined;
        const now = decisionAnswer(record);
        if (old && old.text !== record.text) io.say(`${record.id}: this text replaces the pending answer ${old.answer} with ${now === null ? `"${record.text}"` : `the answer ${now}`}`);
        io.say(`${record.kind === 'doctrine' ? 'doctrine:' : ''}${record.id}: ${first === 'approve' ? (old && old.text === record.text ? `approved with the answer ${old.answer}` : 'approved') : 'declined'}, pending apply`);
      });
      return 0;
    });
  }
  if (first === 'answer') {
    requirePersonChannel(io.personChannel, process.env, { command: personCommand(primaryCheckoutRoot(ctx.info) ?? ctx.info.root, ['spec', 'answer', second, rest.join(' ')]) });
    return withBoard(ctx, async (board) => {
      const me = whoAmI(ctx, board);
      if (!ctx.info.isMain || me.id !== COORDINATOR) throw new Refused('B26_PERSON_APPROVAL', 'only the person answers a pending question, from the main checkout or the view', 'ask the person to answer it in pullboard view, or in their own terminal at the main checkout');
      const given = rest.join(' ').trim();
      if (!second || !given || /[\r\n|]/u.test(given)) throw new Refused('USAGE', 'give one row and a one-line answer without a field separator: pullboard spec answer <id> "<choice or text>"');
      const row = spec.rows.find((entry) => entry.id === second);
      if (!row) throw new Refused('NO_ROW', `${second} is not a row in ${ctx.config.spec}`, 'list the pending questions with pullboard spec --json, then answer one of them');
      if (row.status !== 'pending') throw new Refused('SPEC_ANSWER', `${second} is ${row.status}, not a pending question`, `read it with pullboard spec show ${second}; only a pending row takes an answer`);
      const { text } = answerQuestion(row.text, given, second);
      const records = prepareRowDecisions(ctx.info.root, ctx.config, { ids: [second], decision: 'approve', text, on: new Date().toISOString(), commit: headCommit(ctx.info.root) ?? '' });
      const decisions = await ordered(ctx, board, 'recordRowDecisions', [{ agentId: store.PERSON, channel: io.personChannel ?? 'terminal', decisions: records }]);
      // The answer reported is read back from the signed text, never carried as a field of its own.
      const answered = decisions.map((record) => ({ ...record, answer: decisionAnswer(record) }));
      io.result?.({ decisions: answered });
      answered.forEach((record) => io.say(`${record.id}: answered ${record.answer}, pending apply`));
      return 0;
    });
  }
  if (first === 'apply') {
    if (second || rest.length) throw new Refused('USAGE', 'pullboard spec apply takes no ids; it applies current person decisions');
    return withBoard(ctx, async (board) => {
      const me = whoAmI(ctx, board);
      if (!ctx.info.isMain || me.id !== COORDINATOR) throw new Refused('COORDINATOR_ONLY', 'only the coordinator applies row decisions; ask your coordinator to run pullboard spec apply');
      // A lane's board drafts (#878) reach SPEC.md as draft rows at their own ids; the person approves them there as before.
      const drafted = pendingRowDrafts(loadSpec(ctx.info.root, ctx.config), store.rowDrafts(board)).map((draft) => draftRow(ctx.info.root, ctx.config, { target: 'spec', text: draft.text, gate: draft.gate, tier: draft.tier, section: /^(.*?)\d+$/u.exec(draft.id)[1], id: draft.id }));
      drafted.forEach((row) => io.say(`${row.file}: ${row.id} drafted from a lane, for the person to approve`));
      clashingRowDrafts(loadSpec(ctx.info.root, ctx.config), store.rowDrafts(board)).forEach((draft) => io.say(`${ctx.config.spec}: ${draft.id} holds other text, so the draft by ${draft.by} was not written; shout ${draft.by} to run pullboard spec draft again and cite the new id`));
      const plan = planRowApply(ctx.info.root, ctx.config, store.rowDecisions(board));
      writeRowApply(ctx.info.root, plan);
      let applied;
      try { applied = await ordered(ctx, board, 'applyRowDecisions', [{ agentId: me.id, events: plan.records.map((record) => record.event) }]); }
      catch (error) { restoreRowApply(ctx.info.root, plan); throw error; }
      io.result?.({ applied, files: plan.files.map((file) => file.file) });
      applied.forEach((record) => io.say(`${record.file}: ${record.id} ${record.decision === 'approve' ? 'approved' : 'wont'}${record.reason ? `: ${record.reason}` : ''}`));
      if (!applied.length && !drafted.length) io.say('no pending row decisions');
      else io.say('stage and commit the changed row files and any .pullboard/signoffs.jsonl receipts');
      return 0;
    });
  }
  if (first === 'check' || first === undefined) {
    const files = [[ctx.config.spec, spec], ...(practice.exists ? [[practice.name, practice]] : [])];
    for (const [, parsed] of files) assertRequiredSigners(ctx.info.root, parsed.rows);
    const collisionFiles = [[ctx.config.spec, spec], ...(practice.repoExists ? [[practice.name, practice.repo]] : [])];
    const renameBase = collisionFiles.some(([name]) => name === DOCTRINE_FILE)
      ? legacyDoctrineRenameBase(ctx.info.root, DOCTRINE_FILE)
      : null;
    const baselineNotes = new Set();
    const previousSources = new Map();
    const previousCounts = new Map(collisionFiles.map(([name]) => {
      const baselineName = renameBase && name === DOCTRINE_FILE ? LEGACY_DOCTRINE_FILE : name;
      const previous = name === DOCTRINE_FILE && !renameBase
        ? { status: 1, stdout: '' }
        : coordinatorFile(ctx.info.root, baselineName, renameBase ?? undefined);
      if (previous.baseline) baselineNotes.add(previous.baseline);
      const rows = previous.status === 0 ? parseSpec(previous.stdout, { strictGrammarVersion: false }).rows : [];
      previousSources.set(name, rows);
      const counts = new Map();
      for (const row of rows) counts.set(row.id, (counts.get(row.id) ?? 0) + 1);
      return [name, counts];
    }));
    const locationsById = new Map();
    for (const [name, parsed] of collisionFiles) {
      for (const row of parsed.rows) {
        const locations = locationsById.get(row.id) ?? [];
        locations.push({ name, line: row.line });
        locationsById.set(row.id, locations);
      }
    }
    const collisionFindings = new Map(collisionFiles.map(([name]) => [name, []]));
    for (const [id, locations] of locationsById) {
      if (locations.length < 2) continue;
      const currentCounts = new Map();
      for (const location of locations) currentCounts.set(location.name, (currentCounts.get(location.name) ?? 0) + 1);
      const known = [...currentCounts].every(([name, count]) => count <= (previousCounts.get(name)?.get(id) ?? 0));
      for (let index = 0; index < locations.length; index++) {
        const location = locations[index];
        const other = locations[(index + 1) % locations.length];
        collisionFindings.get(location.name).push({
          level: known ? 'warning' : 'error', line: location.line, id,
          message: `${known ? 'known duplicate id' : 'duplicate id'}; also appears at ${other.name}:${other.line}`,
        });
      }
    }
    let errors = 0;
    const messages = [...baselineNotes];
    for (const [name, parsed] of files) {
      const findings = [
        ...lintSpec(parsed).filter((finding) => !finding.message.startsWith('duplicate id;')),
        ...(collisionFindings.get(name) ?? []),
      ];
      findings.forEach((finding) => messages.push(`${name}:${finding.line} ${finding.id ?? ''} ${finding.level}: ${finding.message}`.replace('  ', ' ')));
      const history = parsed === practice ? doctrineHistory(ctx.info.root, name) : committedIds(ctx.info.root, name);
      const cited = name === ctx.config.spec ? citations(ctx, history) : new Map();
      const lost = permanenceProblems(parsed === practice ? practice.repo : name === ctx.config.spec ? withRowDrafts(parsed, hookRead(ctx, (board) => store.rowDrafts(board))) : parsed, { committed: history.ids, cited });
      if (name === ctx.config.spec) {
        const mainRows = new Set((previousSources.get(name) ?? []).map(row => row.id));
        for (const problem of lost) {
          if (mainRows.has(problem.id)) problem.message = 'is present on main but missing from this worktree; run git merge main, then pullboard spec check';
        }
        const answered = handAnsweredQuestions(previousSources.get(name) ?? [], parsed.rows, () => hookRead(ctx, (board) => store.rowDecisions(board)) ?? []);
        lost.push(...answered.map((id) => ({ id, message: io.guidance(`pending question answered by hand; ask the person to run pullboard spec answer ${id} "<choice or text>" and restore the pending row`) })));
      }
      lost.forEach((problem) => messages.push(`${name}: ${problem.id} error: ${problem.message}`));
      const fileErrors = findings.filter((finding) => finding.level === 'error').length + lost.length;
      errors += fileErrors;
      messages.push(`${name}: ${parsed.rows.length} rows, ${fileErrors} errors, ${findings.length + lost.length - fileErrors} warnings`);
    }
    const unnamed = productProblems(ctx.config, spec);
    unnamed.forEach((problem) => messages.push(`${ctx.config.spec}: error: ${problem}`));
    errors += unnamed.length;
    if (values.json && !errors) {
      const rows = files.flatMap(([file, parsed]) => parsed.rows.map(({ id, status, tier, text, gate, serves, signers = [], section, line, origin, version, reason, file: source, source: from }) => (
        { id, status, tier, text, gate, serves, signers, section, line, file: source ?? file,
          ...(from === undefined ? {} : { source: from }), ...(origin ? { origin, version, reason } : {}) }
      )));
      const fit = readFitBatch(ctx.info.commonDir, { isMain: ctx.info.isMain, channel: io.personChannel });
      io.result({ rows, ...(fit.proposals.length ? { fit: fit.proposals, fitBatch: fit.batch } : {}) });
    } else messages.forEach((message) => io.say(message));
    if (!values.json) fitSummary(readFitBatch(ctx.info.commonDir, { isMain: ctx.info.isMain, channel: io.personChannel })).forEach((message) => io.say(message));
    return errors ? 1 : 0;
  }
  if (first === 'signers' && second === 'add') {
    requirePersonChannel(io.personChannel);
    const signer = addSigner(ctx.info.root, { by: values.by, key: values.key });
    io.result?.(signer);
    io.say(signer.added
      ? signer.initial
        ? `added SSH signer ${signer.by}; stage and commit ${signer.path}, .pullboard/first-commit, and .pullboard/signers.initial`
        : `added SSH signer ${signer.by} to ${signer.path}; commit ${signer.path} and .pullboard/signoffs.jsonl`
      : `${signer.by} is already listed in ${signer.path}`);
    return 0;
  }
  if (first === 'view') {
    const out = values.out ? resolve(ctx.io.cwd, values.out) : join(ctx.info.gitDir, 'pullboard', 'spec.html');
    const html = renderSpecView({
      title: spec.title,
      ...withBoard(ctx, board => rowDecisionView(ctx.info.root, ctx.config, store.rowDecisions(board), spec, practice)),
      signoffs,
      generatedAt: new Date().toISOString().slice(0, 16).replace('T', ' '),
      files: { spec: ctx.config.spec, practice: ctx.config.practice },
    });
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, html);
    io.result?.({ path: out });
    io.say(`wrote ${out}`);
    io.say(`open: ${pathToFileURL(out).href}`);
    return 0;
  }
  if (first === 'show') {
    const doctrineId = second?.startsWith('doctrine:');
    const parsed = doctrineId ? practice : spec;
    const id = doctrineId ? second.slice('doctrine:'.length) : second;
    const source = parsed.rows.find((entry) => entry.id === id);
    const row = source && withBoard(ctx, (board) => decisionProjection(store.rowDecisions(board), source, doctrineId ? 'doctrine' : 'spec', rowDecisionContext(ctx.info.root, ctx.config)));
    if (!row) throw new Refused('NO_ROW', `no row ${second ?? ''} in ${ctx.config.spec}`);
    const standing = standings(parsed.rows, signoffs).get(row.id) ?? { met: [], stale: [] };
    io.result?.({ row, standing });
    io.say(`${row.id} [${row.status}${row.tier ? `, ${row.tier}` : ''}] ${row.text}`);
    if (row.stage) io.say(row.stage);
    if (row.reason) io.say(`reason: ${row.reason}`);
    if (row.gate) io.say(`gate: ${row.gate}`);
    if (row.serves.length) io.say(`serves: ${row.serves.join(', ')}`);
    if (row.source) io.say(`source: ${row.source}`);
    io.say(`signed: ${standing.met.map((entry) => `${entry.by} ${entry.on}`).join(', ') || 'no'}${standing.stale.length ? `; stale: ${standing.stale.length}` : ''}`);
    for (const entry of [...standing.met, ...standing.stale]) if (entry.note) io.say(`note (${entry.by}): ${entry.note}`);
    return 0;
  }
  if (first === 'unmet') {
    const rows = unmetRows(spec.rows, signoffs, { mustOnly: values.must });
    const proof = specProof(ctx);
    const testFiles = citedTestFiles(ctx.info.root);
    const by = standings(spec.rows, signoffs);
    io.result?.({ rows: rows.map((row) => ({ ...row, stage: rowStage(by.get(row.id), rowEvidence(ctx.info.root, row.id, { ...proof, testFiles })) })) });
    rows.forEach((row) => io.say(`${row.id} [${row.tier || 'no tier'}] ${row.text} — ${rowStage(by.get(row.id), rowEvidence(ctx.info.root, row.id, { ...proof, testFiles }))}`));
    io.say(`${rows.length} approved rows without a current sign-off`);
    return 0;
  }
  if (first === 'signoff') {
    requirePersonChannel(io.personChannel);
    const ids = [second, ...rest].filter(Boolean).flatMap((text) => idList(text));
    if (!ids.length) throw new Refused('USAGE', 'pullboard spec signoff <ids> [--by <principal>] [--note "what was checked"]');
    const invalid = ids.filter((id) => spec.rows.find((row) => row.id === id)?.status !== 'approved');
    if (invalid.length) throw new Refused('CANNOT_SIGN', `${invalid.join(', ')}: only approved rows in this spec are signed`);
    const proof = specProof(ctx);
    const testFiles = citedTestFiles(ctx.info.root);
    const evidence = ids.map((id) => ({ id, ...rowEvidence(ctx.info.root, id, { ...proof, testFiles }) }));
    const missing = evidence.filter((row) => !row.files.length && !row.verified.length).map((row) => row.id);
    if (missing.length) throw new Refused('NO_EVIDENCE', `${missing.join(', ')} has no evidence; build it or cite its id in a test first`);
    for (const row of evidence) {
      io.say(`evidence for ${row.id}:`);
      if (row.files.length) io.say('  cited by tests (none run by pullboard):');
      for (const file of row.files) io.say(`    ${file}`);
      for (const item of row.verified) io.say(`  verified #${item.id}: ${item.note || '(no accepting note)'}`);
    }
    const note = textArg(io, values, 'note') ?? '';
    const by = values.by ?? (hasSignerFile(ctx.info.root) ? defaultPrincipal(ctx.info.root) : '');
    const count = signOff(ctx.info.root, spec, { ids, by, on: new Date().toISOString(), note, commit: headCommit(ctx.info.root) ?? '' });
    io.result?.({ count, by, ids, evidence });
    io.say(`signed ${count} rows as ${by}; commit .pullboard/signoffs.jsonl`);
    return 0;
  }
  throw new Refused('USAGE', 'pullboard spec --json | check | view | show <id> | unmet [--must] | draft "<text>" | signoff <ids> | signers add | approve <ids> | decline <ids> --reason "why" | answer <id> "<choice or text>" | apply');
}

/**
 * The hooks git runs. In a repo without pullboard.json they pass, so a stray hook never blocks.
 *
 * @param {any} io
 * @param {any} args
 * @returns {Promise<number>}
 */
async function hookCommand(io, { first, second }) {
  const info = repoInfo(io.cwd);
  let ctx;
  try {
    ctx = context(io);
  } catch (error) {
    if (error instanceof Refused && error.code === 'NO_CONFIG') return 0;
    throw error;
  }
  let problems = [];
  if (first === 'pre-commit' || first === 'pre-merge-commit') {
    applyFixers(info.root, ctx.config.fix).forEach((note) => io.err(`pullboard pre-commit: ${note}`));
    const agent = info.isMain ? null : hookRead(ctx, (board) => store.agentAt(board, info.root));
    const landing = hookRead(ctx, (board) => store.landingBatches(board).some((batch) => batch.root === info.root && !['landed', 'blocked'].includes(batch.state)));
    if (landing) io.caller('coordinator', info.root);
    else if (agent) io.caller('seat', info.root);
    problems = preCommitProblems({ root: info.root, isMain: info.isMain || landing, config: ctx.config, agent, boardFile: ctx.file, preMergeHook: first === 'pre-merge-commit', onNotice: (message) => io.err(`pullboard pre-commit: warning: ${message}`) });
  } else if (first === 'commit-msg') {
    const message = readFileSync(second ?? '', 'utf8');
    const spec = withRowDrafts(loadSpec(info.root, ctx.config), hookRead(ctx, (board) => store.rowDrafts(board)));
    commitCitationWarnings(message, { spec, doctrine: ctx.doctrine })
      .forEach((warning) => io.say(`pullboard commit-msg: warning: ${warning}`));
    problems = commitMsgProblems(message, { rules: ctx.config.commits, spec, doctrine: ctx.doctrine });
  } else if (first === 'pre-push') {
    const refsText = await readStdin(io.stdin);
    problems = prePushProblems(info.root, refsText);
    if (!problems.length) {
      const landing = pushesTrunk(refsText, trunkRef(info.root));
      const waived = landing && withBoard(ctx, (board) => store.waivedLandingProof(board, headTree(info.root)));
      const recordedException = landing && withBoard(ctx, (board) => store.landingBatches(board).some((batch) => batch.proof?.tree === headTree(info.root) && batch.proof.failures?.length));
      if (waived && isClean(info.root) && !untracked(info.root).length) io.say(`pre-push: exact landing tree covered by live person waivers in batch ${waived.id}; no ordinary green stamp`);
      else if (recordedException) problems = ['the landing proof has an expired or missing person waiver; ask the person for a new expiring waiver'];
      else {
        const gate = await runGate(info.root, ctx.config, { landing, agent: resourceAgent(ctx), onWait: gateWaitReporter(io) });
        if (gate.isCached) io.say('pre-push: the gate passed on this exact tree; not running it twice');
        if (!gate.isGreen) problems = [`the gate is red; fix it before pushing. ${gateReport(gate)}`];
      }
    }
  } else {
    throw new Refused('USAGE', 'pullboard hook pre-commit | pre-merge-commit | commit-msg <file> | pre-push');
  }
  if (!problems.length) return 0;
  io.err(`pullboard ${first}: blocked\n${problems.map((problem) => `  - ${io.guidance(problem)}`).join('\n')}\n${FIX_NOTE}`);
  return 1;
}

/**
 * Run one command. Returns the exit code: 0 done, 1 refused, 2 usage.
 *
 * @param {string[]} argv
 * @param {any} io
 * @returns {Promise<number>}
 */
async function runCommand(argv, io) {
  let parsed;
  try {
    parsed = parseCommandArgs(argv);
  } catch (error) {
    const refusal = new Refused('USAGE', `${error.message}; run pullboard help`);
    io.refusal?.(refusal);
    io.err(`pullboard: ${error.message}\nRun pullboard help --all for the full list.\nnext: ${io.refusalDocument(refusal).error.next}`);
    return 2;
  }
  const { values, positionals } = parsed;
  io.jsonMode?.(values.json);
  const [command = '', first, second, ...rest] = positionals;
  if ((values.version || command === 'version') && !values.help) {
    io.result?.({ release: VERSION });
    io.say(VERSION);
    return 0;
  }
  const help = selectedHelp(command, first, second, rest, values);
  if (help) {
    if (help.text) {
      let text = help.text;
      if (help.name === 'worktree') {
        try {
          const ctx = context(io);
          const mainRoot = primaryCheckoutRoot(ctx.info);
          const worktreeConfig = mainRoot ? (ctx.info.isMain ? ctx.config : loadConfig(mainRoot)) : null;
          text += `\nActive worktree location: ${mainRoot
            ? worktreeLocation(mainRoot, worktreeConfig)
            : unavailableWorktreeLocation()}.`;
        } catch (error) {
          if (!(error instanceof Refused)) throw error;
        }
      }
      return printHelp(io, text);
    }
    return unknownCommand(io, help.name);
  }
  const args = { first, second, rest, values };
  try {
    if (values.as === 'person' && !['answer', 'decisions', 'fact'].includes(command)) {
      throw new Refused('USAGE', '--as person works only with pullboard answer, decisions, or fact --never-again');
    }
    if (command === 'sentinel') return await sentinelCommand({ ctx: context(io), words: [first, second, ...rest].filter(value => value !== undefined), values, withBoard, whoAmI, ordered });
    if (command === 'sentinels') return sentinelListCommand(first, () => context(io), withBoard);
    if (command === 'tour') return tour(io);
    if (command === 'lifecycle') {
      io.result?.({ markdown: lifecycleMarkdown().trimEnd() });
      io.say(lifecycleMarkdown().trimEnd());
      return 0;
    }
    if (command === 'view') return await viewHere(io, values);
    if (command === 'serve') return await serveHere(io, values);
    if (command === 'mcp') return await mcpHere(io, args);
    if (command === 'watch') return await watchCommand({ io, values, words: [first, second, ...rest], ctx: context(io), primaryCheckoutRoot, runCommand: main });
    if (command === 'forget') {
      if (!first || second) throw new Refused('USAGE', 'pullboard forget <path>');
      const root = resolve(io.cwd, first);
      if (!forgetProject(root)) throw new Refused('NO_REPO', `no registered repo at ${root}; see the projects in pullboard view`);
      io.result?.({ root });
      io.say(`forgot ${root}`);
      return 0;
    }
    if (command === 'spec') return await specCommand(io, args);
    if (command === 'prompt') {
      let root = io.cwd;
      try {
        root = repoInfo(io.cwd).root;
      } catch (error) {
        if (!(error instanceof Refused)) throw error;
      }
      const text = promptFor(root, first ?? '').trimEnd();
      io.result?.({ role: first, text });
      io.say(text);
      return 0;
    }
    if (command === 'hook') return await hookCommand(io, args);
    if (command === 'settings') return settingsCommand(io, args);
    if (command === 'runner') return runnerCommand(io, args);
    if (command === 'relay') {
      if (first === 'recover') {
        if (second || rest.length || !values.skip || values.url || values.all) throw new Refused('USAGE', 'pullboard relay recover --skip <exact blocked next sequence>');
        requirePersonChannel('terminal');
        const result = await relayRecover(context(io).info.root, Number(values.skip), io);
        io.result?.(result);
        io.say(result.adopted
          ? `relay recovery adopted the authenticated checkpoint at sequence ${result.sequence}; blocked sequence ${result.skipped} remains recorded as refused`
          : `relay recovery published at sequence ${result.sequence}; skipped blocked sequence ${result.skipped}`);
        return 0;
      }
      if (values.skip) throw new Refused('USAGE', '--skip is only valid with pullboard relay recover');
      if (first === 'devices') {
        if (second || rest.length || values.url || values.all) throw new Refused('USAGE', 'pullboard relay devices [--verbose]');
        const roster = await relayRoster({ verbose: values.verbose });
        io.result?.(roster);
        for (const line of rosterLines(roster, { verbose: values.verbose })) io.say(line);
        return 0;
      }
      if (first === 'revoke' && /^device-[0-9a-f]{32}$/u.test(second ?? '')) {
        if (rest.length || values.url || values.all) throw new Refused('USAGE', 'pullboard relay revoke <device>');
        const result = await revokeRelayDevice(second, io);
        io.result?.(result); io.say(result.notice); return 0;
      }
      if (values.all) {
        if (first !== 'on' || second || rest.length) throw new Refused('USAGE', 'pullboard relay on --all [--url <address>]');
        return await relayOnAllCommand(values.url, io);
      }
      if (['tokens', 'revoke'].includes(first)) {
        if (rest.length || values.url || (first === 'tokens' && second) || (first === 'revoke' && !second)) {
          throw new Refused('USAGE', 'pullboard relay tokens, or pullboard relay revoke <token-id>');
        }
        const ctx = context(io);
        const result = first === 'tokens' ? await relayTokens(ctx.info.root, io) : await relayRevoke(ctx.info.root, second, io);
        io.result?.(result);
        if (first === 'tokens') {
          if (!result.tokens.length) io.say('no agent tokens on this board');
          const ctx = context(io);
          const agents = withBoard(ctx, (board) => store.listAgents(board));
          for (const row of result.tokens) io.say(row.id + '  ' + agentDisplayName(agents, ctx.config, row.agent) + '  ' + (row.revoked ? 'revoked' : 'expires ' + new Date(row.expires).toISOString()));
          // The person-made coordinator credential events: who set it up, what it revoked, what it issued.
          for (const row of result.coordinatorEvents ?? []) io.say(`coordinator ${row.reason} by person session ${row.session} at ${new Date(row.at).toISOString()}: issued ${row.issued}, revoked ${row.revoked.length ? row.revoked.join(', ') : 'none'}`);
        } else io.say('revoked token ' + result.id + '; other agent tokens are unchanged');
        return 0;
      }
      if (first === 'pair') {
        if (second || rest.length || values.url) throw new Refused('USAGE', 'pullboard relay pair');
        const ctx = context(io);
        return await relayPair(ctx.info.root, io);
      }
      if (first === 'join') {
        if (!second || rest.length) throw new Refused('USAGE', 'pullboard relay join <code> [--url <address>]');
        const ctx = context(io);
        return await relayJoin(ctx.info.root, second, values.url, io);
      }
      if (second || rest.length || (first && !['on', 'off', 'status'].includes(first)) || (values.url && first !== 'on')) throw new Refused('USAGE', 'pullboard relay [status|on|off] [--url <address>]');
      const ctx = context(io);
      // pullboard relay status is the named form of plain pullboard relay: the same sync and report.
      if (!first || first === 'status') { await syncRelay(ctx.info.root, io); await executePersonRequests(ctx.info.root, io, main); }
      const result = first === 'on' ? await relayOn(ctx.info.root, values.url, io)
        : first === 'off' ? await relayOff(ctx.info.root, io) : relayStatus(ctx.info.root);
      io.result?.(result);
      const boardName = listApiProjects().find((project) => project.root === ctx.info.root)?.name ?? basename(ctx.info.root);
      for (const line of relayOutput.detailLines(result, boardName)) io.say(line);
      return 0;
    }
    if (command === 'blueprint' && first === 'save') {
      if (rest.length) throw new Refused('USAGE', 'pullboard blueprint save [file] [--name <name>] [--title "<title>"]');
      const ctx = context(io);
      const { root, commonDir } = ctx.info;
      const project = ctx.config.project || ctx.config.name || basename(dirname(resolve(root, commonDir)));
      const file = resolve(io.cwd ?? process.cwd(), second ?? `${project}.blueprint.json`);
      if (existsSync(file)) throw new Refused('BLUEPRINT_EXISTS', `${file} already exists; name another file: pullboard blueprint save <file>`);
      const spec = loadSpec(root, ctx.config);
      const { names, parts } = withBoard(ctx, (board) => privateNames(root, board, spec));
      const { blueprint, left } = saveBlueprint(spec, { name: values.name, title: values.title, gate: ctx.config.gate, names, parts });
      writeFileSync(file, `${JSON.stringify(blueprint, null, 2)}\n`, { flag: 'wx' });
      io.result?.({ file, name: blueprint.name, rules: blueprint.rules?.length ?? 0, questions: blueprint.questions?.length ?? 0, left });
      io.say(`saved ${blueprint.rules?.length ?? 0} rules and ${blueprint.questions?.length ?? 0} answered questions to ${file}`);
      for (const entry of left) io.say(`  left out ${entry.id}: ${entry.reason}`);
      return 0;
    }
    if (command === 'blueprint' && first === 'starters') return startersCommand(io, { second, rest, context, withBoard });
    if (command === 'gate') {
      if (first === 'set') return gateConfig.setHere(io, second, rest, values);
      if (first !== undefined || second !== undefined || rest.length > 0) {
        const words = [first, second, ...rest].filter((word) => word !== undefined);
        const next = 'use pullboard resources for status, or pullboard gate with no extra words to run the gate';
        throw new Refused('GATE_ARGUMENT', `pullboard gate does not accept extra words: ${words.join(' ')}. Use pullboard resources for status, or pullboard gate with no extra words to run the gate.`, next);
      }
      const ctx = context(io);
      let config;
      try { config = mainPolicy(ctx.info.root).config; }
      catch (error) {
        if (error instanceof Refused && error.code === 'NO_POLICY'
          && error.message.includes('the coordinator checkout has no commit on ')
          && existsSync(join(ctx.info.root, CONFIG_FILE))) {
          throw new Refused('NO_POLICY', `${CONFIG_FILE} is not committed; add and commit the initialized project before running the gate: git add ${CONFIG_FILE}`);
        }
        // Refused prefixes its message with the code, so match the condition itself, not the text:
        // pullboard.json on disk but absent from the primary checkout's commit. Any other
        // missing policy or claim base keeps its own refusal.
        if (error instanceof Refused && error.code === 'NO_POLICY') {
          let setup = null;
          try { setup = uncommittedPolicySetup(ctx.info); } catch { /* Report the original refusal below. */ }
          if (setup) {
            const files = setup.files.map(shellWord).join(' ');
            throw new Refused('NO_POLICY', `${CONFIG_FILE} and Pullboard's initialized setup files are uncommitted; commit them before running the gate: ${setup.stage} && git commit -q -m "chore: set up pullboard" -- ${files}`);
          }
        }
        throw error;
      }
      const waivers = values.landing ? withBoard(ctx, (board) => liveWaiverProjection(board)) : [];
      const gate = await runGate(ctx.info.root, config, { landing: values.landing, agent: resourceAgent(ctx), onWait: gateWaitReporter(io), stages: Boolean(values.landing), waivers,
        onFailure: nativeFlakes.observer(ctx, { kind: values.landing ? 'land' : 'gate', config }, { ordered, withBoard, resourceAgent }) });
      // A landing gate honours the person's live waivers exactly as land does; a red run never stamps, so it stays waived, not green [B3,R3].
      const waived = values.landing && !gate.isGreen ? withBoard(ctx, (board) => waivedFailures(board, accountedFailures(gate, ctx.info.root))) : null;
      if (waived) {
        const lines = waived.map(waiverLine);
        const report = `landing gate waived, not green: ${waived.length} failure(s), each covered by a live person waiver; the whole output is in ${gate.log}\n${lines.join('\n')}`;
        io.result?.({ green: false, waived: waived.map(({ file, name, waiver }) => ({ file, name, waiver: waiver.id, reason: waiver.reason, until: waiver.until })), report });
        io.say(report);
        return 0;
      }
      io.result?.({ green: gate.isGreen, report: gateReport(gate) });
      io.say(gateReport(gate));
      return gate.isGreen ? 0 : 1;
    }
    const commands = { ...setupCommands(io, args), ...readCommands(io, args), ...workCommands(io, args) };
    const run = commands[command];
    if (!run) return unknownCommand(io, command);
    return await run();
  } catch (error) {
    if (error instanceof Refused) {
      io.refusal?.(error);
      io.err(`pullboard: ${displayedRefusal(io, error)}\nnext: ${io.refusalDocument(error).error.next}`);
      return 1;
    }
    throw error;
  }
}

/**
 * Every private name a saved blueprint must never carry: each agent's id, display name, model
 * and family, the person's Git name and email, everyone who signed off or signs rows, and this
 * machine's host name, whole, plus the parts of each (a first name, an email's user) to match
 * only as written. Missing sources add nothing; they never stop the save [S1].
 */
function privateNames(root, board, spec) {
  const names = new Set();
  const parts = new Set();
  const add = (value) => {
    const text = typeof value === 'string' ? value.trim() : '';
    // "unknown" is the label for an undeclared model, not anyone's name.
    if (!text || text === 'unknown') return;
    names.add(text);
    for (const part of text.split(/[\s@.<>()]+/u)) if (part.length >= 3 && part !== 'unknown' && part !== text) parts.add(part);
  };
  for (const agent of store.listAgents(board)) {
    add(agent.agent_id); add(agent.agent_model); add(agent.agent_family); add(displayAgentName(agent)); add(displayAgentName(agent, 'prefix'));
  }
  for (const key of ['user.name', 'user.email']) add(tryGit(root, ['config', '--get', key]).stdout);
  for (const ident of ['GIT_AUTHOR_IDENT', 'GIT_COMMITTER_IDENT']) {
    const found = /^(.*?)\s*<([^>]*)>/u.exec(tryGit(root, ['var', ident]).stdout ?? '');
    if (found) { add(found[1]); add(found[2]); }
  }
  try { for (const record of readSignoffs(root)) add(record.by); } catch { /* An unreadable sign-off file adds no names. */ }
  for (const row of spec.rows) for (const signer of row.signers ?? []) add(signer);
  add(hostname());
  add(hostname().split('.')[0]);
  return { names: [...names], parts: [...parts] };
}

/** Retain the primary branch on every command without creating a board for global help. */
function rememberTrunk(io) {
  let info;
  try { info = repoInfo(io.cwd); }
  catch (error) {
    if (error instanceof Refused && ['NOT_A_REPO', 'NO_REPO', 'CORE_BARE'].includes(error.code)) return;
    throw error;
  }
  if (!info.isMain) return;
  const primary = mainCheckout(info.root);
  if (primary?.branch) trunkRef(info.root, primary.branch);
}

/** Run one command and emit its single versioned JSON result when requested (A1). */
export async function main(argv, streams) {
  if (argv[0] === 'serve' && !startupMainTraced) {
    startupMainTraced = true;
    traceServeStartup('cli-main-enter');
  }
  return withGitFacts(() => runMain(argv, streams));
}

/** Parse and execute one CLI command, binding its checkout session and Git-fact scope. */
async function runMain(argv, streams) {
  const io = commandOutput(argv, streams);
  let sync = true;
  let needsRepo = true;
  let parsed;
  let checkoutSession;
  try {
    parsed = parseCommandArgs(argv);
    const command = parsed.positionals[0];
    io.relayJson = Boolean(parsed.values.json);
    io.relayCommand = { cliOperation: command === 'done' ? 'submit' : command, cwd: resolve(io.cwd),
      positionals: parsed.positionals.slice(1),
      values: Object.fromEntries(Object.keys(parsed.values).filter(key => key !== 'json').sort().map(key => [key, parsed.values[key]])) };
    sync = Boolean(command) && !parsed.values.help && !parsed.values.version
      && !['help', 'version', 'hook', 'init', 'relay', 'tour', 'mcp', 'health', 'watch', 'digest'].includes(command)
      // A coordinator declaration on a linked clone must refuse before auto-link or relay sync.
      && !(command === 'join' && parsed.positionals[1] === COORDINATOR);
    needsRepo = !(parsed.values.help || parsed.values.version || command === 'help' || command === 'version');
  } catch { sync = false; needsRepo = false; }
  if (parsed) {
    try {
      // Checkout identity supplies the display role even if a person-channel check refuses first.
      try { const info = needsRepo ? repoInfo(io.cwd) : null; if (info?.isMain) io.caller('coordinator', info.root); } catch { /* Unknown checkouts retain existing guidance. */ }
      const [command, verb] = parsed.positionals;
      const remoteRelayOn = command === 'relay' && verb === 'on' && !parsed.values.all;
      if (!parsed.values.help && !parsed.values.version &&
          (parsed.values.as === 'person' && command !== 'decisions' || command === 'relay' && ['on', 'join', 'revoke'].includes(verb) && !remoteRelayOn)) {
        requirePersonChannel(io.personChannel);
        io.caller('person');
      }
      checkoutSession = await bindCheckoutSession(io, parsed.positionals, parsed.values);
      if (checkoutSession?.lease) CHECKOUT_LEASES.set(io, checkoutSession.lease);
    } catch (error) {
      if (!(error instanceof Refused)) throw error;
      io.refusal(error);
      io.err(`pullboard: ${displayedRefusal(io, error)}\nnext: ${io.refusalDocument(error).error.next}`);
      io.flush(1);
      return 1;
    }
  }
  try {
    /** A network refusal preserves offline reads; linked mutation dispatch requires an acknowledgement. */
    const retry = async () => {
      try {
        await syncRelay(io.cwd, io);
        await retryCheckBaselines(io.cwd, io);
      }
      catch (error) {
        if (!(error instanceof Refused)) throw error;
        if (!['NOT_A_REPO', 'NO_REPO', 'NO_CONFIG', 'CORE_BARE'].includes(error.code)) io.err(`pullboard: ${displayedRefusal(io, error)}\nnext: ${io.refusalDocument(error).error.next}`);
      }
    };
    if (needsRepo) rememberTrunk(io);
    traceServeStartup('cli-command-preamble-start');
    if (sync) {
      try { await autoLinkProject(io.cwd, io); } catch (error) { if (!(error instanceof Refused)) throw error; }
      await retry();
      try { await executePersonRequests(io.cwd, io, main); }
      catch (error) {
        if (!(error instanceof Refused)) throw error;
        if (!['NOT_A_REPO', 'NO_REPO', 'NO_CONFIG', 'CORE_BARE'].includes(error.code)) io.err(`pullboard: ${displayedRefusal(io, error)}\nnext: ${io.refusalDocument(error).error.next}`);
      }
    }
    traceServeStartup('cli-command-preamble-ready');
    const code = await runCommand(argv, io);
    if (code === 0) await checkoutSession?.finish?.();
    if (sync && code === 0) await retry();
    const status = io.exitCode(code);
    io.flush(status);
    return status;
  } finally {
    CHECKOUT_LEASES.delete(io);
    CHECKOUT_BOARD_ONLY.delete(io);
    checkoutSession?.lease?.release();
  }
}

/** Result-producing command names, including aliases, for API contract coverage (A1). */
export function resultCommands() {
  const args = { values: {}, rest: [] };
  return [...new Set([
    ...Object.keys(setupCommands({}, args)),
    ...Object.keys(readCommands({}, args)),
    ...Object.keys(workCommands({}, args)),
    'help', 'version', 'tour', 'lifecycle', 'view', 'serve', 'watch', 'forget', 'spec', 'prompt', 'hook', 'gate', 'settings', 'runner', 'relay', 'sentinel', 'sentinels',
  ])].sort();
}

/** Command help follows the same dispatch declarations as execution. */
export const HELP = buildHelp(resultCommands());

// This marker is emitted once when the actual CLI entrypoint finishes evaluating.
if (process.env.PULLBOARD_STARTUP_TRACE_ENTRY
  && resolve(process.argv[1] ?? '') === resolve(process.env.PULLBOARD_STARTUP_TRACE_ENTRY)) {
  traceServeStartup('cli-module-load-complete');
}
