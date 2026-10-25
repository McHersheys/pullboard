/** Native API and actual sealed relay readers must expose the same board [H5,H15,H16,A2]. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parityRoundtrip, assertReaderParity } from './relay-parity-fixture.js';

test('a field that differs between native and relay readers is refused, naming the field [H5,H16,A2]', { timeout: 60_000 }, async t => { // budget: criterion's sixty-second guard ceiling, including real local HTTP and cleanup.
  const { native, relay } = await parityRoundtrip(t);
  const live = native.agents.find(agent => agent.heartbeatAt !== null);
  assert.ok(live, 'a real native heartbeat is present in the seed');
  const missingHeartbeat = structuredClone(native);
  delete missingHeartbeat.agents.find(agent => agent.agent_id === live.agent_id).heartbeatAt;
  assert.throws(() => assertReaderParity(native, missingHeartbeat), error => /agents\.\d+\.heartbeatAt/u.test(error.message)
    && error.message.includes('native=') && error.message.includes('relay=<missing>'), 'the deliberate heartbeat removal names its exact field and both values');
  assertReaderParity(native, relay);
});
