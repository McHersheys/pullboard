/** Rigor remains complete across cold boards, older writers and derived-state rebuilds [D1,N19,H16]. */
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import * as store from '../src/board.js';
import { clearProofCounters } from '../src/proof-counters.js';
import { rebuildProofCounters } from '../src/proof-counters.js';
import { ensureRigorCounters } from '../src/rigor-counters.js';
import { resumeRigorCounters } from '../src/rigor-counters.js';
import { RIGOR_COLD_NOTICE } from '../src/rigor-counters.js';
import { RIGOR_TAIL_LIMIT } from '../src/rigor-counters.js';
import { undraftedRigor } from '../src/rigor-notices.js';
import { rigorSource } from '../src/rigor-source.js';

const PREFIX = 'local:proof-stats:rigor:v1:';

/** Exercise the actual SQLite store, retaining a file that can also be opened strictly read-only. */
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'pullboard-rigor-counter-'));
  const file = join(dir, 'board.sqlite');
  const board = store.openBoard(file);
  store.ensureCoordinator(board, dir);
  const item = store.addItem(board, { lane: 'core', title: 'Old rigor cause', criterion: 'Works.', by: 'coordinator' });
  t.after(() => { store.closeBoard(board); rmSync(dir, { recursive: true, force: true }); });
  return { board, file, item };
}

/** Simulate an older native writer that appends valid event rows but knows no Rigor projection. */
function oldAppend(board, kind, item, detail, by = 'tests-1') {
  board.db.prepare('INSERT INTO event(event_at,event_by,event_kind,item_id,event_detail) VALUES(?,?,?,?,?)')
    .run('2026-01-01T00:00:00.000Z', by, kind, item, JSON.stringify(detail));
}

/** Seed an old repeat at two real commits, not an empty-history performance shortcut. */
function oldRepeat(board, item) {
  oldAppend(board, 'reject', item, { cause: 'row:G1', commit: 'a'.repeat(40) });
  oldAppend(board, 'reopen', item, { cause: 'row:G1', commit: 'b'.repeat(40) });
}

/** Compare complete output against the independent legacy implementation. */
function expected(board, state = { spec: [], practice: [] }) {
  return undraftedRigor(store.events(board), state, { person: store.PERSON });
}

/** Count connection mutations to prove a read-only compatibility fold never warms itself. */
function changes(board) { return board.db.prepare('SELECT total_changes() AS n').get().n; }

test('cold Rigor is complete and loud, and the next actual native write makes it hot [D1,N19,H16]', t => {
  const { board, file, item } = fixture(t);
  oldRepeat(board, item);
  board.db.prepare('DELETE FROM board_meta WHERE meta_key GLOB ?').run(PREFIX + '*');
  const readonly = { db: new DatabaseSync(file, { readOnly: true }) };
  try {
    const before = changes(readonly);
    const cold = resumeRigorCounters(readonly, {});
    assert.deepEqual(cold.causes, expected(board));
    assert.equal(cold.notice, RIGOR_COLD_NOTICE);
    assert.equal(changes(readonly), before);
  } finally { readonly.db.close(); }
  store.appendFact(board, item, { agentId: 'coordinator', kind: 'note', text: 'A current native write.' });
  const hot = resumeRigorCounters(board, {});
  assert.deepEqual(hot.causes, expected(board), 'the first current append must not skip older history');
  assert.equal(hot.notice, null);
});

test('a bounded older-writer tail folds read-only and an over-bound gap is loudly complete [D1,N19,H16]', t => {
  const { board, item } = fixture(t);
  oldRepeat(board, item);
  ensureRigorCounters(board);
  for (let n = 0; n < RIGOR_TAIL_LIMIT; n += 1) oldAppend(board, 'fact', item, { kind: 'note', text: `older ${n}` });
  const before = changes(board);
  assert.deepEqual(resumeRigorCounters(board, {}).causes, expected(board));
  assert.equal(resumeRigorCounters(board, {}).notice, null);
  assert.equal(changes(board), before);
  oldAppend(board, 'fact', item, { cause: 'doctrine:C3', neverAgain: true }, store.PERSON);
  const cold = resumeRigorCounters(board, {});
  assert.deepEqual(cold.causes, expected(board));
  assert.equal(cold.notice, RIGOR_COLD_NOTICE, 'a present summary cannot silently consume an unbounded tail');
  store.appendFact(board, item, { agentId: 'coordinator', kind: 'note', text: 'The current writer catches up.' });
  assert.deepEqual(resumeRigorCounters(board, {}).causes, expected(board));
  assert.equal(resumeRigorCounters(board, {}).notice, null);
});

