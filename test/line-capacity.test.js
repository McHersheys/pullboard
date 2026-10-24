/** Capacity uses real SQLite lifecycle observations and versioned claims, not modelled permanent seat roles [N2,B13,H16]. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as store from '../src/board.js';
import { submitFixture } from './board-submit-fixture.js';
import { lineCapacitySnapshot } from '../src/line-capacity.js';
import { LINE_CAPACITY_ENGINE } from '../src/line-capacity-engine.js';
import { applyEngineMove, prepareEngineMove } from '../src/engine.js';
import { exportBoard, importBoard } from '../src/exchange.js';

const HOUR = 3_600_000;
const FREEZE = () => ({ text: 'private lifecycle bar', digest: 'private-lifecycle-bar' });
/** Create one real board with explicit actor identities and an adjustable observation clock. */
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'pullboard-line-capacity-'));
  let at = Date.parse('2026-10-24T00:00:00Z');
  const clock = { now: () => new Date(at) };
  const board = store.openBoard(join(root, 'board.sqlite'), clock);
  t.after(() => { store.closeBoard(board); rmSync(root, { recursive: true, force: true }); });
  store.register(board, { lane: 'coordinator', path: root });
  const author = store.register(board, { lane: 'core', path: join(root, 'author'), route: 'strong', parent: 'A', session: 'a' });
  const reviewer = store.register(board, { lane: 'core', path: join(root, 'reviewer'), route: 'strong', parent: 'R', session: 'r' });
  /** Record normal private claims without asserting a gate execution. */
  function claim(id, agentId = author, options = {}) {
    return store.claim(board, id, { agentId, lane: 'core', leaseMs: HOUR, freeze: FREEZE, ...options });
  }
  /** Seed a submitted lifecycle through its normal moves. */
  function submit(title = 'waiting') {
    const id = store.addItem(board, { by: 'coordinator', lane: 'core', title });
    claim(id);
    submitFixture(board, id, { agentId: author, commit: String(id).padStart(40, 'a'), tree: String(id).padStart(40, 'b') });
    return id;
  }
  /** Change one recorded board input, leaving machine settings untouched. */
  function setting(key, value) {
    return store.setLineSetting(board, { agentId: 'coordinator', key, value, reason: 'private capacity proof', window: { activeReviewers: 1 } });
  }
  return { board, root, author, reviewer, claim, submit, setting, advance: ms => { at += ms; } };
}

test('capacity counts distinct review actors in the same bounded flow window, not their lane [N2,H16]', t => {
  const f = fixture(t), first = f.submit('first'), second = f.submit('second');
  assert.equal(lineCapacitySnapshot(f.board).activeReviewers, 1, 'no observations retains the denominator floor');
  store.reserveReview(f.board, first, { agentId: f.reviewer, leaseMs: HOUR, policy: 'any' });
  store.reserveReview(f.board, first, { agentId: f.reviewer, leaseMs: HOUR, policy: 'any' });
  store.reserveReview(f.board, second, { agentId: 'coordinator', leaseMs: HOUR, policy: 'any' });
  assert.equal(lineCapacitySnapshot(f.board).activeReviewers, 2, 'a core seat and coordinator are both observed reviewers; renewals do not duplicate them');
  f.advance(2 * HOUR);
  assert.equal(lineCapacitySnapshot(f.board).activeReviewers, 1);
  assert.equal(lineCapacitySnapshot(f.board, { windowMinutes: 180 }).activeReviewers, 2, 'the explicit flow window changes both bounds');
  assert.throws(() => lineCapacitySnapshot(f.board, { windowMinutes: Infinity }), { code: 'USAGE' });
});

test('WIP counts live claims and pending submissions, refuses atomically, and preserves renewals [N2,B13,H16]', t => {
  const f = fixture(t), waiting = f.submit();
  const a = store.addItem(f.board, { by: 'coordinator', lane: 'core', title: 'one live claim' });
  const b = store.addItem(f.board, { by: 'coordinator', lane: 'core', title: 'new claim' });
  f.claim(a);
  f.setting('wipPerReviewer', 1.5);
  const before = store.events(f.board).length;
  assert.throws(() => f.claim(b, f.reviewer), error => error.code === 'LINE_WIP_LIMIT' && error.message.includes(`#${waiting}`));
  assert.equal(store.events(f.board).length, before, 'a refused claim appends no history');
  assert.equal(store.getItem(f.board, b).item_frozen_digest, null);
  assert.equal(f.claim(a).renewed, true, 'a changed setting never strands a held claim');
  f.advance(HOUR + 1);
  assert.equal(lineCapacitySnapshot(f.board).wip, 1, 'an expired claim no longer consumes capacity');
  f.setting('wipPerReviewer', false);
  f.claim(b, f.reviewer);
  assert.equal(store.getItem(f.board, b).item_owner, f.reviewer, 'off restores ordinary claim behavior');
});

test('the offered oldest review respects the actual claim caller policy and author independence [N2,B13,H16]', t => {
  const f = fixture(t), waiting = f.submit();
  const id = store.addItem(f.board, { by: 'coordinator', lane: 'core', title: 'blocked new work' });
  f.setting('wipPerReviewer', 1.5);
  assert.throws(() => f.claim(id, f.author), error => error.code === 'LINE_WIP_LIMIT' && !error.message.includes(`review oldest waiting item #${waiting}`));
  assert.throws(() => f.claim(id, f.reviewer, { reviewPolicy: 'coordinator' }), error => error.code === 'LINE_WIP_LIMIT' && !error.message.includes(`review oldest waiting item #${waiting}`));
});

test('old recorded claims ignore new capacity while new claims retain the feature floor on replay [N2,H16]', t => {
  const f = fixture(t); f.submit(); f.submit(); f.setting('wipPerReviewer', 1.5);
  const id = store.addItem(f.board, { by: 'coordinator', lane: 'core', title: 'old recorded claim' });
  const snapshot = exportBoard(f.board);
  const options = { agentId: f.reviewer, lane: 'core', leaseMs: HOUR, freeze: FREEZE };
  const move = prepareEngineMove(f.board, 'claim', [id, options]);
  const old = applyEngineMove(f.board, { ...move, engine: LINE_CAPACITY_ENGINE - 1 }, { sequence: 1, at: f.board.clock.now().toISOString() });
  assert.equal(old.error, undefined, JSON.stringify(old.error));
  const replica = store.openBoard(join(f.root, 'replica.sqlite'), f.board.clock);
  t.after(() => store.closeBoard(replica));
  importBoard(replica, snapshot);
  const current = applyEngineMove(replica, move, { sequence: 1, at: f.board.clock.now().toISOString() });
  assert.equal(current.error?.code, 'LINE_WIP_LIMIT');
  assert.equal(store.getItem(replica, id).item_status, 'open');
});
