/** Public real-CLI/SQLite decision queue, claim retention and person boundary [B7,B21,B26,B27]. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createE2eHelpers } from './e2e-helpers.js';

/** Run an authenticated private-board CLI command and decode its public response. */
function document(box, cwd, ...args) {
  const result = box.run(cwd, ...args, '--json');
  assert.equal(result.code, 0, result.err || result.out);
  return JSON.parse(result.out);
}

test('a decision asked on an item is answered from the queue and recorded on the item [B7,B21,B26,B27]', async (t) => {
  const helpers = createE2eHelpers();
  t.after(helpers.cleanup);
  const box = helpers.project('true');
  const added = document(box, box.repo, 'add', 'web', 'Keep building while a choice is pending',
    '--criterion', 'The page renders.', '--specs', 'G1');
  const item = { id: added.item.item_id };
  document(box, box.web, 'claim', String(item.id));
  const before = document(box, box.web, 'show', String(item.id));
  const options = ['Keep the local interface', 'Use the shared interface'];
  const question = 'Which interface should this item expose?';
  const ask = document(box, box.web, 'shout', 'coordinator', question,
    '--item', String(item.id), '--decision', '--options', JSON.stringify(options));
  const pending = document(box, box.web, 'show', String(item.id));
  assert.equal(pending.item_status, 'claimed');
  assert.equal(pending.item_owner, before.item_owner);
  assert.equal(pending.item_lease_until, before.item_lease_until, 'asking neither releases nor renews the claim');
  const ordinary = document(box, box.web, 'shout', 'coordinator', 'Implementation continues while the answer is pending.');
  const queue = document(box, box.repo, 'decisions');
  const queued = queue.decisions.find(row => row.shout_id === ask.id);
  assert.ok(queued, 'the coordinator has a separate open decision queue');
  assert.deepEqual(queued.options, options);
  assert.equal(queued.item, item.id);
  assert.equal(queue.decisions.some(row => row.shout_id === ordinary.id), false);
  const view = await helpers.startView(box, box.repo);
  t.after(view.stop);
  const feed = (await view.state(box.repo)).project;
  assert.ok(Array.isArray(feed.decisionQueue), 'the feed exposes a distinct coordinator queue');
  assert.deepEqual(feed.decisionQueue.find(row => row.shout_id === ask.id).options, options);
  assert.equal(feed.decisionQueue.some(row => row.shout_id === ordinary.id), false);
  assert.ok(feed.shouts.some(row => row.shout_id === ordinary.id), 'ordinary shouts remain in the stream');
  const answer = document(box, box.repo, 'answer', String(ask.id), options[1]);
  assert.equal(document(box, box.repo, 'decisions').decisions.some(row => row.shout_id === ask.id), false);
  const answered = document(box, box.web, 'show', String(item.id));
  assert.ok(answered.thread.some(row => row.kind === 'answer' && row.detail.text === options[1]),
    'a fresh CLI process reads the durable item answer');
  const inbox = document(box, box.web, 'inbox');
  assert.ok(inbox.shouts.some(row => row.shout_id === answer.id && row.shout_text === options[1]));
  assert.equal(answered.item_status, 'claimed');
  assert.equal(answered.item_owner, before.item_owner);
  assert.equal(answered.item_lease_until, before.item_lease_until);
  const duplicate = box.run(box.repo, 'answer', String(ask.id), options[0], '--json');
  assert.notEqual(duplicate.code, 0);
  assert.equal(JSON.parse(duplicate.out).error.code, 'ALREADY_ANSWERED');
  const personal = document(box, box.web, 'shout', 'coordinator', 'May the public policy change?',
    '--item', String(item.id), '--decision', '--options', JSON.stringify(['Approve', 'Decline']));
  const passed = document(box, box.repo, 'pass', String(personal.id), 'Only the person can approve policy.');
  const needs = document(box, box.repo, 'resume').needsYou;
  assert.ok(needs.some(row => row.kind === 'decision' && row.id === passed.id));
  const forbidden = box.run(box.repo, 'answer', String(passed.id), 'Approve', '--json');
  assert.notEqual(forbidden.code, 0);
  assert.equal(JSON.parse(forbidden.out).error.code, 'B26_PERSON_ANSWER');
  assert.ok(document(box, box.repo, 'resume').needsYou.some(row => row.id === passed.id),
    'the coordinator cannot clear a person-only choice');
  document(box, box.repo, 'answer', String(passed.id), 'Decline', '--as', 'person');
  assert.equal(document(box, box.repo, 'resume').needsYou.some(row => row.id === passed.id), false);
  assert.ok(document(box, box.web, 'inbox').shouts.some(row => /Person answered/.test(row.shout_text)));
});
