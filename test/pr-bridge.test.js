/** Publishing proposes only proven heads and observes a person's merge [B3,R3]. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { bridgeProject, bridgeProvider, landBridgeItems, landBridgeRepair, mergeBridgeAs, runBridgeCLI } from './pr-bridge-fixture.js';
import { onBoard } from './land-board-fixture.js';
import * as store from '../src/board.js';
import { exportBoard, importBoard } from '../src/exchange.js';
import { prepareEngineMove, applyEngineMove } from '../src/engine.js';
import { PR_BRIDGE_ENGINE } from '../src/pr-bridge-engine.js';
import { configFromSource } from '../src/config.js';

/** Read the real private gate invocations, retaining their exact Git heads. */
function gateHeads(box) {
  return readFileSync(box.gateCalls, 'utf8').trim().split('\n').map(line => JSON.parse(line).head);
}

test("publish opens one pull request with each item's receipt and records the person's merge as the release [B3,R3]", async t => {
  const box = bridgeProject(t);
  const entries = landBridgeItems(box);
  const provider = await bridgeProvider(t, box);
  const head = box.git(box.repo, 'rev-parse', 'main');
  const result = await runBridgeCLI(box, 'publish', '--json');
  assert.equal(result.code, 0, result.err);
  assert.equal(box.git(box.remote, 'rev-parse', 'main'), box.published,
    'opt-in PR publishing must leave the protected remote main unchanged');
  assert.equal(provider.pulls.length, 1, 'one release proposal carries both accepted items');
  const pull = provider.pulls[0];
  assert.equal(pull.head.sha, head, 'the proposed branch is the exact head the whole project gate passed');
  assert.ok(gateHeads(box).includes(head));
  for (const entry of entries) {
    assert.ok(pull.body.includes(`#${entry.id}`));
    assert.ok(pull.body.includes(entry.commit));
    assert.ok(pull.body.includes('ACCEPT'));
    assert.ok(pull.body.includes('coordinator'));
  }
  assert.ok(pull.body.includes('darwin') || pull.body.includes('linux') || pull.body.includes('win32'));
  assert.ok(pull.body.includes(process.versions.node), 'receipt environment comes from actual proof');
  assert.equal(pull.body.includes(box.dir), false, 'machine paths do not become public PR text');
  assert.equal(pull.body.includes('private one remains correct'), false, 'private criteria are not projected');
  assert.equal(provider.requests.some(r => r.path.endsWith('/merge') && r.method !== 'GET'), false);
  const again = await runBridgeCLI(box, 'publish', '--json');
  assert.equal(again.code, 0, again.err);
  assert.equal(provider.pulls.length, 1, 'an existing same-release PR is updated rather than duplicated');

  // A person performs a real private Git merge outside the product; the bridge only observes it.
  const person = join(box.dir, 'person');
  box.git(box.dir, 'clone', '-q', '--branch', 'main', box.remote, person);
  box.git(person, 'fetch', '-q', 'origin', pull.head.ref);
  box.git(person, 'merge', '-q', '--no-ff', '-m', 'chore: person merges reviewed proposal [G1]', 'FETCH_HEAD');
  box.git(person, 'push', '-q', 'origin', 'main');
  pull.state = 'closed'; pull.merged = true;
  pull.merge_commit_sha = box.git(person, 'rev-parse', 'HEAD');
  pull.merged_by = { login: 'fixture-person', type: 'User', id: 42 };
  const observed = await runBridgeCLI(box, 'publish', '--json');
  assert.equal(observed.code, 0, observed.err);
  assert.equal(JSON.parse(observed.out).releases[0].recognizedPerson, true);
  assert.equal(JSON.parse(observed.out).releases[0].personApproval, false);
  const facts = onBoard(box, board => entries.flatMap(entry => store.itemThread(board, entry.id)
    .filter(fact => fact.type === 'fact').map(fact => fact.text)));
  for (const entry of entries) assert.ok(facts.some(text => text.includes(pull.html_url) && text.includes(pull.merge_commit_sha)),
    `item #${entry.id} retains the observed release fact`);
  assert.equal(provider.requests.some(r => r.path.endsWith('/merge') && r.method !== 'GET'), false,
    'no product path performs a GitHub merge');
});


