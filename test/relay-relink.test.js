/** Explicit relinking creates a new sealed epoch without accepting the forgotten key [H15,H17]. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { decodeBoardKey, seal, unseal } from '../src/seal.js';
import { relayClientFixture } from './relay-client-fixture.js';

test('a relink after relay off seals moves with the new key [H15,H17]', async t => {
  const box = await relayClientFixture(t);
  await box.link();
  const oldLink = JSON.parse(readFileSync(box.linkFile, 'utf8'));
  const oldKey = decodeBoardKey(readFileSync(box.keyFile, 'utf8').trim());
  assert.equal((await box.cli('shout', 'all', 'before explicit unlink')).code, 0);
  const beforeOff = (await box.cli('export')).document;
  assert.equal((await box.cli('relay', 'off')).code, 0);
  assert.deepEqual((await box.cli('export')).document.tables, beforeOff.tables,
    'local unlink does not rewrite native history or board identity');
  assert.equal((await box.cli('relay', 'on', '--url', box.origin)).code, 0);
  const linked = JSON.parse(readFileSync(box.linkFile, 'utf8'));
  assert.notEqual(linked.board, oldLink.board, 'forgetting the key requires a fresh remote board');
  const key = decodeBoardKey(readFileSync(join(box.env.PULLBOARD_HOME, 'relay-keys', linked.board + '.key'), 'utf8').trim());
  assert.equal((await box.cli('shout', 'all', 'after explicit relink')).code, 0);
  const move = box.moveAcks.at(-1);
  const binding = { boardId: linked.board, kind: 'move', sequence: move.sequence };
  const opened = await unseal(key, Buffer.from(move.sealed, 'base64url'), binding);
  assert.equal(JSON.parse(new TextDecoder().decode(opened)).operation, 'shout');
  await assert.rejects(unseal(oldKey, Buffer.from(move.sealed, 'base64url'), binding), { code: 'SEAL_AUTH_FAILED' });
  const stale = await seal(oldKey, opened, binding);
  await assert.rejects(unseal(key, stale, binding), { code: 'SEAL_AUTH_FAILED' },
    'even with the new board and sequence binding, a move sealed with the forgotten key is refused');
  const exported = (await box.cli('export')).document;
  assert.ok(exported.tables.shout.some(row => row.shout_text === 'before explicit unlink'));
  assert.ok(exported.tables.shout.some(row => row.shout_text === 'after explicit relink'));
  const response = await fetch(box.origin + '/api/v1/boards/' + oldLink.board + '/state', {
    headers: { authorization: 'Bearer ' + (await box.phoneSession()).token },
  });
  assert.equal(response.status, 200, 'the old remote copy remains until the person deletes it');
});
