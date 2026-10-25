/** Canonical bilateral consent and disclosure are independent of transport and key storage [E32,H17]. */
import { Refused } from './refused.js';
import { boardReference } from './board-reference.js';
import { boardReferenceId } from './board-reference.js';

const MODES = ['states', 'counts', 'nothing'];
const STATES = ['open', 'claimed', 'submitted', 'verified', 'withdrawn'];

/** Reject a malformed link rather than normalizing away signed fields. */
export function boardLinkFormat(message) { throw new Refused('BOARD_LINK_FORMAT', `${message}; use the exact version 1 board-link contract`); }

/** Require a bounded correlation or link identifier that cannot become a path. */
export function boardLinkName(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(value)) boardLinkFormat('Use a bounded link or correlation ID');
  return value;
}

/** Validate the signed body and retain its fixed field order for the existing signature path. */
export function boardLinkBody(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => !['version', 'linkId', 'parent', 'child', 'generation', 'disclosure', 'approvals', 'revocation'].includes(key))) boardLinkFormat('The link has unsupported fields');
  if (value.version !== 1 || !Number.isSafeInteger(value.generation) || value.generation < 1 || !MODES.includes(value.disclosure)) boardLinkFormat('Use a positive generation and a supported disclosure mode');
  const parent = boardReference(value.parent);
  const child = boardReference(value.child);
  if (parent.boardId === child.boardId) boardLinkFormat('A board cannot link to itself');
  return { version: 1, linkId: boardLinkName(value.linkId), parent, child, generation: value.generation, disclosure: value.disclosure };
}

/** Copy bounded public signature records before any asynchronous authority operation. */
function proof(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) boardLinkFormat('Use a signed board approval');
  const allowed = ['version', 'type', 'firstCommit', 'initialHash', 'id', 'file', 'kind', 'source', 'replacement',
    'text', 'decision', 'reason', 'commit', 'by', 'on', 'note', 'signature', 'boardId'];
  if (Object.keys(value).some(key => !allowed.includes(key))) boardLinkFormat('The approval has unsupported fields');
  let encoded;
  try { encoded = JSON.stringify(value); } catch { boardLinkFormat('Use a JSON signature record'); }
  if (typeof encoded !== 'string' || Buffer.byteLength(encoded) > 20000) boardLinkFormat('The approval exceeds its bound');
  const result = JSON.parse(encoded);
  boardReferenceId(result.boardId);
  return result;
}

/** Copy the complete document without accepting mutable caller-owned signature containers. */
export function boardLinkRecord(value) {
  const body = boardLinkBody(value);
  if (!Array.isArray(value.approvals) || value.approvals.length > 2 || value.revocation === undefined) boardLinkFormat('Include approvals and an explicit revocation field');
  const approvals = value.approvals.map(proof).sort((a, b) => a.boardId.localeCompare(b.boardId));
  if (new Set(approvals.map(row => row.boardId)).size !== approvals.length) boardLinkFormat('Each board approves at most once');
  const ends = [body.parent.boardId, body.child.boardId];
  if (approvals.some(row => !ends.includes(row.boardId))) boardLinkFormat('Only the two endpoint boards approve a link');
  return { ...body, approvals, revocation: value.revocation === null ? null : proof(value.revocation) };
}

/** Bind each side and each action as well as the exact document to the SSH signature. */
export function boardLinkSigningText(body, boardId, action) {
  if (!['approve', 'revoke'].includes(action)) boardLinkFormat('Use a link approval or revocation');
  const normalized = boardLinkBody(body);
  if (![normalized.parent.boardId, normalized.child.boardId].includes(boardReferenceId(boardId))) boardLinkFormat('The signer must be an endpoint board');
  return JSON.stringify(['pullboard-board-link', 1, normalized, boardId, action]);
}

/** Strip forbidden text before persistence or transmission; no caller field survives by default. */
export function discloseBoardState(mode, rows) {
  if (!MODES.includes(mode)) throw new Refused('BOARD_LINK_DISCLOSURE', 'use the link’s signed states, counts or nothing disclosure mode');
  if (!Array.isArray(rows) || rows.length > 10000) boardLinkFormat('Use a bounded item-state array');
  if (mode === 'nothing') return [];
  const selected = rows.map(row => {
    if (!row || !Number.isSafeInteger(row.id) || row.id < 1 || !STATES.includes(row.state)) boardLinkFormat('Use exact numeric item IDs and native item states');
    return { board: boardReferenceId(row.board), id: row.id, state: row.state };
  });
  const seen = new Set();
  for (const row of selected) {
    const key = `${row.board}:${row.id}`;
    if (seen.has(key)) boardLinkFormat('An item appears only once in a state announcement');
    seen.add(key);
  }
  if (mode === 'states') return selected;
  const counts = {};
  for (const row of selected) counts[row.state] = (counts[row.state] ?? 0) + 1;
  return counts;
}
