/** @pullboard-test-loads src/board.js src/claims.js src/config.js src/machine.js src/engine.js */
/** Reopened claims reserve the original builder's context only when enabled [B13,B5]. */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import * as store from '../src/board.js';
import { submitFixture } from './board-submit-fixture.js';
import { configFromSource, defaults } from '../src/config.js';
import { prepareEngineMove, applyEngineMove } from '../src/engine.js';
import { exportBoard, importBoard } from '../src/exchange.js';

const COMMIT = 'a'.repeat(40);
const TRUNK = 'b'.repeat(40);
/** Open a real SQLite board with a clock advanced independently of the host. */
function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'pullboard-reopen-'));
  let at = Date.parse('2026-01-01T00:00:00Z');
  const board = store.openBoard(join(directory, 'board.sqlite'), { now: () => new Date(at) });
  t.after(() => { store.closeBoard(board); rmSync(directory, { recursive: true, force: true }); });
  store.register(board, { lane: 'coordinator', path: '/repo' });
  const builder = store.register(board, { lane: 'core', path: '/builder', route: 'mid' });
  const other = store.register(board, { lane: 'core', path: '/other', route: 'mid' });
  return { board, directory, builder, other, advance: (minutes) => { at += minutes * 60_000; } };
}
/** Claim the item with a frozen bar and a bounded lease. */
function claim(f, id, agentId) {
  return store.claim(f.board, id, { agentId, lane: 'core', leaseMs: 7_200_000,
    freeze: () => ({ text: JSON.stringify({ policy: { version: 1, commit: COMMIT, verify: { policy: 'any', family: 'off' } } }), digest: 'digest:bar' }) });
}
/** Submit and return an item through the real rejection, landing-failure or conflict path. */
function returned(f, cause, minutes, causeKey) {
  const id = store.addItem(f.board, { by: 'coordinator', lane: 'core', title: 'fix', criterion: 'prove', specIds: ['B13'], route: 'mid', check: 'true', brief: 'Files: src/a.js\nTest: proves the fix' });
  claim(f, id, f.builder);
  submitFixture(f.board, id, { agentId: f.builder, commit: COMMIT, tree: COMMIT });
  const verdict = { agentId: f.other, head: COMMIT, digest: 'digest:bar', policy: 'any', note: 'proof', ...(causeKey ? { cause: causeKey } : {}) };
  if (cause === 'reject') store.verify(f.board, id, { ...verdict, decision: 'REJECT', reason: 'OTHER', reopenFirstRefusalMinutes: minutes });
  else {
    store.verify(f.board, id, { ...verdict, decision: 'ACCEPT' });
    store.reopen(f.board, id, { agentId: 'coordinator', reopenFirstRefusalMinutes: minutes, ...(causeKey ? { cause: causeKey } : {}),
      ...(cause === 'conflict' ? { conflict: { files: ['src/a.js'], trunk: TRUNK } }
        : { note: `test/a.test.js: failed case; merge commit ${TRUNK}` }) });
  }
  return id;
}

test('[B13,B5] a reopened item waits for its builder first', (t) => {
  for (const cause of ['reject', 'landing', 'conflict']) {
    const f = fixture(t);
    const id = returned(f, cause, 30);
    const notices = store.inbox(f.board, f.builder).filter(row => row.shout_text.includes('waits for you'));
    assert.equal(notices.length, 1, cause);
    assert.equal(store.recentShouts(f.board).filter(row => row.shout_to === f.builder && row.shout_text.includes('waits for you')).length, 1);
    f.advance(5);
    assert.throws(() => claim(f, id, f.other), error => error.code === 'REOPEN_HELD_FOR_BUILDER'
      && error.message.includes(f.builder) && error.message.includes('2026-01-01T00:30:00.000Z'), cause);
    claim(f, id, f.builder);
    assert.equal(store.getItem(f.board, id).item_owner, f.builder);
    assert.equal(store.inbox(f.board, f.builder).filter(row => row.shout_text.includes('waits for you')).length, 0);
    assert.equal(store.recentShouts(f.board).filter(row => row.shout_to === f.builder && row.shout_text.includes('waits for you')).length, 1);
    f.advance(26);
    // A fresh return keeps the expiry proof independent of a builder's live lease.
    const fresh = fixture(t);
    const expired = returned(fresh, cause, 30);
    fresh.advance(31);
    claim(fresh, expired, fresh.other);
    assert.equal(store.getItem(fresh.board, expired).item_owner, fresh.other);
  }
});


