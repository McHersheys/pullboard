/** A move sends only its own event; one background publisher sends the checkpoint once moves go quiet [H5]. */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { relayClientFixture } from './relay-client-fixture.js';
import { CHECKPOINT_BACKGROUND_ENV } from '../src/relay-checkpoint.js';

/** Whether a relay call uploads a checkpoint: an API1 state write or an API2 page publish. */
function checkpointUpload(call) {
  return call.method === 'PUT' && /^\/api\/v1\/boards\/[0-9a-f]{32}\/state$/u.test(call.path ?? '')
    || call.method === 'POST' && /^\/api\/v2\/boards\/[0-9a-f]{32}\/uploads\/[^/]+\/publish$/u.test(call.path ?? '');
}

/** Wait until the background publisher has uploaded at least `uploads` checkpoints since `from` and finished. */
async function publisherDone(box, from, uploads) {
  const directory = dirname(box.linkFile);
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (box.calls.slice(from).filter(checkpointUpload).length >= uploads && !existsSync(join(directory, 'relay-checkpoint.pid'))) return;
    await new Promise(next => setTimeout(next, 100));
  }
  const log = join(directory, 'relay-checkpoint.log');
  assert.fail(`the background publisher sent no checkpoint: ${existsSync(log) ? readFileSync(log, 'utf8') : 'no publisher log'}`);
}

test('a move on a large board sends only its event and never the checkpoint [H5]', async (t) => {
  // The runner keeps checkpoints inside commands, like the view; this case opts in to the background publisher.
  const inline = process.env[CHECKPOINT_BACKGROUND_ENV];
  delete process.env[CHECKPOINT_BACKGROUND_ENV];
  t.after(() => { if (inline === undefined) delete process.env[CHECKPOINT_BACKGROUND_ENV]; else process.env[CHECKPOINT_BACKGROUND_ENV] = inline; });
  const box = await relayClientFixture(t);

  // Seed the presentation's heaviest part, as on the 22 Oct board: 20,000 shouts.
  const db = new DatabaseSync(join(box.root, '.git', 'pullboard', 'board.sqlite'));
  const insert = db.prepare('INSERT INTO shout(shout_from, shout_to, shout_text, shout_at) VALUES (?, ?, ?, ?)');
  db.exec('BEGIN');
  for (let index = 0; index < 20_000; index += 1) insert.run('coordinator', 'all', `seeded shout ${index} with some ordinary words in it`, new Date(Date.UTC(2026, 9, 22, 0, 0, index % 60)).toISOString());
  db.exec('COMMIT');
  db.close();
  await box.link();

  // One move, then let its checkpoint go out, so the burst below starts from a covered board.
  const warm = box.calls.length;
  assert.equal((await box.cli('shout', 'all', 'warm up')).code, 0);
  await publisherDone(box, warm, 1);

  const before = box.calls.length;
  for (let index = 1; index <= 10; index += 1) {
    const from = box.calls.length;
    const started = performance.now();
    const moved = await box.cli('shout', 'all', `burst ${index}`);
    const elapsed = performance.now() - started;
    assert.equal(moved.code, 0, JSON.stringify(moved.document));
    const sent = box.calls.slice(from);
    assert.equal(sent.filter(checkpointUpload).length, 0, `move ${index} uploaded no checkpoint`);
    const bytes = sent.reduce((total, call) => total + (call.requestBytes ?? 0), 0);
    assert.ok(bytes < 64 * 1024, `move ${index} sent ${bytes} bytes, under 64 KB`);
    assert.ok(elapsed < 1000, `move ${index} returned in ${Math.round(elapsed)} ms, under one second`);
  }
  await publisherDone(box, before, 1);
  await new Promise(next => setTimeout(next, 2_000)); // budget: a second quiet period, so a second upload would show.
  assert.equal(box.calls.slice(before).filter(checkpointUpload).length, 1, 'ten moves in a burst produced one checkpoint upload');
});
