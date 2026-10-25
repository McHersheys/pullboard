/** Person-given computer names remain display data, never coordinator authority [E19,H16]. */
import assert from 'node:assert/strict';
import { hostname } from 'node:os';
import { test } from 'node:test';
import { relayClientFixture } from './relay-client-fixture.js';
import { relayWorkBudgetMs } from './relay-budget.js';

test('linked computers use person-given names in coordinator holds and devices [E19,H16]', { timeout: relayWorkBudgetMs(12) }, async t => { // budget: real two-device CLI sign-in, pairing, takeover and cleanup; no speed target.
  const box = await relayClientFixture(t);
  await box.link('Writing desk');
  const pairing = await box.cli('relay', 'pair');
  const other = await box.otherDeviceJoin(pairing.document.code, 'Travel laptop');
  assert.equal((await box.cli('add', box.lane, 'First named coordinator')).code, 0);
  const denied = await other.cli('add', box.lane, 'Other coordinator is refused');
  assert.equal(denied.document?.error?.code, 'COORDINATOR_HELD');
  assert.match(denied.document.error.message, /Writing desk/u);
  const taken = await other.cli('takeover');
  assert.equal(taken.code, 0);
  assert.equal(taken.document.coordinator, 'Travel laptop');
  assert.equal(taken.document.previous, 'Writing desk');
  const first = await box.cli('add', box.lane, 'Former coordinator is refused');
  assert.equal(first.document?.error?.code, 'COORDINATOR_HELD');
  assert.match(first.document.error.message, /Travel laptop/u);
  for (const [device, expected] of [[box, 'Travel laptop'], [other, 'Writing desk']]) {
    const roster = await device.cli('relay', 'devices');
    assert.equal(roster.code, 0);
    assert.ok(JSON.stringify(roster.document).includes(expected), 'device roster retains the explicit name');
    for (const privateText of [hostname(), box.root, other.root]) {
      assert.equal(JSON.stringify(roster.document).includes(privateText), false, 'roster does not disclose host or path');
      assert.equal(first.document.error.message.includes(privateText), false, 'refusal does not disclose host or path');
    }
  }
});