test('[B13,B5] reopen first refusal is a default-off validated board setting', () => {
  assert.equal(defaults().claim.reopenFirstRefusalMinutes, 0);
  assert.equal(configFromSource('{}').claim.reopenFirstRefusalMinutes, 0);
  assert.equal(configFromSource('{"claim":{}}').claim.reopenFirstRefusalMinutes, 0);
  assert.equal(configFromSource('{"claim":{"reopenFirstRefusalMinutes":30}}').claim.reopenFirstRefusalMinutes, 30);
  for (const claim of [null, [], false, { reopenFirstRefusalMinutes: -1 }, { reopenFirstRefusalMinutes: 0.5 },
    { reopenFirstRefusalMinutes: '30' }, { reopenFirstRefusalMinutes: Number.MAX_SAFE_INTEGER }]) {
    assert.throws(() => configFromSource(JSON.stringify({ claim })), /claim.reopenFirstRefusalMinutes/);
  }
});

test('[B13,B5] first refusal ends on direct builder release, claimed release or exact expiry', (t) => {
  for (const cause of ['reject', 'landing', 'conflict']) {
    for (const mode of ['direct', 'claimed', 'expiry']) {
      const f = fixture(t);
      const id = returned(f, cause, 30);
      assert.throws(() => store.release(f.board, id, f.other), error => error.code === 'NOT_YOURS');
      f.advance(5);
      if (mode === 'expiry') f.advance(25);
      else {
        if (mode === 'claimed') claim(f, id, f.builder);
        store.release(f.board, id, f.builder);
      }
      claim(f, id, f.other);
      assert.equal(store.getItem(f.board, id).item_owner, f.other, `${cause}/${mode}`);
    }
  }
});

test('[B13,B5] omitted or zero first refusal keeps reopened claims unchanged', (t) => {
  for (const cause of ['reject', 'landing', 'conflict']) {
    for (const minutes of [undefined, 0]) {
      const f = fixture(t);
      const id = returned(f, cause, minutes);
      assert.equal(store.inbox(f.board, f.builder).filter(row => row.shout_text.includes('waits for you')).length, 0);
      f.advance(5);
      claim(f, id, f.other);
      assert.equal(store.getItem(f.board, id).item_owner, f.other);
    }
  }
});

test('[B13,B5] first refusal does not bypass the existing one-live-claim rule', (t) => {
  const f = fixture(t);
  const id = returned(f, 'landing', 30);
  const second = store.addItem(f.board, { by: 'coordinator', lane: 'core', title: 'another', route: 'mid',
    criterion: 'prove', check: 'true', brief: 'Files: src/a.js\nTest: proves another fix' });
  claim(f, second, f.builder);
  assert.throws(() => claim(f, id, f.builder), error => error.code === 'ONE_CLAIM');
  store.release(f.board, second, f.builder);
  claim(f, id, f.builder);
});


test('[B13,B5] releasing another review cannot cancel the builder reservation', (t) => {
  const f = fixture(t);
  const id = returned(f, 'reject', 30);
  const another = store.addItem(f.board, { by: 'coordinator', lane: 'core', title: 'review another', route: 'mid',
    criterion: 'prove', check: 'true', brief: 'Files: src/unrelated.js\nTest: proves another fix' });
  claim(f, another, f.other);
  submitFixture(f.board, another, { agentId: f.other, commit: COMMIT, tree: COMMIT });
  store.reserveReview(f.board, another, { agentId: f.builder, leaseMs: 1_800_000, policy: 'any' });
  assert.equal(store.release(f.board, another, f.builder, 'another reviewer can take this'), true);
  assert.throws(() => claim(f, id, f.other), error => error.code === 'REOPEN_HELD_FOR_BUILDER');
  assert.equal(store.nextFor(f.board, { agentId: f.other, lane: 'core' }).item, null);
  assert.equal(store.nextFor(f.board, { agentId: f.builder, lane: 'core' }).item.item_id, id);
});

