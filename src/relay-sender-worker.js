/**
 * The machine's background relay sender (#1013): one per machine, serving every local-first board on it. For each
 * board a command nudged, and every few seconds while it runs, it sends the queued moves and pulls other machines'
 * moves under that board's relay lock, then runs the person's waiting requests. Commands never wait on it. It exits
 * once no board has been nudged for a while and no move waits; a failure backs off and is kept in its short log.
 *
 * Usage (spawned by nudgeRelaySender): node relay-sender-worker.js
 */
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { withFileLock } from './relay-outbox-guard.js';
import { outboxWaiting } from './relay-outbox.js';
import {
  senderFiles,
  senderHolding,
} from './relay-local-first.js';

const files = senderFiles();
// Budget: a board is pulled this often while the sender runs, so another machine's move shows here within seconds.
const PULL_MS = Number(process.env.PULLBOARD_RELAY_SENDER_PULL_MS) || 3_000;
// Budget: the sender stays this long after the last nudge, so a working session keeps one warm sender.
const IDLE_MS = Number(process.env.PULLBOARD_RELAY_SENDER_IDLE_MS) || 60_000;
// Budget: a failing board is retried no more often than this at worst, and once a second at best.
const BACKOFF_MAX_MS = 30_000;
const TICK_MS = 100;

/** Keep a short record of each pass beside the claim; status and a person debugging read it. */
const io = {
  say(line) { io.err(line); },
  err(line) {
    try { appendFileSync(files.log, `${new Date().toISOString()} ${String(line).trim()}\n`, { mode: 0o600 }); } catch { /* No log is no worse than none. */ }
  },
};

/** Read every board note: the board's checkout, its link file, and when a command last nudged it. */
function notes() {
  let names = [];
  try { names = readdirSync(files.boards).filter((name) => name.endsWith('.json')); } catch { return []; }
  return names.flatMap((name) => {
    try {
      const note = JSON.parse(readFileSync(join(files.boards, name), 'utf8'));
      return typeof note.root === 'string' && typeof note.file === 'string' && Number.isFinite(note.due) ? [{ ...note, path: join(files.boards, name) }] : [];
    } catch { return []; }
  });
}

/**
 * Claim the machine's sender place. The decision is made under a lock, so two senders started together cannot
 * both take it: the second sees the first's live claim and exits.
 */
async function claim() {
  mkdirSync(files.directory, { recursive: true, mode: 0o700 });
  return withFileLock(join(files.directory, 'claim.sqlite'), () => {
    const holder = senderHolding();
    if (holder && holder !== process.pid) return false;
    writeFileSync(files.pid, `${process.pid}\n`, { mode: 0o600 });
    rmSync(files.starting, { force: true }); // Started: the next nudge sees this claim instead.
    writeFileSync(files.log, '', { mode: 0o600 }); // Each sender keeps only its own short story.
    io.say(`claimed by ${process.pid}`);
    return true;
  });
}

/** Give up the claim, only while it is still this process's own. */
async function release() {
  await withFileLock(join(files.directory, 'claim.sqlite'), () => {
    try { if (Number(readFileSync(files.pid, 'utf8')) === process.pid) rmSync(files.pid, { force: true }); } catch { /* Already gone. */ }
  });
}

/** Send and pull one board under its relay lock, then run the person's waiting requests. True when nothing waits. */
async function serve(root, file) {
  const { syncRelay } = await import('./relay.js');
  const { relayOutboxSetting } = await import('./cli.js');
  const boardIo = { ...io, relayOutbox: () => relayOutboxSetting(root) };
  await syncRelay(root, boardIo);
  try {
    const { executePersonRequests } = await import('./relay-request-execution.js');
    const { main } = await import('./cli-main.js');
    await executePersonRequests(root, boardIo, main);
  } catch (error) { io.err(`person requests not run: ${error.message}`); }
  return !outboxWaiting(file);
}

/** Per board: when it was last served, and when a failing board may be tried again. */
const boards = new Map();

/**
 * Serve boards until none has been nudged for the idle period and no move waits; returns the newest nudge seen.
 * A board is served when a command nudged it since its last pass, or once the pull period has passed.
 */
async function serveUntilIdle() {
  let newest = 0;
  for (;;) {
    try { utimesSync(files.pid, new Date(), new Date()); } catch { /* A removed claim is re-made by the next sender. */ }
    const now = Date.now();
    const seen = notes();
    let waiting = false;
    for (const note of seen) {
      newest = Math.max(newest, note.due);
      if (!existsSync(note.file)) { rmSync(note.path, { force: true }); continue; }
      const board = boards.get(note.file) ?? { served: 0, failures: 0, retryAt: 0 };
      boards.set(note.file, board);
      const nudged = note.due > board.served;
      if (now < board.retryAt || !(nudged || now - board.served >= PULL_MS)) { waiting ||= outboxWaiting(note.file); continue; }
      board.served = Date.now();
      let settled = false;
      io.say(`serving ${note.root}`);
      try { settled = await serve(note.root, note.file); }
      catch (error) { io.err(`${note.root}: ${error.message}`); }
      io.say(`served in ${Date.now() - board.served} ms${settled ? '' : '; moves still wait'}`);
      if (settled) { board.failures = 0; board.retryAt = 0; }
      else {
        board.failures += 1;
        board.retryAt = Date.now() + Math.min(BACKOFF_MAX_MS, 1000 * 2 ** Math.min(board.failures - 1, 5));
        waiting = true;
      }
    }
    if (!waiting && Date.now() - newest >= IDLE_MS) return newest;
    await new Promise((next) => setTimeout(next, TICK_MS));
  }
}

// A nudge after the last look, but before the claim was released, saw a live sender and started none: look once
// more after releasing, and go again if a newer one came.
for (let newest = -1; await claim();) {
  try { newest = await serveUntilIdle(); }
  catch (error) { io.err(`sender stopped: ${error.message}`); newest = Infinity; }
  finally { await release(); }
  if (!notes().some((note) => note.due > newest)) break;
}
