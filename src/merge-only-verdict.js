/** Immutable acceptance provenance for a narrowly proved trunk merge [V1,V4,H16]. */
import { Refused } from './refused.js';
import { acceptedVerdict } from './verdict-reviews.js';

const SHA = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;

/** Find only the latest conflict return and the exact unwithdrawn verdict it superseded. */
export function mergeOnlyBasis(board, item) {
  const last = board.db.prepare("SELECT event_id, event_kind, event_detail FROM event WHERE item_id = ? AND event_kind IN ('reopen','accept','reject','refreeze','merge-only-accept') ORDER BY event_id DESC LIMIT 1").get(item.item_id);
  if (last?.event_kind !== 'reopen') return null;
  const returned = JSON.parse(last.event_detail);
  if (!returned.conflict || !Number.isSafeInteger(returned.supersedes)) return null;
  const accepted = board.db.prepare("SELECT event_detail FROM event WHERE event_id = ? AND item_id = ? AND event_kind IN ('accept','merge-only-accept')").get(returned.supersedes, item.item_id);
  if (!accepted) return null;
  const detail = JSON.parse(accepted.event_detail);
  const verdict = acceptedVerdict(board, { ...item, item_commit: returned.commit });
  if (!verdict || verdict.verdict_digest !== item.item_frozen_digest || detail.commit !== returned.commit || item.item_commit !== returned.commit) return null;
  return { acceptedCommit: returned.commit, acceptedHead: verdict.review?.head ?? returned.commit,
    digest: item.item_frozen_digest, verdict: verdict.verdict_id, by: verdict.verdict_by,
    reopen: last.event_id, conflict: returned.conflict, review: verdict.review ?? null };
}

/** Validate sealed source facts against native history without consulting replica-local Git. */
export function mergeOnlyProblem(board, item, proof, { commit, tree, policyCommit }) {
  const basis = mergeOnlyBasis(board, item);
  const valid = basis && proof && proof.version === 1 && proof.reopen === basis.reopen
    && proof.verdict === basis.verdict && proof.acceptedCommit === basis.acceptedCommit
    && proof.acceptedHead === basis.acceptedHead && proof.digest === basis.digest
    && proof.commit === commit && proof.tree === tree && proof.trunk === policyCommit
    && ['acceptedCommit','acceptedHead','acceptedTree','commit','tree','trunk','mergeTree'].every(key => SHA.test(proof[key] ?? ''))
    && Array.isArray(proof.paths) && proof.paths.every(path => typeof path === 'string' && path && !path.includes('\0'))
    && JSON.stringify(proof.paths) === JSON.stringify([...new Set(proof.paths)].sort())
    && typeof proof.resolutionDiff === 'string' && proof.resolutionDiff.length <= 1024 * 1024;
  return valid ? null : new Refused('MERGE_ONLY_PROOF', 'the carried acceptance must name the current conflict return, immutable verdict, unchanged frozen bar and exact gated merge; submit normally for outside review');
}
