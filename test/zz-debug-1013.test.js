import { recordedRelayRefusal } from './relay-recorded-refusal-fixture.js';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { ENGINE_OPERATIONS } from '../src/engine.js';
import { rememberCreatedItems } from '../src/relay-created-items.js';
import {
  ITEM_SLOTS,
  bindRefs,
  resolveMove,
  strayItemRefs,
} from '../src/relay-outbox.js';
import { runFixtureGit } from './fixture-child.js';
import { relayClientFixture } from './relay-client-fixture.js';
import { relayFixtureChild } from './relay-client-fixture.js';

const CLI = fileURLToPath(new URL('../bin/pullboard.js', import.meta.url));

/** Turn the board's committed relay.outbox setting on, as its coordinator would. */
function enableOutbox(box) {
  const file = join(box.root, 'pullboard.json');
  const config = JSON.parse(readFileSync(file, 'utf8'));
  writeFileSync(file, JSON.stringify({ ...config, relay: { outbox: true } }, null, 2) + '\n');
  // The board's own commit hook runs pullboard, so this private PATH gets the CLI under test.
  const cliPath = fileURLToPath(new URL('../bin/pullboard.js', import.meta.url));
  writeFileSync(join(box.env.PATH, 'pullboard'), `#!/bin/sh\nexec node "${cliPath}" "$@"\n`, { mode: 0o700 });
  runFixtureGit(['add', 'pullboard.json'], { cwd: box.root, env: box.env });
  runFixtureGit(['commit', '-q', '-m', 'chore(config): queue relay moves while the relay is down'], { cwd: box.root, env: box.env });
}

/** The shout texts a board export holds, in board order. */
function shoutTexts(exported) {
  return exported.tables.shout.map((row) => row.shout_text);
}

/**
 * An agent seat on the other machine. Its moves are its own, so it adds while the first machine's main checkout
 * keeps the coordinator: one main checkout coordinates a board at a time (E19, #347).
 */
async function otherAgent(box, other) {
  const path = join(dirname(other.root), 'other-agent');
  runFixtureGit(['worktree', 'add', '-q', '-b', 'agent/other', path], { cwd: other.root, env: other.env });
  /** Run the real CLI in the other machine's agent worktree. */
  const run = (...args) => relayFixtureChild(path, other.env, [CLI, ...args, '--json']);
  const joined = await run('join', box.lane, '--model', 'fixture-model');
  assert.equal(joined.code, 0, joined.failure);
  return run;
}

/** Two machines on one accepted relay board with the outbox on, and an item added before the outage. */
async function twoMachines(t, title, { beforeLink } = {}) {
  const box = await relayClientFixture(t);
  enableOutbox(box);
  await beforeLink?.(box);
  await box.link();
  const contested = (await box.cli('add', box.lane, title)).document.item.item_id;
  const printed = await box.cli('relay', 'pair');
  const other = await box.otherDeviceJoin(printed.document.code);
  assert.equal(JSON.parse(readFileSync(box.linkFile, 'utf8')).baselineAccepted, true, 'the relay accepted this board before the outage');
  return { box, other, contested };
}

test('a move on an accepted relay link waits in the ordered outbox while the relay is down, and replays in order [B26,H16,H17]', async (t) => {
  const { box, other, contested } = await twoMachines(t, 'Contested while the relay is down');

  await box.stopRelay();
  const first = await box.cli('shout', 'all', 'queued first while the relay is down');
  assert.equal(first.code, 0, JSON.stringify(first.document));
  const withdrawn = await box.cli('withdraw', String(contested), 'queued withdraw from this machine');
  assert.equal(withdrawn.code, 0, withdrawn.failure);
  const last = await box.cli('shout', 'all', 'queued last while the relay is down');
  assert.equal(last.code, 0, last.failure);

  const waiting = await box.cli('status');
  assert.deepEqual(waiting.document.relay.outbox.map((move) => [move.operation, move.item]), [['shout', null], ['withdraw', contested], ['shout', null]],
    'pullboard status lists the queued moves in the order they were made');
  const shown = await box.cli('show', String(contested));
  assert.deepEqual(shown.document.relayPending.map((move) => move.operation), ['withdraw'], 'the item shows its move as pending');
  const local = await box.cli('export');
  assert.ok(shoutTexts(local.document).includes('queued last while the relay is down'), 'this machine keeps working on its queued moves');

  await box.restartRelay();
  // One main checkout coordinates at a time (E19, #347): the other machine takes the coordinator before it withdraws.
  const taken = await other.cli('takeover');
  assert.equal(taken.code, 0, JSON.stringify(taken.document) + taken.failure);
  const raced = await other.cli('withdraw', String(contested), 'the other machine withdrew it first');
  assert.equal(raced.code, 0, raced.failure);

  const replayed = await box.cli('status');
  assert.equal(replayed.code, 0, replayed.failure);
  assert.equal(replayed.document.relay.outbox, undefined, 'the outbox is empty once it replays');
  const refusals = replayed.document.relay.outboxRefusals;
  assert.deepEqual(refusals.map((refused) => refused.move.split(' ')[0]), ['shout', 'withdraw', 'shout'], 'each queued move replays in the order it was made');
  for (const refused of refusals) {
    assert.equal(refused.code, 'COORDINATOR_HELD', 'a queued coordinator move from the machine that no longer holds the coordinator is refused');
    assert.ok(refused.message.includes(`computer ${other.machine.slice(-8)}`), 'the refusal names the machine that holds the coordinator');
  }
  assert.ok(refusals[1].earlier.some((earlier) => earlier.move.startsWith(`withdraw #${contested}`)), 'the refusal names the move another machine made first');

  const there = await other.cli('export');
  const here = await box.cli('export');
  const sent = shoutTexts(there.document).filter((text) => /while the relay is down/u.test(text));
  assert.deepEqual(sent, [], 'no queued coordinator move reaches the other machine');
  assert.deepEqual(shoutTexts(here.document), shoutTexts(there.document), 'both machines hold the same shouts in the same order');
  const item = (exported) => exported.tables.item.find((row) => row.item_id === contested);
  assert.deepEqual(item(here.document), item(there.document), 'both machines agree on the contested item');
  assert.equal(item(there.document).item_status, 'withdrawn');
});

