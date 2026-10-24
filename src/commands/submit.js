/** The pullboard submit command, in its own module so an item adding another command never edits these lines. */
import * as store from '../board.js';
import {
  refuseProvesNothing,
} from '../check-accept.js';
import {
  COORDINATOR,
} from '../config.js';
import {
  hasSubmitRules,
  holdDoctrine,
  ruleLine,
} from '../doctrine-checks.js';
import * as gateReceipt from '../gate-receipt.js';
import { recordNativeProof } from '../proof-cli.js';
import {
  gateWaitReporter,
} from '../gate-wait.js';
import {
  deferredSelectionNote,
  runSubmitGate,
  submitGateReport,
  withGateSlot,
} from '../gate.js';
import {
  headCommit,
  headTree,
  isClean,
  untracked,
} from '../git.js';
import {
  machineNameProblems,
} from '../hooks.js';
import * as infraNotes from '../infra-note.js';
import {
  accountedFailures,
  waivedFailures,
  waiverLine,
} from '../land.js';
import {
  compareMainFailures,
  mainRedMessage,
} from '../main-red.js';
import * as nativeFlakes from '../native-flake-cli.js';
import {
  Refused,
} from '../refused.js';
import {
  relayRecovered,
} from '../relay.js';
import * as seatCheckout from '../seat-checkout.js';
import {
  submitPreflight,
} from '../submit-preflight.js';
import {
  dependencySnapshots,
  frozenCheck,
  itemPolicy,
  mainPolicy,
  requireTrunkMerge,
  submissionPaths,
} from '../trusted-policy.js';
import {
  CHECKOUT_LEASES,
  browserAdmissionReporter,
  context,
  filesSince,
  freezer,
  idArg,
  ordered,
  queuedItemLease,
  refuseUnverifiedStack,
  reportSubmission,
  resourceAgent,
  whoAmI,
  withBoard,
} from '../cli.js';
import { recordedRecovery } from '../recorded-recovery.js';

/**
 * Submit: a clean tree, nothing untracked, the gate green at HEAD, then the board (V4).
 *
 * The cheap checks run before the gate, so a submit that cannot succeed fails fast.
 *
 * @param {any} ctx
 * @param {number} id
 * @returns {Promise<number>}
 */
export async function submitHere(ctx, id, infra) {
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
  machineNameProblems(root, `${acceptedMain.commit}..${commit}`, { refuse: acceptedMain.config.commits.noHostName === true, say: (line) => ctx.io.say(line) });
  const infraRecord = infraNotes.infraNote({ root, claimHead, files: filesSince(root, id, claimHead, commit), gates: [ctx.config.gate, acceptedMain.config.gate], infra, requireInfraNote: acceptedMain.config.submit.requireInfraNote });
  // Doctrine counts only fall: accepted main's rules, at this exact commit (D1). No rule, no change.
  const doctrine = hasSubmitRules(root, acceptedMain.commit, acceptedMain.config.practice)
    ? await withGateSlot(root, () => holdDoctrine(root, { mainCommit: acceptedMain.commit, commit, practice: acceptedMain.config.practice, timeoutMs: acceptedMain.config.check?.timeoutMs }),
      { itemCheck: true, agent: me.id, item: String(id), kind: 'doctrine', onWait: queuedItemLease(ctx, held, me.id, 'build'), onReceipt: (receipt) => ctx.io.say(`doctrine hold ${gateReceipt.receiptLine(receipt)}`) })
    : [];
  for (const rule of doctrine) ctx.io.say(`doctrine: ${ruleLine(rule)}`);
  // Every submit proves its frozen check and reachable tests anew on this exact commit (V4,V16).
  // Empty frozen gates adopt accepted main setup; only a full fallback may stamp its tree.
  const submitConfig = { ...ctx.config, gate: ctx.config.gate.trim() ? ctx.config.gate : acceptedMain.config.gate, submitGate: acceptedMain.config.submitGate, staticChecks: acceptedMain.config.staticChecks,
    submitInvariants: acceptedMain.config.submitInvariants, submitDeferAbove: acceptedMain.config.submitDeferAbove,
    // The accepted project runner interprets its current invariant files; candidate config cannot replace it.
    ...(acceptedMain.config.submitInvariants.length ? { affectedTests: acceptedMain.config.affectedTests } : {}) };
  const gate = await runSubmitGate(root, submitConfig, { base: claimHead, trunk: acceptedMain.commit, check: frozenCheck(held), agent: me.id, item: String(id), onWait: queuedItemLease(ctx, held, me.id, 'build'), onBrowserFallback: browserAdmissionReporter(ctx.io, ctx.io.relayJson),
    proofContext: { item: id, frozenDigest: held.item_frozen_digest ?? null, seat: me.id },
    onFailure: nativeFlakes.observer(ctx, { kind: 'submit', main: acceptedMain.commit, config: submitConfig }, { ordered, withBoard, resourceAgent }) });
  for (const proofReceiptId of gate.proofReceiptIds ?? []) {
    await recordNativeProof(ctx, held, { proofReceiptId }, { ordered, withBoard, resourceAgent });
  }
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
      submissionProof: { version: 1, files: gate.files, full: gate.full, deferred: gate.deferred, reason: gate.reason, ...(gate.deferredFiles ? { deferredFiles: gate.deferredFiles } : {}) },
      ...(gate.deferred ? { note: gate.deferredFiles ? deferredSelectionNote(gate.deferredFiles) : 'full suite deferred to the landing gate' } : {}) }]);
  });
  const report = waived
    ? `submission proof waived, not green: ${waived.length} failure(s), each covered by a live person waiver; the whole output is in ${gate.log}\n${waivedLines.join('\n')}`
    : submitGateReport(gate);
  return reportSubmission(ctx, id, commit, { green: gate.isGreen, report, files: gate.files, full: gate.full, deferred: gate.deferred, deferFullFallback: gate.deferFullFallback, ...(gate.deferredFiles ? { deferredFiles: gate.deferredFiles } : {}), reason: gate.reason, check: gate.check,
    log: gate.log, profile: gate.profile, profilePath: gate.profilePath, proofLog: gate.proofLog, proofProfilePath: gate.proofProfilePath,
    ...(waived ? { waived: waived.map(({ file, name, waiver }) => ({ file, name, waiver: waiver.id, reason: waiver.reason, until: waiver.until })) } : {}) }, doctrine);
}

/** Run `pullboard submit` and return its exit code. */
export async function run(io, { first, values }) {
  return submitHere(context(io), idArg(first), values.infra);
}
