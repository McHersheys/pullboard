/**
 * The background checkpoint publisher for one board (#1014): waits until moves have been quiet, uploads one
 * checkpoint under the relay lock, and goes again only if a move arrived meanwhile. One runs per board at a time;
 * a second exits at once. A failure leaves the sealed checkpoint saved in the link for the next publisher to retry.
 *
 * Usage (spawned by scheduleCheckpoint): node relay-checkpoint-worker.js <root> <relay link file>
 */
import { appendFileSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { checkpointFiles, checkpointQuietMs, publisherHolding } from './relay-checkpoint.js';
import { publishLatestCheckpoint } from './relay.js';

const [root, file] = process.argv.slice(2);
const { due, pid, log } = checkpointFiles(file);

/** Read the time of the last move, or 0 when none was noted. */
function lastMove() {
  try { return Number(readFileSync(due, 'utf8')) || 0; } catch { return 0; }
}

/** Claim the publisher's place for this board, replacing only a holder that has gone. */
function claim() {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try { writeFileSync(pid, `${process.pid}\n`, { flag: 'wx', mode: 0o600 }); return true; }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const holder = publisherHolding(pid);
      if (holder && holder !== process.pid) return false;
      rmSync(pid, { force: true });
    }
  }
  return false;
}

/** Keep a short record of failures beside the link; the next command's status reports pending uploads. */
const io = {
  say() {},
  err(line) { try { appendFileSync(log, `${new Date().toISOString()} ${String(line).trim()}\n`, { mode: 0o600 }); } catch { /* No log is no worse than none. */ } },
};

/** Publish until a checkpoint covers the last move; returns the time of the move it covered. */
async function publishUntilQuiet() {
  const quiet = checkpointQuietMs();
  for (;;) {
    // Refresh the claim, so a scheduler never takes this live publisher for a dead one.
    try { utimesSync(pid, new Date(), new Date()); } catch { /* A removed claim is re-made by the next pass. */ }
    const moved = lastMove();
    const wait = quiet - (Date.now() - moved);
    if (wait > 0) { await new Promise(next => setTimeout(next, wait)); continue; }
    await publishLatestCheckpoint(root, io);
    if (lastMove() === moved) return moved;
  }
}

// A move noted after the last look, but before the claim was released, saw a live publisher and spawned none:
// look once more after releasing, and go again if it is newer than what was covered.
for (let covered = -1; claim();) {
  try { covered = await publishUntilQuiet(); }
  catch (error) { io.err(`checkpoint not published: ${error.message}`); covered = Infinity; }
  finally {
    try { if (Number(readFileSync(pid, 'utf8')) === process.pid) rmSync(pid, { force: true }); } catch { /* Already gone. */ }
  }
  if (lastMove() <= covered) break;
}
