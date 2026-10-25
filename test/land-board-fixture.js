/** Shared read-only board and gate-call observations for real landing fixtures [B3,R3]. */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as store from '../src/board.js';

/** Read a private board through public functions, never by mutating its database. */
export function onBoard(box, action, clock) {
  const board = store.openBoard(join(box.repo, '.git', 'pullboard', 'board.sqlite'), clock);
  try { return action(board); } finally { store.closeBoard(board); }
}

/** Return append-only public events for receipt and replay assertions. */
export function events(box) { return onBoard(box, (board) => store.events(board)); }

/** Parse the gate's actual command arguments to distinguish full runs from single-file diagnoses. */
export function calls(box) {
  return existsSync(box.calls) ? readFileSync(box.calls, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line)) : [];
}


/** Run a successful JSON command, retaining child context if any actual hook or check refuses. */
export function json(box, cwd, ...args) {
  const result = box.run(cwd, ...args, '--json');
  assert.equal(result.code, 0, `${result.err}\n${result.out}`);
  return JSON.parse(result.out);
}

/** Read the actual first-parent merge sequence at the published tip. */
export function mergeSubjects(box, base, tip) {
  return box.git(box.repo, 'log', '--reverse', '--first-parent', '--format=%s', `${base}..${tip}`).split('\n').filter(Boolean);
}


/** Resolve when an owned fixture child closes or fails to spawn. */
export function childOutcome(child) {
  return new Promise((resolveOutcome) => {
    let spawnError = null;
    child.once('error', (error) => { spawnError = error; });
    child.once('close', (code, signal) => resolveOutcome({ code, signal, error: spawnError }));
  });
}
