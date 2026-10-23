/** Shared read-only board and gate-call observations for real landing fixtures [B3,R3]. */
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

