/** A refusal that stops someone reaches whoever can clear it, is recorded, and repeats are counted [C6,N26]. */
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { personNeedsState } from '../src/needs-state.js';
import { createE2eHelpers } from './e2e-helpers.js';

const e2e = createE2eHelpers();
after(e2e.cleanup);

test('a Pullboard block reaches whoever can clear it and repeats are counted [C6,N26]', () => {
  const box = e2e.project();

  // A person-only move from an agent's terminal: the person, not the agent, can clear it.
  box.env.CLAUDECODE = '1';
  const person = box.run(box.repo, 'answer', '1', 'yes', '--as', 'person');
  delete box.env.CLAUDECODE;
  assert.equal(person.code, 1, person.err);
  assert.match(person.err, /^pullboard: only the person can clear this; it is in their Needs you list now$/mu);
  const needs = personNeedsState(box.repo).needs.filter(row => row.kind === 'block');
  assert.equal(needs.length, 1, JSON.stringify(needs));
  assert.equal(needs[0].text, 'Pullboard stopped a request that only you can clear: this terminal belongs to an agent');
  assert.match(needs[0].what, /^run pullboard view\b/u);
  assert.doesNotMatch(`${needs[0].text} ${needs[0].what}`, /\[[A-Z][A-Z0-9_]*\]|B26|relay|--/u);

  // An agent's coordinator-only move: the agent is told to take it to the coordinator.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const held = box.run(box.web, 'hold', 'api', '--reason', 'the api lane waits');
    assert.equal(held.code, 1, held.err);
    assert.match(held.err, /\[COORDINATOR_ONLY\]/u);
    assert.match(held.err, /^pullboard: only the coordinator can clear this; tell them: pullboard shout coordinator "blocked by COORDINATOR_ONLY on pullboard hold: only the coordinator holds a lane"$/mu);
  }
  // An agent's block is not the person's call.
  assert.equal(personNeedsState(box.repo).needs.filter(row => row.kind === 'block').length, 1);

  // Health counts the day's blocks by code and drafts an item for the one that repeated.
  const report = JSON.parse(box.run(box.repo, 'health', '--json').out);
  const byCode = Object.fromEntries(report.blocks.codes.map(entry => [entry.code, entry]));
  assert.equal(byCode.COORDINATOR_ONLY.count, 3);
  assert.deepEqual(byCode.COORDINATOR_ONLY.commands, ['pullboard hold']);
  assert.deepEqual(byCode.COORDINATOR_ONLY.who, ['web-1']);
  assert.equal(byCode.COORDINATOR_ONLY.audience, 'coordinator');
  assert.equal(byCode.B26_PERSON_CHANNEL.count, 1);
  assert.deepEqual(byCode.B26_PERSON_CHANNEL.who, ['coordinator']);
  assert.deepEqual(report.blocks.drafts.map(draft => draft.cause), ['refusal:COORDINATOR_ONLY']);
  const [draft] = report.blocks.drafts;
  assert.equal(draft.title, 'Pullboard blocked 3 requests in a day with COORDINATOR_ONLY');
  const text = box.run(box.repo, 'health').out;
  assert.match(text, /^ {2}COORDINATOR_ONLY 3x on pullboard hold, stopped web-1; the coordinator clears it: ask the coordinator/mu);
  assert.match(text, /^ {2}repeated, draft an item: pullboard add coordinator 'Pullboard blocked 3 requests in a day with COORDINATOR_ONLY'/mu);

  // The drafted item files as it reads.
  const added = box.run(box.repo, 'add', draft.lane, draft.title, '--brief', draft.brief, '--json');
  assert.equal(added.code, 0, added.err);
  assert.equal(JSON.parse(added.out).item.item_title, draft.title);
});
