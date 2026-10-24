/** Publish only exact native independent review coverage, never a PR author's proof claims [B3,R3]. */
import * as store from './board.js';
import {
  git,
  tryGit,
} from './git.js';
import { Refused } from './refused.js';
import { outsideSource } from './outside-source.js';

export const PR_VERIFICATION_CONTEXT = 'pullboard/verified-by-second-agent';
const COMMIT = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;

/** Unknown historical provenance or a different criterion cannot become independent proof later. */
function itemReceipt(board, item) {
  if (item.item_status !== 'verified' || item.item_verdict !== 'ACCEPT') return null;
  const verdict = store.acceptedVerdict(board, item);
  const assurance = board.db.prepare('SELECT meta_value FROM board_meta WHERE meta_key=?')
    .get(`verdict_assurance:${verdict?.verdict_id}`)?.meta_value;
  if (!verdict || assurance !== 'independent' || verdict.check !== 'green'
      || verdict.verdict_digest !== item.item_frozen_digest || verdict.verdict_by === item.item_built_by
      || verdict.review?.commit !== item.item_commit || !COMMIT.test(verdict.review?.head ?? '')
      || !verdict.environment || ['platform', 'arch', 'node'].some(key => typeof verdict.environment[key] !== 'string' || !verdict.environment[key])) return null;
  return { item: item.item_id, commit: item.item_commit, reviewer: verdict.verdict_by,
    verdict: verdict.verdict_id, assurance, checked: verdict.review.head };
}

/** Only one unambiguous Git trailer can identify an item; prose and PR descriptions are not authority. */
function trailerItem(root, commit, key) {
  const values = git(root, ['show', '-s', `--format=%(trailers:key=${key},valueonly)`, commit]).split('\n').filter(Boolean);
  const match = values.length === 1 && /^#([1-9][0-9]*)$/u.exec(values[0]);
  return match && Number.isSafeInteger(Number(match[1])) ? Number(match[1]) : null;
}

/** Resolve actual board-recorded landings, and companions only on the coordinator's trusted source history. */
function coverage(root, board, commits, trustedHead) {
  const items = store.listItems(board, { all: true });
  const receipts = new Map(items.map(item => [item.item_id, itemReceipt(board, item)]).filter(([, receipt]) => receipt));
  const recordedTrunks = [...items.map(item => item.item_merged_commit),
    ...store.landingBatches(board).filter(batch => ['trunk', 'landed', 'pushed'].includes(batch.state)).map(batch => batch.tip)]
    .filter(commit => COMMIT.test(commit ?? '') && tryGit(root, ['merge-base', '--is-ancestor', commit, trustedHead]).status === 0);
  const covered = new Map([...receipts.values()].map(receipt => [receipt.commit, receipt]));
  for (const item of items) {
    const commit = item.item_merged_commit;
    const receipt = receipts.get(item.item_id);
    if (receipt && COMMIT.test(commit ?? '') && recordedTrunks.includes(commit)
        && trailerItem(root, commit, 'Pullboard-Item') === item.item_id
        && git(root, ['show', '-s', '--format=%P', commit]).split(' ').length > 1
        && tryGit(root, ['merge-base', '--is-ancestor', receipt.commit, commit]).status === 0) {
      for (const introduced of git(root, ['rev-list', `${commit}^1..${commit}`]).split('\n').filter(Boolean)) covered.set(introduced, receipt);
    }
  }
  for (const commit of commits) {
    const companion = receipts.get(trailerItem(root, commit, 'Pullboard-Companion'));
    const companionItem = companion && items.find(item => item.item_id === companion.item);
    if (companion && COMMIT.test(companionItem.item_merged_commit ?? '') && recordedTrunks.some(trunk =>
      tryGit(root, ['merge-base', '--is-ancestor', commit, trunk]).status === 0
      && tryGit(root, ['merge-base', '--is-ancestor', companionItem.item_merged_commit, trunk]).status === 0)) covered.set(commit, companion);
  }
  return covered;
}

/** A missing or procedural receipt explains a red status without exporting private notes or machine paths. */
function unverifiedReason(board, commits) {
  for (const item of store.listItems(board, { all: true }).filter(item => commits.includes(item.item_commit))) {
    const verdict = store.acceptedVerdict(board, item);
    const assurance = verdict && board.db.prepare('SELECT meta_value FROM board_meta WHERE meta_key=?')
      .get(`verdict_assurance:${verdict.verdict_id}`)?.meta_value;
    if (verdict && assurance !== 'independent') return "second agent's independence is unproven (" + (assurance ?? 'unknown') + ')';
  }
  return 'one or more commits lack an exact independent green receipt';
}

