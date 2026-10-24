/** Read-only validation of optional row approvals, without importing the mutable board or CLI graph [E22,H16]. */
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { parseSpec } from './spec.js';
import { answerQuestion } from './blueprints.js';
import {
  presenceSigned,
  validPresence,
} from './person-presence.js';
import { rowDecisionReplacement } from './row-decision-text.js';

/** Keep the original signed request's complete row effect, including source fields and optional signer boundaries. */
export function signedRowDecisionsMatch(request, rows) {
  try {
    const document = JSON.parse(request.encoded);
    const { verb, args } = document.move;
    if (!['spec-approve', 'spec-decline', 'spec-answer'].includes(verb) || args.by !== undefined && args.by !== 'person') return false;
    const ids = verb === 'spec-answer' ? [args.row] : args.ids.split(/[\s,]+/u).filter(Boolean);
    if (!Array.isArray(rows) || rows.length !== ids.length || !Array.isArray(document.rows) || document.rows.length !== ids.length) return false;
    return rows.every((row, index) => {
      const id = ids[index];
      const shown = document.rows.find(entry => entry.id === id);
      const original = parseSpec(`## Decision\n${row.source}\n`).rows[0];
      const kindId = row.kind === 'doctrine' ? `doctrine:${row.id}` : row.id;
      const decision = verb === 'spec-decline' ? 'decline' : 'approve';
      const text = verb === 'spec-answer' ? answerQuestion(shown.text, args.answer, args.row).text
        : args.text === undefined ? shown.text : args.text.trim();
      return shown && original && kindId === id && original.id === row.id && original.text === shown.text && !original.signers?.length
        && row.decision === decision && row.text === text && row.by === 'person' && row.signature === undefined
        && row.reason === (decision === 'decline' ? args.reason.trim() : '') && row.passkeyRequest === request.id
        && row.replacement === rowDecisionReplacement(row.source, decision, text);
    });
  } catch { return false; }
}

/** Ignore mutable local projection fields while keeping all original decision fields exact. */
function decisionBody({ event, at, applied, appliedAt, ...value }) { return value; }

/** Verify a decision from its immutable signed intent and exact committed result; a local marker alone grants nothing. */
export function verifiedPasskeyRowDecision(board, decision) {
  try {
    if (typeof decision.passkeyRequest !== 'string' || decision.by !== 'person' || decision.signature !== undefined) return false;
    const read = key => board.db.prepare('SELECT meta_value FROM board_meta WHERE meta_key=?').get(key)?.meta_value;
    const request = JSON.parse(read('relay_person_requests') ?? '[]').find(record => record.id === decision.passkeyRequest && !record.duplicateOf);
    if (!request || !Number.isSafeInteger(request.resultSequence) || request.resultSequence < 1) return false;
    const source = JSON.parse(request.received);
    const stamp = source.sender?.presence;
    const pin = JSON.parse(read('person_authority_local') ?? 'null');
    if (source.sender?.kind !== 'person' || typeof source.sender.userId !== 'string' || !source.sender.userId
      || JSON.stringify(source.document) !== request.encoded || JSON.stringify(source.document.move) !== JSON.stringify(request.move)
      || stamp?.board !== read('board_id') || stamp?.request !== request.id
      || stamp?.digest !== createHash('sha256').update(request.encoded).digest('hex')
      || !validPresence(stamp) || !pin || !presenceSigned(stamp, pin.publicKey) || !signedRowDecisionsMatch(request, request.result)) return false;
    return request.result.some(record => record.event === decision.event && isDeepStrictEqual(decisionBody(record), decisionBody(decision)));
  } catch { return false; }
}
