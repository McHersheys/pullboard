/** Wait for board admission without occupying a machine test slot [Q1,Q2,Q3]. */
import { randomUUID } from 'node:crypto';
import { setTimeout as pause } from 'node:timers/promises';
import { assertLandingLease, landingLeaseState } from './landing-lease.js';
import { Refused } from './refused.js';

/** A dead local owner can be released immediately on an unlinked board; never compare foreign PIDs. */
function deadLocalOwner(holder) {
  if (!holder || holder.lineage !== null) return false;
  try { process.kill(holder.pid, 0); return false; }
  catch (error) {
    if (error.code !== 'ESRCH') return false;
    if (holder.guardianPid) {
      try { process.kill(holder.guardianPid, 0); return false; }
      catch (guardianError) { return guardianError.code === 'ESRCH'; }
    }
    return true;
  }
}

/** Return a generation-bound lease whose renewal failures prevent later landing writes. */
export async function takeLandingResource({ board, write, branch, onWait, onLost }) {
  const token = randomUUID();
  const parameters = { agentId: 'coordinator', token, branch, pid: process.pid };
  let generation = null;
  let timer;
  let watchdog;
  let deadline = 0;
  let pending = Promise.resolve();
  let lost = null;
  /** Serialize heartbeats and explicit checks, retaining a failure until the command stops. */
  const assertHeld = () => {
    const task = pending.then(async () => {
      if (lost) throw lost;
      try {
        const result = await write('landingLeaseMove', [{ ...parameters, action: 'renew', generation }]);
        if (lost) throw lost;
        assertLandingLease(board, { token, branch, generation }); // A delayed recovered receipt is not a fresh grant.
        deadline = Date.parse(result.holder.until);
        return result;
      }
      catch (error) { lost = error; onLost?.(error); throw error; }
    });
    pending = task.catch(() => {});
    return task;
  };
  try {
    while (true) {
      const holder = landingLeaseState(board).holder;
      if (deadLocalOwner(holder)) await write('landingLeaseMove', [{ agentId: 'coordinator', action: 'release', token: holder.token, generation: holder.generation }]);
      const result = await write('landingLeaseMove', [{ ...parameters, action: 'request' }]);
      if (result.acquired) { generation = result.generation; deadline = Date.parse(result.holder.until); break; }
      await onWait?.({ holders: result.holder ? [result.holder] : [], position: result.position });
      await pause(1000);
    }
    timer = setInterval(() => { void assertHeld().catch(() => {}); }, 5000);
    timer.unref();
    watchdog = setInterval(() => {
      if (!lost && Date.now() >= deadline - 1000) {
        lost = new Refused('LAND_LEASE_LOST', 'the landing lease could not renew before its deadline; inspect pullboard resume after its owned worker stops');
        onLost?.(lost);
      }
    }, 100);
    watchdog.unref();
    return { name: 'landing', scope: 'board', fence: { token, branch, generation }, assertHeld,
      /** Record the guardian before it starts physical work, so dead-parent recovery waits for its drain. */
      async bindWorker(guardianPid) {
        await assertHeld();
        if (lost) throw lost;
        const result = await write('landingLeaseMove', [{ ...parameters, action: 'bind', generation, guardianPid }]);
        if (lost) throw lost;
        deadline = Date.parse(result.holder.until);
      },
      /** Check the current wall-time fence without adding an await before a physical action. */
      assertCurrent() { return assertLandingLease(board, { token, branch, generation }); },
      /** End renewals before releasing; a stale generation never clears its successor. */
      async release() {
        clearInterval(timer);
        clearInterval(watchdog);
        await pending;
        await write('landingLeaseMove', [{ ...parameters, action: 'release', generation }]);
      } };
  } catch (error) {
    clearInterval(timer);
    clearInterval(watchdog);
    try { await write('landingLeaseMove', [{ ...parameters, action: 'release', generation }]); }
    catch { /* Preserve the admission failure; the ordered lease expires without a false grant. */ }
    throw error;
  }
}