test('[B13,B5,H16] a sealed return persists one window and notice across replay and snapshots', async (t) => {
  const { REOPEN_FIRST_REFUSAL_ENGINE } = await import('../src/machine.js');
  // A sealed move carries the current engine, which a later feature may raise past this one.
  const { ENGINE_VERSION } = await import('../src/machine.js');
  assert.ok(ENGINE_VERSION >= REOPEN_FIRST_REFUSAL_ENGINE);
  const { firstRefusalArgs } = await import('../src/claims.js');
  const f = fixture(t);
  const id = store.addItem(f.board, { by: 'coordinator', lane: 'core', title: 'replay', route: 'mid',
    criterion: 'prove', check: 'true', brief: 'Files: src/a.js\nTest: proves replay' });
  claim(f, id, f.builder);
  submitFixture(f.board, id, { agentId: f.builder, commit: COMMIT, tree: COMMIT });
  const args = firstRefusalArgs('verify', [id, { agentId: f.other, decision: 'REJECT', reason: 'OTHER',
    note: 'proof', head: COMMIT, digest: 'digest:bar', policy: 'any' }], configFromSource('{"claim":{"reopenFirstRefusalMinutes":30}}'));
  const move = prepareEngineMove(f.board, 'verify', args);
  assert.equal(move.engine, ENGINE_VERSION);
  assert.throws(() => applyEngineMove(f.board, { ...move, engine: REOPEN_FIRST_REFUSAL_ENGINE - 1 },
    { sequence: 1, at: '2026-01-01T00:00:00Z' }), /engine/);
  const receipt = { sequence: 1, at: '2026-01-01T00:00:00Z' };
  applyEngineMove(f.board, move, receipt);
  applyEngineMove(f.board, move, receipt);
  assert.equal(store.recentShouts(f.board).filter(row => row.shout_text.includes('waits for you')).length, 1);
  const replica = store.openBoard(join(f.directory, 'replica.sqlite'), { now: () => new Date('2026-01-01T00:05:00Z') });
  t.after(() => store.closeBoard(replica));
  importBoard(replica, exportBoard(f.board));
  assert.throws(() => store.claim(replica, id, { agentId: f.other, lane: 'core', leaseMs: 7_200_000, freeze: () => null }),
    error => error.code === 'REOPEN_HELD_FOR_BUILDER' && error.message.includes('2026-01-01T00:30:00.000Z'));
  assert.equal(store.recentShouts(replica).filter(row => row.shout_text.includes('waits for you')).length, 1);
  const claimMove = prepareEngineMove(replica, 'claim', [id, { agentId: f.other, lane: 'core', leaseMs: 7_200_000, freeze: () => null }]);
  assert.throws(() => applyEngineMove(replica, { ...claimMove, engine: REOPEN_FIRST_REFUSAL_ENGINE - 1 }, { sequence: 2, at: '2026-01-01T00:05:00Z' }), /engine/);
  assert.equal(store.getItem(replica, id).item_owner, null);
  assert.equal(prepareEngineMove(replica, 'release', [id, f.builder]).engine, ENGINE_VERSION);
  store.release(replica, id, f.builder);
  store.claim(replica, id, { agentId: f.other, lane: 'core', leaseMs: 7_200_000, freeze: () => null });
});


test('[B13,B5,D1] a builder notice preserves the reopen cause that triggers rigor', (t) => {
  const f = fixture(t);
  returned(f, 'landing', 30, 'refusal:CHECK_RED');
  returned(f, 'landing', 30, 'refusal:CHECK_RED');
  const notices = store.recentShouts(f.board);
  assert.equal(notices.filter(row => row.shout_from === 'rigor' && row.shout_to === 'coordinator' && row.shout_text.includes('CHECK_RED')).length, 1);
  assert.equal(store.events(f.board).filter(row => row.event_kind === 'rigor-notice' && JSON.parse(row.event_detail).cause === 'refusal:CHECK_RED').length, 1);
  assert.equal(notices.filter(row => row.shout_to === f.builder && row.shout_text.includes('waits for you')).length, 2);
});
