/** Approved requirements change only through a visible person decision [P6,B23,N39]. */
import assert from 'node:assert/strict';
import {
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import {
  after,
  test,
} from 'node:test';
import { createE2eHelpers } from './e2e-helpers.js';
import { personNeedsState } from '../src/needs-state.js';
import { parseSpec } from '../src/spec.js';

const fixtures = createE2eHelpers();
after(fixtures.cleanup);

/** Require a successful real command and retain its diagnostics on failure. */
function succeeds(result) {
  assert.equal(result.code, 0, `${result.out}\n${result.err}`);
  return result;
}

/** Read one actual requirement from the fixture's current SPEC bytes. */
function row(box, id) {
  return parseSpec(readFileSync(join(box.repo, 'SPEC.md'), 'utf8')).rows.find(entry => entry.id === id);
}

test('a proposed change to an approved row waits in Needs you and applies only when the person approves it [P6,B23,N39]', { timeout: 120_000 }, () => {
  const box = fixtures.project('true');
  const file = join(box.repo, 'SPEC.md');
  const original = readFileSync(file, 'utf8');
  const proposal = JSON.parse(succeeds(box.run(box.web, 'spec', 'draft', 'The page renders accessibly.',
    '--revises', 'G1', '--gate', 'true', '--reason', 'The old gate was removed.', '--json')).out);
  assert.ok(proposal.id && proposal.id !== 'G1', 'the proposal has its own actionable identity');
  assert.equal(readFileSync(file, 'utf8'), original, 'proposing never edits the approved requirement');
  const need = personNeedsState(box.repo).needs.find(entry => entry.id === proposal.id);
  assert.ok(need, 'the person receives the proposed revision in Needs you');
  const shown = JSON.stringify(need);
  for (const text of ['The page renders.', 'The page renders accessibly.', 'web test', 'true', 'The old gate was removed.']) {
    assert.ok(shown.includes(text), `Needs you includes the old/new effect and reason: ${text}`);
  }
  const agentApproval = box.run(box.web, 'spec', 'approve', proposal.id);
  assert.notEqual(agentApproval.code, 0, 'an agent cannot approve its proposal');
  succeeds(box.run(box.repo, 'spec', 'apply'));
  assert.equal(readFileSync(file, 'utf8'), original, 'apply before a person decision leaves the row untouched');
  succeeds(box.run(box.repo, 'spec', 'approve', proposal.id));
  assert.equal(readFileSync(file, 'utf8'), original, 'the person decision remains pending explicit apply');
  succeeds(box.run(box.repo, 'spec', 'apply'));
  assert.equal(row(box, 'G1').text, 'The page renders accessibly.');
  assert.equal(row(box, 'G1').gate, 'true');
  assert.equal(row(box, 'G1').status, 'approved');
  assert.ok(!personNeedsState(box.repo).needs.some(entry => entry.id === proposal.id), 'the completed proposal leaves Needs you');
  const history = JSON.parse(succeeds(box.run(box.repo, 'export')).out).tables.event;
  const decision = history.find(event => event.event_kind === 'row_decision' && JSON.stringify(event).includes(proposal.id));
  assert.ok(decision, 'durable row history identifies the proposal and person decision');
  assert.equal(decision.event_by, 'person', 'the approval history attributes the actual person');

  const approved = readFileSync(file, 'utf8');
  const declined = JSON.parse(succeeds(box.run(box.web, 'spec', 'draft', 'An unwanted replacement.',
    '--revises', 'G1', '--status', 'retired', '--reason', 'Consider retiring it.', '--json')).out);
  succeeds(box.run(box.repo, 'spec', 'decline', declined.id, '--reason', 'Keep the existing requirement.'));
  succeeds(box.run(box.repo, 'spec', 'apply'));
  assert.equal(readFileSync(file, 'utf8'), approved, 'declining a revision never retires or rejects its approved target');
  assert.ok(!personNeedsState(box.repo).needs.some(entry => entry.id === declined.id));

  const retired = JSON.parse(succeeds(box.run(box.web, 'spec', 'draft', 'The page renders accessibly.',
    '--revises', 'G1', '--status', 'retired', '--reason', 'The feature is no longer supported.', '--json')).out);
  succeeds(box.run(box.repo, 'spec', 'approve', retired.id));
  succeeds(box.run(box.repo, 'spec', 'apply'));
  assert.equal(row(box, 'G1').status, 'retired', 'the person can approve an explicit status revision');
  assert.notEqual(box.run(box.web, 'spec', 'draft', 'Change a retired row.', '--revises', 'G1', '--reason', 'Not approved.').code, 0);

  writeFileSync(file, approved.replace('The page renders accessibly.', 'An agent silently changed it.'));
  const check = box.run(box.repo, 'spec', 'check');
  assert.notEqual(check.code, 0, 'a direct edit cannot reuse the earlier approval');
  writeFileSync(file, approved);
});
