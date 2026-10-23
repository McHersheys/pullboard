/** Coordinator landing batches retain exact Git and gate receipts across interruptions [B3,R3]. */
import {
  createHash,
  randomUUID,
} from 'node:crypto';
import {
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
} from 'node:fs';
import {
  dirname,
  isAbsolute,
  join,
  relative,
} from 'node:path';
import * as store from './board.js';
import { badgeCounts } from './badge.js';
import { writeBadges } from './badge.js';
import {
  git,
  headCommit,
  headTree,
  isClean,
  invalidateGitFacts,
  mainCheckout,
  repoInfo,
  tryGit,
  untracked,
} from './git.js';
import {
  runGate,
  runProfiledShell,
  runStaticChecks,
  withGateSlot,
} from './gate.js';
import {
  readGateReceipt,
  receiptStore,
} from './gate-run-receipt.js';
import { testsNeedBrowser } from './browser-admission.js';
import { laneOf } from './lanes.js';
import { takeLandingResource } from './landing-resource.js';
import {
  landingLeaseState,
  requireConfirmedLanding,
} from './landing-lease.js';
import { runLandingWorker } from './landing-worker.js';
import { Refused } from './refused.js';
import { browserFreeChecksEnabled } from './settings.js';
import { tightenLandingDoctrine } from './landing-doctrine.js';
import { policyAt } from './trusted-policy.js';
import { landingFileTimes } from './submit-invariants.js';
import {
  flakeSource,
  observeNativeFailure,
} from './native-flakes.js';
import {
  staleVerdictRefusal,
  verdictProjector,
} from './verdict-freshness.js';

/** Quote a command argument without allowing shell interpolation. */
function quote(value) { return `'${String(value).replaceAll("'", "'\\''")}'`; }

/** Hash a test's current bytes, so a real correction can unblock its held batch. */
function testHash(root, file) {
  try { return createHash('sha256').update(readFileSync(join(root, file))).digest('hex'); }
  catch { return null; }
}

