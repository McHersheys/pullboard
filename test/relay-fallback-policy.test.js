/** @pullboard-test-loads src/relay.js src/cli.js */
/** A transient outage never turns an acknowledged-authority exception into a local move [H21,H16]. */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { outboxFile, outboxQueueable } from '../src/relay-outbox.js';
import { Refused } from '../src/refused.js';
import { relayClientFixture } from './relay-client-fixture.js';

/** Run a synchronous policy control with a synthetic token, restoring the test process's original environment. */
function withToken(value, work) {
  const original = process.env.PULLBOARD_RELAY_TOKEN;
  if (value === undefined) delete process.env.PULLBOARD_RELAY_TOKEN;
  else process.env.PULLBOARD_RELAY_TOKEN = value;
  try { return work(); }
  finally {
    if (original === undefined) delete process.env.PULLBOARD_RELAY_TOKEN;
    else process.env.PULLBOARD_RELAY_TOKEN = original;
  }
}

/** An already accepted ordered link and the public transient failure needed for policy-only controls. */
function policy(state = {}, operation = 'shout', io = {}, args = []) {
  return outboxQueueable({ mode: 'ordered', baselineAccepted: true, ...state },
    new Refused('RELAY_UNAVAILABLE', 'the private relay is unavailable'), operation,
    { relayOutbox: () => true, ...io }, args);
}

test('ordinary accepted-link transient fallback honors the effective outbox setting [H21,H16]', () => withToken(undefined, () => {
  assert.equal(policy(), true);
  assert.equal(policy({}, 'appendFact', {}, [1, { agentId: 'fixture' }]), true);
  assert.equal(policy({}, 'shout', { relayOutbox: () => false }), false, 'an explicit opt-out stays off');
  assert.equal(policy({}, 'shout', { relayOutbox() { throw new Error('private configuration unavailable'); } }), false);
  assert.equal(policy({ baselineAccepted: false }), false);
  assert.equal(policy({ baselineConflict: {} }), false);
  assert.equal(outboxQueueable({ mode: 'ordered', baselineAccepted: true }, new Refused('AUTH_REQUIRED', 'sign in again'),
    'shout', { relayOutbox: () => true }, []), false, 'a definite authentication refusal never queues a move');
}));

test('all environment-token sessions require acknowledgment instead of offline fallback [H21,H16,E18]', () => {
  withToken(undefined, () => assert.equal(policy({ environment: { agent: 'fixture' } }), false, 'a saved ephemeral link never queues'));
  for (const token of ['pa_' + 'x'.repeat(43), '']) {
    withToken(token, () => assert.equal(policy(), false, 'the presence of an environment token excludes even an otherwise ordinary link'));
  }
});

test('takeover landing and person-request authority cannot gain a transient fallback [H21,H16]', () => withToken(undefined, () => {
  for (const operation of ['register', 'ensureCoordinator', 'takeCoordinator', 'landingLeaseMove']) {
    assert.equal(policy({}, operation), false, `${operation} needs relay acknowledgment`);
  }
  assert.equal(policy({}, 'shout', { personRequest: {} }), false);
  assert.equal(policy({}, 'shout', { personRequestMoveId: 'private-request' }), false);
}));

test('landing-fenced arguments remain acknowledged across every transient fallback [H21,H16]', () => withToken(undefined, () => {
  assert.equal(policy({}, 'appendFact', {}, [{ landingFence: { batch: 'fixture' } }]), false);
  assert.equal(policy({}, 'editItem', {}, [1, { landingFence: { batch: 'fixture' } }]), false);
  assert.equal(policy({}, 'editItem', {}, [1, { brief: 'ordinary change' }]), true);
}));

test('an accepted linked environment-token CLI refuses an offline move without creating an outbox [H21,H16,E18]', async t => {
  const box = await relayClientFixture(t);
  assert.equal((await box.link()).code, 0);
  const state = JSON.parse(readFileSync(box.linkFile, 'utf8'));
  assert.equal(state.baselineAccepted, true, 'the private relay accepted this real linked board');
  const token = state.agentTokens?.coordinator?.token;
  assert.equal(typeof token, 'string', 'the actual linked coordinator has a board-scoped token');
  const text = 'An ephemeral session must receive an acknowledgment';
  const db = new DatabaseSync(join(box.root, '.git', 'pullboard', 'board.sqlite'), { readOnly: true });
  t.after(() => db.close());
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM shout WHERE shout_text=?').get(text).n, 0);
  assert.equal(existsSync(outboxFile(box.linkFile)), false);
  await box.stopRelay();
  const running = box.startCli(['shout', 'all', text], { PULLBOARD_RELAY_TOKEN: token });
  const result = await running.closed;
  assert.equal(result.signal, null, 'the actual private CLI terminates normally');
  assert.notEqual(result.code, 0, 'an ephemeral session cannot report an unacknowledged write as success');
  const document = JSON.parse(result.stdout);
  assert.ok(['RELAY_UNAVAILABLE', 'RELAY_RESPONSE'].includes(document.error?.code), 'the public response preserves a typed transport refusal');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM shout WHERE shout_text=?').get(text).n, 0, 'the refused requested move never enters the local board');
  assert.equal(existsSync(outboxFile(box.linkFile)), false, 'no ephemeral outbox can be lost when the job exits');
});