test('publication modes are opt-in and invalid values refuse before a push [B3,R3]', () => {
  assert.equal(configFromSource('{}').publish?.pullRequest ?? false, false);
  for (const mode of [false, 'release', 'item']) {
    assert.equal(configFromSource(JSON.stringify({ publish: { pullRequest: mode } })).publish.pullRequest, mode);
  }
  for (const value of [true, 'auto-merge', null, { pullRequest: 'release', merge: true }]) {
    const publish = value && typeof value === 'object' ? value : { pullRequest: value };
    assert.throws(() => configFromSource(JSON.stringify({ publish })), { code: 'BAD_CONFIG' });
  }
});

test('CI findings preserve the merged item and create one linked repair, then update the same PR [B2,R3]', async t => {
  const box = bridgeProject(t);
  const entries = landBridgeItems(box);
  const provider = await bridgeProvider(t, box);
  const first = await runBridgeCLI(box, 'publish', '--json');
  assert.equal(first.code, 0, first.err);
  const pull = provider.pulls[0];
  const oldHead = pull.head.sha;
  provider.checks = [
    { id: 301, name: 'linux / behavior', head_sha: oldHead, status: 'completed', conclusion: 'failure',
      html_url: 'https://github.com/fixture/repository/actions/runs/301' },
    { id: 302, name: 'unattributed infrastructure', head_sha: oldHead, status: 'completed', conclusion: 'failure' },
    { id: 303, name: 'stale unrelated job', head_sha: '0'.repeat(40), status: 'completed', conclusion: 'failure' },
  ];
  provider.annotationsByRun[301] = [{ path: entries[0].file, annotation_level: 'failure' }];
  provider.annotationsByRun[302] = [];
  const observed = await runBridgeCLI(box, 'publish', '--json');
  assert.equal(observed.code, 0, observed.err);
  const items = onBoard(box, board => store.listItems(board, { all: true }));
  const children = items.filter(item => item.item_parent_id === entries[0].id);
  assert.equal(children.length, 1);
  const repair = children[0];
  assert.equal(items.find(item => item.item_id === entries[0].id).item_status, 'verified');
  assert.equal(items.find(item => item.item_id === entries[0].id).item_merged_commit !== null, true);
  assert.equal(items.filter(item => item.item_parent_id === entries[1].id).length, 0);
  const facts = onBoard(box, board => store.itemThread(board, entries[0].id));
  assert.ok(facts.some(fact => fact.type === 'fact' && fact.text.includes('linux / behavior') && fact.text.includes('/runs/301')));
  assert.ok(JSON.parse(observed.out).unattributed.some(job => job.job === 'unattributed infrastructure'));
  assert.equal((await runBridgeCLI(box, 'publish', '--json')).code, 0);
  assert.equal(onBoard(box, board => store.listItems(board, { all: true })).filter(item => item.item_parent_id === entries[0].id).length, 1,
    'polling the same failing run creates no duplicate child');
  landBridgeRepair(box, repair.item_id, entries[0].file);
  provider.checks = [];
  const updated = await runBridgeCLI(box, 'publish', '--json');
  assert.equal(updated.code, 0, updated.err);
  assert.equal(provider.pulls.length, 1);
  assert.notEqual(pull.head.sha, oldHead, 'the actual newly proven repair head updates the original PR');
  assert.ok(pull.body.includes(`#${repair.item_id}`));
  assert.ok(gateHeads(box).includes(pull.head.sha));
  assert.equal(box.git(box.remote, 'rev-parse', 'main'), box.published);
});