/** Derive failing test identities from TAP or spec reporter names and source locations, refusing unknown paths. */
export function landingFailures(output, root, { excludeCancelled = false } = {}) {
  const failures = [];
  let active = null;
  /** A reported path relative to the root, or null when it lies outside it. */
  const inRoot = (path) => {
    const file = isAbsolute(path) ? relative(root, path) : path.replace(/^\.\//u, '');
    return file && !file.startsWith('../') && !file.includes('\\') ? file : null;
  };
  // The spec reporter (Node 24's default for node --test) names each failure as "test at <file>:<line>" then "✖ <name>".
  let specFile;
  for (const line of output.split('\n')) {
    const at = /^\s*test at (.+?):\d+(?::\d+)?\s*$/u.exec(line);
    if (at) { specFile = inRoot(at[1]); active = null; continue; }
    const spec = specFile !== undefined ? /^\s*\u2716 (.+?)(?: \([\d.]+m?s\))?\s*$/u.exec(line) : null;
    if (spec) { failures.push({ name: spec[1], file: specFile }); specFile = undefined; continue; }
    const failed = /^\s*not ok\s+\d+\s+-\s+(.*)$/u.exec(line);
    if (failed) {
      active = { name: failed[1].replace(/\s+#.*$/u, ''), file: null };
      failures.push(active);
      if (/^(?:\.\/)?(?:test|tests)\/[^\r\n]+\.(?:[cm]?js|ts|py)$/u.test(active.name)) active.file = active.name.replace(/^\.\//u, '');
    }
    const location = /^\s*location:\s*['"]?(.+?):\d+(?::\d+)?['"]?\s*$/u.exec(line);
    if (active && location) {
      const file = inRoot(location[1]);
      if (file) active.file = file;
    }
    if (excludeCancelled && active && /^\s*failureType:\s*['"]?(?:cancelledByParent|subtestsFailed)['"]?\s*$/u.test(line)) active.omit = true;
  }
  const unique = new Map(failures.filter(entry => !entry.omit).map(({ file, name }) => [`${file}\0${name}`, { name, file }]));
  return [...unique.values()];
}

/** The merge header type an item with no spec rows takes from its lane; any other lane lands as chore. */
const LANE_MERGE_TYPES = Object.freeze({ docs: 'docs', test: 'test' });

/** Produce a hook-valid lower-case merge subject at a word boundary [R3]. */
export function landingSubject(item) {
  const suffix = item.item_spec_ids ? ` [${item.item_spec_ids.split(/[\s,]+/u).filter(Boolean).join(',')}]` : '';
  // An item with no rows cites none, so its merge header names its lane's type: docs or test; anything else is chore (B3).
  const type = item.item_spec_ids ? 'chore' : (LANE_MERGE_TYPES[item.item_lane] ?? 'chore');
  const prefix = `${type}(merge): `;
  const budget = 72 - prefix.length - suffix.length;
  if (budget < 1) throw new Refused('LAND_HEADER', `item #${item.item_id} cites too many rows for a merge header; shorten its cited set before landing`);
  const words = item.item_title.toLowerCase().replace(/[\p{Extended_Pictographic}\u200d\uFE0E\uFE0F]/gu, '').replace(/[\r\n]+/gu, ' ').replace(/\[[^\]]*\]/gu, '').trim().split(/\s+/u);
  let subject = '';
  for (const word of words) {
    if ((subject ? `${subject} ${word}` : word).length > budget) break;
    subject = subject ? `${subject} ${word}` : word;
  }
  if (!subject) subject = `item ${item.item_id}`.length <= budget ? `item ${item.item_id}` : String(item.item_id);
  if (subject.length > budget) throw new Refused('LAND_HEADER', `item #${item.item_id} has no title word that fits its merge header; shorten its cited set before landing`);
  return `${prefix}${subject.replace(/\.$/u, '')}${suffix}`;
}

/** Keep the submitted identity and, when different, its sealed checked composition. */
function landingEntry(item) {
  return { id: item.item_id, commit: item.item_commit,
    ...(item.item_landing_commit !== item.item_commit ? { reviewedCommit: item.item_landing_commit } : {}) };
}

/** Select in verdict order; a read-only preflight may stop at its first eligible item [B3,R3]. */
function candidates(board, root, base, maximum, { firstReady = false } = {}) {
  const all = store.listItems(board, { all: true });
  const projector = verdictProjector(root, board, { main: base });
  const pending = all.filter((item) => item.item_status === 'verified' && !item.item_merged_commit);
  const order = new Map();
  for (const event of store.events(board)) if (event.event_kind === 'accept') order.set(event.item_id, event.event_id);
  pending.sort((left, right) => (order.get(left.item_id) ?? Infinity) - (order.get(right.item_id) ?? Infinity) || left.item_id - right.item_id);
  const ready = [];
  const blocked = [];
  const knownReds = store.landingBatches(board).flatMap((batch) => batch.culprits ?? []);
  for (const original of pending) {
    const item = { ...original, item_landing_commit: store.checkedLandingCommit(board, original) };
    const stale = projector.state(item);
    if (stale) { blocked.push({ id: item.item_id, ...stale }); continue; }
    const known = knownReds.find((entry) => entry.id === item.item_id && entry.commit === item.item_commit
      && (entry.reviewedCommit ?? entry.commit) === item.item_landing_commit);
    if (known && !known.tests.every((failure) => store.landingWaiverFor(board, failure))) {
      blocked.push({ id: item.item_id, code: 'LAND_KNOWN_RED', tests: known.tests });
      continue;
    }
    const dependencies = (item.item_after || '').split(',').filter(Boolean).map(Number);
    if (dependencies.some((id) => !all.find((other) => other.item_id === id)?.item_merged_commit && !ready.some((other) => other.item_id === id))) continue;
    const stacked = store.unverifiedSubmissions(board).find((other) => other.item_id !== item.item_id
      && tryGit(root, ['merge-base', '--is-ancestor', other.item_commit, item.item_landing_commit]).status === 0
      && tryGit(root, ['merge-base', '--is-ancestor', other.item_commit, base]).status !== 0);
    if (stacked) {
      blocked.push({ id: item.item_id, code: 'STACKED_UNVERIFIED', stacked: stacked.item_id });
      continue;
    }
    if (ready.length < maximum) {
      ready.push(item);
      if (firstReady) break;
    }
  }
  return { ready, blocked };
}

/** Append a durable snapshot before or after each external side effect. */
async function save(state, patch) {
  const conflicts = [...new Map([...(state.batch.conflicts ?? []), ...(patch.conflicts ?? [])].map((entry) => [entry.id, entry])).values()];
  state.batch = await state.write('recordLandingBatch', [{ agentId: 'coordinator', batch: { ...state.batch, ...patch, conflicts }, revision: state.batch.revision ?? 0 }]);
  return state.batch;
}

/** Merge one ordered group from the immutable batch base, preserving each first-containing commit. */
async function mergeGroup(state, items) {
  await state.checkLease();
  const { batch } = state;
  if (!isClean(batch.root) || untracked(batch.root).length) throw new Refused('LAND_DIRTY', 'the landing worktree has unfinished edits; inspect its recorded path before adopting');
  git(batch.root, ['checkout', '--detach', batch.base]);
  const merged = [];
  const conflicts = [];
  for (const entry of items) {
    await state.checkLease();
    const item = store.getItem(state.board, entry.id ?? entry.item_id);
    if (item.item_status !== 'verified' || item.item_commit !== (entry.commit ?? item.item_commit)) throw new Refused('LAND_ITEM_MOVED', `item #${item.item_id} changed; rebuild the batch from current verified work`);
    const checked = store.checkedLandingCommit(state.board, item);
    if (checked !== (entry.reviewedCommit ?? entry.commit ?? item.item_commit)) throw new Refused('LAND_ITEM_MOVED', `item #${item.item_id} was re-reviewed; rebuild its landing from the checked commit`);
    const stale = verdictProjector(state.root, state.board, { main: batch.base }).state(item);
    if (stale) throw staleVerdictRefusal(item, stale);
    // The body is the item trailer alone: the subject carries the title, and no lane branch is named [B3,R3].
    // merge.log is switched off on this call, so a local Git config cannot append a shortlog to the body.
    const result = tryGit(batch.root, ['-c', 'merge.log=false', 'merge', '--no-ff', '--no-log', checked, '-m', landingSubject(item), '-m', `Pullboard-Item: #${item.item_id}`]);
    if (result.status !== 0) {
      const files = tryGit(batch.root, ['diff', '--name-only', '--diff-filter=U']).stdout.split('\n').filter(Boolean);
      if (!files.length) throw new Refused('LAND_MERGE', `merge of #${item.item_id} failed outside a conflict: ${result.stderr || result.stdout}; inspect ${batch.root} and its hooks before adopting`);
      git(batch.root, ['merge', '--abort']);
      conflicts.push({ id: item.item_id, files });
      state.say(`conflict #${item.item_id}: ${files.join(', ')}`);
      continue;
    }
    const first = git(batch.root, ['rev-list', '--first-parent', '--reverse', 'HEAD']).split('\n')
      .find((commit) => tryGit(batch.root, ['merge-base', '--is-ancestor', checked, commit]).status === 0);
    merged.push({ id: item.item_id, commit: item.item_commit, ...(checked !== item.item_commit ? { reviewedCommit: checked } : {}), merge: first });
  }
  if (merged.length) {
    const changed = writeBadges(batch.root, badgeCounts(state.board));
    if (changed.length) {
      git(batch.root, ['add', '--', ...changed]);
      git(batch.root, ['commit', '-m', 'chore: refresh board badge counts']);
    }
  }
  let doctrineCounts = [];
  try {
    if (merged.length) doctrineCounts = await tightenLandingDoctrine(batch.root, state.config, { onWait: state.onWait });
  } catch (error) {
    await save(state, { state: 'blocked', items: merged, conflicts, tip: headCommit(batch.root), doctrineCounts: [] });
    throw error;
  }
  for (const change of doctrineCounts) state.say(`doctrine ${change.id}: ${change.before} -> ${change.count}`);
  return { items: merged, conflicts, tip: headCommit(batch.root), doctrineCounts };
}

/** Read positive TAP completion counts while rejecting the canonical runner's incomplete accounts. */
function completionAccount() {
  let early = false;
  let plan = null;
  let topLevel = 0;
  const counts = {};
  /** Recognize canonical incomplete accounts even when only a bounded line prefix is retained. */
  const markerPrefix = (text) => {
    if (/^(?:Landing gate stopped early after |Files not run: |Interrupted test files: )/u.test(text)) early = true;
  };
  return {
    markerPrefix,
    /** Consume one complete output line without retaining test output or diagnostic blocks. */
    line(text) {
      markerPrefix(text);
      if (/^(?:not )?ok \d+\b/u.test(text)) topLevel++;
      const planned = /^1\.\.(\d+)\s*$/u.exec(text);
      if (planned) plan = Number(planned[1]);
      const count = /^# (tests|pass|fail|cancelled|skipped|todo) (\d+)\s*$/u.exec(text);
      if (count) counts[count[1]] = Number(count[2]);
    },
    /** A complete plan accounts for every test and contains no interrupted or cancelled work. */
    complete() {
      return !early && Number.isSafeInteger(plan) && plan > 0 && plan === topLevel && Number.isSafeInteger(counts.tests)
        && Number.isSafeInteger(counts.pass) && Number.isSafeInteger(counts.fail)
        && (counts.cancelled ?? 0) === 0
        && counts.pass + counts.fail + (counts.skipped ?? 0) + (counts.todo ?? 0) === counts.tests;
    },
  };
}

/** Require positive completion evidence from this run, or stream the retained legacy raw account. */
function completeGate(gate) {
  if (typeof gate.complete === 'boolean') return gate.complete;
  const account = completionAccount();
  if (typeof gate.output === 'string') {
    for (const line of gate.output.split('\n')) account.line(line);
    return account.complete();
  }
  if (!gate.logPath || !existsSync(gate.logPath)) return false;
  const input = openSync(gate.logPath, 'r');
  const chunk = Buffer.alloc(64 * 1024);
  let pending = '';
  let oversized = false;
  try {
    let count;
    while ((count = readSync(input, chunk, 0, chunk.length, null)) > 0) {
      const parts = chunk.toString('latin1', 0, count).split('\n');
      for (const [index, part] of parts.entries()) {
        if (index) {
          if (oversized) account.markerPrefix(pending);
          else account.line(pending);
          pending = ''; oversized = false;
        }
        if (pending.length + part.length > 256) oversized = true;
        pending += part.slice(0, 256 - pending.length);
      }
    }
    if (oversized) account.markerPrefix(pending);
    else account.line(pending);
    return account.complete();
  } finally { closeSync(input); }
}

/** Whether current person waivers cover every named failure of this exact recorded run. */
function coveredFailures(state, gate) {
  return gate.failures.length > 0 && gate.failures.every((failure) => failure.file && store.landingWaiverFor(state.board, failure));
}

/** Record the receipt the landing gate wrote for its run, in the lane that owns its first failing test [C7,D1]. */
async function recordLandingRun(state, receiptId) {
  const receipt = readGateReceipt(receiptStore(state.batch.root), receiptId);
  if (!receipt) return;
  const owner = receipt.failures.map(failure => laneOf(state.config, failure.file)).find(lane => lane !== 'coordinator');
  await state.write('recordGateRun', [{ agentId: 'coordinator', receipt, lane: owner ?? store.getItem(state.board, state.batch.items[0].id).item_lane }]);
}

/** Run one full landing gate and retain its complete output under this batch's immutable phase path. */
async function gateGroup(state, label) {
  const tree = headTree(state.batch.root);
  const commit = headCommit(state.batch.root);
  const cached = state.gates.get(tree);
  if (cached?.timedOut) throw new Refused('LAND_GATE_TIMEOUT', 'this exact tree has a recorded landing timeout; inspect its log before starting a new batch');
  if (cached && (completeGate(cached) || !coveredFailures(state, cached))) return cached;
  const directory = join(dirname(state.batch.root), 'logs');
  mkdirSync(directory, { recursive: true });
  const logPath = join(directory, `${label}-${state.batch.revision}.log`);
  await save(state, { state: 'gating', tip: headCommit(state.batch.root), logPath });
  const pin = flakeSource(state.batch.root, { commit, main: state.batch.base });
  const gate = await runGate(state.batch.root, state.config, { trustStamp: false, landing: true, agent: 'coordinator', onWait: state.onWait, stages: true, waivers: liveWaiverProjection(state.board),
    onFailure: Object.assign((run, { root, command, lease }) => observeNativeFailure({ root, config: state.config, pin, run, command, lease, kind: 'land',
      record: observation => {
        const owner = observation.file ? laneOf(state.config, observation.file) : 'coordinator';
        const lane = owner === 'coordinator' ? store.getItem(state.board, state.batch.items[0].id).item_lane : owner;
        return state.write('recordFlakeObservation', [{ agentId: 'coordinator', observation, lane }]);
      } }), { main: pin.main, recordRun: receiptId => recordLandingRun(state, receiptId) }),
  });
  copyFileSync(gate.log, logPath);
  if (gate.profilePath) copyFileSync(gate.profilePath, `${logPath}.profile.json`);
  if (headCommit(state.batch.root) !== commit || headTree(state.batch.root) !== tree || !isClean(state.batch.root)) {
    throw new Refused('LAND_SOURCE_CHANGED', `the landing source changed while the gate ran; inspect ${logPath} and restore the recorded batch before adopting`);
  }
  const result = { ...gate, failures: landingFailures(gate.output, state.batch.root), accounted: accountedFailures(gate, state.batch.root), complete: completeGate(gate),
    requiresGreen: Boolean(cached && !completeGate(cached)), tree, logPath };
  state.gates.set(tree, result);
  const evidence = state.batch.invariantEvidence ?? { version: 1, gates: [], diagnostics: [] };
  const tested = { commit, isGreen: gate.isGreen && completeGate(gate),
    submissions: state.batch.items.map(({ id, commit }) => ({ id, commit })),
    failures: [...new Set(landingFailures(gate.output, state.batch.root, { excludeCancelled: true }).map(failure => failure.file).filter(Boolean))],
    fileTimes: landingFileTimes(state.batch.root, gate.profile) };
  await save(state, { gateResults: [...state.gates.values()].map(({ tree: testedTree, isGreen, failures, accounted, complete, requiresGreen, logPath: log, flakeDiagnostics, timedOut }) =>
    ({ tree: testedTree, isGreen, ...(timedOut ? { timedOut: true } : {}), failures, accounted: accounted ?? null, complete: complete ?? null, requiresGreen: Boolean(requiresGreen), logPath: log,
      ...(flakeDiagnostics ? { flakeDiagnostics } : {}) })),
    invariantEvidence: { ...evidence, gates: [...evidence.gates, tested] } });
  if (gate.timedOut) {
    await save(state, { state: 'blocked', timedOut: true });
    throw new Refused('LAND_GATE_TIMEOUT', 'the landing gate timed out; its process tree is stopped and no candidate is a culprit');
  }
  return result;
}

/** Run each failing file once alone, with the same queued machine capacity as other checks. */
async function diagnose(state, failures, gate) {
  // The enabled observer already made the only allowed exact-target pair under the original lease.
  // A saved gate retains that association, so adopting it cannot repeat a confidence measurement.
  if (state.config.flakes?.rerun === true) {
    const observations = gate?.flakeDiagnostics?.observations ?? [];
    if (gate?.flakeDiagnostics?.error || !observations.length || observations.some(row => !row.recorded || row.classification === 'unclassified')) {
      await save(state, { state: 'blocked', failures, flakeDiagnostics: gate?.flakeDiagnostics });
      throw new Refused('LAND_DIAGNOSTIC', `the original red has no complete classified diagnostic; no additional run or landing is allowed; inspect ${gate.logPath} and pullboard flakes`);
    }
    return [...new Set(observations.filter(row => row.classification === 'flake' && row.file).map(row => row.file))];
  }
  if (!failures.length || failures.some((entry) => !entry.file)) throw new Refused('LAND_DIAGNOSTIC', `the gate did not name a failing test file; inspect ${state.batch.logPath} and make its reporter name source files`);
  const files = [...new Set(failures.map((entry) => entry.file))];
  const flakes = [];
  for (const file of files) {
    if (state.diagnosed.has(file)) { if (state.diagnosed.get(file)) flakes.push(file); continue; }
    const runner = state.config.affectedTests || (/\.[cm]?js$/u.test(file) ? 'node --test' : null);
    if (!runner) throw new Refused('LAND_DIAGNOSTIC', `no runner can isolate ${file}; configure affectedTests for the project’s test runner`);
    const commit = headCommit(state.batch.root);
    const tree = headTree(state.batch.root);
    const result = await withGateSlot(state.batch.root, (lease) => runProfiledShell(state.batch.root, `${runner} ${quote(file)}`, {
      waitMs: lease.waitMs, artifactDirectory: dirname(state.batch.logPath), artifactPrefix: 'diagnostic', persistLog: true, pipefail: true, gateLease: lease,
    }), { landing: true, browser: true, agent: 'coordinator', kind: 'land-diagnostic', onWait: state.onWait });
    if (headCommit(state.batch.root) !== commit || headTree(state.batch.root) !== tree || !isClean(state.batch.root)) {
      throw new Refused('LAND_SOURCE_CHANGED', `the landing source changed during its whole-file diagnostic; inspect ${result.logPath} before adopting`);
    }
    state.diagnosed.set(file, result.isGreen);
    const evidence = state.batch.invariantEvidence ?? { version: 1, gates: [], diagnostics: [] };
    await save(state, { diagnostics: [...state.diagnosed].map(([test, isGreen]) => ({ test, isGreen })),
      invariantEvidence: { ...evidence, diagnostics: [...evidence.diagnostics,
        { test: file, isGreen: result.isGreen, commit, wallMs: result.profile?.wallMs ?? null }] } });
    if (result.isGreen) flakes.push(file);
  }
  return flakes;
}

/**
 * Read one stage's TAP strictly: test lines outside YAML blocks, each failure's file from its own
 * block, and a final `# fail N` that equals the failures read. Anything after that summary other
 * than summary counts or the package manager's own failure report means something else failed,
 * so the stage is unaccounted and null is returned [B3,R3].
 */
export function tapFailures(output, root) {
  const lines = output.split('\n');
  const failures = [];
  let yaml = null;
  let active = null;
  let version = false;
  let summary = null;
  let summaryAt = -1;
  let cancelled = 0;
  for (const [index, line] of lines.entries()) {
    if (yaml !== null) {
      if (line === `${yaml}...`) { yaml = null; continue; }
      const location = /^\s*location:\s*['"]?(.+?):\d+(?::\d+)?['"]?\s*$/u.exec(line);
      if (active && location) {
        const path = location[1];
        const file = isAbsolute(path) ? relative(root, path) : path.replace(/^\.\//u, '');
        if (file && !file.startsWith('../') && !file.includes('\\')) active.file = file;
      }
      continue;
    }
    const block = /^(\s*)---\s*$/u.exec(line);
    if (block) { yaml = block[1]; continue; }
    if (/^TAP version \d+\s*$/u.test(line)) version = true;
    const failed = /^\s*not ok\s+\d+\s+-\s+(.*)$/u.exec(line);
    if (failed) {
      active = { name: failed[1].replace(/\s+#.*$/u, ''), file: null };
      if (/^(?:\.\/)?(?:test|tests)\/[^\r\n]+\.(?:[cm]?js|ts|py)$/u.test(active.name)) active.file = active.name.replace(/^\.\//u, '');
      failures.push(active);
      continue;
    }
    if (/^\s*ok\s+\d+/u.test(line)) { active = null; continue; }
    const count = /^# fail (\d+)\s*$/u.exec(line);
    if (count) { summary = Number(count[1]); summaryAt = index; }
    const stopped = /^# cancelled (\d+)\s*$/u.exec(line);
    if (stopped) cancelled = Number(stopped[1]);
  }
  if (yaml !== null || !version || summary === null || summary < 1 || summary !== failures.length || cancelled !== 0) return null;
  const trailer = lines.slice(summaryAt + 1).every((line) => !line.trim() || /^# [a-z_]+ \d+(?:\.\d+)?\s*$/u.test(line) || /^npm (?:ERR!|error|warn|notice)\b/u.test(line));
  return trailer ? failures : null;
}

/**
 * The failures that explain a red run, or null when anything else may have failed: the command
 * could not be split into stages, a stage did not finish, a stage exited other than 0 without
 * exactly 1 and a complete TAP account of its failures, or a pipeline in a stage had a component
 * that left no status or failed without its own complete TAP account. Waivers only ever subtract
 * these [B3,R3].
 */
export function accountedFailures(gate, root) {
  if (gate.isGreen || !Array.isArray(gate.stages) || !gate.stages.length) return null;
  // Only the authenticated worker checkout may relocate remote failure locations.
  const executionRoot = gate.executionRoot ?? root;
  const failures = [];
  for (const stage of gate.stages) {
    if (!Number.isInteger(stage.status)) return null;
    if (stage.pipeline !== undefined) {
      // In a pipeline each failing component must explain itself; a forwarded account credits no one else [B3,R3].
      const own = pipelineFailures(stage.pipeline, executionRoot);
      if (!own || (stage.status === 0) !== (own.length === 0)) return null;
      failures.push(...own);
      continue;
    }
    if (stage.status === 0) continue;
    const own = stage.status === 1 ? tapFailures(stage.output ?? '', executionRoot) : null;
    if (!own) return null;
    failures.push(...own);
  }
  return failures.length ? failures : null;
}

/**
 * The failures a pipeline's components account for themselves, or null. Every component must have
 * recorded its status, and every failing one must exit exactly 1 with a complete TAP account in its
 * own output. A setup step that fails beside a consumer printing a waived test's TAP has no account
 * of its own, so it is an independent red no waiver names, and it voids the run.
 */
function pipelineFailures(components, root) {
  if (!Array.isArray(components) || components.some((entry) => !Number.isInteger(entry?.status))) return null;
  const failures = [];
  for (const { status, output } of components.filter((entry) => entry.status !== 0)) {
    const own = status === 1 ? tapFailures(output ?? '', root) : null;
    if (!own) return null;
    failures.push(...own);
  }
  return failures;
}

/**
 * Pair every named failure of a red run with the live person waiver covering it, or return null.
 * One unnamed, unfiled or unwaived failure voids the whole run, so a waiver never hides another red [B3,R3].
 */
export function waivedFailures(board, failures) {
  if (!Array.isArray(failures) || !failures.length || failures.some((entry) => !entry.file)) return null;
  const covered = failures.map((failure) => ({ ...failure, waiver: store.landingWaiverFor(board, failure) }));
  return covered.every((entry) => entry.waiver) ? covered : null;
}

/** Project the live person waivers a landing run may read, so it does not stop early on one [B3]. */
export function liveWaiverProjection(board) {
  const now = board.clock.now().getTime();
  return store.landingWaivers(board).filter((waiver) => Date.parse(waiver.until) > now)
    .map((waiver) => ({ kind: waiver.kind ?? store.landingWaiverKind(waiver.test), test: waiver.test }));
}

/** Name one waived failure with the person's waiver, its reason and its expiry [B3]. */
export function waiverLine(failure) {
  const { waiver } = failure;
  if (waiver.quarantine) return `quarantined: ${failure.name} (${failure.file}) is a proven flake, reported but not blocking until repair #${waiver.quarantine.item} is verified`;
  return `waived: ${failure.name} (${failure.file}) by person waiver ${waiver.id} for ${waiver.kind ?? store.landingWaiverKind(waiver.test)} ${waiver.test}: ${waiver.reason}; expires ${waiver.until}`;
}

/** Record every failure's exact live waiver rather than changing which tests the gate runs. */
function waivedProof(state, gate) {
  if (!completeGate(gate) || gate.requiresGreen) return null;
  const failures = waivedFailures(state.board, gate.accounted);
  return failures ? { tree: gate.tree, failures: failures.map((entry) => ({ ...entry, waiver: entry.waiver.id })), logPath: gate.logPath } : null;
}

/** Bisect a reproducible red without retrying any previously tested group. */
async function bisect(state, items, failures, label = 'split') {
  if (items.length === 1) {
    const item = items[0];
    const text = `Landing batch ${state.batch.id} reproduces failures: ${failures.map((failure) => `${failure.file}: ${failure.name}`).join('; ')}`;
    if (!store.itemThread(state.board, item.id).some((entry) => entry.type === 'fact' && entry.text === text)) {
      await state.write('appendFact', [item.id, { agentId: 'coordinator', kind: 'measurement', text }]);
    }
    const mergeCommit = state.batch.tip;
    if (!state.culprits.some((entry) => entry.id === item.id)) state.culprits.push({ id: item.id, commit: item.commit, ...(item.reviewedCommit ? { reviewedCommit: item.reviewedCommit } : {}), mergeCommit, tests: failures });
    await save(state, { culprits: state.culprits });
    await returnCulprits(state);
    state.say(`culprit #${item.id}: ${failures.map((failure) => failure.name).join(', ')}`);
    return [];
  }
  const middle = Math.ceil(items.length / 2);
  const green = [];
  for (const [index, part] of [items.slice(0, middle), items.slice(middle)].entries()) {
    const build = await mergeGroup(state, part);
    await save(state, { ...build, state: 'bisecting' });
    const gate = await gateGroup(state, `${label}-${index}`);
    if (gate.isGreen || waivedProof(state, gate)) green.push(...build.items);
    else {
      const flakyFiles = await diagnose(state, gate.failures, gate);
      if (flakyFiles.length) {
        await fileFlakes(state, gate, flakyFiles);
        state.flaky = true;
        return [];
      }
      green.push(...await bisect(state, build.items, gate.failures, `${label}-${index}`));
    }
  }
  return green;
}

/** Return recorded red candidates once, including a saved failure interrupted before its move. */
async function returnCulprits(state) {
  for (const culprit of state.culprits) {
    const item = store.getItem(state.board, culprit.id);
    if (item.item_status !== 'verified' || item.item_merged_commit || item.item_commit !== culprit.commit
      || (culprit.reviewedCommit ?? culprit.commit) !== store.checkedLandingCommit(state.board, item)
      || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(culprit.mergeCommit ?? '')) continue;
    const note = `Landing batch ${state.batch.id} failed ${culprit.tests.map((failure) => `${failure.file}: ${failure.name}`).join('; ')}; merge commit ${culprit.mergeCommit}`;
    await state.write('reopen', [culprit.id, { agentId: 'coordinator', note }]);
  }
}

/** File a flake once against its named test and leave the batch stopped. */
async function fileFlakes(state, gate, files) {
  if (state.config.flakes?.rerun === true) {
    await save(state, { state: 'blocked', failures: gate.failures, flakeDiagnostics: gate.flakeDiagnostics });
    state.say(`flake observed: ${files.join(', ')}; the original gate stays red and nothing lands; inspect pullboard flakes`);
    return;
  }
  const flakes = [];
  for (const file of files) {
    const owner = laneOf(state.config, file);
    const lane = owner === 'coordinator' ? store.getItem(state.board, state.batch.items[0].id).item_lane : owner;
    flakes.push(await state.write('recordLandingFlake', [{ agentId: 'coordinator', test: file, hash: testHash(state.batch.root, file),
      names: gate.failures.filter((entry) => entry.file === file).map((entry) => entry.name), lane, batchId: state.batch.id }]));
  }
  await save(state, { state: 'flaky', failures: gate.failures, flakes });
  state.say(`flake: ${files.join(', ')}; nothing landed; fix the test or ask the person for an expiring waiver`);
}

/** Name the remote a landing pushes the trunk to: the trunk branch's own remote, else origin [B3]. */
function landingRemoteName(root, branch) {
  return tryGit(root, ['config', '--get', `branch.${branch.replace(/^refs\/heads\//u, '')}.remote`]).stdout || 'origin';
}

/**
 * Name the configured remote a landing would push the trunk to, or null when this repo has none [B3].
 * An accept uses it to say which landing command fits this repo; the landing itself refuses on null.
 */
export function landingRemote(root, branch) {
  const remote = landingRemoteName(root, branch);
  return tryGit(root, ['remote', 'get-url', remote]).status === 0 ? remote : null;
}

/** Build the one LAND_PUSH refusal every landing push failure reports, real or previewed [B3]. */
function pushRefused(reason, next = 'inspect the remote and hooks, then run pullboard land --adopt') {
  return new Refused('LAND_PUSH', `the landing push failed: ${reason}; ${next}`);
}

/**
 * Return the remote a landing pushes to, refusing LAND_PUSH when it does not exist [B3].
 * The dry run and the real landing both call this, so a preview cannot say "would land" for a push that must fail.
 */
function requirePushTarget(root, branch) {
  const remote = landingRemote(root, branch);
  if (remote) return remote;
  const missing = landingRemoteName(root, branch);
  throw pushRefused(`this repo has no ${missing} remote to push ${branch.replace(/^refs\/heads\//u, '')} to`,
    `add one with git remote add ${missing} <url> and run pullboard land again, or merge each verified commit on the trunk with git merge --no-ff and record it with pullboard merged <id> <commit>`);
}

/** Recheck immutable publication inputs after the last awaited canonical operation. */
function publicationInputs(state, batch) {
  for (const entry of batch.items) {
    const item = store.getItem(state.board, entry.id);
    if (item.item_status !== 'verified' || item.item_commit !== entry.commit
      || store.checkedLandingCommit(state.board, item) !== (entry.reviewedCommit ?? entry.commit)) {
      throw new Refused('LAND_ITEM_MOVED', `item #${entry.id} changed its checked composition; rebuild the landing before publishing`);
    }
  }
  if (batch.proof?.failures?.some(failure => !store.landingWaiverFor(state.board, failure))) throw new Refused('LAND_WAIVER', 'the landing proof has an expired or missing person waiver; ask the person for a new expiring waiver, then adopt the batch');
  if (headCommit(batch.root) !== batch.tip || !isClean(batch.root) || untracked(batch.root).length) throw new Refused('LAND_MOVED', 'the gated landing tree changed; inspect the batch and adopt it again');
  if (mainCheckout(state.root)?.commit !== batch.base) throw new Refused('LAND_TRUNK_MOVED', 'main moved during the landing; rebuild the batch from its new tip');
}

/** Push the exact gated tip before recording receipts, then fast-forward only a clean unchanged main. */
async function publish(state) {
  let batch = state.batch;
  const remote = requirePushTarget(state.root, batch.branch);
  if (batch.proof?.failures?.length && batch.state !== 'pushed') {
    const failures = batch.proof.failures.map((failure) => ({ ...failure, waiver: store.landingWaiverFor(state.board, failure)?.id }));
    if (!failures.every((failure) => failure.waiver)) throw new Refused('LAND_WAIVER', 'the landing proof has an expired or missing person waiver; ask the person for a new expiring waiver, then adopt the batch');
    batch = await save(state, { proof: { ...batch.proof, failures } });
  }
  if (batch.state !== 'pushed') {
    await state.checkLease();
    publicationInputs(state, batch);
    const alreadyPushed = tryGit(batch.root, ['ls-remote', remote, batch.branch]).stdout.split(/\s+/u)[0] === batch.tip;
    if (!alreadyPushed) {
      state.checkLeaseNow();
      const pushed = tryGit(batch.root, ['push', remote, `HEAD:${batch.branch}`]);
      if (pushed.status !== 0) throw pushRefused(pushed.stderr || pushed.stdout);
    }
    await save(state, { state: 'pushed' });
  }
  if (tryGit(batch.root, ['ls-remote', remote, batch.branch]).stdout.split(/\s+/u)[0] !== batch.tip) {
    throw new Refused('LAND_REMOTE_MOVED', 'the remote no longer names the pushed batch tip; inspect it before adopting, without rewriting the remote');
  }
  state.batch = await state.write('finishLandingBatch', [{ agentId: 'coordinator', id: state.batch.id, tip: state.batch.tip }]);
  await state.checkLease();
  const main = mainCheckout(state.root);
  if (main?.commit === state.batch.base && isClean(state.root) && !untracked(state.root).length) git(state.root, ['merge', '--ff-only', state.batch.tip]);
  state.say(`landed ${state.batch.items.map((entry) => `#${entry.id}`).join(', ')} at ${state.batch.tip}`);
  return state.batch;
}

/** Whether this project lands in two tiers: on the local trunk at once, and on the remote only through publish (#801). */
export function landsOnTrunk(config) {
  return config?.landing?.publish === 'separate';
}

/**
 * The quick guards a tier-1 landing runs on its merged tree (#801): the project's static checks and its submit
 * invariants. Each item's frozen check already ran at verify, and the whole suite runs at publish.
 */
async function quickGuards(state) {
  const root = state.batch.root;
  await runStaticChecks(root, state.config, { agent: 'coordinator', onWait: state.onWait });
  const invariants = [...new Set(state.config.submitInvariants ?? [])].sort();
  if (!invariants.length) return;
  const command = `${state.config.affectedTests} ${invariants.map(quote).join(' ')}`;
  const run = await withGateSlot(root, lease => runProfiledShell(root, command, { waitMs: lease.waitMs, gateLease: lease }),
    { agent: 'coordinator', kind: 'check', itemCheck: true, onWait: state.onWait });
  if (!run.isGreen) throw new Refused('GATE_RED', `the submit invariants are red on the merged tree: ${invariants.join(', ')}`);
}

/** The affected test files each batch item's submission moved to the landing gate, read from its exact submit. */
function deferredSelections(state) {
  return state.batch.items.flatMap((entry) => {
    const event = store.events(state.board, { itemId: entry.id }).findLast((row) => row.event_kind === 'submit');
    const detail = event ? JSON.parse(event.event_detail) : null;
    const files = detail?.commit === entry.commit ? detail.submissionProof?.deferredFiles ?? [] : [];
    return files.length ? [{ entry, files }] : [];
  });
}

/**
 * Run every affected test file a submit deferred over submitDeferAbove on the merged tree, before anything lands.
 * A red sends back each item whose own deferred selection holds a failing file, the way a red submit would.
 */
async function deferredGuards(state) {
  const root = state.batch.root;
  const deferred = deferredSelections(state);
  if (!deferred.length) return;
  const files = [...new Set(deferred.flatMap((row) => row.files))].sort();
  const tree = headTree(root);
  const commit = headCommit(root);
  const browser = !browserFreeChecksEnabled() || await testsNeedBrowser(root, files);
  const run = await withGateSlot(root, lease => runProfiledShell(root, `${state.config.affectedTests} ${files.map(quote).join(' ')}`, { waitMs: lease.waitMs, gateLease: lease, stages: true }),
    { agent: 'coordinator', kind: 'gate', landing: true, browser, onWait: state.onWait });
  // The same pin as the full landing gate: a result only counts for the exact merged tree it ran on.
  if (headCommit(root) !== commit || headTree(root) !== tree || !isClean(root)) {
    throw new Refused('LAND_SOURCE_CHANGED', 'the landing source changed while the deferred affected tests ran; restore the recorded batch before adopting');
  }
  state.say(`deferred affected tests: ${files.length} file(s) ${run.isGreen ? 'green' : 'red'} on the merged tree`);
  if (run.isGreen) return;
  const failures = landingFailures(run.output, root);
  const failed = new Set(failures.map((failure) => failure.file).filter(Boolean));
  for (const { entry, files: own } of deferred) {
    if (!own.some((file) => failed.has(file)) || state.culprits.some((culprit) => culprit.id === entry.id)) continue;
    state.culprits.push({ id: entry.id, commit: entry.commit, ...(entry.reviewedCommit ? { reviewedCommit: entry.reviewedCommit } : {}),
      mergeCommit: state.batch.tip, tests: failures.filter((failure) => own.includes(failure.file)) });
  }
  await save(state, { culprits: state.culprits });
  await returnCulprits(state);
  throw new Refused('GATE_RED', `the deferred affected tests are red on the merged tree: ${[...failed].join(', ') || 'no failing file was named; inspect the merged tree'}`);
}

/** Run the deferred affected tests before an inline landing's gate; false when they are red and nothing may land. */
async function inlineDeferredGuards(state) {
  try { await deferredGuards(state); return true; } catch (error) {
    if (!(error instanceof Refused) || error.code !== 'GATE_RED') throw error;
    state.say(`nothing landed: ${error.message}`);
    return false;
  }
}

/**
 * Tier 1 (#801): after a clean merge and its quick guards, the batch lands on the local trunk in seconds, with each
 * item's merged receipt; nothing is pushed. pullboard publish runs the whole suite on the trunk head and pushes it.
 */
async function landOnTrunk(state) {
  await save(state, { state: 'gating', tip: headCommit(state.batch.root) });
  try { await quickGuards(state); await deferredGuards(state); } catch (error) {
    if (!(error instanceof Refused)) throw error;
    await save(state, { state: 'blocked' });
    state.say(`nothing landed: ${error.message}`);
    return;
  }
  for (const entry of state.batch.items) {
    const item = store.getItem(state.board, entry.id);
    if (item.item_status !== 'verified' || item.item_commit !== entry.commit) throw new Refused('LAND_ITEM_MOVED', `item #${entry.id} changed after the batch merged; rebuild its landing`);
  }
  if (mainCheckout(state.root)?.commit !== state.batch.base) throw new Refused('LAND_TRUNK_MOVED', 'main moved during the landing; rebuild the batch from its new tip');
  await save(state, { state: 'trunk', proof: { tree: headTree(state.batch.root), failures: [], logPath: null } });
  await finishTrunk(state);
}

/** Record a tier-1 batch's merged receipts and move the local trunk to it; an adopted 'trunk' batch resumes here (#801). */
async function finishTrunk(state) {
  state.batch = await state.write('finishLandingBatch', [{ agentId: 'coordinator', id: state.batch.id, tip: state.batch.tip }]);
  await state.checkLease();
  const main = mainCheckout(state.root);
  if (main?.commit === state.batch.base && isClean(state.root) && !untracked(state.root).length) git(state.root, ['merge', '--ff-only', state.batch.tip]);
  state.say(`landed ${state.batch.items.map((entry) => `#${entry.id}`).join(', ')} at ${state.batch.tip} on the local trunk; pullboard publish pushes it once the whole suite passes`);
}

/** Skip admission only when no queued owner, interrupted batch or recorded Git repair needs it. */
function idleLanding(board, trunk) {
  const lease = landingLeaseState(board);
  if (lease.holder || lease.line.length) return false;
  return !store.landingBatches(board).some(batch =>
    (batch.state !== 'landed' && batch.state !== 'blocked')
      || (batch.state === 'landed' && batch.base === trunk));
}

/** Preserve the existing empty selection's refusal, blocked reports and result shape. */
function emptyLanding(selected, say) {
  const stale = selected.blocked.find(item => item.code === 'STALE_VERDICT');
  if (stale) throw staleVerdictRefusal({ item_id: stale.id }, stale);
  for (const entry of selected.blocked) say(`${entry.code} #${entry.id}${entry.stacked ? ` carries #${entry.stacked}` : ''}`);
  return { batch: null, landed: [], conflicts: [], blocked: selected.blocked, culprits: [], flakes: [] };
}

/** Defer a new ordinary attempt without taking capacity or sleeping between landing batches. */
function cadenceDeferral(board, config, branch, say) {
  const interval = config.landing?.cadenceMs;
  if (!interval) return null;
  const latest = store.landingBatches(board).filter(batch => batch.branch === branch).map(batch => Date.parse(batch.startedAt ?? '')).filter(Number.isFinite).sort((a, b) => b - a)[0];
  if (latest === undefined || latest + interval <= Date.now()) return null;
  const deferredUntil = new Date(latest + interval).toISOString();
  say(`landing deferred until ${deferredUntil}: the trunk's landing cadence has not elapsed`);
  return { batch: null, landed: [], conflicts: [], blocked: [], culprits: [], flakes: [], deferredUntil };
}

/** Build, gate, diagnose and durably land one coordinator batch; all external actions stay in its worktree. */
export async function land(options) {
  if (options.dryRun) return runLandingBatch(options);
  invalidateGitFacts();
  const trunk = mainCheckout(options.root);
  const branch = trunk?.branch;
  if (!branch) throw new Refused('LAND_TRUNK', 'landing needs the coordinator’s primary branch; return its checkout to the trunk');
  if (trunk.commit && !options.adopt) {
    requireConfirmedLanding(options.board);
    const deferred = cadenceDeferral(options.board, policyAt(options.root, trunk.commit).config, branch, options.say);
    if (deferred) return deferred;
  }
  if (trunk.commit && !options.adopt && idleLanding(options.board, trunk.commit)) {
    requireConfirmedLanding(options.board);
    // Only accepted trunk policy may inform this read-only preflight.
    const config = policyAt(options.root, trunk.commit).config;
    options.board.quarantineEnabled = () => config.flakes?.quarantine === true;
    const selected = candidates(options.board, options.root, trunk.commit, options.maximum ?? Infinity, { firstReady: true });
    invalidateGitFacts();
    const current = mainCheckout(options.root);
    if (!selected.ready.length && current?.commit === trunk.commit && current.branch === branch
      && idleLanding(options.board, trunk.commit)) {
      requireConfirmedLanding(options.board);
      return emptyLanding(selected, options.say);
    }
  }
  let lastWait = '';
  const controller = new AbortController();
  const lease = await takeLandingResource({ board: options.board, write: options.write, branch,
    onLost: error => controller.abort(error),
    /** Report a real ordered holder, without allocating machine test capacity to this waiter. */
    onWait({ holders, position }) {
      const message = `landing waiting: ${branch} held by ${holders[0]?.label ?? 'the previous landing'}; queued at place ${position}`;
      if (message !== lastWait) options.say(message);
      lastWait = message;
    } });
  let failed = false;
  try {
    await lease.assertHeld();
    invalidateGitFacts(); // The holder may have moved main while this command waited.
    /** Bind each batch transition to this acknowledged grant, never to an optimistic local result. */
    const write = async (operation, args) => {
      await lease.assertHeld();
      const values = ['recordLandingBatch', 'finishLandingBatch'].includes(operation)
        ? [{ ...args[0], landingFence: lease.fence }, ...args.slice(1)] : args;
      return options.write(operation, values);
    };
    /** Relay catch-up can change proof or trunk facts while a renewal awaits its receipt. */
    const checkLease = async () => { await lease.assertHeld(); invalidateGitFacts(); };
    const batchOptions = { root: options.root, config: options.config, owner: options.owner, maximum: Number.isFinite(options.maximum) ? options.maximum : null,
      adopt: options.adopt, fence: lease.fence };
    if (batchOptions.maximum === null) delete batchOptions.maximum;
    return await runLandingWorker(batchOptions, { write, checkLease, checkLeaseNow: lease.assertCurrent,
      bindWorker: lease.bindWorker, watchDeadline: lease.watchDeadline, onWait: options.onWait, say: options.say, signal: controller.signal });
  } catch (error) { failed = true; throw error; }
  finally {
    try { await lease.release(); }
    catch (error) {
      if (!failed) throw error;
      options.say(`landing lease release was not acknowledged: ${error.code ?? 'ERROR'}; inspect pullboard resume before adopting`);
    }
  }
}

/** Select only after admission, retaining the existing batch, proof and adoption rules. */
export async function runLandingBatch({ root, board, config, write, say, owner, maximum = Infinity, dryRun = false, adopt = false, onWait, checkLease, checkLeaseNow, fence }) {
  let trunk = mainCheckout(root);
  if (fence && trunk?.branch !== fence.branch) throw new Refused('LAND_LEASE_LOST', 'the trunk branch changed while landing waited; start a new land command for its current branch');
  const unfinished = store.landingBatches(board).findLast((batch) => batch.state !== 'landed' && batch.state !== 'blocked');
  if (fence && unfinished && unfinished.branch !== fence.branch) throw new Refused('LAND_LEASE_LOST', 'the interrupted batch belongs to another trunk branch; restore that branch and start a fresh land --adopt');
  const recorded = store.landingBatches(board).findLast((batch) => batch.state === 'landed' && batch.base === trunk?.commit);
  if (fence && recorded && recorded.branch !== fence.branch) throw new Refused('LAND_LEASE_LOST', 'the recorded Git repair belongs to another trunk branch; restore that branch before landing');
  if (!dryRun && recorded && isClean(root) && !untracked(root).length) {
    await checkLease();
    git(root, ['merge', '--ff-only', recorded.tip]);
    trunk = mainCheckout(root);
  }
  if (!trunk?.commit) throw new Refused('LAND_TRUNK', 'landing needs the coordinator’s primary branch; return its checkout to the trunk');
  // Pin accepted policy after any recorded-landed repair, never before admission or from candidate files.
  config ??= policyAt(root, trunk.commit).config;
  board.quarantineEnabled = () => config.flakes?.quarantine === true;
  if (!dryRun && !adopt && !unfinished) {
    const deferred = cadenceDeferral(board, config, trunk.branch, say);
    if (deferred) return deferred;
  }
  const selected = candidates(board, root, trunk.commit, maximum);
  const stale = selected.blocked.find(item => item.code === 'STALE_VERDICT');
  if (!selected.ready.length && stale) throw staleVerdictRefusal({ item_id: stale.id }, stale);
  if (dryRun) {
    if (selected.ready.length && !landsOnTrunk(config)) requirePushTarget(root, trunk.branch);
    const conflicts = [];
    for (const item of selected.ready) {
      const merge = tryGit(root, ['merge-tree', '--write-tree', '--name-only', '-z', trunk.commit, item.item_landing_commit]);
      if (merge.status === 1) {
        const parts = merge.stdout.split('\0').slice(1);
        const end = parts.indexOf('');
        conflicts.push({ id: item.item_id, files: parts.slice(0, end < 0 ? parts.length : end) });
      } else if (merge.status !== 0) throw new Refused('LAND_MERGE', 'Git could not preview the landing; restore its objects and retry the dry run');
    }
    return { batch: null, landed: [], conflicts, blocked: selected.blocked, culprits: [], flakes: [], items: selected.ready.map((item) => item.item_id) };
  }
  if (unfinished && !adopt && unfinished.state !== 'flaky') throw new Refused('LAND_ADOPT', `batch ${unfinished.id} is ${unfinished.state}; inspect pullboard resume, then run pullboard land --adopt`);
  if (adopt && !unfinished) throw new Refused('LAND_ADOPT', 'there is no interrupted landing batch; run pullboard land');
  let batch = unfinished;
  if (batch?.state === 'flaky') {
    const held = (batch.flakes ?? []).filter((flake) => {
      const corrected = batch.base !== trunk.commit && testHash(root, flake.test) !== null && testHash(root, flake.test) !== flake.hash;
      const failures = (batch.failures ?? []).filter((failure) => failure.file === flake.test);
      return !corrected && (!failures.length || !failures.every((failure) => store.landingWaiverFor(board, failure)));
    });
    if (held.length) throw new Refused('LAND_FLAKE', `batch ${batch.id} is held by ${held.map((entry) => entry.test).join(', ')}; fix the test or ask the person for an expiring waiver; nothing retries`);
  }
  if (batch && batch.base !== trunk.commit && batch.state !== 'pushed') {
    await write('recordLandingBatch', [{ agentId: 'coordinator', batch: { ...batch, state: 'blocked', supersededByMain: trunk.commit }, revision: batch.revision }]);
    batch = null;
  }
  if (!batch && !selected.ready.length) return emptyLanding(selected, say);
  if (!batch) {
    if (!landsOnTrunk(config)) requirePushTarget(root, trunk.branch);
    const id = randomUUID();
    const directory = join(repoInfo(root).commonDir, 'pullboard', 'landings', id);
    batch = { version: 1, id, startedAt: new Date().toISOString(), base: trunk.commit, tip: trunk.commit, branch: trunk.branch, root: join(directory, 'worktree'),
      candidates: selected.ready.map(landingEntry),
      items: selected.ready.map(landingEntry), conflicts: [], blocked: selected.blocked,
      state: 'merging', owner, logPath: join(directory, 'logs', 'batch.log'), revision: 0 };
    batch = await write('recordLandingBatch', [{ agentId: 'coordinator', batch }]);
    mkdirSync(directory, { recursive: true });
    git(root, ['worktree', 'add', '--detach', batch.root, batch.base]);
  }
  const state = { root, board, config, write, say, onWait, checkLease, checkLeaseNow, batch, culprits: batch.culprits ?? [], flaky: false, gates: new Map((batch.gateResults ?? []).map((result) => [result.tree, result])), diagnosed: new Map((batch.diagnostics ?? []).map((result) => [result.test, result.isGreen])) };
  try {
    await save(state, { owner });
    await returnCulprits(state);
    if (state.batch.state === 'trunk') await finishTrunk(state);
    else if (state.batch.state === 'pushed' || state.batch.state === 'ready') await publish(state);
    else {
      const initialItems = (state.batch.candidates ?? state.batch.items)
        .filter((entry) => !state.culprits.some((culprit) => culprit.id === entry.id && culprit.commit === entry.commit));
      if (!existsSync(state.batch.root)) throw new Refused('LAND_WORKTREE', `the recorded landing worktree is missing at ${state.batch.root}; restore it before adopting`);
      const build = await mergeGroup(state, initialItems);
      await save(state, { ...build, conflicts: [...state.batch.conflicts, ...build.conflicts] });
      for (const entry of state.batch.blocked ?? []) say(`${entry.code} #${entry.id}${entry.stacked ? ` carries #${entry.stacked}` : ''}`);
      if (!build.items.length) await save(state, { state: 'blocked' });
      else if (landsOnTrunk(state.config)) await landOnTrunk(state);
      else if (!await inlineDeferredGuards(state)) await save(state, { state: 'blocked' });
      else {
        let gate = await gateGroup(state, 'batch');
        let proof = gate.isGreen ? null : waivedProof(state, gate);
        if (!gate.isGreen && !proof) {
          const flakyFiles = await diagnose(state, gate.failures, gate);
          if (flakyFiles.length) { await fileFlakes(state, gate, flakyFiles); state.flaky = true; }
          else {
            const green = await bisect(state, build.items, gate.failures);
            if (!state.flaky && green.length) {
              const rebuilt = await mergeGroup(state, green);
              await save(state, { ...rebuilt, culprits: state.culprits });
              // The smaller final tree lost the removed items' changes, so the kept items' deferred files run again on it.
              if (!await inlineDeferredGuards(state)) {
                await save(state, { state: 'blocked', culprits: state.culprits });
                gate = null;
              } else {
                gate = await gateGroup(state, 'green-items');
                proof = gate.isGreen ? null : waivedProof(state, gate);
                if (!gate.isGreen && !proof) {
                  await save(state, { state: 'blocked', failures: gate.failures, culprits: state.culprits });
                  throw new Refused('LAND_INTERACTION', 'the individually green items fail together; nothing retries or lands; inspect the batch’s failing tests');
                }
              }
            } else if (!state.flaky) await save(state, { state: 'blocked', culprits: state.culprits });
          }
        }
        if (!state.flaky && gate && (gate.isGreen || proof)) {
          await save(state, { state: 'ready', proof: proof ?? { tree: gate.tree, failures: [], logPath: gate.logPath }, culprits: state.culprits });
          await publish(state);
        }
      }
    }
  } catch (error) {
    if (!(error instanceof Refused) || error.code !== 'LAND_GATE_TIMEOUT') throw error;
    say(error.message);
  }
  return { batch: state.batch, landed: state.batch.state === 'landed' ? state.batch.items.map((entry) => entry.id) : [],
    conflicts: state.batch.conflicts ?? [], blocked: state.batch.blocked ?? [], culprits: state.culprits, flakes: state.batch.flakes ?? [] };
}
