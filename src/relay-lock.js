/** The per-board link lock: one worktree sends at a time, and a sibling waits instead of failing (#919). */
import {
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import {
  dirname,
  join,
} from 'node:path';
import { Refused } from './refused.js';

/** Longest wait for a sibling worktree's relay send, and how often the waiting command says so. */
const LOCK_WAIT_MS = 120000;
const LOCK_PROGRESS_MS = 10000;

/**
 * Wait for another worktree's upload, recovering a lock only when its owner is gone.
 * Why: one large baseline PUT can hold the lock past any short limit, and a board move that gave up
 * after 15 s failed for a reason the person cannot fix (#919); the wait is up to 2 minutes with a progress line.
 */
export async function locked(file, work, io) {
  const lock = file + '.lock';
  mkdirSync(dirname(file), { recursive: true });
  const startedAt = Date.now();
  const deadline = startedAt + (io?.relayLockWaitMs ?? LOCK_WAIT_MS);
  const progressEvery = io?.relayLockProgressMs ?? LOCK_PROGRESS_MS;
  let nextProgress = startedAt + progressEvery;
  while (true) {
    try { mkdirSync(lock, { mode: 0o700 }); writeFileSync(join(lock, 'pid'), String(process.pid)); break; }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      try {
        const pid = Number(readFileSync(join(lock, 'pid'), 'utf8'));
        if (Number.isInteger(pid) && pid > 0) {
          try { process.kill(pid, 0); } catch (dead) { if (dead.code === 'ESRCH') { rmSync(lock, { recursive: true, force: true }); continue; } }
        }
      } catch {
        try { if (Date.now() - lstatSync(lock).mtimeMs > 30000) { rmSync(lock, { recursive: true, force: true }); continue; } }
        catch (gone) { if (gone.code === 'ENOENT') continue; throw gone; }
      }
      if (Date.now() >= deadline) throw new Refused('RELAY_BUSY', `another worktree was still sending this board after ${Math.round((Date.now() - startedAt) / 1000)} s; nothing was lost, so run the command again`);
      if (io?.err && Date.now() >= nextProgress) {
        nextProgress = Date.now() + progressEvery;
        io.err(`pullboard: waiting for another worktree to finish sending this board (${Math.round((Date.now() - startedAt) / 1000)} s of ${Math.round((deadline - startedAt) / 1000)} s)`);
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  try {
    // Only the current lock holder can have a live link write; remove crashed legacy bearer fragments.
    for (const name of readdirSync(dirname(file))) {
      if (/^relay\.json\.[0-9a-f-]+\.tmp$/u.test(name)) rmSync(join(dirname(file), name), { force: true });
    }
    return await work();
  } finally { rmSync(lock, { recursive: true, force: true }); }
}
