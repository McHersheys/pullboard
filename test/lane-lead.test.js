/** Real lane coordination retains claims and the existing person boundary [B7,B21,B26,N26]. */
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { createE2eHelpers } from './e2e-helpers.js';

/** Execute a real private CLI command and retain its public response. */
function document(box, cwd, ...args) {
  const result = box.run(cwd, ...args, '--json');
  assert.equal(result.code, 0, result.err || result.out);
  return JSON.parse(result.out);
}

/** Locate one durable message without changing an inbox cursor. */
function message(box, id) {
  return document(box, box.repo, 'export').tables.shout.find(row => row.shout_id === id);
}

test('a lane question reaches its lead and only the decision reaches the coordinator [B7,B21,B26,N26]', t => {
  const helpers = createE2eHelpers();
  t.after(helpers.cleanup);
  const box = helpers.project('true');
  const lead = join(box.dir, 'web-lead');
  const other = join(box.dir, 'api-seat');
  box.git(box.repo, 'worktree', 'add', '-q', '--detach', lead, 'main');
  box.git(box.repo, 'worktree', 'add', '-q', '--detach', other, 'main');
  const leadId = document(box, lead, 'join', 'web').agent;
  document(box, other, 'join', 'api');
  const item = document(box, box.repo, 'add', 'web', 'Keep working during lane coordination',
    '--criterion', 'The page renders.', '--specs', 'G1').item.item_id;
  document(box, box.web, 'claim', String(item));
  const claimed = document(box, box.web, 'show', String(item));
  const legacy = document(box, box.web, 'shout', 'coordinator', 'Default-off question', '--decision');
  assert.equal(message(box, legacy.id).shout_to, 'coordinator', 'no named lead leaves legacy delivery unchanged');
  document(box, box.repo, 'lanes', 'lead', 'web', leadId);
  assert.equal(document(box, box.repo, 'lanes').leads?.web, leadId, 'the coordinator durably names the existing lane seat');
  const denied = box.run(box.web, 'lanes', 'lead', 'web', 'off', '--json');
  assert.equal(JSON.parse(denied.out).error?.code, 'COORDINATOR_ONLY');
  assert.equal(document(box, box.repo, 'lanes').leads.web, leadId);
  const question = document(box, box.web, 'shout', 'coordinator', 'Which interface?', '--decision');
  assert.equal(message(box, question.id).shout_to, leadId);
  assert.ok(document(box, lead, 'inbox').shouts.some(row => row.shout_id === question.id));
  assert.equal(document(box, box.repo, 'inbox').shouts.some(row => row.shout_id === question.id), false);
  const blocked = document(box, box.web, 'shout', 'coordinator', 'Need an API answer', '--kind', 'blocker', '--decision');
  assert.equal(message(box, blocked.id).shout_to, leadId);
  const status = box.run(box.web, 'shout', 'coordinator', 'Still implementing', '--kind', 'status', '--json');
  assert.equal(JSON.parse(status.out).error?.code, 'STATUS_IS_ACTIVITY');
  const answer = document(box, lead, 'answer', String(question.id), 'Use the local interface');
  assert.ok(document(box, box.web, 'inbox').shouts.some(row => row.shout_id === answer.id));
  assert.ok(document(box, box.repo, 'inbox').shouts.some(row => row.shout_from === leadId && row.shout_text.includes('Use the local interface')),
    'the actual lead decision, not ongoing lane status, reaches the coordinator');
  const passed = document(box, lead, 'pass', String(blocked.id), 'Cross-lane API ownership needs coordination.');
  assert.equal(message(box, passed.id).shout_to, 'coordinator');
  document(box, box.repo, 'answer', String(passed.id), 'Coordinate with the API lane');
  assert.ok(document(box, box.web, 'inbox').shouts.some(row => row.shout_text.includes('Coordinate with the API lane')),
    'the answer to an escalation reaches the original asker');
  const forbidden = box.run(lead, 'shout', 'person', 'Approve a policy change', '--decision', '--json');
  assert.equal(JSON.parse(forbidden.out).error?.code, 'B26_PERSON_DECISION');
  const after = document(box, box.web, 'show', String(item));
  for (const field of ['item_status', 'item_owner', 'item_lease_until']) assert.equal(after[field], claimed[field]);
  const independent = document(box, other, 'shout', 'coordinator', 'API has no lead', '--kind', 'question', '--decision');
  assert.equal(message(box, independent.id).shout_to, 'coordinator');
  document(box, box.repo, 'lanes', 'lead', 'web', 'off');
  const restored = document(box, box.web, 'shout', 'coordinator', 'Lead removed', '--kind', 'question', '--decision');
  assert.equal(message(box, restored.id).shout_to, 'coordinator');
});
