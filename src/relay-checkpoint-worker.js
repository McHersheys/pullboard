/**
 * The background checkpoint publisher for one board (#1014): waits until moves have been quiet, uploads one
 * checkpoint under the relay lock, and goes again only if a move arrived meanwhile. One runs per board at a time;
 * a second exits at once. A failure leaves the sealed checkpoint saved in the link for the next publisher to retry.
 *
 * Usage (spawned by scheduleCheckpoint): node relay-checkpoint-worker.js <root> <relay link file>
 */
import {
  appendFileSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { locked } from './relay-lock.js';
import {
  checkpointFiles,
  checkpointQuietMs,
  publisherHolding,
} from './relay-checkpoint.js';
import { publishLatestCheckpoint } from './relay.js';

const [root, file] = process.argv.slice(2);
const { due, done, pid, log } = checkpointFiles(file);

/** Read the time of the last move, or 0 when none was noted. */
function lastMove() {
  try { return Number(readFileSync(due, 'utf8')) || 0; } catch { return 0; }
}

/** Read the move time the last upload covered, or 0. */
function lastCovered() {
  try { return Number(readFileSync(done, 'utf8')) || 0; } catch { return 0; }
}

/**
 * Claim the publisher's place for this board. The decision is made under the relay lock, so two publishers that
 * both find a dead holder's claim cannot each replace it: the second sees the first's live claim and stands down.
 */
async function claim() {
  return locked(file, () => {
    const holder = publisherHolding(pid);
    if (holder && holder !== process.pid) return false;
    writeFileSync(pid, `${process.pid}\n`, { mode: 0o600 });
    writeFileSync(log, '', { mode: 0o600 }); // Each publisher keeps only its own short story.
    io.say(`claimed by ${process.pid}`);
    return true;
  }, io);
}

/** Give up the claim under the relay lock, and only while it is still this process's own. */
async function release() {
  await locked(file, () => {
    try { if (Number(readFileSync(pid, 'utf8')) === process.pid) rmSync(pid, { force: true }); } catch { /* Already gone. */ }
  }, io);
}

/** Keep a short record of failures beside the link; the next command's status reports pending uploads. */
const io = {
  // Progress goes to the same short log as failures, so a stalled publisher shows how far it got.
  say(line) { io.err(line); },
  err(line) { try { appendFileSync(log, `${new Date().toISOString()} ${String(line).trim()}\n`, { mode: 0o600 }); } catch { /* No log is no worse than none. */ } },
};

/** Publish until a checkpoint covers the last move; returns the time of the move it covered. */
async function publishUntilQuiet() {
  const quiet = checkpointQuietMs();
  for (;;) {
    // Refresh the claim, so a scheduler never takes this live publisher for a dead one.
    try { utimesSync(pid, new Date(), new Date()); } catch { /* A removed claim is re-made by the next pass. */ }
    const moved = lastMove();
    // An earlier publisher already covered this move: nothing to send.
    if (lastCovered() >= moved) return moved;
    const wait = quiet - (Date.now() - moved);
    if (wait > 0) { await new Promise(next => setTimeout(next, wait)); continue; }
    io.say(`publishing for the move at ${new Date(moved).toISOString()}`);
    if (await publishLatestCheckpoint(root, io)) writeFileSync(done, `${moved}\n`, { mode: 0o600 });
    io.say('published');
    if (lastMove() === moved) return moved;
  }
}

// A move noted after the last look, but before the claim was released, saw a live publisher and spawned none:
// look once more after releasing, and go again if it is newer than what was covered.
for (let covered = -1; await claim();) {
  try { covered = await publishUntilQuiet(); }
  catch (error) { io.err(`checkpoint not published: ${error.message}`); covered = Infinity; }
  finally { await release(); }
  if (lastMove() <= covered) break;
}
