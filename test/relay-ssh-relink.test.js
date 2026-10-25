/** Public SSH CLI and cookie-bound auth protocol retain one active repository link [E12,H5,H16]. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { relayClientFixture } from './relay-client-fixture.js';

const PROMPT = 'After sign-in, confirm the link in your browser: ';

/** Send one ordinary same-origin confirmation request, carrying only the real issued cookie. */
async function confirmation(box, route, body, cookie) {
  const response = await fetch(box.origin + '/auth/device/confirmation' + route, {
    method: 'POST', headers: { origin: box.origin, 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
  return { status: response.status, value: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
}

test('SSH relay off then on confirms replacement and retains the old-board off receipt [E12,H5,H16]', async t => {
  const box = await relayClientFixture(t);
  await box.link();
  const previous = JSON.parse(readFileSync(box.linkFile, 'utf8')).board;
  assert.equal((await box.cli('relay', 'off')).code, 0, 'ordinary local off finishes first');
  const running = box.startCli(['relay', 'on', '--url', box.origin], { SSH_CONNECTION: '192.0.2.10 12345 192.0.2.20 22' });
  try {
    const output = await running.waitForOutput(PROMPT);
    const line = output.split('\n').find(row => row.includes(PROMPT));
    const address = new URL(line.slice(line.indexOf(PROMPT) + PROMPT.length).trim());
    assert.equal(address.origin, box.origin);
    const ticket = decodeURIComponent(address.hash.slice(1));
    const opened = await confirmation(box, '/open', { ticket });
    assert.equal(opened.status, 200);
    let ready;
    const deadline = Date.now() + 30_000; // budget: private device-flow readiness hang ceiling, not a speed target.
    do {
      ready = await confirmation(box, '/status', { ticket }, opened.cookie);
      assert.equal(ready.status, 200);
      if (!ready.value.ready) await new Promise(done => setTimeout(done, 20));
    } while (!ready.value.ready && Date.now() < deadline);
    assert.equal(ready.value.ready, true, 'real GitHub device grant reaches browser confirmation');
    const result = await confirmation(box, '', { ticket, decision: 'confirm' }, opened.cookie);
    assert.equal(result.status, 200, JSON.stringify(result.value));
    assert.equal(result.value.confirmed, true);
    const completed = await running.closed;
    assert.equal(completed.code, 0, 'the actual SSH CLI receives the confirmed replacement');
    const state = JSON.parse(readFileSync(box.linkFile, 'utf8'));
    assert.notEqual(state.board, previous);
    assert.deepEqual(box.auth.boardOff(previous), { board: previous, replacedBy: state.board, userId: '7', at: box.auth.boardOff(previous).at });
    assert.equal(JSON.parse(readFileSync(box.root + '/pullboard.json', 'utf8')).relay.board, state.board);
    const sessions = box.auth.linkedBoards().filter(row => !box.auth.boardOff(row.id));
    assert.deepEqual(sessions.map(row => row.id), [state.board], 'exactly one repository link stays active');
  } finally {
    if (running.child.exitCode === null && running.child.signalCode === null) {
      running.child.kill('SIGTERM');
      await running.closed;
    }
  }
});
