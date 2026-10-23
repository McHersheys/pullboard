/** Test files on one machine never outnumber its cores, and the longest files start first [C7]. */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { runFixtureChild, runFixtureChildAsync, startFixtureChild } from './fixture-child.js';
import { TEST_FILE_CORES_ENV, TEST_FILE_POOL_ENV, occupiedPlaces } from '../src/test-file-pool.js';

const runner = fileURLToPath(new URL('../bin/run-tests.js', import.meta.url));

/** A fixture test file that logs when its body starts and ends, holding its token for `ms`. */
function timedFile(name, ms, body = '') {
  return `import { appendFileSync } from 'node:fs';
import { test } from 'node:test';
const mark = at => appendFileSync(process.env.FIXTURE_LOG, JSON.stringify({ run: process.env.FIXTURE_RUN, file: ${JSON.stringify(name)}, at, t: Date.now() }) + '\\n');
test(${JSON.stringify(name)}, async () => {
  mark('start');
  ${body}
  await new Promise(done => setTimeout(done, ${ms}));
  mark('end');
});
`;
}

/** A Git fixture repository with its own machine home, and an environment whose pool has `cores` tokens. */
function fixture(t, cores) {
  const root = mkdtempSync(join(tmpdir(), 'pullboard-file-pool-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  runFixtureChild('git', ['init', '-q'], { cwd: root });
  writeFileSync(join(root, 'package.json'), JSON.stringify({ type: 'module' }));
  const machine = join(root, '.machine');
  mkdirSync(machine);
  // Four gate slots, so the four runs overlap and only the file pool can hold them to the cores.
  writeFileSync(join(machine, 'settings.json'), JSON.stringify({ gateSlots: 4, browserSlots: 1 }));
  const env = { ...process.env, PULLBOARD_MACHINE_HOME: machine, [TEST_FILE_CORES_ENV]: String(cores), FIXTURE_LOG: join(root, 'log.jsonl') };
  // This test file holds a token of its own run's pool; the fixture runs get a pool of their own.
  delete env[TEST_FILE_POOL_ENV];
  return { root, env, log: () => readFileSync(env.FIXTURE_LOG, 'utf8').trim().split('\n').map(line => JSON.parse(line)) };
}

/** The most file bodies running at one moment in a start/end log. */
function peak(events) {
  let live = 0;
  let most = 0;
  for (const event of [...events].sort((a, b) => a.t - b.t || (a.at === 'end' ? -1 : 1))) {
    live += event.at === 'start' ? 1 : -1;
    most = Math.max(most, live);
  }
  return most;
}

test('four runs never hold more test files than cores, and the longest-recorded file starts first [C7]', async (t) => {
  const { root, env, log } = fixture(t, 4);
  const files = ['a.test.js', 'b.test.js', 'c.test.js', 'd.test.js', 'e.test.js', 'z-slow.test.js'];
  for (const file of files) writeFileSync(join(root, file), timedFile(file, 300));
  const runs = await Promise.all([1, 2, 3, 4].map(run => runFixtureChildAsync(process.execPath, [runner, ...files],
    { cwd: root, env: { ...env, FIXTURE_RUN: String(run) } })));
  for (const result of runs) assert.equal(result.status, 0, `${result.failure ?? ""}\n${result.stdout.slice(-3000)}`);
  const events = log();
  assert.equal(events.filter(event => event.at === 'start').length, 24, 'every file of every run ran');
  assert.ok(peak(events) <= 4, `at most 4 files at once on 4 cores, saw ${peak(events)}`);

  // The last landing timed z-slow longest, so it starts first though it sorts last.
  mkdirSync(join(root, '.git', 'pullboard'), { recursive: true });
  writeFileSync(join(root, '.git', 'pullboard', 'landing-file-times.json'),
    JSON.stringify({ version: 1, files: { 'z-slow.test.js': 9000, 'c.test.js': 500, 'a.test.js': 10 } }));
  writeFileSync(join(root, 'pullboard.json'), JSON.stringify({ testConcurrency: { files: 1 } }));
  writeFileSync(env.FIXTURE_LOG, '');
  const ordered = runFixtureChild(process.execPath, [runner, ...files], { cwd: root, env: { ...env, FIXTURE_RUN: 'order', PULLBOARD_LANDING_RUN: '1' }, encoding: 'utf8' });
  assert.equal(ordered.status, 0, ordered.failure ?? ordered.stdout);
  assert.deepEqual(log().filter(event => event.at === 'start').map(event => event.file),
    ['z-slow.test.js', 'c.test.js', 'a.test.js', 'b.test.js', 'd.test.js', 'e.test.js'], 'timed files longest first, then the rest in order');
});

test('a file waiting on a nested run lends its place, so saturated parents still run at most cores files [C7]', async (t) => {
  const { root, env, log } = fixture(t, 2);
  for (const file of ['inner-a.test.js', 'inner-b.test.js']) writeFileSync(join(root, file), timedFile(file, 300));
  // Each outer file runs both inner files through run-tests and waits; its own body does no work meanwhile.
  const nested = `const { spawnSync } = await import('node:child_process');
  const inner = spawnSync(process.execPath, [${JSON.stringify(runner)}, 'inner-a.test.js', 'inner-b.test.js'], { cwd: ${JSON.stringify(root)}, env: { ...process.env, FIXTURE_RUN: 'inner-' + process.pid }, encoding: 'utf8' });
  if (inner.status !== 0) throw new Error(inner.stdout + inner.stderr);`;
  for (const file of ['outer-a.test.js', 'outer-b.test.js']) {
    writeFileSync(join(root, file), timedFile(file, 0, nested).replace("mark('start');", '').replace("mark('end');", ''));
  }
  const result = await runFixtureChildAsync(process.execPath, [runner, 'outer-a.test.js', 'outer-b.test.js'], { cwd: root, env: { ...env, FIXTURE_RUN: 'outer' } });
  assert.equal(result.status, 0, result.failure ?? result.stdout);
  const events = log();
  assert.equal(events.filter(event => event.at === 'start').length, 4, 'both inner files ran under both outer files');
  assert.ok(peak(events) <= 2, `two saturated outer files with nested runs still run at most 2 files, saw ${peak(events)}`);
});

test('a caller keeps its place while its synchronous call is open, so no other file takes it [C7]', async (t) => {
  const home = mkdtempSync(join(tmpdir(), 'pullboard-file-pool-race-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  /** A live process to stand in for one pool row; the pool prunes rows of processes that have gone. */
  const live = () => {
    const child = startFixtureChild('sleep', ['30']);
    t.after(() => child.kill('SIGKILL'));
    return child.pid;
  };
  assert.equal(await occupiedPlaces(home), 0);
  const db = new DatabaseSync(join(home, 'test-file-pool.sqlite'));
  t.after(() => db.close());
  const [parent, unrelated, child] = [live(), live(), live()];
  const hold = (pid, lender = null, call = null) => db.prepare('INSERT INTO file_holder(pid, since, lender, call) VALUES (?, ?, ?, ?)').run(pid, Date.now(), lender, call);
  hold(parent);
  hold(unrelated);
  db.prepare('INSERT INTO file_call(call, lender) VALUES (?, ?)').run('call-1', parent);
  assert.equal(await occupiedPlaces(home), 2, 'a caller with no file of its call yet keeps its place');
  hold(child, parent, 'call-1');
  assert.equal(await occupiedPlaces(home), 2, 'the file of its call runs in that place');
  db.prepare('UPDATE file_call SET closing = 1 WHERE call = ?').run('call-1');
  assert.equal(await occupiedPlaces(home), 2, 'a closing call still counts its file in the caller\'s place');
  db.prepare('DELETE FROM file_holder WHERE pid = ?').run(child);
  assert.equal(await occupiedPlaces(home), 2, 'that file gone, the place is the caller\'s again, not free');
  db.prepare('DELETE FROM file_call WHERE call = ?').run('call-1');
  assert.equal(await occupiedPlaces(home), 2, 'the call returned, the caller runs in its own place');
});

test('a parent that starts its nested run asynchronously keeps its own token, so its nested files take separate ones [C7]', async (t) => {
  const { root, env, log } = fixture(t, 2);
  for (const file of ['inner-a.test.js', 'inner-b.test.js']) writeFileSync(join(root, file), timedFile(file, 400));
  // The parent starts its nested run without blocking on it and spins the CPU until the run ends.
  writeFileSync(join(root, 'busy.test.js'), `import { spawn } from 'node:child_process';
import { test } from 'node:test';
test('busy parent', async () => {
  const child = spawn(process.execPath, [${JSON.stringify(runner)}, 'inner-a.test.js', 'inner-b.test.js'], { cwd: ${JSON.stringify(root)}, env: { ...process.env, FIXTURE_RUN: 'inner' }, stdio: 'ignore' });
  let done = false;
  child.on('exit', () => { done = true; });
  while (!done) {
    const until = Date.now() + 40;
    while (Date.now() < until) { /* computing */ }
    await new Promise(next => setImmediate(next));
  }
});
`);
  const result = await runFixtureChildAsync(process.execPath, [runner, 'busy.test.js'], { cwd: root, env: { ...env, FIXTURE_RUN: 'outer' } });
  assert.equal(result.status, 0, result.failure ?? result.stdout);
  const events = log();
  assert.equal(events.filter(event => event.at === 'start').length, 2, 'both nested files ran');
  assert.equal(peak(events), 1, 'with the busy parent holding one of 2 places, its nested files share the one left');
});

test('a run a synchronous call leaves behind lends nothing once the call returns [C7]', async (t) => {
  const { root, env, log } = fixture(t, 1);
  for (const file of ['inner-a.test.js', 'inner-b.test.js']) writeFileSync(join(root, file), timedFile(file, 200));
  // The parent's shell call starts a detached run and returns at once; the parent then works on in its own place.
  const detached = `const { execSync } = await import('node:child_process');
  execSync(${JSON.stringify(`${JSON.stringify(process.execPath)} ${JSON.stringify(runner)} inner-a.test.js inner-b.test.js > /dev/null 2>&1 &`)}, { cwd: ${JSON.stringify(root)}, env: { ...process.env, FIXTURE_RUN: 'inner' } });
  const until = Date.now() + 1500;
  while (Date.now() < until) { /* computing in its own place */ }`;
  writeFileSync(join(root, 'parent.test.js'), timedFile('parent.test.js', 0, detached));
  const result = await runFixtureChildAsync(process.execPath, [runner, 'parent.test.js'], { cwd: root, env: { ...env, FIXTURE_RUN: 'outer' } });
  assert.equal(result.status, 0, result.failure ?? result.stdout);
  const deadline = Date.now() + 30_000;
  while (log().filter(event => event.run === 'inner' && event.at === 'end').length < 2 && Date.now() < deadline) await new Promise(next => setTimeout(next, 100));
  const events = log();
  const parentEnd = events.find(event => event.file === 'parent.test.js' && event.at === 'end').t;
  const innerStarts = events.filter(event => event.run === 'inner' && event.at === 'start').map(event => event.t);
  assert.equal(innerStarts.length, 2, 'the detached run finished both files');
  assert.ok(innerStarts.every(at => at >= parentEnd), 'on 1 core, the detached run waited for the parent instead of borrowing its place');
});

test('a synchronous call returns only after the file it lent its place to has exited [C7]', async (t) => {
  const { root, env, log } = fixture(t, 1);
  writeFileSync(join(root, 'inner.test.js'), timedFile('inner.test.js', 2000));
  // The shell starts a run, waits until its file is surely admitted inside the open call, then returns.
  const lingering = `const { execSync } = await import('node:child_process');
  execSync(${JSON.stringify(`${JSON.stringify(process.execPath)} ${JSON.stringify(runner)} inner.test.js > /dev/null 2>&1 & sleep 1`)}, { cwd: ${JSON.stringify(root)}, env: { ...process.env, FIXTURE_RUN: 'inner' } });
  mark('resume');`;
  writeFileSync(join(root, 'parent.test.js'), timedFile('parent.test.js', 0, lingering));
  const result = await runFixtureChildAsync(process.execPath, [runner, 'parent.test.js'], { cwd: root, env: { ...env, FIXTURE_RUN: 'outer' } });
  assert.equal(result.status, 0, result.failure ?? result.stdout);
  const deadline = Date.now() + 30_000;
  while (!log().some(event => event.file === 'inner.test.js' && event.at === 'end') && Date.now() < deadline) await new Promise(next => setTimeout(next, 100));
  const events = log();
  const innerEnd = events.find(event => event.file === 'inner.test.js' && event.at === 'end')?.t;
  const resumed = events.find(event => event.at === 'resume').t;
  assert.ok(innerEnd, 'the nested file ran inside the call');
  assert.ok(resumed >= innerEnd, 'on 1 core, the caller resumed only after the file in its place exited');
});
