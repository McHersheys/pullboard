/** @pullboard-test-input source-tree */
/**
 * Every query the hot commands run reaches events and shouts through an index, never a full scan, on a
 * seeded board of 1,000 items, 45,000 events and 23,000 shouts [C7]. The commands run as the real CLI
 * with a preload that records each statement they prepare; each is then planned with EXPLAIN QUERY PLAN.
 */
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { after, test } from 'node:test';
import { submitFixture } from './board-submit-fixture.js';
import * as store from '../src/board.js';
import { healthReport } from '../src/health.js';
import { loadConfig } from '../src/config.js';
import { personNeedsSummary } from '../src/needs-summary.js';
import { resumeNeeds } from '../src/resume-needs.js';
import { undraftedRigor } from '../src/rigor-notices.js';
import { runFixtureChild, runFixtureGit } from './fixture-child.js';

const BIN = resolve(import.meta.dirname, '../bin/pullboard.js');
const SERVE = pathToFileURL(resolve(import.meta.dirname, '../src/serve.js')).href;
const ITEMS = 1_000;
const EVENTS = 45_000;
const SHOUTS = 23_000;
const SEATS = 800;
const sandboxes = [];
// Reads that fold the whole history by design, so no index can serve them, each with the item that
// rewrites it: resume's proofStats (#1051). The test fails if one stops scanning while still listed, so the list can only
// shrink.
const WHOLE_HISTORY = ['proofStats'];

after(() => {
  for (const dir of sandboxes) rmSync(dir, { recursive: true, force: true });
});

