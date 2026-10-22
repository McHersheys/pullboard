/** Isolate blocking Git and gates so the coordinator keeps renewing and fencing its board lease [Q1,Q3]. */
import { spawn, execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as store from './board.js';
import { invalidateGitFacts, repoInfo } from './git.js';
import { Refused } from './refused.js';
import { parseProcessCensus } from './process-census.js';

const FILE = fileURLToPath(import.meta.url);

/** Preserve one typed refusal prefix while passing it through more than one process. */
function messageText(error) { return String(error.message).replace(/^\[[A-Z][A-Z0-9_]*\] /u, ''); }

/** Stop only the process group this invocation created; never signal another landing's processes. */
function stop(child) {
  if (!child.pid) return;
  // Sharded gates start their own groups; collect them while their parent ancestry is still present.
  try {
    const rows = parseProcessCensus(execFileSync('/bin/ps', ['-axo', 'pid=,ppid=,pgid=,lstart=,stat=,comm='], { encoding: 'utf8', env: { ...process.env, LC_ALL: 'C', TZ: 'UTC' } }));
    if (rows) {
      const owned = new Set([child.pid]);
      let changed;
      do {
        changed = false;
        for (const row of rows.values()) if (owned.has(row.ppid) && !owned.has(row.pid)) { owned.add(row.pid); changed = true; }
      } while (changed);
      for (const pid of [...owned].reverse()) if (pid !== child.pid) {
        try { process.kill(pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
      }
    }
  } catch { /* The worker's own group is still known; never broaden a failed census to the machine. */ }
  try { process.kill(-child.pid, 'SIGKILL'); }
  catch (error) { if (error.code !== 'ESRCH') throw error; }
}

/** Run blocking batch work under a live parent that owns all canonical writes and lease renewal. */
export async function runLandingWorker(options, { write, checkLease, checkLeaseNow, bindWorker, onWait, say, signal }) {
  const child = spawn(process.execPath, [FILE, 'guardian'], { cwd: options.root, env: process.env, detached: true, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  const inFlight = new Set();
  let result;
  let failure;
  let stderr = '';
  child.stderr.setEncoding('utf8').on('data', part => { stderr = (stderr + part).slice(-65536); });
  /** A failed authority check stops the whole owned group before another command can adopt its worktree. */
  const abort = () => { failure ??= signal.reason; if (child.exitCode === null && child.signalCode === null) stop(child); };
  signal.addEventListener('abort', abort, { once: true });
  /** Reply only over this owned child's channel, preserving the original typed refusal. */
  const answer = (id, value, error) => {
    if (!child.connected) return;
    child.send({ type: 'answer', id, value, error: error ? { code: error.code ?? 'LAND_WORKER', message: messageText(error) } : null }, () => {});
  };
  child.on('message', message => {
    if (message.type === 'say') { say(message.text); return; }
    if (message.type === 'result') { result = message.value; return; }
    if (message.type === 'failure') { failure = new Refused(message.code, message.message); return; }
    if (message.type !== 'call') return;
    /** Permit only the batch worker's narrow protocol, retaining all authority in this parent. */
    const act = async () => {
      if (signal.aborted) throw signal.reason;
      if (message.operation === 'check') { await checkLease(); checkLeaseNow(); return null; }
      if (message.operation === 'wait') return await onWait?.(message.args[0]);
      if (!['recordLandingBatch', 'finishLandingBatch', 'recordLandingFlake', 'recordFlakeObservation', 'recordGateRun', 'reopen', 'appendFact'].includes(message.operation)) {
        throw new Refused('LAND_WORKER', 'the landing worker requested an unsupported operation; stop it and inspect pullboard resume');
      }
      return await write(message.operation, message.args);
    };
    const pending = act().then(value => answer(message.id, value), error => answer(message.id, null, error));
    inFlight.add(pending);
    void pending.finally(() => inFlight.delete(pending));
  });
  try {
    const terminal = new Promise(resolveClose => {
      child.once('error', error => { failure = error; });
      child.once('close', (code, terminatedBy) => resolveClose({ code, signal: terminatedBy }));
    });
    await new Promise((resolveSpawn, reject) => { child.once('spawn', resolveSpawn); child.once('error', reject); });
    await bindWorker(child.pid);
    if (signal.aborted) abort();
    else child.send({ type: 'start', options });
    const status = await terminal;
    if (failure) throw failure;
    if (status.code !== 0 || result === undefined) throw new Refused('LAND_WORKER', `the landing worker stopped without a completed batch (${status.signal ?? status.code}); inspect pullboard resume before adopting${stderr ? `: ${stderr.trim()}` : ''}`);
    return result;
  } finally {
    signal.removeEventListener('abort', abort);
    if (child.exitCode === null && child.signalCode === null) stop(child);
    await Promise.allSettled(inFlight);
  }
}

/** Make one checked request to the live parent without giving the worker independent board-write authority. */
function channel() {
  let next = 0;
  let finished = false;
  const waiting = new Map();
  process.on('message', message => {
    if (message.type !== 'answer') return;
    const pair = waiting.get(message.id);
    if (!pair) return;
    waiting.delete(message.id);
    if (message.error) pair.reject(new Refused(message.error.code, message.error.message));
    else pair.resolve(message.value);
  });
  process.once('disconnect', () => { if (!finished) { try { process.kill(-process.pid, 'SIGKILL'); } catch { process.exit(1); } } });
  const call = (operation, args = []) => new Promise((resolve, reject) => {
    const id = ++next;
    waiting.set(id, { resolve, reject });
    process.send({ type: 'call', id, operation, args });
  });
  return { call, finish(message) { finished = true; process.send(message, () => process.disconnect()); } };
}

/** Enter batch execution only through the parent's private process channel. */
async function workerMain(options) {
  const pipe = channel();
  const { call } = pipe;
  const board = store.openBoard(join(repoInfo(options.root).commonDir, 'pullboard', 'board.sqlite'));
  try {
    const { runLandingBatch } = await import('./land.js');
    /** Canonical catch-up may have moved proof or trunk while the request was in flight. */
    const checkLease = async () => { await call('check'); invalidateGitFacts(); assertWorkerFence(board, options.fence); };
    const result = await runLandingBatch({ ...options, board, write: (operation, args) => call(operation, args),
      say: text => process.send({ type: 'say', text }), onWait: state => call('wait', [state]), checkLease,
      checkLeaseNow: () => assertWorkerFence(board, options.fence) });
    pipe.finish({ type: 'result', value: result });
  } catch (error) {
    process.exitCode = 1;
    pipe.finish({ type: 'failure', code: error.code ?? 'LAND_WORKER', message: messageText(error) });
  } finally { store.closeBoard(board); }
}

/** Check the shared native board immediately before a physical Git action, with no intervening await. */
function assertWorkerFence(board, fence) {
  // This imported live binding is used only after module initialization, keeping board cycles inert.
  return assertLandingLease(board, fence);
}
import { assertLandingLease } from './landing-lease.js';

/** A nonblocking guardian survives CLI death and stops its own whole group, even while the worker is synchronous. */
function guardianMain() {
  let worker;
  let finished = false;
  let closed = false;
  let pending = 0;
  /** Flush result and refusal messages before ending this private channel normally. */
  const finish = () => {
    if (!closed || pending) return;
    finished = true;
    if (process.connected) process.disconnect();
  };
  process.on('message', message => {
    if (message.type === 'start' && !worker) {
      // The worker stays in this guardian's detached group; its gates inherit that group too.
      worker = spawn(process.execPath, [FILE, 'worker'], { cwd: message.options.root, env: process.env,
        stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
      worker.on('message', value => {
        if (!process.connected) return;
        pending += 1;
        process.send(value, () => { pending -= 1; finish(); });
      });
      worker.once('error', error => {
        if (process.connected) process.send({ type: 'failure', code: 'LAND_WORKER', message: error.message });
      });
      worker.once('close', (code, signal) => {
        closed = true;
        process.exitCode = code ?? (signal ? 1 : 0);
        finish();
      });
      worker.send(message);
    } else if (worker?.connected) worker.send(message, () => {});
  });
  process.once('disconnect', () => { if (!finished) stop({ pid: process.pid }); });
}

if (process.argv[1] === FILE && process.send) {
  if (process.argv[2] === 'guardian') guardianMain();
  else if (process.argv[2] === 'worker') process.once('message', message => {
    if (message.type === 'start') void workerMain(message.options);
  });
}
