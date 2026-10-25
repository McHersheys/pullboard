/** Companion requests and claims share the real board transaction [B2,B5,B12,H16]. */
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { after, test } from 'node:test';
import * as store from '../src/board.js';
import { createE2eHelpers } from './e2e-helpers.js';

const helpers = createE2eHelpers();
after(helpers.cleanup);

/** Run a private real CLI command without discarding its refusal diagnostics. */
function run(box, cwd, ...args) {
  const result = box.run(cwd, ...args);
  assert.equal(result.code, 0, `${args.join(' ')}: ${result.err}${result.out}`);
  return args.includes('--json') ? JSON.parse(result.out) : result.out;
}

/** Join another independent worktree, retaining the shared real SQLite board. */
function seat(box, name, lane) {
  const path = join(box.dir, name);
  box.git(box.repo, 'worktree', 'add', '-q', '--detach', path, 'HEAD');
  run(box, path, 'join', lane, '--model', 'fixture-companion');
  return path;
}

test('a companion request becomes one claimable child item and a second request finds it [B2,B5,B12,H16]', async () => {
  const box = helpers.project('true');
  const other = seat(box, 'requester-two', 'web');
  const parent = run(box, box.repo, 'add', 'web', 'Parent feature', '--specs', 'G1', '--criterion', 'needs the API', '--json').item.item_id;
  run(box, box.web, 'claim', String(parent));
  const args = ['companion', String(parent), 'api', 'Provide the API', '--key', 'api-part', '--criterion', 'the API serves this parent', '--specs', 'G2', '--json'];
  // Concurrent independent processes must observe one creation, not merely converge after serial retries.
  const children = [box.web, other].map(cwd => helpers.launch(box, cwd, process.execPath, [helpers.BIN, ...args]));
  const completed = await Promise.all(children.map(child => child.closed));
  completed.forEach((result, index) => assert.equal(result.code, 0, children[index].stderrText));
  const results = children.map(child => JSON.parse(child.stdoutText));
  assert.equal(results[0].item.item_id, results[1].item.item_id);
  assert.deepEqual(results.map(result => result.created).sort(), [false, true]);
  const child = results[0].item;
  assert.equal(child.item_parent_id, parent);
  assert.equal(child.item_lane, 'api');
  assert.equal(child.item_criterion, 'the API serves this parent');
  assert.equal(run(box, other, ...args).item.item_id, child.item_id, 'a later request retains the same durable child');
  const first = seat(box, 'api-builder-one', 'api');
  const second = seat(box, 'api-builder-two', 'api');
  run(box, first, 'claim', String(child.item_id));
  const refused = box.run(second, 'claim', String(child.item_id));
  assert.equal(refused.code, 1);
  assert.match(refused.err + refused.out, /HELD/u, 'ordinary exclusive claims prevent duplicate companion builders');
  const read = store.openBoard(join(box.repo, '.git', 'pullboard', 'board.sqlite'));
  try {
    assert.equal(store.listItems(read, { all: true }).filter(item => item.item_parent_id === parent).length, 1);
    assert.equal(store.events(read).filter(event => event.event_kind === 'add' && event.item_id === child.item_id).length, 1);
    assert.equal(store.getItem(read, child.item_id).item_owner, run(box, first, 'whoami', '--json').id);
    assert.throws(() => store.addItem(read, { by: 'coordinator', lane: 'api', parentId: parent, title: 'Ordinary cross-lane child' }), /PARENT_LANE/u,
      'the companion operation does not weaken historical ordinary-add parenting');
  } finally { store.closeBoard(read); }
  assert.equal(box.run(box.web, 'companion', String(parent), 'web', 'Wrong lane', '--key', 'wrong').code, 1);
  assert.equal(box.run(box.web, 'companion', String(parent), 'api', 'Missing key').code, 1);
});