/** Make a real repo with a coordinator and one joined builder, and return how to run the CLI there with a statement log. */
function fixture() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'pullboard-query-plans-')));
  sandboxes.push(dir);
  const log = join(dir, 'statements.log');
  const preload = join(dir, 'record.mjs');
  // Record every statement any connection prepares, so the test plans exactly what the command ran.
  writeFileSync(preload, `import { DatabaseSync } from 'node:sqlite';
import { appendFileSync } from 'node:fs';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
// Explicit development profiling preserves the normal command and timing assertion unchanged.
if (process.env.PULLBOARD_RESUME_CPU_PROFILE) {
  const { Session } = await import('node:inspector');
  const { writeFileSync } = await import('node:fs');
  const session = new Session();
  session.connect();
  const post = method => new Promise((resolve, reject) => session.post(method, (error, result) => error ? reject(error) : resolve(result)));
  await post('Profiler.enable');
  await post('Profiler.start');
  process.once('beforeExit', async () => {
    const { profile } = await post('Profiler.stop');
    writeFileSync(process.env.PULLBOARD_RESUME_CPU_PROFILE + '.' + process.pid + '.cpuprofile', JSON.stringify(profile));
    session.disconnect();
  });
}
let gitDepth = 0;
for (const name of ['spawnSync', 'execFileSync']) {
  const original = childProcess[name];
  /** Measure actual synchronous Git calls without substituting their results or environment. */
  childProcess[name] = function (command, ...args) {
    const started = performance.now();
    const git = command === 'git';
    if (git) gitDepth += 1;
    try { return original.call(this, command, ...args); }
    finally {
      if (git) gitDepth -= 1;
      if (git && gitDepth === 0 && process.env.PULLBOARD_GIT_TIMING_LOG) {
        appendFileSync(process.env.PULLBOARD_GIT_TIMING_LOG, JSON.stringify({ pid: process.pid, milliseconds: performance.now() - started }) + '\\n');
      }
    }
  };
}
syncBuiltinESMExports();
const prepare = DatabaseSync.prototype.prepare;
DatabaseSync.prototype.prepare = function (sql, ...rest) {
  // The function that asked: past the events() helper and serve's withProject wrapper.
  const caller = new Error().stack.split('\\n').slice(2).map((line) => /at (?:Module\\.)?([\\w$.]+) \\(/u.exec(line)?.[1])
    .find((name) => name && name !== 'events' && name !== 'withProject');
  appendFileSync(process.env.PULLBOARD_QUERY_LOG, JSON.stringify({ sql, caller, stack: new Error().stack }) + '\\n');
  return prepare.call(this, sql, ...rest);
};
`);
  const shims = join(dir, 'bin');
  mkdirSync(shims);
  writeFileSync(join(shims, 'pullboard'), `#!/bin/sh\nexec "${process.execPath}" "${BIN}" "$@"\n`, { mode: 0o755 });
  chmodSync(join(shims, 'pullboard'), 0o755);
  const env = {
    ...process.env,
    PATH: `${shims}:${process.env.PATH}`,
    GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'Test Agent', GIT_AUTHOR_EMAIL: 'agent@example.com',
    GIT_COMMITTER_NAME: 'Test Agent', GIT_COMMITTER_EMAIL: 'agent@example.com',
    PULLBOARD_HOME: join(dir, 'home'), PULLBOARD_MACHINE_HOME: join(dir, 'machine-home'),
    PULLBOARD_MODEL: 'Test Model',
  };
  delete env.PULLBOARD_RELAY_TOKEN;
  const repo = join(dir, 'repo');
  mkdirSync(repo);
  const git = (...args) => runFixtureGit(args, { cwd: repo, env });
  /** Run the CLI, or a node script, in a checkout; `record` adds the statement-recording preload. */
  const run = (cwd, args, { record = false, node = false, timing = false } = {}) => {
    const argv = [...(record ? ['--import', pathToFileURL(preload).href] : []), ...(node ? [] : [BIN]), ...args];
    const result = runFixtureChild(process.execPath, argv, { cwd, env: { ...env, PULLBOARD_QUERY_LOG: log,
      ...(timing ? { PULLBOARD_GIT_TIMING_LOG: join(dir, 'git-timing.log') } : {}) }, encoding: 'utf8' });
    return { code: result.status, pid: result.pid, out: result.stdout ?? '', err: result.failure ?? result.stderr ?? '' };
  };
  git('init', '-q', '-b', 'main');
  assert.equal(run(repo, ['init']).code, 0);
  writeFileSync(join(repo, 'pullboard.json'), JSON.stringify({
    gate: 'true', spec: 'SPEC.md', verify: 'any', lease: '2h',
    lanes: { web: { owns: ['web/'], specs: ['G1'] } },
  }, null, 2));
  writeFileSync(join(repo, 'SPEC.md'), '# Plans fixture\n\n## G · Goals\n- G1 [approved, must] The feature works. | gate: test\n');
  mkdirSync(join(repo, 'web'));
  writeFileSync(join(repo, 'web', 'a.txt'), 'base\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'chore: create plans fixture');
  const made = run(repo, ['worktree', 'web', '--route', 'strong', '--json']);
  assert.equal(made.code, 0, `${made.err}\n${made.out}`);
  const board = join(git('rev-parse', '--path-format=absolute', '--git-common-dir').trim(), 'pullboard', 'board.sqlite');
  return { dir, repo, web: JSON.parse(made.out).path, board, log, run };
}

/** Fill the board to the measured scale: seats, items, an event log, shouts, and decisions half answered. */
function seed(file, { rigor = [] } = {}) {
  const db = new DatabaseSync(file);
  const at = (n) => new Date(Date.UTC(2026, 9, 1) + n * 1000).toISOString();
  db.exec('BEGIN');
  const seat = db.prepare('INSERT INTO agent (agent_id, agent_lane, agent_path, agent_created_at) VALUES (?, ?, ?, ?)');
  for (let n = 0; n < SEATS; n += 1) seat.run(`web-${n + 100}`, 'web', `/gone/web-${n + 100}`, at(n));
  const item = db.prepare(`INSERT INTO item (item_lane, item_title, item_criterion, item_created_by, item_created_at, item_updated_at)
    VALUES ('web', ?, 'The feature works.', 'coordinator', ?, ?)`);
  for (let n = 0; n < ITEMS; n += 1) item.run(`Item ${n}`, at(n), at(n));
  const event = db.prepare('INSERT INTO event (event_at, event_by, event_kind, item_id, event_detail) VALUES (?, ?, ?, ?, ?)');
  const kinds = ['add', 'claim', 'renew', 'shout', 'edit'];
  for (let n = 0; n < EVENTS; n += 1) {
    const row = rigor[n];
    event.run(at(n), row?.by ?? `web-${100 + (n % SEATS)}`, row?.kind ?? kinds[n % kinds.length],
      row ? row.item : n % 10 ? 1 + (n % ITEMS) : null, JSON.stringify(row?.detail ?? {}));
  }
  const shout = db.prepare('INSERT INTO shout (shout_from, shout_to, shout_text, shout_at, shout_decision, shout_answers) VALUES (?, ?, ?, ?, ?, ?)');
  for (let n = 0; n < SHOUTS; n += 1) {
    const asks = n % 10 === 0;
    const to = asks ? (n % 20 === 0 ? 'coordinator' : 'person') : 'all';
    // Every other coordinator ask gets its answer two shouts later (shout ids start at 1).
    const answers = n % 40 === 2 ? n - 1 : null;
    shout.run(`web-${100 + (n % SEATS)}`, to, `shout ${n}`, at(n), asks ? 1 : 0, answers);
  }
  db.exec('COMMIT');
  db.close();
}

