/** Browser-sealed person intent is CLI input, never an executable engine move [H12,H16]. */
import { moveArgs } from './api-moves.js';
import { Refused } from './refused.js';

export const PERSON_REQUEST_VERSION = 1;
const VERBS = Object.freeze(['add', 'shout', 'answer', 'hold', 'spec-approve', 'spec-decline', 'sentinel-approve', 'sentinel-decline', 'land-waive', 'signing', 'fact', 'spec-answer']);

/** Validate a narrow person intent while retaining literal arguments for the actual CLI parser. */
export function personRequestMove(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)
      || Object.keys(body).some(key => !['verb', 'item', 'args'].includes(key))
      || !VERBS.includes(body.verb)) {
    throw new Refused('BAD_REQUEST', 'a person request takes add, shout, answer, hold, spec-approve, spec-decline, sentinel-approve, sentinel-decline, land-waive signing, fact or spec-answer with item and args; use the view controls');
  }
  const move = structuredClone(body);
  move.args ??= {};
  if (typeof move.args !== 'object' || Array.isArray(move.args)) throw new Refused('BAD_REQUEST', 'args needs the move arguments as a JSON object; use the view controls');
  if (['answer', 'fact'].includes(move.verb)) {
    if (move.args.as !== undefined && move.args.as !== 'person') throw new Refused('B26_PERSON_ANSWER', 'the relay person answers as person; use the view to answer the decision');
    move.args.as = 'person';
  }
  // A passkey turns signing on or off; nothing else rides on this verb [E22].
  if (move.verb === 'signing' && !['on', 'off'].includes(move.args.signed)) throw new Refused('BAD_REQUEST', 'signing takes args.signed "on" or "off"; use the view controls');
  moveArgs(move);
  return move;
}

/**
 * Create the distinct versioned request document before the browser seals it for request-kind AAD. A row decision on
 * a board that signs person moves also carries `rows`, the exact text of each row as the person saw it [E22].
 */
export function preparePersonRequest(body, id = crypto.randomUUID(), rows) {
  const document = { version: PERSON_REQUEST_VERSION, type: 'person-request', id, move: personRequestMove(body), ...(rows ? { rows } : {}) };
  return validatePersonRequest(document);
}

/** Keep shown rows to bounded `{id, text}` pairs, one per decided row. */
function shownRows(rows) {
  if (!Array.isArray(rows) || !rows.length || rows.length > 200 || rows.some((row) => !row || typeof row !== 'object' || Object.keys(row).some(key => !['id', 'text', 'source'].includes(key))
      || typeof row.id !== 'string' || !/^(?:doctrine:)?[A-Za-z][A-Za-z0-9._-]{0,79}$/u.test(row.id) || typeof row.text !== 'string' || row.text.length > 8000 || row.source !== undefined && (typeof row.source !== 'string' || row.source.length > 16000 || /[\r\n\0]/u.test(row.source)))) {
    throw new Refused('BAD_REQUEST', 'a signed row decision names each row it shows with its id and exact text; reload the paired view and retry');
  }
  return rows.map(({ id, text, source }) => ({ id, text, ...(source === undefined ? {} : { source }) }));
}

/** Refuse malformed or newer request formats before any CLI can interpret their intent. */
export function validatePersonRequest(document) {
  if (document?.version !== PERSON_REQUEST_VERSION || document?.type !== 'person-request') {
    throw new Refused('PERSON_REQUEST_VERSION', 'this person request format is unsupported; upgrade Pullboard on the browser and linked machine');
  }
  if (typeof document.id !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/u.test(document.id)
      || Object.keys(document).some(key => !['version', 'type', 'id', 'move', 'rows'].includes(key))) {
    throw new Refused('BAD_REQUEST', 'a sealed person request needs its stable id and literal move; reload the paired view and retry');
  }
  const move = personRequestMove(document.move);
  if (document.rows !== undefined && !['spec-approve', 'spec-decline', 'spec-answer'].includes(move.verb)) throw new Refused('BAD_REQUEST', 'only a row decision carries the rows it shows');
  return { version: PERSON_REQUEST_VERSION, type: 'person-request', id: document.id, move, ...(document.rows === undefined ? {} : { rows: shownRows(document.rows) }) };
}