test('proof-counter clear and rebuild cannot leave Rigor falsely current or empty [D1,N19,H16]', t => {
  const { board, item } = fixture(t);
  oldRepeat(board, item);
  ensureRigorCounters(board);
  const oracle = expected(board);
  rebuildProofCounters(board);
  assert.deepEqual(resumeRigorCounters(board, {}).causes, oracle);
  assert.equal(resumeRigorCounters(board, {}).notice, null);
  clearProofCounters(board);
  assert.deepEqual(resumeRigorCounters(board, {}).causes, oracle);
  assert.equal(resumeRigorCounters(board, {}).notice, RIGOR_COLD_NOTICE);
  store.appendFact(board, item, { agentId: 'coordinator', kind: 'note', text: 'Rebuild after clear.' });
  assert.deepEqual(resumeRigorCounters(board, {}).causes, expected(board));
  assert.equal(resumeRigorCounters(board, {}).notice, null);
});

test('a current append catches up a present older-writer gap and rebuilds an older projection version [D1,N19,H16]', t => {
  const { board, item } = fixture(t);
  ensureRigorCounters(board);
  oldRepeat(board, item);
  store.appendFact(board, item, { agentId: 'coordinator', kind: 'note', text: 'Current write after an old writer.' });
  assert.deepEqual(resumeRigorCounters(board, {}).causes, expected(board));
  assert.equal(resumeRigorCounters(board, {}).notice, null);
  const key = PREFIX + 'summary';
  const summary = JSON.parse(board.db.prepare('SELECT meta_value FROM board_meta WHERE meta_key=?').get(key).meta_value);
  summary.data.version = 0;
  board.db.prepare('UPDATE board_meta SET meta_value=? WHERE meta_key=?').run(JSON.stringify(summary), key);
  assert.equal(resumeRigorCounters(board, {}).notice, RIGOR_COLD_NOTICE);
  store.appendFact(board, item, { agentId: 'coordinator', kind: 'note', text: 'Current write after a previous projection version.' });
  assert.deepEqual(resumeRigorCounters(board, {}).causes, expected(board));
  assert.equal(resumeRigorCounters(board, {}).notice, null);
});

test('persistent decline cursors stay quiet for an old item and revive only for a new item [D1,N19,H16]', t => {
  const { board, item } = fixture(t);
  oldRepeat(board, item);
  ensureRigorCounters(board);
  const cause = expected(board)[0];
  const proof = { check: 'test -f fixed', red: { commit: 'a'.repeat(40), exit: 1 }, green: { commit: 'b'.repeat(40), exit: 0 } };
  const source = `- G9 [draft, must] A proved rule | source: ${rigorSource(cause, proof)}`;
  oldAppend(board, 'row_decision', null, { record: { decision: 'decline', source } }, store.PERSON);
  ensureRigorCounters(board);
  assert.deepEqual(resumeRigorCounters(board, {}).causes, []);
  oldAppend(board, 'reject', item, { cause: 'row:G1', commit: 'c'.repeat(40) });
  ensureRigorCounters(board);
  assert.deepEqual(resumeRigorCounters(board, {}).causes, expected(board));
  assert.deepEqual(expected(board), [], 'a new commit on the same item cannot override a decline');
  const nextItem = store.addItem(board, { lane: 'core', title: 'A different item', criterion: 'Works.', by: 'coordinator' });
  oldAppend(board, 'reject', nextItem, { cause: 'row:G1', commit: 'd'.repeat(40) });
  ensureRigorCounters(board);
  assert.deepEqual(resumeRigorCounters(board, {}).causes, expected(board));
  assert.equal(expected(board).length, 1);
});

test('persistent cause keys preserve percent signs, glob characters and accepted historical Unicode [D1,N19,H16]', t => {
  const { board, item } = fixture(t);
  const keys = ['test:test/a*.js::a percent % and [brackets]', 'test:test/unicode.js::' + String.fromCharCode(0xd800)];
  for (const cause of keys) {
    oldAppend(board, 'reject', item, { cause, commit: 'a'.repeat(40) });
    oldAppend(board, 'reject', item, { cause, commit: 'b'.repeat(40) });
  }
  ensureRigorCounters(board);
  const oracle = expected(board);
  assert.equal(oracle.length, 2, 'both keys are accepted by the unchanged legacy grammar');
  assert.deepEqual(resumeRigorCounters(board, {}).causes, oracle);
});

