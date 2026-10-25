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

test('an item added while the relay is down keeps its queued moves when another machine adds one first [B26,H16,H17]', async (t) => {
  const { box, other } = await twoMachines(t, 'Added before the outage');
  await box.stopRelay();
  const added = await box.cli('add', box.lane, 'Added here while the relay is down');
  assert.equal(added.code, 0, JSON.stringify(added.document));
  const local = added.document.item.item_id;
  const second = await box.cli('add', box.lane, 'Also added here while the relay is down');
  assert.equal(second.document.item.item_id, local + 1, 'the second offline add takes the next local number');
  const withdrawn = await box.cli('withdraw', String(local), 'withdrawn here while the relay is down');
  assert.equal(withdrawn.code, 0, withdrawn.failure);

  await box.restartRelay();
  const first = await (await otherAgent(box, other))('add', box.lane, 'Added there first');
  assert.equal(first.code, 0, first.failure);
  assert.equal(first.document.item.item_id, local, 'the other machine takes the number this machine used offline');

  const replayed = await box.cli('status');
  assert.equal(replayed.code, 0, replayed.failure);
  assert.equal(replayed.document.relay.outbox, undefined, 'the outbox is empty once it replays' + JSON.stringify(replayed.document.diagnostics));
  assert.equal(replayed.document.relay.outboxRefusals, undefined, 'nothing is refused: the queued withdraw follows its own item');
  assert.deepEqual(replayed.document.relay.outboxRenumbered, [{ was: local, is: local + 1 }, { was: local + 1, is: local + 2 }],
    'status says each offline item got the next number');
  for (const machine of [box, other]) {
    const items = new Map((await machine.cli('export')).document.tables.item.map((row) => [row.item_id, row]));
    assert.deepEqual([items.get(local).item_title, items.get(local).item_status], ['Added there first', 'open'], 'the other machine\'s item is untouched');
    assert.deepEqual([items.get(local + 1).item_title, items.get(local + 1).item_status], ['Added here while the relay is down', 'withdrawn'], 'the queued withdraw acts on the item it was made for');
    assert.deepEqual([items.get(local + 2).item_title, items.get(local + 2).item_status], ['Also added here while the relay is down', 'open'],
      'a later renumbering never moves a target that was already mapped');
  }
});

