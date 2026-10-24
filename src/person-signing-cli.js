/**
 * The terminal side of signed person moves [E22,B26,H16]: the passkey step a person-only command takes, the
 * `pullboard settings person.signed` switch, and pinning the relay's stamp key from this board's own relay origin.
 */
import * as store from './board.js';
import {
  localAuthority,
  passkeyConfirmed,
  personSigning,
  pinAuthority,
  signedMoveProblem,
  signedRefusal,
} from './person-signing.js';
import { personAuthority } from './relay-sender.js';
import { preparePersonRequest } from './person-request.js';
import { personRequestRecords } from './relay-requests.js';
import { Refused } from './refused.js';
import { awaitPersonConfirmation } from './person-confirmation.js';
import { relayStatus } from './relay.js';
import { loadMachineSettings } from './settings.js';
import { repoInfo } from './git.js';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  actOn,
  ordered,
} from './cli.js';

const AUTHORITY_PATH = '/.well-known/pullboard-person-authority';

/**
 * Pin the relay's passkey stamp key for a linked board that has none yet, read from the board's own relay origin.
 * A relay that cannot be reached leaves the board unpinned, and every passkey check then fails closed.
 *
 * @param {string} root
 * @param {any} board
 * @param {{ err?: (line: string) => void }} [io]
 */
export async function pinRelayAuthority(root, board, io = {}) {
  if (localAuthority(board)) return localAuthority(board);
  const relay = relayStatus(root);
  if (!relay.linked || !relay.url) return null;
  const origin = new URL(relay.url).origin;
  let document;
  try {
    const response = await fetch(new URL(AUTHORITY_PATH, origin), { redirect: 'error', signal: AbortSignal.timeout(10_000) });
    document = await response.json();
    if (!response.ok) throw new Refused(document?.error?.code ?? 'PERSON_AUTHORITY', document?.error?.message ?? 'the relay refused');
  } catch (error) {
    io.err?.(`pullboard: [PERSON_AUTHORITY] could not read the passkey stamp key from ${origin} (${error.code ?? error.name ?? 'error'}); passkey-confirmed moves wait until it can`);
    return null;
  }
  return pinAuthority(board, origin, document.authority);
}

/**
 * The step a person-only command takes while signing is on. A command carrying out a passkey-confirmed request goes
 * ahead. Unpaired commands refuse at once with the pairing step. A linked command sends its exact supported move
 * to the passkey device and waits for one confirmation, reporting where; its caller then returns without a duplicate move.
 *
 * @returns {Promise<number | null>} Completed terminal exit code, or null when the original command may proceed.
 * @param {any} ctx
 * @param {any} board
 * @param {{ id: string }} me
 * @param {{ verb: string, item?: number, args: any } | null} intent - the request the passkey device shows, or null when it cannot carry this move
 */
export async function requireSignedPerson(ctx, board, me, intent, rows) {
  if (!personSigning(board).signed) return null;
  // A board that has not pinned its relay key yet cannot check a passkey stamp, including an off it replayed: pin first.
  if (!localAuthority(board) && await pinRelayAuthority(ctx.info.root, board, ctx.io) && !personSigning(board).signed) return null;
  if (ctx.io.personRequest) {
    if (passkeyConfirmed(board, ctx.io.personRequest)) return null;
    throw signedRefusal('this request reached the board without a passkey confirmation', 'send it again from the relay view and confirm it with your passkey');
  }
  const relay = relayStatus(ctx.info.root);
  if (!relay.linked) throw signedRefusal('no passkey device is paired with this board');
  const origin = new URL(relay.url).origin;
  const where = `${origin}/#board=${relay.board}`;
  let sent = '';
  if (intent && me.id !== store.PERSON) {
    const request = preparePersonRequest(intent, undefined, rows);
    try {
      await ordered(ctx, board, 'proposePersonMove', [{ agentId: me.id, request }]);
      sent = 'proposed';
    } catch (error) {
      if (!(error instanceof Refused)) throw error;
      sent = `; the request did not reach the relay (${error.code}), so start it there`;
    }
    if (sent === 'proposed') return awaitPersonConfirmation(ctx, board, request, where);
  }
  throw signedRefusal(`confirm it on your passkey${sent}`,
    `confirm it with your passkey at ${where} (Face ID, Touch ID or a key touch); keep the initiating terminal open while confirming. No passkey there yet? Add one on that page, or pair a new device with pullboard relay on --all`);
}

/**
 * Refuse, before ordering it, a person-only move that no passkey confirmed while the board signs person moves. Every
 * command's move passes here, so a person move a command does not ask about itself is still refused.
 *
 * @param {any} board
 * @param {string} operation
 * @param {any[]} args
 * @param {any} personRequest - the request the command carries out, if any
 */
