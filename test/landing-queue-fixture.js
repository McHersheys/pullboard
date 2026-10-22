/** Public, real-Git landing contention fixture; no private drill data is used [B3,R3,Q1,Q2,E8]. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as store from '../src/board.js';

/** Run an ordinary fixture command and retain its full refusal on failure. */
function run(box, root, ...args) {
  const result = box.run(root, ...args);
  assert.equal(result.code, 0, `${args.join(' ')}: ${result.err}\n${result.out}`);
  return result.out;
}

/** Read the real board, always closing its SQLite handle. */
function readBoard(box, action) {
  const board = store.openBoard(join(box.repo, '.git', 'pullboard', 'board.sqlite'));
  try { return action(board); }
  finally { store.closeBoard(board); }
}

/** Observe only a recorded fixture PID; no process is signalled by this read. */
function alive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) { if (error.code === 'ESRCH') return false; throw error; }
}

/** Retain actual states for only this fixture's known PIDs when a custody assertion fails. */
function processObservation(pids) {
  const result = spawnSync('/bin/ps', ['-o', 'pid=,ppid=,pgid=,stat=', '-p', pids.join(',')], { encoding: 'utf8' });
  return { status: result.status, states: result.stdout?.trim() ?? '', error: result.error?.code ?? null };
}

/** Build two independent items and accept the higher id first through actual CLI checks. */
function acceptedPair(helpers, box, staleAfterFirst) {
  const entries = [1, 2].map(number => {
    const root = join(box.dir, `queue-build-${number}`);
    box.git(box.repo, 'worktree', 'add', '-q', '-b', `web/queue-${number}`, root, 'main');
    run(box, root, 'join', 'web');
    const file = `web/queue-${number}.txt`;
    const added = JSON.parse(run(box, box.repo, 'add', 'web', `Queue item ${number}`, '--specs', 'G1',
      '--criterion', `queue item ${number} works`, '--check', `grep -qx works ${file}`, '--json'));
    const id = added.item.item_id;
    run(box, root, 'claim', String(id));
    if (number === 2 && staleAfterFirst) {
      // The first-to-land item changes the lower id's checked path on an independent branch.
      mkdirSync(join(root, 'web'), { recursive: true });
      writeFileSync(join(root, 'web', 'queue-1.txt'), 'works changed\n');
    }
    const commit = helpers.commitFile(box, root, file, 'works\n', 'feat(web): build queue fixture [G1]');
    assert.equal(commit.status, 0, commit.stderr);
    run(box, root, 'submit', String(id));
    return { id, head: box.git(root, 'rev-parse', 'HEAD') };
  });
  for (const entry of [...entries].reverse()) {
    const review = join(box.dir, `queue-review-${entry.id}`);
    box.git(box.repo, 'worktree', 'add', '-q', '--detach', review, entry.head);
    run(box, review, 'join', 'api');
    run(box, review, 'next', '--verify', String(entry.id));
    run(box, review, 'verify', String(entry.id), 'accept', '--note', 'The exact item check passes in this independent private fixture seat.');
  }
  return entries;
}

