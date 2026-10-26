/** Scratch: inbox without the board key on a linked board [H21]. */
import assert from 'node:assert/strict';
import { readdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { relayClientFixture } from './relay-client-fixture.js';

test('scratch inbox without key [H21]', async t => {
  const box = await relayClientFixture(t);
  assert.equal((await box.link()).code, 0);
  assert.equal((await box.cli('add', box.lane, 'Read from any session')).code, 0);
  const keys = join(box.env.PULLBOARD_HOME, 'relay-keys');
  renameSync(keys, keys + '.parked');
  try {
    const read = await box.cli('inbox');
    assert.equal(read.code, 0, JSON.stringify(read.document));
  } finally { renameSync(keys + '.parked', keys); }
});
