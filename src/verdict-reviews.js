/** Sealed review validation and immutable acceptance projections [E8,H16]. */
import { verdictWithdrawals } from './verdict-withdrawal.js';
import { Refused } from './refused.js';

/** Validate a sealed review without consulting Git or changing either replica [E8,H16]. */
export function verdictReviewProblem(review, commit, { checked } = {}) {
  const valid = review && typeof review === 'object' && !Array.isArray(review)
    && Object.keys(review).sort().join(',') === (checked === false ? 'commit,paths,trunk' : checked === true || Object.hasOwn(review, 'head') ? 'commit,head,paths,trunk' : 'commit,paths,trunk')
    && (!checked || Object.hasOwn(review, 'head'))
    && (!Object.hasOwn(review, 'head') || /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(review.head ?? ''))
    && review.commit === commit && /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(review.commit ?? '')
    && /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(review.trunk ?? '')
    && Array.isArray(review.paths) && review.paths.every(path => typeof path === 'string' && !path.includes('\0')
      && path.split('/').every(part => part && part !== '.' && part !== '..'))
    && JSON.stringify(review.paths) === JSON.stringify([...new Set(review.paths)].sort());
  return valid ? null : new Refused('BAD_VERDICT_REVIEW', checked ? 'the review must bind the current submitted commit, its checked commit, reviewed trunk and sorted unique candidate paths; use current Pullboard to review it again' : 'the review must bind the current submitted commit, its reviewed trunk and sorted unique candidate paths; use current Pullboard to review it again');
}

/**
 * Every verdict on an item, oldest first.
 *
 * @param {any} board
 * @param {number} id
 * @returns {any[]}
 */
export function verdictsFor(board, id) {
  const verdicts = board.db.prepare('SELECT * FROM verdict WHERE item_id = ? ORDER BY verdict_id').all(id);
  const receipts = board.db.prepare("SELECT event_kind, event_detail FROM event WHERE item_id = ? AND event_kind IN ('accept', 'reject') ORDER BY event_id").all(id);
  const withdrawals = verdictWithdrawals(board, id);
  return verdicts.map((verdict, index) => {
    let detail = {};
    try { detail = JSON.parse(receipts[index]?.event_detail ?? '{}'); } catch { /* Malformed legacy details remain unknown. */ }
    return { ...verdict, ...(withdrawals.has(verdict.verdict_id) ? { withdrawn: true, withdrawal: withdrawals.get(verdict.verdict_id) } : {}), assurance: verdictAssurance(board, verdict), check: detail.check ?? 'unknown', ...(detail.review ? { review: detail.review } : {}),
      ...(Object.hasOwn(detail, 'environment') ? { environment: detail.environment } : {}) };
  });
}

/** The latest matching acceptance; the submission stays immutable through later re-reviews. */
export function acceptedVerdict(board, item) {
  const latest = verdictsFor(board, item.item_id).findLast(verdict =>
    verdict.verdict_decision === 'ACCEPT' && verdict.verdict_commit === item.item_commit);
  return latest?.withdrawn ? undefined : latest;
}

/** The exact checked composition for a new acceptance, or the historical submitted candidate. */
export function checkedLandingCommit(board, item) {
  return acceptedVerdict(board, item)?.review?.head ?? item.item_commit;
}

/** Old verdicts without an assurance record never acquire independent status from later seat enrollment. */
export function verdictAssurance(board, verdict) {
  return board.db.prepare('SELECT meta_value FROM board_meta WHERE meta_key = ?')
    .get(`verdict_assurance:${verdict.verdict_id}`)?.meta_value === 'independent' ? 'independent' : 'procedural';
}
