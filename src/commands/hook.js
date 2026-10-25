/** The pullboard hook command, in its own module so an item adding another command never edits these lines. */
import * as store from '../board.js';
import { pendingCommitSignoffProblem } from '../commit-signoff.js';
import { landingBatchOwnsRoot } from '../landing-candidates.js';
import {
  hookRead,
  readStdin,
} from '../cli-support.js';
import {
  gateWaitReporter,
} from '../gate-wait.js';
import {
  gateReport,
  runGate,
} from '../gate.js';
import {
  headTree,
  isClean,
  repoInfo,
  untracked,
} from '../git.js';
import {
  applyFixers,
  commitCitationWarnings,
  commitMsgProblems,
  FIX_NOTE,
  preCommitProblems,
  prePushProblems,
  gitBoardDataPush,
  pushesTrunk,
} from '../hooks.js';
import {
  Refused,
} from '../refused.js';
import {
  withRowDrafts,
} from '../row-drafts.js';
import {
  loadSpec,
} from '../spec.js';
import {
  trunkRef,
} from '../trusted-policy.js';
import {
  readFileSync,
} from 'node:fs';
import {
  context,
  resourceAgent,
  withBoard,
} from '../cli.js';

/**
 * The hooks git runs. In a repo without pullboard.json they pass, so a stray hook never blocks.
 *
 * @param {any} io
 * @param {any} args
 * @returns {Promise<number>}
 */
export async function hookCommand(io, { first, second }) {
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
    const landing = hookRead(ctx, (board) => store.landingBatches(board).some((batch) => landingBatchOwnsRoot(batch, info.root)));
    if (landing) io.caller('coordinator', info.root);
    else if (agent) io.caller('seat', info.root);
    problems = preCommitProblems({ root: info.root, isMain: info.isMain || landing, config: ctx.config, agent, boardFile: ctx.file, preMergeHook: first === 'pre-merge-commit', onNotice: (message) => io.err(`pullboard pre-commit: warning: ${message}`) });
  } else if (first === 'commit-msg') {
    const message = readFileSync(second ?? '', 'utf8');
    const signoff = pendingCommitSignoffProblem(info.root, message);
    if (signoff) { io.err(signoff); return 1; }
    const spec = withRowDrafts(loadSpec(info.root, ctx.config), hookRead(ctx, (board) => store.rowDrafts(board)));
    commitCitationWarnings(message, { spec, doctrine: ctx.doctrine })
      .forEach((warning) => io.say(`pullboard commit-msg: warning: ${warning}`));
    const claimedItems = spec.rows.some(row => row.status === 'approved') ? [] : (hookRead(ctx, board => {
      const agent = store.agentAt(board, info.root);
      return agent ? store.listItems(board, { lane: agent.agent_lane }).filter(item =>
        item.item_status === 'claimed' && item.item_owner === agent.agent_id).map(item => item.item_id) : [];
    }) ?? []);
    problems = commitMsgProblems(message, { rules: ctx.config.commits, spec, doctrine: ctx.doctrine, claimedItems });
  } else if (first === 'pre-push') {
    const refsText = await readStdin(io.stdin);
    if (gitBoardDataPush(info.root, refsText)) {
      io.say('pre-push: validated append-only board data; no code refs are updated');
      return 0;
    }
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

/** Run `pullboard hook` and return its exit code. */
export async function run(io, args) {
  return await hookCommand(io, args);
}
