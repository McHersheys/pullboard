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
// Budget: a lock with no readable owner this long after it was made belongs to a command that died making it.
const UNOWNED_STALE_MS = 30000;

/** The lock's owner, or null when it names none yet (its maker is between creating it and writing its pid). */
function ownerOf(lock) {
  const pid = Number(readFileSync(join(lock, 'pid'), 'utf8'));
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

/** Whether a process has exited; one another user owns, or one we cannot signal, still counts as alive. */
function gone(pid) {
  try { process.kill(pid, 0); return false; }
  catch (error) { return error.code === 'ESRCH'; }
}

/**
 * Remove a lock whose owner is gone, as the only waiter allowed to (#1119). Waiters that found the same dead owner
 * compete for one short reap lock; the winner checks again that the lock still has that dead owner, or still none
 * after the stale age, and only then removes it. Nothing else removes another's lock, so the check cannot be
 * overtaken: a live owner's lock is never removed, and the lock it frees is then won by exactly one mkdir.
 *
 * @returns {boolean} Whether this waiter cleared the lock.
 */
function reap(lock, seenOwner) {
  const reaper = lock + '.reap';
  try { mkdirSync(reaper, { mode: 0o700 }); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    // A reaper holds this only for a check and a removal; one this old died doing it.
    try { if (Date.now() - lstatSync(reaper).mtimeMs > UNOWNED_STALE_MS) rmSync(reaper, { recursive: true, force: true }); }
    catch (gone) { if (gone.code !== 'ENOENT') throw gone; }
    return false;
  }
  try {
    let owner;
    try { owner = ownerOf(lock); } catch (error) { if (error.code === 'ENOENT') return false; owner = null; }
    const dead = seenOwner === null
      ? owner === null && Date.now() - lstatSync(lock).mtimeMs > UNOWNED_STALE_MS
      : owner === seenOwner && gone(owner);
    if (dead) rmSync(lock, { recursive: true, force: true });
    return dead;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  } finally { rmSync(reaper, { recursive: true, force: true }); }
}

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
      let owner;
      try { owner = ownerOf(lock); }
      catch (unread) {
        if (unread.code === 'ENOENT') {
          try { lstatSync(lock); } catch (missing) { if (missing.code === 'ENOENT') continue; throw missing; }
        }
        owner = null;
      }
      let stale;
      try { stale = owner !== null ? gone(owner) : Date.now() - lstatSync(lock).mtimeMs > UNOWNED_STALE_MS; }
      catch (vanished) { if (vanished.code === 'ENOENT') continue; throw vanished; }
      if (stale && reap(lock, owner)) continue;
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
  } finally {
    // Remove only this command's own lock; another's is never ours to free.
    let owner = null;
    try { owner = ownerOf(lock); } catch { /* Already gone, or never named: nothing of ours to keep. */ }
    if (owner === null || owner === process.pid) rmSync(lock, { recursive: true, force: true });
  }
}
