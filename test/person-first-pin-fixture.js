/** Initial unpaired authority insertion uses only an owned private board, never shared SQLite [E22,B26,H16]. */
import assert from 'node:assert/strict';
import {
  createHash,
  generateKeyPairSync,
  randomUUID,
  sign,
} from 'node:crypto';
import {
  mkdtempSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as store from '../src/board.js';
import { presenceAttestation } from '../src/person-presence.js';

/** A local first-row insertion cannot supply the missing person/relay trust anchor on an unpaired signed board. */
export function firstUnpairedAuthorityInsertion(t) {
  const directory = mkdtempSync(join(tmpdir(), 'pullboard-person-first-pin-'));
  const board = store.openBoard(join(directory, 'board.sqlite'));
  t.after(() => { store.closeBoard(board); rmSync(directory, { recursive: true, force: true }); });
  const boardId = board.db.prepare("SELECT meta_value FROM board_meta WHERE meta_key='board_id'").get().meta_value;
  store.setPersonSigning(board, { agentId: 'coordinator', signed: true });
  assert.equal(board.db.prepare("SELECT meta_value FROM board_meta WHERE meta_key='person_authority_local'").get(), undefined,
    'the board has never pinned an authority or paired a phone');
  assert.equal(board.db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'person_authority_%'").all().length, 0,
    'no legitimate first-pin triggers exist; this control never drops or alters a trigger');
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const request = randomUUID();
  const intent = { version: 1, type: 'person-request', id: request, move: { verb: 'signing', args: { signed: 'off' } } };
  const presence = { board: boardId, request, digest: createHash('sha256').update(JSON.stringify(intent)).digest('hex'),
    credential: 'local-forged-credential', at: Date.now() };
  presence.signature = sign(null, presenceAttestation(presence), privateKey).toString('base64url');
  // The forged off is exact and correctly signed by an unrelated local key; it is not a relay/person attestation.
  board.db.prepare('INSERT INTO event(event_at,event_by,event_kind,item_id,event_detail) VALUES (?,?,?,?,?)')
    .run(new Date().toISOString(), 'person', 'person_signing', null, JSON.stringify({ signed: false, request, presence, intent }));
  assert.equal(store.personSigning(board).signed, true, 'without an authenticated authority the forged off is ignored');
  board.db.prepare('INSERT INTO board_meta(meta_key,meta_value) VALUES (?,?)').run('person_authority_local', JSON.stringify({
    origin: 'https://unrelated-fixture.invalid', publicKey: publicKey.export({ format: 'der', type: 'spki' }).toString('base64url'),
  }));
  assert.equal(store.personSigning(board).signed, true,
    'an initial raw local authority row cannot turn signing off on an unpaired board');
}