/** Prove named waiting, exclusion and verdict order with two real overlapping land commands. */
export async function landingQueueCase(t, helpers, { staleAfterFirst = false, killParent = false, killGuardian = false, suspendParent = false } = {}) {
  const sandbox = helpers.sandbox();
  const arm = join(sandbox.dir, 'landing-armed');
  const entered = join(sandbox.dir, 'landing-entered');
  const release = join(sandbox.dir, 'landing-release');
  const gatePid = join(sandbox.dir, 'landing-gate-pid');
  const gateFile = join(sandbox.dir, 'landing-queue-gate.cjs');
  writeFileSync(gateFile, [
    "const fs = require('node:fs'); const assert = require('node:assert/strict');",
    `const [arm,entered,release,gatePid] = ${JSON.stringify([arm, entered, release, gatePid])};`,
    ...(suspendParent ? ["if (fs.existsSync(gatePid)) { const old = Number(fs.readFileSync(gatePid,'utf8')); try { process.kill(old,0); throw new Error('the previous landing gate is still running when the successor gate starts'); } catch(error) { if (error.code !== 'ESRCH') throw error; } }"] : []),
    // Budget: the suspended-parent control holds beyond the real 30s lease; 65s is a runaway ceiling, not a speed target.
    `if (fs.existsSync(arm)) { fs.writeFileSync(gatePid, String(process.pid)); fs.writeFileSync(entered, process.cwd()); const end = Date.now() + ${suspendParent ? 65000 : 20000}; while (!fs.existsSync(release) && Date.now() < end) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,20); assert.ok(fs.existsSync(release), 'owning test releases the gate'); }`,
    "const files = fs.existsSync('web') ? fs.readdirSync('web').filter(file => /^queue-\\d+\\.txt$/.test(file)) : [];",
    "for (const file of files) assert.match(fs.readFileSync('web/' + file,'utf8'), /^works/);",
    "console.log('TAP version 13\\nok 1 - landed queue files keep their behavior\\n1..1\\n# tests 1\\n# pass 1\\n# fail 0');",
  ].join('\n'));
  const box = helpers.project(`node ${JSON.stringify(gateFile)}`, sandbox);
  const remote = join(box.dir, 'queue-origin.git');
  box.git(box.dir, 'init', '-q', '--bare', remote);
  box.git(box.repo, 'remote', 'add', 'origin', remote);
  box.git(box.repo, 'push', '-q', '-u', 'origin', 'main');
  const entries = acceptedPair(helpers, box, staleAfterFirst);
  const base = box.git(box.repo, 'rev-parse', 'main');
  const children = [];
  t.after(async () => {
    writeFileSync(release, 'released');
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) { child.kill('SIGCONT'); child.kill('SIGTERM'); }
      await child.closed;
    }
  });
  writeFileSync(arm, 'armed');
  box.env.CODEX_THREAD_ID = 'private-landing-queue-session';
  const first = helpers.launch(box, box.repo, process.execPath, [helpers.BIN, 'land', '--max', '1']);
  children.push(first);
  await helpers.waitFor(() => existsSync(entered) || first.exitCode !== null, 'first landing reaches its real gate');
  assert.ok(existsSync(entered), first.failure ?? first.stderrText);
  const firstBatch = readBoard(box, board => store.landingBatches(board).at(-1));
  assert.equal(firstBatch.state, 'gating');
  assert.deepEqual(firstBatch.items.map(entry => entry.id), [entries[1].id], 'verdict order precedes numeric item order');
  if (suspendParent) rmSync(arm); // Only later gates become unblocked; the current one still requires its unreleased marker.
  const second = helpers.launch(box, box.repo, process.execPath, [helpers.BIN, 'land', ...(suspendParent ? ['--adopt'] : ['--max', '1'])]);
  children.push(second);
  await helpers.waitFor(() => /landing waiting: .*held by .*; queued/u.test(second.stdoutText) || second.exitCode !== null,
    'second landing names its holder and queues');
  assert.match(second.stdoutText, /landing waiting: .*held by .*; queued/u, `${second.stdoutText}\n${second.stderrText}`);
  const holder = readBoard(box, board => store.landingLeaseState(board).holder);
  assert.equal(holder.pid, first.pid);
  assert.ok(second.stdoutText.includes(holder.label), 'the queue names the actual durable holder');
  assert.equal(second.exitCode, null, 'the second command stays queued instead of refusing');
  assert.equal(readBoard(box, board => store.landingBatches(board).length), 1, 'the waiter creates no concurrent batch');
  assert.equal(box.git(box.repo, 'rev-parse', 'main'), base, 'neither unfinished gate advances main');
  await helpers.waitFor(() => Date.parse(readBoard(box, board => store.landingLeaseState(board).holder?.until)) > Date.parse(holder.until),
    'the independent parent renews while the worker is blocked inside its real synchronous gate');
  assert.equal(readBoard(box, board => store.landingBatches(board).at(-1).state), 'gating');
  if (killParent || killGuardian || suspendParent) {
    const blockedGatePid = Number(readFileSync(gatePid, 'utf8'));
    assert.ok(Number.isSafeInteger(holder.guardianPid));
    if (killParent) {
      first.kill('SIGKILL'); // Only the CLI dies; its separately grouped guardian owns the blocked gate.
      assert.equal((await first.closed).signal, 'SIGKILL');
    } else if (killGuardian) {
      process.kill(holder.guardianPid, 'SIGKILL'); // This exact PID came from this private command's bound guardian.
    } else first.kill('SIGSTOP'); // Keep IPC connected while the authority owner cannot renew or run its own watchdog.
    try {
      await helpers.waitFor(() => !alive(holder.guardianPid) && !alive(blockedGatePid), 'the guardian and blocked gate stop without releasing their marker',
        suspendParent ? 45_000 : 8_000); // Budget: actual 30s lease expiry plus owned-process drain; not a speed threshold.
    } catch (error) {
      const batch = readBoard(box, board => store.landingBatches(board).at(-1));
      error.message += '; custody observation: ' + JSON.stringify({ processes: processObservation([first.pid, holder.guardianPid, blockedGatePid, second.pid]),
        firstExit: first.exitCode, secondExit: second.exitCode, batchState: batch.state, revision: batch.revision, releaseExists: existsSync(release) });
      throw error;
    }
    if (suspendParent) {
      const successor = await second.closed;
      assert.equal(successor.code, 0, successor.failure ?? 'the queued adopter lands only after the previous gate is dead');
      assert.equal(existsSync(release), false, 'no test release made the old gate look drained');
      assert.equal(readBoard(box, board => store.landingBatches(board).at(-1).state), 'landed');
      first.kill('SIGCONT');
      assert.equal((await first.closed).code, 1, 'the resumed old holder cannot use its expired generation');
      run(box, box.repo, 'land', '--max', '1');
      assert.equal(readBoard(box, board => store.landingBatches(board).length), 2);
      return;
    }
    if (!killParent) assert.equal((await first.closed).code, 1, 'a surviving authority owner refuses after its worker stops');
    assert.equal(existsSync(release), false, 'the owning test did not let the abandoned gate proceed');
    const waiting = await second.closed;
    assert.equal(waiting.code, 1);
    assert.match(second.stderrText, /LAND_ADOPT/u, 'a queued ordinary land preserves explicit interrupted-batch adoption');
    rmSync(arm); // Future gates may run, but removing arm cannot unblock the old gate's release loop.
    const adopted = JSON.parse(run(box, box.repo, 'land', '--adopt', '--json'));
    assert.equal(adopted.batch.id, firstBatch.id);
    assert.deepEqual(adopted.landed, [entries[1].id]);
    run(box, box.repo, 'land', '--max', '1');
    assert.deepEqual(readBoard(box, board => store.landingBatches(board).flatMap(batch => batch.items.map(entry => entry.id))), [entries[1].id, entries[0].id]);
    return;
  }
  writeFileSync(release, 'released');
  const results = await Promise.all(children.map(child => child.closed));
  if (staleAfterFirst) {
    assert.equal(results[0].code, 0, results[0].failure);
    assert.equal(results[1].code, 1, 'the queued command refuses the now-stale acceptance');
    assert.match(second.stderrText, /STALE_VERDICT/u);
    assert.equal(readBoard(box, board => store.landingBatches(board).length), 1, 'a stale waiter starts no batch');
    assert.equal(readBoard(box, board => store.getItem(board, entries[0].id).item_merged_commit), null);
    return;
  }
  for (const result of results) assert.deepEqual({ code: result.code, signal: result.signal }, { code: 0, signal: null }, result.failure ?? 'land succeeds');
  const batches = readBoard(box, store.landingBatches);
  assert.equal(batches.length, 2);
  assert.ok(batches.every(batch => batch.state === 'landed'));
  assert.deepEqual(batches.flatMap(batch => batch.items.map(entry => entry.id)), [entries[1].id, entries[0].id]);
  assert.equal(batches[1].base, batches[0].tip, 'the waiter selects against the completed first landing');
  assert.equal(box.git(box.repo, 'rev-parse', 'main'), batches[1].tip);
  for (const entry of entries) {
    assert.equal(readFileSync(join(box.repo, `web/queue-${entry.id}.txt`), 'utf8'), 'works\n');
    assert.equal(readBoard(box, board => board.db.prepare("SELECT COUNT(*) AS n FROM event WHERE event_kind='merged' AND item_id=?").get(entry.id).n), 1);
  }
}
