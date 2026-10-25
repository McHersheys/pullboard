/** Report capability migration preserves existing indexed read-only statistics [R1,R2]. */
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import * as store from '../src/board.js';
import { proofStats } from '../src/stats.js';
import { flowStats } from '../src/stats-flow.js';
import { ensureProofCounters } from '../src/proof-counters.js';
import { runFixtureGit } from './fixture-child.js';

/** Construct a native board whose append path maintains current report shards. */
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'pullboard-report-cache-'));
  runFixtureGit(['init', '-q', '-b', 'main'], { cwd: root, stdio: 'pipe' });
  const board = store.openBoard(join(root, '.git', 'board.sqlite'));
  store.register(board, { lane: 'coordinator', path: root });
  store.addItem(board, { by: 'coordinator', lane: 'core', title: 'Known open history' });
  t.after(() => { store.closeBoard(board); rmSync(root, { recursive: true, force: true }); });
  return board;
}

test('flow report indexed projection matches canonical replay without hot raw history reads [R1,R2]', t => {
  const board = fixture(t);
  const now = Date.now() + 60_000;
  const history = store.events(board);
  const stats = proofStats(board, { now });
  assert.deepEqual(stats.flow.report, flowStats(history, null, now, stats).report);
  const prepare = board.db.prepare.bind(board.db);
  const reads = [];
  board.db.prepare = sql => { reads.push(sql); return prepare(sql); };
  t.after(() => { board.db.prepare = prepare; });
  assert.deepEqual(proofStats(board, { now }).flow.report, stats.flow.report);
  assert.ok(!reads.some(sql => /SELECT\s+\*\s+FROM\s+event\b/i.test(sql)), 'current report reads indexed facts, never raw event history');
  assert.equal(proofStats(board, { now, since: '2026-10-01' }).flow.report.scope, 'all-time', 'a date-filtered legacy summary visibly labels the report scope');
});

test('old v2 counters retain fast metrics and explicitly unavailable reports until a writer rebuilds [R1,R2]', t => {
  const board = fixture(t);
  const row = board.db.prepare('SELECT meta_value FROM board_meta WHERE meta_key=?').get('local:proof-stats:v2:summary');
  const summary = JSON.parse(row.meta_value);
  delete summary.data.reportVersion;
  board.db.prepare('UPDATE board_meta SET meta_value=? WHERE meta_key=?').run(JSON.stringify(summary), 'local:proof-stats:v2:summary');
  const prepare = board.db.prepare.bind(board.db);
  const reads = [];
  board.db.prepare = sql => { reads.push(sql); return prepare(sql); };
  const old = proofStats(board);
  assert.deepEqual(old.flow.report, { available: false });
  assert.equal(old.flow.queues.open.size, 1);
  assert.ok(!reads.some(sql => /SELECT\s+\*\s+FROM\s+event\b/i.test(sql)), 'missing optional report capability does not force raw fallback');
  board.db.prepare = prepare;
  const before = store.events(board);
  ensureProofCounters(board);
  assert.ok(proofStats(board).flow.report.items);
  assert.deepEqual(store.events(board), before, 'writer backfill changes only local derived counters');
});

test('retained refreezes keep active build time and prototype-like recorded names remain ordinary groups [R1,R2]', () => {
  const base = Date.parse('2026-10-10T00:00:00Z');
  const commit = 'a'.repeat(40);
  const entries = [
    [0, 'milestone_add', null, { name: '__proto__', items: [1] }],
    [0, 'line_setting', null, { key: 'focusMilestone', value: '__proto__' }],
    [0, 'add', 1, { lane: '__proto__' }],
    [10, 'claim', 1, { leaseUntil: new Date(base + 100 * 60_000).toISOString() }],
    [15, 'refreeze', 1, { retainedClaim: true }],
    [30, 'submit', 1, { commit }],
  ];
  const history = entries.map(([minute, kind, item, detail], index) => ({ event_id: index + 1,
    event_at: new Date(base + minute * 60_000).toISOString(), event_by: 'core-1',
    event_kind: kind, item_id: item, event_detail: JSON.stringify(detail) }));
  const counts = { submissions: 1, rejections: 0, rejectionShare: 0 };
  const during = flowStats(history.slice(0, -1), null, base + 20 * 60_000, counts);
  assert.equal(during.queues.claimed.size, 1, 'a retained native refreeze leaves the same live claim in place');
  const report = flowStats(history, null, base + 30 * 60_000, counts).report;
  assert.deepEqual(report.items[0].stages.build, { minutes: 20, unknown: 0 });
  assert.deepEqual(report.items[0].stages.rework, { minutes: 0, unknown: 0 });
  assert.equal(report.lanes[0].lane, '__proto__');
  assert.equal(report.milestones[0].milestone, '__proto__');
});


test('an item fact after claim expiry cannot reclassify the preceding active build [R1,R2]', () => {
  const base = Date.parse('2026-10-10T00:00:00Z');
  const entries = [
    [0, 'add', { lane: 'core' }],
    [10, 'claim', { leaseUntil: new Date(base + 20 * 60_000).toISOString() }],
    [30, 'fact', { note: 'Observation after the recorded lease boundary' }],
    [40, 'claim', { leaseUntil: new Date(base + 100 * 60_000).toISOString() }],
    [50, 'submit', { commit: 'b'.repeat(40) }],
  ];
  const history = entries.map(([minute, kind, detail], index) => ({ event_id: index + 1,
    event_at: new Date(base + minute * 60_000).toISOString(), event_by: 'core-1', item_id: 1,
    event_kind: kind, event_detail: JSON.stringify(detail) }));
  const counts = { submissions: 1, rejections: 0, rejectionShare: 0 };
  const observed = flowStats(history.slice(0, 3), null, base + 35 * 60_000, counts);
  assert.equal(observed.queues.open.size, 1, 'clock projection still exposes an expired claim after a non-lifecycle fact');
  assert.deepEqual(observed.report.items[0].stages.build, { minutes: 10, unknown: 0 });
  assert.deepEqual(observed.report.items[0].stages.rework, { minutes: 15, unknown: 0 });
  const completed = flowStats(history, null, base + 50 * 60_000, counts).report.items[0];
  assert.deepEqual(completed.stages.build, { minutes: 20, unknown: 0 });
  assert.deepEqual(completed.stages.rework, { minutes: 20, unknown: 0 });
});
