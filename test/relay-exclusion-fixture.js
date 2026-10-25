/** Real CLI and loopback relay controls preserve person opt-out and deleted-copy recovery [H5,H17,B26]. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ENGINE_VERSION } from '../src/engine-metadata.js';
import { relayClientFixture } from './relay-client-fixture.js';
import { fetchFresh } from './http-fixture.js';

/** Read only this fixture's private local machine settings. */
function machine(box) {
  return JSON.parse(readFileSync(join(box.env.PULLBOARD_HOME, 'relay-machine/state.json'), 'utf8'));
}

/** A real person deletes a remote copy; ordinary recovery must retain local history and request new authority. */
export async function deletedCopyRelinks(t) {
  const box = await relayClientFixture(t);
  await box.link();
  const old = JSON.parse(readFileSync(box.linkFile, 'utf8'));
  const before = (await box.cli('export')).document.tables;
  const phone = await box.phoneSession();
  const removed = await fetchFresh(`${box.origin}/api/v1/boards/${old.board}`, {
    method: 'DELETE', headers: { authorization: `Bearer ${phone.token}`, 'x-pullboard-engine': String(ENGINE_VERSION) },
  });
  assert.equal(removed.status, 200, 'the person genuinely removes the remote copy');
  const detected = await box.cli('relay', 'status');
  assert.equal(detected.code, 0);
  assert.equal(machine(box).excluded.includes(box.root), false, 'a deleted copy never creates a durable person exclusion');
  const stale = await fetchFresh(`${box.origin}/api/v1/boards/${old.board}/state`, {
    headers: { authorization: `Bearer ${old.token}`, 'x-pullboard-engine': String(ENGINE_VERSION) },
  });
  assert.equal(stale.status, 410, 'deleted credentials remain tombstoned and cannot recreate their board');
  const linked = await box.cli('relay', 'on', '--url', box.origin);
  assert.equal(linked.code, 0, 'the existing genuine sign-in flow grants the replacement link');
  const fresh = JSON.parse(readFileSync(box.linkFile, 'utf8'));
  assert.notEqual(fresh.board, old.board, 'the deleted remote epoch is replaced rather than resurrected');
  assert.notEqual(fresh.token, old.token, 'recovery obtains newly authorized machine credentials');
  const state = await fetchFresh(`${box.origin}/api/v1/boards/${fresh.board}/state`, {
    headers: { authorization: `Bearer ${fresh.token}`, 'x-pullboard-engine': String(ENGINE_VERSION) },
  });
  assert.equal(state.status, 200, 'the fresh link actually uploads a relay snapshot');
  assert.ok((await state.json()).state.sealed.length > 0, 'the replacement stores sealed state');
  const after = (await box.cli('export')).document.tables;
  assert.deepEqual(after.item, before.item, 'the native items survive recovery');
  assert.deepEqual(after.event.slice(0, before.event.length), before.event, 'the complete existing native event prefix survives');
  assert.equal(machine(box).excluded.includes(box.root), false);
}

/** A real person exclusion is visible and an explicit successful sign-in clears it with an explanation. */
export async function relayOnClearsExclusion(t) {
  const box = await relayClientFixture(t);
  await box.link();
  assert.equal((await box.cli('relay', 'off')).code, 0);
  assert.equal(machine(box).excluded.includes(box.root), true, 'the person may persist an opt-out');
  const status = await box.cli('status');
  assert.equal(status.code, 0);
  assert.equal(status.document.relay.excluded, true, 'normal status makes the durable opt-out visible');
  assert.equal(status.document.relay.exclusion.reason, 'person relay off');
  assert.ok(Number.isFinite(Date.parse(status.document.relay.exclusion.at)), 'new exclusions retain their actual time');
  assert.match(status.document.relay.exclusion.next, /pullboard relay on/u);
  const linked = await box.cli('relay', 'on', '--url', box.origin);
  assert.equal(linked.code, 0);
  assert.match(linked.document.notice, /exclusion.*clear|clear.*exclusion/iu, 'successful explicit on names the cleared exclusion');
  assert.equal(machine(box).excluded.includes(box.root), false);
  assert.equal((await box.cli('status')).document.relay.excluded, undefined, 'a cleared exclusion is no longer reported');
}