/** Check the complete provider range against Git objects and immutable native receipts, not merely its head. */
export function pullRequestVerification({ root, board, client, pull, proposal, repository, trustedHead }) {
  const head = pull.head?.sha;
  const outside = store.listItems(board, { all: true }).find(item => {
    const source = outsideSource(board, item.item_id);
    return source?.repository === repository && source.kind === 'pull-request' && source.number === pull.number && source.commit === head;
  });
  const knownProposal = proposal && proposal.head === head;
  if (!knownProposal && !outside) return { state: 'failure', description: 'not verified: outside pull request; use pullboard intake', assurance: 'unknown', receipts: [] };
  if (!COMMIT.test(head ?? '') || !COMMIT.test(pull.base?.sha ?? '')) {
    return { state: 'failure', description: 'not verified: exact pull request range is unavailable', assurance: 'unknown', receipts: [] };
  }
  // GitHub's PR-commits endpoint stops at 250; a larger open range is read from exact local Git objects.
  const rows = pull.commits <= 250 ? client.commits(pull.number) : null;
  const range = rows ? null : tryGit(root, ['rev-list', `${pull.base.sha}..${head}`]);
  const commits = rows ? rows.map(row => row.sha) : range.status === 0 ? range.stdout.trim().split('\n').filter(Boolean) : [];
  if (!Number.isSafeInteger(pull.commits) || pull.commits < 1 || commits.length !== pull.commits
      || commits.some(commit => !COMMIT.test(commit ?? '')) || new Set(commits).size !== commits.length
      || !commits.includes(head) || commits.some(commit => tryGit(root, ['merge-base', '--is-ancestor', commit, head]).status !== 0)) {
    return { state: 'failure', description: 'not verified: complete exact commit range is unavailable', assurance: 'unknown', receipts: [] };
  }
  const covered = coverage(root, board, commits, trustedHead);
  const missing = commits.filter(commit => !covered.has(commit));
  if (missing.length) return { state: 'failure', description: 'not verified: ' + unverifiedReason(board, missing), assurance: 'unproven', receipts: [], unverified: missing };
  const receipts = [...new Map(commits.map(commit => { const receipt = covered.get(commit); return [receipt.verdict, receipt]; })).values()];
  return { state: 'success', description: 'verified by a second agent (independent)', assurance: 'independent', receipts };
}

/** Reconcile open PRs, including outside contributions, without posting comments or merging anyone's work. */
export function publishVerificationStatuses({ root, board, client, state, repository, trustedHead }) {
  const numbers = [...new Set([...client.open().map(pull => pull.number),
    ...state.proposals.filter(proposal => proposal.repository === repository).map(proposal => proposal.number)])];
  const results = numbers.map(number => {
    if (!Number.isSafeInteger(number) || number < 1) throw new Refused('PUBLISH_GITHUB', 'the pull request lacks an exact provider identity; refresh it before publishing');
    const pull = client.read(number);
    if (pull.number !== number || !COMMIT.test(pull.head?.sha ?? '')) throw new Refused('PUBLISH_GITHUB', 'the pull request lacks an exact head; refresh it before publishing');
    const proposal = state.proposals.find(entry => entry.repository === repository && entry.number === pull.number);
    const verification = pullRequestVerification({ root, board, client, pull, proposal, repository, trustedHead });
    return { number: pull.number, head: pull.head.sha, ...verification,
      ...(proposal ? {} : { intake: `pullboard intake https://github.com/${repository}/pull/${pull.number} --criterion "behavior" --check "command"` }) };
  });
  // GitHub statuses belong to a commit, not a PR: an outside PR sharing a head must never borrow green.
  for (const head of new Set(results.map(result => result.head))) {
    const sharing = results.filter(result => result.head === head);
    const red = sharing.find(result => result.state !== 'success');
    const status = { state: red ? 'failure' : 'success', context: PR_VERIFICATION_CONTEXT,
      description: red?.description ?? 'verified by a second agent (independent)' };
    const old = client.statuses(head).find(entry => entry.context === status.context);
    if (!old || old.state !== status.state || old.description !== status.description) client.setStatus(head, status);
    for (const result of sharing) { result.statusState = status.state; result.statusDescription = status.description; }
  }
  return results;
}
