/** Run a bounded shell under identity-checked process custody before returning its result [E27]. */
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDescendantTracker } from './runner-custody.js';

const request = JSON.parse(readFileSync(0, 'utf8'));
if (!Number.isSafeInteger(request.timeoutMs) || request.timeoutMs < 1 || request.timeoutMs > 2_147_483_647) throw new Error('invalid shell timeout');
const directory = mkdtempSync(join(tmpdir(), 'pullboard-timed-shell-'));
const tracker = createDescendantTracker(directory);
const env = { ...process.env, NODE_OPTIONS: [process.env.NODE_OPTIONS, tracker.nodeOptions].filter(Boolean).join(' '), PULLBOARD_RUNNER_PRELOAD: tracker.nodeOptions };
const child = spawn('/bin/sh', ['-c', request.command], { env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
tracker.registerRoot(child.pid);
tracker.observe();
let timedOut = false;
let overflow = false;
let error = null;
let bytes = 0;
let stopping;
const chunks = [];
const closed = new Promise(resolveClose => {
  child.once('error', cause => { error = cause.message; resolveClose({ status: null, signal: null }); });
  child.once('close', (status, signal) => resolveClose({ status, signal }));
});

/** Drain only currently proven descendants and root groups; ambiguity keeps custody rather than freeing a lease. */
function stop() {
  stopping ??= (async () => {
    await tracker.stopDescendants();
    for (const signal of ['SIGTERM', 'SIGKILL']) {
      const deadline = Date.now() + 2_000;
      for (;;) {
        const sent = tracker.signalOwnedGroup(child.pid, signal);
        if (sent === false) break;
        if (sent === true && Date.now() >= deadline) break;
        await new Promise(resolvePause => setTimeout(resolvePause, 50));
      }
    }
    await closed;
    await tracker.verifyAfterGroups();
  })();
  return stopping;
}

/** Retain the gate's merged output within its existing one-GiB bound. */
function capture(chunk) {
  bytes += chunk.length;
  if (bytes > 2 ** 30) { overflow = true; void stop(); }
  else chunks.push(chunk);
}
child.stdout.on('data', capture);
child.stderr.on('data', capture);
child.once('exit', () => { void stop(); });
const timer = setTimeout(() => { timedOut = true; void stop(); }, request.timeoutMs);
process.on('SIGTERM', () => { timedOut = true; void stop(); });
process.on('SIGHUP', () => { timedOut = true; void stop(); });
const result = await closed;
clearTimeout(timer);
await stop();
tracker.stopMonitoring();
rmSync(directory, { recursive: true, force: true });
process.stdout.write(JSON.stringify({ ...result, timedOut, overflow, error, output: Buffer.concat(chunks).toString('utf8') }));