test('coordinator resume never reads the whole event history for rigor [C7,D1,N19]', () => {
  const box = fixture();
  seed(box.board, { rigor: [
    { kind: 'reject', item: 1, detail: { cause: 'row:G1', commit: 'a'.repeat(40) } },
    { kind: 'reopen', item: 1, detail: { cause: 'row:G1', commit: 'b'.repeat(40) } },
    { kind: 'reject', item: 2, detail: { cause: 'test:test/old.js::old failure', commit: 'a'.repeat(40) } },
    { kind: 'reject', item: 3, detail: { cause: 'test:test/old.js::old failure', commit: 'a'.repeat(40) } },
    { kind: 'fact', item: 4, by: store.PERSON, detail: { cause: 'doctrine:C3', neverAgain: true } },
    { kind: 'reject', item: 5, detail: { cause: 'refusal:MERGE_CONFLICT' } },
    { kind: 'reject', item: 6, detail: { cause: 'refusal:MERGE_CONFLICT' } },
  ] });
  // Writable initialization may backfill once, before the measured read-only resume.
  const board = store.openBoard(box.board);
  try {
    const config = loadConfig(box.repo);
    const state = personNeedsSummary(box.repo, { board, config });
    const expected = undraftedRigor(store.events(board), state, { person: store.PERSON });
    assert.deepEqual(expected.map(cause => cause.key), ['doctrine:C3', 'test:test/old.js::old failure', 'row:G1']);
    const actual = resumeNeeds(box.repo, { board, config, includeRigorUndrafted: true });
    assert.deepEqual(actual.rigorUndrafted, expected, 'old failures survive 44,993 later unrelated events');
    writeFileSync(box.log, '');
    writeFileSync(join(box.dir, 'git-timing.log'), '');
    const started = performance.now();
    const result = box.run(box.repo, ['resume'], { record: true, timing: true });
    const wallMs = performance.now() - started;
    assert.equal(result.code, 0, result.err + result.out);
    const plans = [];
    for (const line of readFileSync(box.log, 'utf8').split('\n').filter(Boolean)) {
      const row = JSON.parse(line);
      if (!/resume-needs\.js|rigor-counters\.js/u.test(row.stack) || !/\bFROM event\b/iu.test(row.sql)) continue;
      const bindings = row.sql.includes('?') ? [0] : []; // The only hot event parameter is the recorded integer cursor.
      const plan = board.db.prepare(`EXPLAIN QUERY PLAN ${row.sql}`).all(...bindings).map(entry => entry.detail);
      plans.push({ sql: row.sql, plan });
      assert.ok(!plan.some(detail => /^SCAN event\b/u.test(detail)), `Rigor must use indexed state/tail, never whole-history: ${row.sql}\n${plan.join('\n')}`);
    }
    assert.ok(plans.length > 0, 'the real coordinator resume executed an observed Rigor event-cursor/tail query');
    const gitMs = readFileSync(join(box.dir, 'git-timing.log'), 'utf8').split('\n').filter(Boolean)
      .map(line => JSON.parse(line)).filter(row => row.pid === result.pid)
      .reduce((total, row) => total + row.milliseconds, 0);
    assert.ok(gitMs <= wallMs, 'only actual nonoverlapping synchronous Git durations are excluded');
    const excludingGit = wallMs - gitMs;
    console.log(`# coordinator resume wall ${wallMs.toFixed(2)} ms; actual Git ${gitMs.toFixed(2)} ms; excluding Git ${excludingGit.toFixed(2)} ms`);
    assert.ok(excludingGit < 1000, `coordinator resume excluding actual Git took ${excludingGit.toFixed(2)} ms, over 1000 ms`); // budget: declared #1052 steady-state bound is 1 s excluding actual Git.
  } finally { store.closeBoard(board); }
});

