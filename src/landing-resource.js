/** Wait for board admission without occupying a machine test slot [Q1,Q2,Q3]. */
import { randomUUID } from 'node:crypto';
import { setTimeout as pause } from 'node:timers/promises';
import { landingLeaseState } from './landing-lease.js';

/** A dead local owner can be released immediately on an unlinked board; never compare foreign PIDs. */
function deadLocalOwner(holder) {
  if (!holder || holder.lineage !== null) return false;
  try { process.kill(holder.pid, 0); return false; }
  catch (error) { return error.code === 'ESRCH'; }
}

/** Return a generation-bound lease whose renewal failures prevent later landing writes. */
export async function takeLandingResource({ board, write, branch, onWait }) {
  const token = randomUUID();
  const parameters = { agentId: 'coordinator', token, branch, pid: process.pid };
  let generation = null;
  let timer;
  let pending = Promise.resolve();
  let lost = null;
  /** Serialize heartbeats and explicit checks, retaining a failure until the command stops. */
  const assertHeld = () => {
    const task = pending.then(async () => {
      if (lost) throw lost;
      try { return await write('landingLeaseMove', [{ ...parameters, action: 'renew', generation }]); }
      catch (error) { lost = error; throw error; }
    });
    pending = task.catch(() => {});
    return task;
  };
  try {
    while (true) {
      const holder = landingLeaseState(board).holder;
      if (deadLocalOwner(holder)) await write('landingLeaseMove', [{ agentId: 'coordinator', action: 'release', token: holder.token, generation: holder.generation }]);
      const result = await write('landingLeaseMove', [{ ...parameters, action: 'request' }]);
      if (result.acquired) { generation = result.generation; break; }
      await onWait?.({ holders: result.holder ? [result.holder] : [], position: result.position });
      await pause(1000);
    }
    timer = setInterval(() => { void assertHeld().catch(() => {}); }, 5000);
    timer.unref();
    return { name: 'landing', scope: 'board', fence: { token, branch, generation }, assertHeld,
      /** End renewals before releasing; a stale generation never clears its successor. */
      async release() {
        clearInterval(timer);
        await pending;
        await write('landingLeaseMove', [{ ...parameters, action: 'release', generation }]);
      } };
  } catch (error) {
    clearInterval(timer);
    try { await write('landingLeaseMove', [{ ...parameters, action: 'release', generation }]); }
    catch { /* Preserve the admission failure; the ordered lease expires without a false grant. */ }
    throw error;
  }
}