test('per-item proposals isolate each patch and never attribute bots or unlisted users as person approval [B3,R3]', async t => {
  const box = bridgeProject(t, 'item');
  const entries = landBridgeItems(box);
  const provider = await bridgeProvider(t, box);
  const result = await runBridgeCLI(box, 'publish', '--json');
  assert.equal(result.code, 0, result.err);
  assert.equal(provider.pulls.length, 2);
  for (const entry of entries) {
    const pull = provider.pulls.find(p => p.body.includes(`#${entry.id}:`));
    assert.ok(pull);
    const other = entries.find(e => e.id !== entry.id);
    assert.equal(pull.body.includes(`#${other.id}:`), false);
    const files = box.git(box.remote, 'diff', '--name-only', box.published, pull.head.sha).split('\n');
    assert.deepEqual(files, [entry.file], 'per-item mode never duplicates the whole trunk diff into every PR');
    assert.ok(gateHeads(box).includes(pull.head.sha));
  }
  assert.equal(box.git(box.remote, 'rev-parse', 'main'), box.published);
  mergeBridgeAs(box, provider.pulls[0], 'fixture-bot', 'Bot');
  mergeBridgeAs(box, provider.pulls[1], 'unlisted-user');
  const observed = await runBridgeCLI(box, 'publish', '--json');
  assert.equal(observed.code, 0, observed.err);
  const facts = onBoard(box, board => entries.flatMap(entry => store.itemThread(board, entry.id)
    .filter(fact => fact.type === 'fact').map(fact => fact.text)));
  const releases = facts.filter(text => text.startsWith('{')).map(text => JSON.parse(text)).filter(fact => fact.type === 'github-release');
  assert.equal(releases.length, 2);
  assert.ok(releases.every(release => release.recognizedPerson === false && release.personApproval === false));
  assert.ok(releases.some(release => release.actor === 'fixture-bot'));
  assert.ok(releases.some(release => release.actor === 'unlisted-user'));
  assert.equal(provider.pulls.length, 2, 'cherry-picked publication commits are not proposed again merely because ancestry differs');
  assert.equal(provider.requests.some(request => request.path.endsWith('/merge') && request.method !== 'GET'), false);
});

test('publication findings replay deterministically and ordinary closed-parent guards remain intact [B2,H16,R3]', t => {
  const box = bridgeProject(t);
  const entries = landBridgeItems(box);
  const source = store.openBoard(join(box.repo, '.git', 'pullboard', 'board.sqlite'));
  const replica = store.openBoard(join(box.dir, 'replica.sqlite'));
  t.after(() => { store.closeBoard(source); store.closeBoard(replica); });
  const baseline = exportBoard(source);
  importBoard(replica, baseline);
  const request = { agentId: 'coordinator', item: entries[0].id, repository: 'fixture/repository', pull: 1,
    head: box.git(box.repo, 'rev-parse', 'HEAD'), failures: [{ id: 401, name: 'recorded CI job',
      url: 'https://github.com/fixture/repository/actions/runs/401', files: [entries[0].file] }] };
  const move = prepareEngineMove(source, 'recordPublishFinding', [request], { id: 'fixture-publication-finding' });
  assert.throws(() => applyEngineMove(replica, { ...move, engine: PR_BRIDGE_ENGINE - 1 },
    { sequence: 1, at: '2026-10-24T07:00:00.000Z' }), { code: 'RELAY_MOVE' });
  const options = { sequence: 1, at: '2026-10-24T07:00:00.000Z' };
  const a = applyEngineMove(source, move, options);
  const b = applyEngineMove(replica, move, options);
  assert.deepEqual(a, b);
  assert.equal(a.error, undefined);
  assert.deepEqual(applyEngineMove(replica, move, options), b);
  assert.deepEqual(exportBoard(source), exportBoard(replica));
  assert.equal(store.getItem(source, entries[0].id).item_status, 'verified');
  assert.throws(() => store.addItem(source, { by: 'coordinator', lane: 'web', title: 'ordinary child',
    criterion: 'ordinary closed parent remains refused', parentId: entries[0].id, route: 'strong' }), { code: 'PARENT_CLOSED' });
  assert.throws(() => store.recordPublishFinding(source, { ...request, agentId: 'web-1' }), { code: 'COORDINATOR_ONLY' });
  assert.throws(() => store.linkPublishRepair(source, { agentId: 'web-1', item: entries[0].id, repair: entries[1].id }), { code: 'COORDINATOR_ONLY' });
});