/** Add each recorded statement to `statements`, with the commands and the functions that ran it. */
function record(statements, log, command) {
  for (const line of readFileSync(log, 'utf8').split('\n').filter(Boolean)) {
    const { sql, caller } = JSON.parse(line);
    const seen = statements.get(sql) ?? { commands: new Set(), callers: new Set() };
    seen.commands.add(command);
    seen.callers.add(caller ?? 'unknown');
    statements.set(sql, seen);
  }
}

/** The aliases a statement gives the event and shout tables, besides their own names. */
function scanNames(sql) {
  const names = new Set(['event', 'shout', 'ask', 'reply']);
  for (const match of sql.matchAll(/\b(?:event|shout)\s+(?:AS\s+)?([A-Za-z_]\w*)/giu)) {
    if (!/^(?:WHERE|ORDER|GROUP|LIMIT|JOIN|LEFT|INNER|ON|USING|SET|VALUES|AND|OR|WHEN|INDEXED|NOT)$/iu.test(match[1])) names.add(match[1]);
  }
  return names;
}

test('hot board queries never scan events or shouts [C7]', () => {
  const box = fixture();
  seed(box.board);
  // The commands run worktree code, which never changes a shared board's schema, so the board gets
  // its indexes the way the trunk's next open gives them.
  store.closeBoard(store.openBoard(box.board));
  const commands = [
    [box.repo, ['status']], [box.repo, ['list']], [box.repo, ['show', '1']], [box.repo, ['next']],
    [box.repo, ['resume']], [box.repo, ['health']],
    [box.web, ['status']], [box.web, ['list']], [box.web, ['show', '1']], [box.web, ['next']], [box.web, ['resume']],
  ];
  const statements = new Map();
  const timings = [];
  for (const [cwd, args] of commands) {
    writeFileSync(box.log, '');
    const started = performance.now();
    const result = box.run(cwd, args, { record: true });
    timings.push(`${cwd === box.repo ? 'coordinator' : 'builder'} ${args[0]} ${Math.round(performance.now() - started)} ms`);
    assert.ok(result.code === 0 || result.code === 1, `${args.join(' ')} crashed: ${result.err}`);
    record(statements, box.log, args.join(' '));
  }
  // The view's state, as the page polls it.
  writeFileSync(box.log, '');
  const view = join(box.dir, 'view-state.mjs');
  writeFileSync(view, `const { projectState } = await import(${JSON.stringify(SERVE)});\nprojectState(process.argv[2]);\n`);
  const state = box.run(box.repo, [view, box.repo], { record: true, node: true });
  assert.equal(state.code, 0, state.err);
  record(statements, box.log, 'view state');
  assert.ok(statements.size > 20, `only ${statements.size} statements were recorded`);

  const board = store.openBoard(box.board);
  try {
    const scans = [];
    const wholeHistory = new Set();
    for (const [sql, { commands, callers }] of statements) {
      if (!/\b(?:event|shout)\b/iu.test(sql)) continue;
      const plan = board.db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all().map((row) => row.detail);
      const names = scanNames(sql);
      // A full scan, or an automatic index, which SQLite builds by scanning the table on every run.
      const scanned = plan.filter((detail) => {
        const match = /^(?:SCAN (\w+)|SEARCH (\w+) USING AUTOMATIC)/u.exec(detail);
        return match && names.has(match[1] ?? match[2]);
      });
      if (!scanned.length) continue;
      if ([...callers].every((caller) => WHOLE_HISTORY.includes(caller))) {
        for (const caller of callers) wholeHistory.add(caller);
        continue;
      }
      scans.push(`${[...commands].join(', ')} (${[...callers].join(', ')}): ${sql.replace(/\s+/gu, ' ').slice(0, 200)}\n    ${plan.join('\n    ')}`);
    }
    assert.deepEqual(scans, [], `${scans.length} hot statements scan events or shouts:\n${scans.join('\n')}`);
    assert.deepEqual([...wholeHistory].sort(), WHOLE_HISTORY, 'a whole-history read stopped scanning: remove it from WHOLE_HISTORY');

    store.openDecisions(board, 'coordinator');
    const runs = [];
    for (let n = 0; n < 5; n += 1) {
      const started = performance.now();
      const open = store.openDecisions(board, 'coordinator');
      runs.push(performance.now() - started);
      assert.equal(open.length, 575);
    }
    const median = runs.sort((a, b) => a - b)[2];
    assert.ok(median < 5, `openDecisions took ${median.toFixed(2)} ms, over 5 ms`);
    console.log(`# openDecisions median ${median.toFixed(2)} ms; ${timings.join('; ')}`);
  } finally {
    store.closeBoard(board);
  }
});

