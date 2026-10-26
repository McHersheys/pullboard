/** A real relay inbox read must not turn an unavailable key into a forged receipt [E9,E18,N26]. */
import assert from 'node:assert/strict';
import {
  existsSync,
  readFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { openBoardForRead } from '../src/board.js';

/** Observe only the private fixture's canonical delivery projection. */
function receipts(box) {
  const board = openBoardForRead(join(box.root, '.git', 'pullboard', 'board.sqlite'));
  try { return board.db.prepare("SELECT * FROM board_meta WHERE meta_key LIKE 'activity:%' ORDER BY meta_key").all(); }
  finally { board.db.close(); }
}

/** Read an optional local cursor without creating it. */
function cursor(box) {
  const file = join(box.root, '.git', 'pullboard-activity.json');
  return existsSync(file) ? readFileSync(file, 'utf8') : null;
}

/** Create a genuine answered decision through the authenticated public CLI before hiding its key. */
export async function prepareKeylessInbox(box) {
  const asked = await box.cli('shout', 'person', 'May this session read without recording delivery?', '--decision');
  assert.equal(asked.code, 0, 'the fixture asks a real decision');
  const answer = await box.cli('answer', String(asked.document.id), 'Read without acknowledging until the key returns.', '--as', 'person');
  assert.equal(answer.code, 0, 'the fixture person answers through ordinary authentication');
  return { answer: answer.document.id };
}

/** Preserve both cursors while displaying a real obligation and refusing explicit acknowledgement. */
export async function readKeylessInbox(box, state) {
  const beforeCursor = cursor(box), beforeReceipts = receipts(box);
  const read = await box.cli('inbox');
  assert.equal(read.code, 0, `inbox reads without the key: ${JSON.stringify(read.document?.error ?? null)}`);
  assert.equal(read.document.activity.receipt.recorded, false, 'an unavailable canonical receipt is never claimed');
  assert.equal(read.document.activity.receipt.code, 'RELAY_KEY_MISSING', 'delivery reports why it remains unrecorded');
  const interrupt = read.document.activity.interrupts.find(entry => entry.shout === state.answer);
  assert.ok(interrupt, 'the answered decision remains visible despite the missing key');
  state.interrupt = interrupt.id;
  assert.equal(cursor(box), beforeCursor, 'unrecorded delivery never advances the local cursor');
  assert.deepEqual(receipts(box), beforeReceipts, 'the read cannot forge a canonical delivery');
  const acted = await box.cli('inbox', '--acted-on', state.interrupt);
  assert.equal(acted.document?.error?.code, 'RELAY_KEY_MISSING', 'explicit acknowledgement stays an authenticated write');
  assert.deepEqual(receipts(box), beforeReceipts, 'a refused acknowledgement changes no receipt');
  return read;
}

/** Restored credentials deliver the same obligation, which disappears only after explicit acknowledgement. */
export async function finishKeylessInbox(box, state) {
  const delivered = await box.cli('inbox');
  assert.equal(delivered.code, 0, 'restoring the key permits canonical delivery');
  assert.notEqual(delivered.document.activity.receipt?.recorded, false, 'delivery is recorded rather than silently skipped');
  assert.ok(delivered.document.activity.interrupts.some(entry => entry.id === state.interrupt), 'the unrecorded obligation survives key recovery');
  assert.notEqual(cursor(box), null, 'only successful delivery advances the local cursor');
  assert.ok(receipts(box).some(row => row.meta_key.endsWith(`pending:${state.interrupt}`)), 'the native board retains the delivered obligation');
  const acted = await box.cli('inbox', '--acted-on', state.interrupt);
  assert.equal(acted.code, 0, 'the recipient can acknowledge after credentials return');
  assert.equal(acted.document.activity.interrupts.some(entry => entry.id === state.interrupt), false, 'explicit acknowledgement retires only the delivered obligation');
}