test('a derived JSON shard does not normalize historical decoded commits to null [D1,N19,H16]', t => {
  const { board, item } = fixture(t);
  for (const commit of ['1e400', '-1e400']) {
    board.db.prepare('INSERT INTO event(event_at,event_by,event_kind,item_id,event_detail) VALUES(?,?,?,?,?)')
      .run('2026-01-01T00:00:00.000Z', 'tests-1', 'reject', item, `{"cause":"row:G1","commit":${commit}}`);
  }
  ensureRigorCounters(board);
  const oracle = expected(board);
  assert.deepEqual(oracle[0].items[0].commits, [Infinity, -Infinity]);
  assert.deepEqual(resumeRigorCounters(board, {}).causes, oracle);
});

test('typed draft decisions suppress only their cause and local doctrine, just like legacy [D1,N19,H16]', t => {
  const { board, item } = fixture(t);
  oldRepeat(board, item);
  ensureRigorCounters(board);
  const cause = expected(board)[0];
  const proof = { check: 'test -f fixed', red: { commit: 'a'.repeat(40), exit: 1 }, green: { commit: 'b'.repeat(40), exit: 0 } };
  const source = rigorSource(cause, proof);
  for (const state of [
    { spec: [{ source, status: 'draft' }] },
    { spec: [{ source, status: 'declined', decision: { decision: 'approve' } }] },
    { practice: [{ source, status: 'draft', origin: 'standard' }] },
    { practice: [{ source, status: 'draft', origin: 'local' }] },
    { spec: [{ source: 'ordinary prose', status: 'draft' }] },
  ]) assert.deepEqual(resumeRigorCounters(board, state).causes, expected(board, state));
});

test('a read-only Rigor snapshot cannot mix an old cursor with a newly committed cause shard [D1,N19,H16]', t => {
  const { board, file, item } = fixture(t);
  oldRepeat(board, item);
  ensureRigorCounters(board);
  const oldResult = expected(board);
  const readonly = { db: new DatabaseSync(file, { readOnly: true }) };
  const original = DatabaseSync.prototype.prepare;
  let interleaved = false;
  /** Commit a real second-connection update immediately after the reader observes its old summary. */
  DatabaseSync.prototype.prepare = function (sql, ...rest) {
    const statement = original.call(this, sql, ...rest);
    if (this !== readonly.db || sql !== 'SELECT meta_value FROM board_meta WHERE meta_key=?') return statement;
    return new Proxy(statement, {
      /** Keep native statement receivers intact while interleaving exactly one summary read. */
      get(target, property) {
        if (property === 'get') return (...args) => {
          const result = target.get(...args);
          if (args[0] === PREFIX + 'summary' && !interleaved) {
            interleaved = true;
            oldAppend(board, 'reject', item, { cause: 'row:G1', commit: 'c'.repeat(40) });
            ensureRigorCounters(board);
          }
          return result;
        };
        const value = Reflect.get(target, property, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  };
  try {
    const before = changes(readonly);
    const result = resumeRigorCounters(readonly, {});
    assert.equal(interleaved, true);
    const newResult = expected(board);
    assert.ok(JSON.stringify(result.causes) === JSON.stringify(oldResult)
      || JSON.stringify(result.causes) === JSON.stringify(newResult), 'one complete snapshot, never a double-folded new shard');
    assert.equal(result.notice, null);
    assert.equal(changes(readonly), before);
  } finally {
    DatabaseSync.prototype.prepare = original;
    readonly.db.close();
  }
});


test('malformed historical detail preserves native writes and the legacy read failure [D1,N19,H16]', t => {
  const { board, file } = fixture(t);
  board.db.prepare('INSERT INTO event(event_at,event_by,event_kind,item_id,event_detail) VALUES(?,?,?,?,?)')
    .run('2026-01-01T00:00:00.000Z', 'tests-1', 'reject', null, '{broken');
  let failure;
  try { undraftedRigor(store.events(board), {}, { person: 'person' }); }
  catch (error) { failure = error; }
  assert.ok(failure instanceof SyntaxError, 'retain the independent legacy refusal');
  store.closeBoard(store.openBoard(file));
  const before = store.events(board).length;
  store.logEvent(board, 'tests-1', 'shout', null, { text: 'a later valid native move' });
  assert.equal(store.events(board).length, before + 1);
  const summary = JSON.parse(board.db.prepare('SELECT meta_value FROM board_meta WHERE meta_key=?').get(PREFIX + 'summary').meta_value).data;
  assert.equal(summary.invalid, true);
  assert.equal(summary.last, store.events(board).at(-1).event_id);
  assert.throws(() => resumeRigorCounters(board, {}), error => error.constructor === failure.constructor && error.message === failure.message,
    'a caught-up invalid projection delegates to the exact legacy reader, never empty or falsely green');
});
