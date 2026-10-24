/** Literal item-message text survives ordinary recipient words [B7,A2,N19]. */
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { join } from 'node:path';
import * as store from '../src/board.js';
import { createE2eHelpers } from './e2e-helpers.js';

const fixtures = createE2eHelpers();
after(fixtures.cleanup);

test('an explicit item keeps all, person and lane names as literal message text [B7,A2,N19]', () => {
  const box = fixtures.project('true');
  const added = box.run(box.repo, 'add', 'web', 'Literal item messages', '--specs', 'G1', '--criterion', 'item messages retain text');
  assert.equal(added.code, 0, added.err);
  for (const text of ['all', 'person', 'web']) {
    const sent = box.run(box.web, 'shout', '--item', '1', text, '--json');
    assert.equal(sent.code, 0, `${text}: ${sent.err}${sent.out}`);
    const board = store.openBoard(join(box.repo, '.git', 'pullboard', 'board.sqlite'));
    try {
      const row = store.getShout(board, JSON.parse(sent.out).id);
      assert.equal(row.shout_to, 'item:1');
      assert.equal(row.shout_text, text);
    } finally { store.closeBoard(board); }
  }
  const explicit = box.run(box.web, 'shout', 'web', 'explicit recipient with item', '--item', '1', '--json');
  assert.equal(explicit.code, 0, explicit.err);
  const board = store.openBoard(join(box.repo, '.git', 'pullboard', 'board.sqlite'));
  try {
    const row = store.getShout(board, JSON.parse(explicit.out).id);
    assert.equal(row.shout_to, 'item:1');
    assert.equal(row.shout_text, 'explicit recipient with item');
  } finally { store.closeBoard(board); }
});