test('health reads item history by index [C7]', () => {
  const box = fixture();
  seed(box.board);
  const board = store.openBoard(box.board, { now: () => new Date('2026-10-22T22:30:00.000Z') });
  const rejectAt = '2026-10-22T21:00:00.000Z';
  const reopenAt = '2026-10-22T22:00:00.000Z';
  const submitAt = '2026-10-22T23:00:00.000Z';
  try {
    store.claim(board, 2, { agentId: 'web-100', lane: 'web', leaseMs: 60_000,
      freeze: (item) => ({ text: item.item_title, digest: `digest:${item.item_title}` }) });
    submitFixture(board, 2, { agentId: 'web-100', commit: 'a'.repeat(40), tree: 'b'.repeat(40) });
    const event = board.db.prepare('INSERT INTO event (event_at, event_by, event_kind, item_id, event_detail) VALUES (?, ?, ?, ?, ?)');
    event.run(rejectAt, 'web-100', 'reject', 1, JSON.stringify({ reason: 'TEST_FAILURE' }));
    event.run(reopenAt, 'coordinator', 'reopen', 1, '{}');
    event.run(submitAt, 'web-100', 'submit', 2, JSON.stringify({ commit: 'a'.repeat(40) }));
  } finally {
    store.closeBoard(board);
  }

  const originalPrepare = DatabaseSync.prototype.prepare;
  let historyPlans = 0;
  DatabaseSync.prototype.prepare = function (sql, ...args) {
    if (/\bSELECT\s+event_id\s*,\s*event_at\s*,\s*event_by\s*,\s*event_kind\s*,\s*item_id\s*,\s*event_detail\s+FROM event\b/iu.test(sql)) {
      const explanation = originalPrepare.call(this, `EXPLAIN QUERY PLAN ${sql}`);
      const plan = (sql.includes('?') ? explanation.all(1) : explanation.all()).map((row) => row.detail);
      historyPlans += 1;
      assert.ok(plan.some((detail) => /\bSEARCH event USING INDEX event_item_id_event_id\b/u.test(detail)),
        `health item history must search its index before reading: ${sql}\n${plan.join('\n')}`);
      assert.ok(!plan.some((detail) => /^SCAN event\b/u.test(detail)),
        `health item history must not scan the event table: ${sql}\n${plan.join('\n')}`);
    }
    return originalPrepare.call(this, sql, ...args);
  };
  try {
    const db = store.openBoardReadOnly(box.board);
    try {
      const started = performance.now();
      const report = healthReport({ db, root: box.repo, now: new Date('2026-10-23T00:00:00.000Z') });
      const elapsed = performance.now() - started;
      assert.ok(historyPlans > 0, 'health planned its item-history statement');
      assert.ok(elapsed < 1_000, `health on 45,000 events took ${elapsed.toFixed(2)} ms, over 1 s`); // budget: approved row C7 requires health under 1s on the seeded board.
      const rework = report.stuck.find((entry) => entry.key === 'REWORK_UNCLAIMED:item:1');
      assert.equal(rework?.since, reopenAt, 'health keeps the latest lifecycle event for the open item');
      assert.deepEqual(rework?.detail, { move: 'reopen', by: 'coordinator' });
      const unreviewed = report.stuck.find((entry) => entry.key === 'NO_REVIEWER:item:2');
      assert.equal(unreviewed?.since, submitAt, 'health keeps the latest submit event for the submitted item');
    } finally {
      db.close();
    }
  } finally {
    DatabaseSync.prototype.prepare = originalPrepare;
  }
});