export function refuseUnsignedMove(board, operation, args, personRequest) {
  const unsigned = signedMoveProblem(board, personAuthority({ operation, args }), personRequest, { strict: true });
  if (unsigned) throw unsigned;
}

/**
 * Whether the board of the checkout at `cwd` signs person moves, read without opening it for writing. Why the CLI
 * asks before parsing a person command: with signing on, a person move from any shell, SSH included, takes the
 * passkey step, so the shell-marker check that would otherwise stop it first gives way to that step.
 *
 * @param {string} cwd
 * @returns {boolean}
 */
export function signsPersonMoves(cwd) {
  let file;
  try { file = join(repoInfo(cwd).commonDir, 'pullboard', 'board.sqlite'); }
  catch { return false; } // Outside a repository there is no board to sign for; the usual checks apply.
  if (!existsSync(file)) return false;
  let db;
  try { db = store.openBoardReadOnly(file); return personSigning({ db }).signed; }
  catch { return false; } // An unreadable board keeps the stricter shell checks; the command then reports why it cannot open.
  finally { db?.close(); }
}

export { signingLine } from './person-signing-words.js';
import { signingLine } from './person-signing-words.js';

/**
 * `pullboard settings person.signed on|off`. Anyone may turn signing on; off is a person move, so with signing on it
 * takes the passkey step like every other.
 */
export function signingSetting(io, value) {
  if (!['on', 'off'].includes(value)) throw new Refused('USAGE', 'pullboard settings person.signed on|off');
  return actOn(io, async (ctx, board, me) => {
    const signed = value === 'on';
    if (personSigning(board).signed === signed) {
      io.result?.({ settings: loadMachineSettings(), person: { signed } });
      io.say(`person moves are already ${signed ? '' : 'not '}signed`);
      return 0;
    }
    if (!signed) {
      const confirmed = await requireSignedPerson(ctx, board, me, { verb: 'signing', args: { signed: value } });
      if (confirmed !== null) return confirmed;
    }
    else await pinRelayAuthority(ctx.info.root, board, io);
    await ordered(ctx, board, 'setPersonSigning', [signed ? { agentId: ctx.io.personRequest ? store.PERSON : me.id, signed }
      : { agentId: store.PERSON, signed, request: ctx.io.personRequest.id }]);
    io.result?.({ settings: loadMachineSettings(), person: { signed } });
    io.say(signingLine({ signed }));
    return 0;
  });
}

/**
 * Refuse a signed row decision on a row that names required SSH signers. Why by name: a passkey stands in for an
 * optional SSH sign-off, but a row that names its signers asked for those people's keys, and no passkey identity can
 * say which person it is yet.
 *
 * @param {{ id: string, signers?: string[] }[]} rows - the spec rows, and doctrine rows as `doctrine:<id>`
 * @param {string[]} ids - the rows being decided
 */
export function refuseNamedSigners(rows, ids) {
  const named = ids.map((id) => rows.find((row) => row.id === id)).filter((row) => row?.signers?.length);
  if (!named.length) return;
  throw new Refused('PERSON_SIGNER_REQUIRED', `${named.map((row) => `${row.id} names its SSH signers ${row.signers.join(', ')}`).join('; ')}, and a passkey cannot sign as a named signer yet`,
    'decide the other rows with your passkey; a row that names SSH signers waits until passkeys carry a signer identity, or until signing is off');
}

/**
 * Refuse a signed row decision unless the passkey-confirmed request names every decided row with the exact text the
 * person saw, and that text is still the row's. Why: the passkey confirms what was on the screen, so a row edited
 * after it was shown needs to be shown and decided again.
 *
 * @param {any} board
 * @param {any} personRequest - the request this command carries out
 * @param {{ id: string, text: string }[]} rows - the spec rows, and doctrine rows as `doctrine:<id>`
 * @param {string[]} ids - the rows being decided
 */
export function requireShownRows(board, personRequest, rows, ids, sources = []) {
  const record = personRequestRecords(board).find((entry) => entry.id === personRequest?.id && !entry.duplicateOf);
  const shown = record ? JSON.parse(record.encoded).rows : undefined;
  const changed = ids.filter((id) => !Array.isArray(shown) || shown.find((row) => row.id === id)?.text !== rows.find((row) => row.id === id)?.text
    || typeof shown.find(row => row.id === id)?.source !== 'string' || shown.find(row => row.id === id)?.source !== sources.find(row => row.id === id)?.source);
  if (changed.length) {
    throw new Refused('STALE_ROW_DECISION', `${changed.join(', ')} changed after the person saw ${changed.length === 1 ? 'it' : 'them'}, or the passkey request did not show ${changed.length === 1 ? 'it' : 'them'}`,
      'read the rows again in the relay view and decide them again with your passkey');
  }
}
