/** Compare a native unflagged control with the actual test harness arguments [C7]. */
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { hostname, loadavg, tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromeCloneSnapshot, newChromeClones } from '../src/chrome-clone-check.js';
import { findChromeExecutable, launchChromeProcess } from './chrome-fixture.js';
import { chromeLaunchArgs } from './chrome-launch-args.js';

/** Poll one bounded native handshake; never extend a declared browser deadline. */
async function waitUntil(predicate, timeoutMs, message) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.fail(message);
}

/** Ask only this private profile's browser to exit gracefully, preserving Chromium's own cleanup. */
async function gracefulClose(profile, launched) {
  if (launched.child.exitCode !== null || launched.child.signalCode !== null) return;
  const port = readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0].trim();
  assert.match(port, /^\d+$/u);
  const response = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(2_000) });
  const info = await response.json();
  const socket = new WebSocket(info.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.close(); reject(new Error('private Chrome graceful close timed out')); }, 3_000); // budget: hang ceiling for this private browser's graceful shutdown.
    socket.addEventListener('open', () => socket.send(JSON.stringify({ id: 1, method: 'Browser.close' })), { once: true });
    socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('private Chrome close connection failed')); }, { once: true });
    socket.addEventListener('close', () => { clearTimeout(timer); resolve(); }, { once: true });
  });
  await waitUntil(() => launched.child.exitCode !== null || launched.child.signalCode !== null, 3_000, 'native Chrome did not exit after Browser.close');
}

/** Run a real control and SIGKILL the test launch; no code deletes any clone directory. */
export async function assertNoKilledChromeClone(t) {
  t.diagnostic(JSON.stringify({ host: hostname(), node: process.version, load: loadavg(), chrome: findChromeExecutable() }));
  const initial = chromeCloneSnapshot();
  for (const control of [true, false]) {
    const profile = mkdtempSync(join(tmpdir(), 'pullboard-clone-proof-'));
    const before = chromeCloneSnapshot();
    const args = chromeLaunchArgs(profile).filter(arg => !control || arg !== '--disable-features=MacAppCodeSignClone');
    // Force the native feature on in both arms; the harness disable switch must take precedence.
    args.unshift('--enable-features=MacAppCodeSignClone');
    const launched = launchChromeProcess({ executable: findChromeExecutable(), args });
    try {
      await waitUntil(() => existsSync(join(profile, 'DevToolsActivePort')), 15_000, 'real Chrome did not publish its private DevTools port');
      if (control) {
        await waitUntil(() => newChromeClones(before).length > 0, 5_000, 'unflagged native Chrome must create a clone for the control');
        t.diagnostic(JSON.stringify({ phase: 'unflagged-control', newClones: newChromeClones(before).length }));
        await gracefulClose(profile, launched);
        await waitUntil(() => newChromeClones(before).length === 0, 5_000, 'Chromium must clean its own control clone after graceful shutdown');
      } else {
        // Give the same native startup path time to create the clone that the positive control demonstrated.
        await new Promise(resolve => setTimeout(resolve, 1_000)); // budget: observe the native clone after DevTools readiness, before deliberate SIGKILL.
        launched.child.kill('SIGKILL');
        await launched.close();
        assert.deepEqual(newChromeClones(before), [], 'the harness must prevent clones even when its Chrome is SIGKILLed');
      }
    } catch (error) {
      t.diagnostic(JSON.stringify({ phase: control ? 'unflagged-control' : 'harness', args, stderr: launched.stderr.slice(-2_000), newClones: newChromeClones(before).length }));
      throw error;
    } finally {
      try { await gracefulClose(profile, launched); }
      finally { await launched.close(); rmSync(profile, { recursive: true, force: true }); }
    }
  }
  assert.deepEqual(newChromeClones(initial), [], 'the native control and killed test launch leave no new clone');
}
