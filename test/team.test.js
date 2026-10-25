import { submitFixture as submitBoardStateFixture } from './board-submit-fixture.js';
import { createHash } from 'node:crypto';
/** @pullboard-test-loads src/board.js src/engine.js src/exchange.js */
/** Two independent Git/SQLite replicas derive verdict freshness without rewriting proof [E8]. */
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, cpSync, readdirSync, lstatSync, renameSync, symlinkSync } from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { after, test } from 'node:test';
import * as store from '../src/board.js';
import { exportBoard, importBoard } from '../src/exchange.js';
import { applyEngineMove, prepareEngineMove } from '../src/engine.js';
import { appliedSequence } from '../src/engine.js';
import { relayClientFixture as sessionRelay, relayFixtureChild as sessionChild, relayClientFixture, relayFixtureChild } from './relay-client-fixture.js';
import { runFixtureGit as sessionGit, runFixtureGit } from './fixture-child.js';
import { createE2eHelpers } from './e2e-helpers.js';
import { serveApi } from '../src/api.js';
import { main } from '../src/cli.js';
import { fetchFresh } from './http-fixture.js';
import { relaySnapshot, presentationDigest } from '../src/relay-presentation.js';
import { snapshotState } from '../relay/browser-model.js';
import { unpackRelease } from './release-archive.js';
import { decodeBoardKey, seal } from '../src/seal.js';
import { ENGINE_VERSION as PEOPLE_VERSION } from '../src/machine.js';
import { relayWorkBudgetMs } from './relay-budget.js';
import { hostname, tmpdir } from 'node:os';
import { assertMatchingLandingHost, assertNoCulpritTrunkHold } from './landing-environment-fixture.js';
import { landingQueueCase } from './landing-queue-fixture.js';

const CLI = join(import.meta.dirname, '..', 'bin', 'pullboard.js');

const helpers = createE2eHelpers();
after(helpers.cleanup);

test('land runs on a matching host [E27,E28,E29]', { timeout: 180_000 }, () => { // budget: hang ceiling for real Git/CLI host checks, bisection and waiver controls; no speed target.
  assertMatchingLandingHost(helpers);
  assertNoCulpritTrunkHold(helpers);
});
test('a trunk lands one batch at a time [B3,R3,Q1,Q2,E8]', { timeout: 120_000 }, // budget: hang ceiling for real private Git, CLI checks, both gate barriers and cleanup; no speed target.
  async t => landingQueueCase(t, helpers));

test('a queued landing uses admitted policy and repairs before pinning it [Q1,B3]', { timeout: 120_000 }, // budget: two real CLI landings and bounded recorded-tip repair, not a speed threshold.
  async t => landingQueueCase(t, helpers, { policyAfterFirst: true }));

test('a queued landing rechecks freshness after its holder moves main [E8,Q1,Q2]', { timeout: 120_000 }, // budget: real private Git/CLI and deterministic gate barrier; no speed target.
  async t => landingQueueCase(t, helpers, { staleAfterFirst: true }));

test('an abandoned landing drains its blocked gate before adoption [Q1,Q3,B3]', { timeout: 120_000 }, // budget: private CLI death, owned-process cleanup, interrupted-batch adoption and Git; no speed target.
  async t => landingQueueCase(t, helpers, { killParent: true }));

test('a dead landing guardian cannot leave its blocked worker running [Q1,Q3,B3]', { timeout: 120_000 }, // budget: private guardian death, identity-bound cleanup and explicit adoption; no speed target.
  async t => landingQueueCase(t, helpers, { killGuardian: true }));

test('a suspended landing owner is fenced before the queued adopter runs [Q1,Q3]', { timeout: 120_000 }, // budget: real 30s authority expiry, independent guardian watchdog, cleanup and adoption; no speed target.
  async t => landingQueueCase(t, helpers, { suspendParent: true }));

/** Open a fixture's independent board and always close it after its observation or public move. */
function withBoard(root, action) {
  const board = store.openBoard(join(root, '.git', 'pullboard', 'board.sqlite'));
  try { return action(board); }
  finally { store.closeBoard(board); }
}

/** Run a real fixture CLI command, retaining the refusal or successful document verbatim. */
function run(box, root, ...args) {
  const result = box.run(root, ...args);
  assert.equal(result.code, 0, `${args.join(' ')}: ${result.err}${result.out}`);
  return result.out;
}

/** Occupy this fixture's actual gate until its stale re-review enters the ordinary queue. */
async function holdForReviewQueue(box) {
  const ready = join(box.dir, 'review-gate-held');
  const observed = join(box.dir, 'review-was-queued');
  const source = `
import {setTimeout as pause} from 'node:timers/promises';
import {writeFileSync} from 'node:fs';
import {takeResource,listResources} from ${JSON.stringify(new URL('../src/resources.js', import.meta.url).href)};
import {loadMachineSettings} from ${JSON.stringify(new URL('../src/settings.js', import.meta.url).href)};
const [root,ready,observed]=process.argv.slice(1);
const capacity=loadMachineSettings().gateSlots;
const leases=[];
let stopping=false;
process.once('SIGTERM',()=>{stopping=true;});
try {
  for(let i=0;i<capacity;i++) leases.push(await takeResource({name:'gate',capacity,scope:'machine',root,agent:'stale-review-fixture-holder',browser:false}));
  writeFileSync(ready,'all ordinary slots really held');
  const deadline=Date.now()+30_000;
  while(!stopping) {
    const gate=listResources({root}).find(entry=>entry.name==='gate');
    if(gate?.line.some(entry=>entry.item==='1'&&entry.kind==='review')) {writeFileSync(observed,'the real review waiter was observed');break;}
    if(Date.now()>=deadline) throw Error('the stale review never entered the actual private gate queue');
    await pause(20);
  }
} finally {for(const lease of leases.reverse()) lease.release();}
`;
  const holder = helpers.launch(box, box.repo, process.execPath, ['--input-type=module', '-e', source, box.repo, ready, observed]);
  const deadline = Date.now() + 10_000;
  try {
    while (!existsSync(ready)) {
      assert.equal(holder.exitCode, null, holder.failure ?? holder.stderrText);
      assert.ok(Date.now() < deadline, 'the real private gate holder becomes ready');
      await new Promise(resolveWait => setTimeout(resolveWait, 20));
    }
  } catch (error) {
    if (holder.exitCode === null && holder.signalCode === null) holder.kill('SIGTERM');
    await holder.closed;
    throw error;
  }
  return { holder, observed };
}

test('a verdict reads stale when main moves under its files [E8]', { timeout: 120_000 }, async t => { // budget: hang ceiling for two real replicas, CLI checks and Git history; not a speed target.
  const box = helpers.project();
  assert.equal(helpers.commitFile(box, box.repo, 'web/feature.js', 'feature = 0\nmain = 0\n', 'feat(web): baseline [G1]').status, 0);
  box.git(box.web, 'merge', '-q', '--ff-only', 'main');
  const checkedHeads = join(box.dir, 'checked-heads');
  const check = `grep -q '^feature = 1$' web/feature.js && git rev-parse HEAD >> '${checkedHeads}'`;
  run(box, box.repo, 'add', 'web', 'Feature', '--specs', 'G1', '--check', check, '--wait');
  run(box, box.web, 'claim', '1');
  assert.equal(helpers.commitFile(box, box.web, 'web/feature.js', 'feature = 1\nmain = 0\n', 'feat(web): feature [G1]').status, 0);
  const submitted = box.git(box.web, 'rev-parse', 'HEAD');
  run(box, box.web, 'submit', '1');
  const reviewer = join(box.dir, 'web-2');
  box.git(box.repo, 'worktree', 'add', '-q', '--detach', reviewer, submitted);
  run(box, reviewer, 'join', 'web');
  run(box, reviewer, 'next', '--verify', '1');
  run(box, reviewer, 'verify', '1', 'accept', '--note', 'The feature changes its first line and the frozen check observes it.');
  assert.equal(withBoard(box.repo, board => store.getItem(board, 1)).item_review_by,
    withBoard(box.repo, board => store.getItem(board, 1)).item_verified_by,
    'the original reservation stays in history after acceptance; it is not a live review lease');
  const original = withBoard(box.repo, board => store.verdictsFor(board, 1));
  const mainEditor = join(box.dir, 'main-caller-editor');
  box.git(box.repo, 'worktree', 'add', '-q', '--detach', mainEditor, 'main');
  run(box, mainEditor, 'join', 'web');
  const peer = join(box.dir, 'replica');
  box.git(box.dir, 'clone', '-q', box.repo, peer);
  withBoard(peer, board => importBoard(board, withBoard(box.repo, exportBoard)));

  /** Move only the peer's Git trunk; its independently stored acceptance stays unchanged. */
  const syncTrunk = () => {
    box.git(peer, 'fetch', '-q', 'origin', 'main');
    box.git(peer, 'merge', '-q', '--ff-only', 'origin/main');
  };
  /** Read each replica through its actual public CLI, rather than a test-only freshness helper. */
  const items = () => [box.repo, peer].map(root => JSON.parse(run(box, root, 'show', '1', '--json')));
  let streamController;
  let streamReader;
  let builds = 0;
  const api = await serveApi({ runCommand: main, projects: () => [{ root: reviewer, name: 'Verdict fixture' }], onStateBuild: () => { builds += 1; } });
  t.after(async () => {
    streamController?.abort();
    await streamReader?.cancel().catch(() => {});
    await api.close();
  });
  const address = new URL(api.url);
  const headers = { 'x-pullboard-key': address.searchParams.get('k') };
  const apiPath = '/api/v1/boards/' + withBoard(box.repo, store.boardId);
  /** Read one authenticated public HTTP endpoint on the persistent worktree-backed server. */
  const http = async suffix => {
    const response = await fetchFresh(address.origin + apiPath + suffix, { headers });
    const document = await response.json();
    assert.equal(response.status, 200, JSON.stringify(document));
    return document;
  };
  const initialState = (await http('/state')).state;
  const phoneBefore = relaySnapshot(reviewer);
  await http('/state');
  assert.equal(builds, 1, 'unchanged HTTP reads reuse the state cache');
  await http('/items/1'); // Warm the independent detail freshness projection for a verified item.
  const processMethods = ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync'];
  const originals = new Map(processMethods.map(method => [method, childProcess[method]]));
  const processCalls = [];
  try {
    for (const method of processMethods) childProcess[method] = function (...args) {
      processCalls.push({ method, command: args[0] });
      return Reflect.apply(originals.get(method), this, args);
    };
    syncBuiltinESMExports();
    await http('/items/1');
    await http('/state');
    await http('/items/1');
    relaySnapshot(reviewer);
    relaySnapshot(reviewer);
    assert.deepEqual(processCalls, [], 'unchanged accepted-item detail, state and sealed phone snapshot reads spawn no process');
  } finally {
    for (const [method, original] of originals) childProcess[method] = original;
    syncBuiltinESMExports();
  }

  assert.ok(items().every(item => !item.item_verdict_state));
  assert.equal(helpers.commitFile(box, mainEditor, 'web/unrelated.js', 'unrelated = 1\n', 'feat(web): unrelated [G1]').status, 0);
  box.git(box.repo, 'merge', '-q', '--no-ff', box.git(mainEditor, 'rev-parse', 'HEAD'), '-m', 'chore(merge): unrelated main change [G1]');
  syncTrunk();
  assert.ok(items().every(item => !item.item_verdict_state), 'unrelated main files do not stale acceptance');
  assert.equal((await http('/state')).state.items[0].verdictState, undefined);
  const beforeMoveHead = box.git(reviewer, 'rev-parse', 'HEAD');
  streamController = new AbortController();
  const stream = await fetchFresh(address.origin + apiPath + '/events?after=' + initialState.sequence, {
    headers: { ...headers, accept: 'text/event-stream' }, signal: streamController.signal,
  });
  assert.equal(stream.status, 200);
  streamReader = stream.body.getReader();
  box.git(mainEditor, 'merge', '-q', '--ff-only', 'main');
  assert.equal(helpers.commitFile(box, mainEditor, 'web/feature.js', 'feature = 0\nmain = 1\n', 'feat(web): change main caller [G1]').status, 0);
  box.git(box.repo, 'merge', '-q', '--no-ff', box.git(mainEditor, 'rev-parse', 'HEAD'), '-m', 'chore(merge): change main caller [G1]');
  const movingCommit = box.git(box.repo, 'rev-parse', 'HEAD');
  syncTrunk();
  for (const item of items()) {
    assert.equal(item.item_verdict_state?.code, 'STALE_VERDICT');
    assert.equal(item.item_verdict_state.file, 'web/feature.js');
    assert.equal(item.item_verdict_state.commit, movingCommit);
    assert.equal(item.item_verdict, 'ACCEPT', 'the historical acceptance remains a fact');
  }
  assert.equal(box.git(reviewer, 'rev-parse', 'HEAD'), beforeMoveHead, 'the served worktree HEAD stayed fixed while main moved');
  const apiStale = (await http('/state')).state;
  assert.equal(apiStale.sequence, initialState.sequence, 'Git movement needs no board event to invalidate the state cache');
  assert.equal(apiStale.items[0].verdictState?.code, 'STALE_VERDICT');
  assert.equal(apiStale.items[0].verdictState.commit, movingCommit);
  const coldGit = [];
  const originalSpawn = childProcess.spawnSync;
  let phoneStale;
  try {
    childProcess.spawnSync = function (...args) {
      if (args[0] === 'git') coldGit.push(args[1]);
      return Reflect.apply(originalSpawn, this, args);
    };
    syncBuiltinESMExports();
    phoneStale = relaySnapshot(reviewer);
  } finally { childProcess.spawnSync = originalSpawn; syncBuiltinESMExports(); }
  assert.ok(coldGit.filter(args => args.includes('diff')).length <= 1,
    'unrelated main history must not start one file-diff process per commit: ' + JSON.stringify(coldGit));
  const phoneState = snapshotState(phoneStale, withBoard(box.repo, store.boardId));
  assert.equal(phoneState.items[0].verdictState?.commit, movingCommit, 'the sealed phone snapshot carries the same stale verdict at fixed served HEAD');
  assert.notEqual(presentationDigest(phoneBefore.presentation), presentationDigest(phoneStale.presentation), 'Git-only freshness changes cause a new sealed presentation');

  assert.equal((await http('/items/1')).item.verdictState?.commit, movingCommit);
  const streamDeadline = setTimeout(() => streamController.abort(new Error('trunk movement produced no live changed event')), 5_000); // budget: hang ceiling for a fixture-local change notification; no throughput claim.
  try {
    let buffered = '';
    while (!/event: changed\n/u.test(buffered)) {
      const { value, done } = await streamReader.read();
      assert.equal(done, false, 'the live stream stays open through the trunk change');
      buffered += new TextDecoder().decode(value);
    }
  } finally { clearTimeout(streamDeadline); }
  streamController.abort();
  await streamReader.cancel().catch(() => {});
  for (const root of [box.repo, peer]) {
    assert.match(run(box, root, 'show', '1'), /STALE_VERDICT/u);
    assert.equal(JSON.parse(run(box, root, 'list', '--all', '--json')).items[0].item_verdict_state?.commit, movingCommit);
    const resume = JSON.parse(run(box, root, 'resume', '--diagnostics', '--json'));
    assert.equal(resume.all[0].item_verdict_state?.commit, movingCommit);
    assert.deepEqual(resume.toMerge, [], 'resume never suggests landing a stale acceptance');
    assert.equal(resume.staleVerdicts[0].item_id, 1);
    assert.deepEqual(withBoard(root, board => store.verdictsFor(board, 1)), original, 'read projection cannot rewrite original proof');
    const refused = box.run(root, 'land', '--dry-run', '--json');
    assert.equal(refused.code, 1, refused.out + refused.err);
    const error = JSON.parse(refused.out).error;
    assert.equal(error.code, 'STALE_VERDICT');
    assert.ok(error.message.includes('web/feature.js') && error.message.includes(movingCommit), error.message);
  }
  box.git(box.repo, 'revert', '-m', '1', '--no-edit', movingCommit);
  syncTrunk();
  assert.ok(items().every(item => item.item_verdict_state?.commit === movingCommit), 'a revert cannot turn an old review into a new review');
  const priorChecks = readFileSync(checkedHeads, 'utf8');
  const oldHead = box.run(reviewer, 'verify', '1', 'accept', '--note', 'Trying the old candidate is insufficient.');
  assert.equal(oldHead.code, 1);
  assert.equal(readFileSync(checkedHeads, 'utf8'), priorChecks, 'old candidate is refused before running its check');
  box.git(reviewer, 'merge', '-q', '--no-edit', 'main');
  const composed = box.git(reviewer, 'rev-parse', 'HEAD');
  assert.notEqual(composed, submitted);
  const { holder, observed } = await holdForReviewQueue(box);
  let landingGuidance;
  try {
    landingGuidance = run(box, reviewer, 'verify', '1', 'accept', '--note', 'Re-reviewed the feature with the latest main caller and its reverted history.');
    assert.ok(existsSync(observed), 'the same prior reviewer really waited behind occupied fixture gate capacity');
  } finally {
    if (holder.exitCode === null && holder.signalCode === null) holder.kill('SIGTERM');
    const result = await holder.closed;
    assert.equal(result.code, 0, holder.failure ?? holder.stderrText);
  }
  assert.ok(landingGuidance.includes('git merge --no-ff ' + composed), 'the new-main manual landing hint names the checked composition, not the original submission');
  assert.equal(readFileSync(checkedHeads, 'utf8').trim().split('\n').at(-1), composed, 'the frozen check ran on the reviewed composition');
  const reviewed = withBoard(box.repo, board => store.verdictsFor(board, 1));
  assert.deepEqual(reviewed.slice(0, original.length), original);
  assert.equal(reviewed.length, original.length + 1, 're-review appends independent proof');
  const verdict = reviewed.at(-1);
  const outcome = withBoard(peer, board => {
    const move = prepareEngineMove(board, 'verify', [1, {
      agentId: verdict.verdict_by, decision: 'ACCEPT', note: verdict.verdict_note,
      head: verdict.verdict_head, digest: verdict.verdict_digest, policy: 'any',
      check: verdict.check, review: verdict.review, environment: verdict.environment,
    }]);
    return applyEngineMove(board, move, { sequence: 1, at: verdict.verdict_at });
  });
  assert.equal(outcome.error, undefined, JSON.stringify(outcome));
  const reviewPin = `refs/pullboard/items/1/${composed.slice(0, 12)}`;
  assert.equal(box.git(box.repo, 'rev-parse', reviewPin), composed, 'the checked commit is pinned durably for other replicas to fetch');
  assert.equal(items()[1].item_verdict_state?.code, 'STALE_VERDICT', 'a replica without the checked Git objects fails closed');
  const peerBoardId = withBoard(peer, store.boardId);
  assert.equal(snapshotState(relaySnapshot(peer), peerBoardId).items[0].verdictState?.code, 'STALE_VERDICT',
    'a sealed phone presentation also fails closed until the reviewed objects arrive');
  const peerApi = await serveApi({ runCommand: main, projects: () => [{ root: peer, name: 'Peer verdict fixture' }] });
  t.after(() => peerApi.close());
  const peerAddress = new URL(peerApi.url);
  /** Keep this peer's server alive across an object-only fetch without a board write. */
  const peerHttp = async suffix => {
    const response = await fetchFresh(peerAddress.origin + apiPath + suffix,
      { headers: { 'x-pullboard-key': peerAddress.searchParams.get('k') } });
    assert.equal(response.status, 200);
    return response.json();
  };
  assert.equal((await peerHttp('/state')).state.items[0].verdictState?.code, 'STALE_VERDICT');
  assert.equal((await peerHttp('/items/1')).item.verdictState?.code, 'STALE_VERDICT');
  box.git(peer, 'fetch', '-q', 'origin', reviewPin);
  assert.equal((await peerHttp('/items/1')).item.verdictState, undefined,
    'an object-only fetch clears a cached unavailable HTTP detail');
  assert.equal((await peerHttp('/state')).state.items[0].verdictState, undefined,
    'an object-only fetch clears a cached unavailable HTTP state');
  assert.equal(snapshotState(relaySnapshot(peer), peerBoardId).items[0].verdictState, undefined,
    'fetching the exact reviewed objects clears the sealed phone presentation without another board event or main move');
  assert.ok(items().every(item => !item.item_verdict_state), 'the same sealed re-review clears both replicas');
  assert.equal((await http('/state')).state.items[0].verdictState, undefined, 'a newer acceptance invalidates stale cached state');
  assert.equal((await http('/items/1')).item.verdictState, undefined);
  assert.equal(snapshotState(relaySnapshot(reviewer), withBoard(box.repo, store.boardId)).items[0].verdictState, undefined, 'the sealed phone presentation clears after the checked re-review');
  assert.deepEqual(withBoard(peer, board => store.verdictsFor(board, 1)), reviewed);
  box.git(box.repo, 'merge', '-q', '--no-edit', composed);
  syncTrunk();
  const landed = box.git(box.repo, 'rev-parse', 'HEAD');
  for (const root of [box.repo, peer]) withBoard(root, board => store.merged(board, 1, { agentId: 'coordinator', commit: landed }));
  assert.equal(helpers.commitFile(box, box.repo, 'web/feature.js', 'feature = 1\nmain = 2\n', 'feat(web): after landing [G1]').status, 0);
  syncTrunk();
  assert.ok(items().every(item => !item.item_verdict_state), 'landed items are not waiting for re-review');
  assert.ok(existsSync(join(peer, '.git', 'pullboard', 'board.sqlite')));
});


test('a checkout or trunk moving during verification cannot acquire proof [E8]', () => {
  const box = helpers.project();
  const reviewer = join(box.dir, 'moving-reviewer');
  const moveHead = join(box.dir, 'move-review-head');
  const moveMain = join(box.dir, 'move-review-main');
  const baseline = box.git(box.repo, 'rev-parse', 'main');
  const check = `grep -q '^feature = 1$' web/feature.js && if test -f '${moveHead}'; then git -C '${reviewer}' checkout -q --detach '${baseline}'; fi && if test -f '${moveMain}'; then git -C '${box.repo}' commit -q --allow-empty -m 'chore: move review trunk [G1]'; fi`;
  run(box, box.repo, 'add', 'web', 'Moving review', '--specs', 'G1', '--check', check, '--wait');
  run(box, box.web, 'claim', '1');
  assert.equal(helpers.commitFile(box, box.web, 'web/feature.js', 'feature = 1\n', 'feat(web): moving review feature [G1]').status, 0);
  const submitted = box.git(box.web, 'rev-parse', 'HEAD');
  run(box, box.web, 'submit', '1');
  box.git(box.repo, 'worktree', 'add', '-q', '--detach', reviewer, submitted);
  run(box, reviewer, 'join', 'web');
  writeFileSync(moveHead, 'armed');
  const moved = box.run(reviewer, 'verify', '1', 'accept', '--note', 'The check moved the live reviewer checkout.');
  assert.equal(moved.code, 1, moved.out + moved.err);
  assert.match(moved.err, /NOT_AT_COMMIT/u);
  assert.equal(box.git(reviewer, 'rev-parse', 'HEAD'), baseline, 'the actual checkout moved while its private check was running');
  assert.deepEqual(withBoard(box.repo, board => store.verdictsFor(board, 1)), []);
  rmSync(moveHead);
  box.git(reviewer, 'checkout', '-q', '--detach', submitted);
  writeFileSync(moveMain, 'armed');
  const mainMoved = box.run(reviewer, 'verify', '1', 'accept', '--note', 'The check moved the known main.');
  assert.equal(mainMoved.code, 1, mainMoved.out + mainMoved.err);
  assert.match(mainMoved.err, /VERDICT_TRUNK_MOVED/u);
  assert.notEqual(box.git(box.repo, 'rev-parse', 'main'), baseline);
  assert.deepEqual(withBoard(box.repo, board => store.verdictsFor(board, 1)), []);
  rmSync(moveMain);
  run(box, reviewer, 'verify', '1', 'accept', '--note', 'The candidate and known trunk stayed fixed through the complete frozen check.');
  assert.equal(withBoard(box.repo, board => store.verdictsFor(board, 1)).length, 1);
});


test('landing retains the exact repair that passed stale re-review [E8,V8,R3]', () => {
  const box = helpers.project();
  const source = (feature, expected) => `feature = ${feature}\n${'// independent caller line\n'.repeat(12)}expected = ${expected}\n`;
  assert.equal(helpers.commitFile(box, box.repo, 'web/feature.txt', source(0, 1), 'feat(web): baseline caller [G1]').status, 0);
  box.git(box.web, 'merge', '-q', '--ff-only', 'main');
  const check = `test "$(sed -n 's/^feature = //p' web/feature.txt)" = "$(sed -n 's/^expected = //p' web/feature.txt)"`;
  run(box, box.repo, 'add', 'web', 'Repair follows its review', '--specs', 'G1', '--check', check, '--wait');
  run(box, box.web, 'claim', '1');
  assert.equal(helpers.commitFile(box, box.web, 'web/feature.txt', source(1, 1), 'feat(web): original feature [G1]').status, 0);
  const submitted = box.git(box.web, 'rev-parse', 'HEAD');
  run(box, box.web, 'submit', '1');
  const reviewer = join(box.dir, 'repair-reviewer');
  box.git(box.repo, 'worktree', 'add', '-q', '--detach', reviewer, submitted);
  run(box, reviewer, 'join', 'web');
  run(box, reviewer, 'verify', '1', 'accept', '--note', 'The original feature matches the original caller.');
  const original = withBoard(box.repo, board => store.verdictsFor(board, 1));
  assert.equal(helpers.commitFile(box, box.repo, 'web/feature.txt', source(0, 2), 'feat(web): caller now requires two [G1]').status, 0);
  assert.equal(JSON.parse(run(box, box.repo, 'show', '1', '--json')).item_verdict_state?.code, 'STALE_VERDICT');
  box.git(reviewer, 'merge', '-q', '--no-edit', 'main');
  assert.equal(helpers.commitFile(box, reviewer, 'web/feature.txt', source(2, 2), 'feat(web): repair against the new caller [G1]').status, 0);
  assert.equal(helpers.commitFile(box, reviewer, 'web/repair.txt', 'ready\n', 'feat(web): add the repair companion [G1]').status, 0);
  const checked = box.git(reviewer, 'rev-parse', 'HEAD');
  run(box, reviewer, 'verify', '1', 'accept', '--note', 'The repaired composition matches the new caller; the original feature does not.');
  const reviewed = withBoard(box.repo, board => store.verdictsFor(board, 1));
  assert.deepEqual(reviewed.slice(0, original.length), original);
  assert.equal(reviewed.at(-1).verdict_head, checked);
  const probe = join(box.dir, 'repair-path-replica');
  box.git(box.dir, 'clone', '-q', box.repo, probe);
  withBoard(probe, board => importBoard(board, withBoard(box.repo, exportBoard)));
  box.git(probe, 'fetch', '-q', 'origin', `refs/pullboard/items/1/${checked.slice(0, 12)}`);
  assert.equal(helpers.commitFile(box, probe, 'web/repair.txt', 'main changed the repair\n', 'feat(web): main changes a repair file [G1]').status, 0);
  const changedRepair = JSON.parse(run(box, probe, 'show', '1', '--json'));
  assert.equal(changedRepair.item_verdict_state?.file, 'web/repair.txt', 'a file introduced by the checked repair must participate in later freshness');

  const remote = join(box.dir, 'landing-remote.git');
  box.git(box.dir, 'init', '-q', '--bare', remote);
  box.git(box.repo, 'remote', 'add', 'origin', remote);
  box.git(box.repo, 'push', '-q', '-u', 'origin', 'main');
  const landed = JSON.parse(run(box, box.repo, 'land', '--json'));
  assert.deepEqual(landed.landed, [1], JSON.stringify(landed));
  assert.equal(box.git(box.repo, 'show', landed.batch.tip + ':web/feature.txt'), source(2, 2).trim(), 'landing must retain the exact repaired file that passed the frozen check');
  assert.equal(box.git(box.remote ?? remote, 'rev-parse', 'main'), landed.batch.tip);
  assert.equal(withBoard(box.repo, board => store.getItem(board, 1)).item_commit, submitted, 'the original submission remains the immutable item identity');
});

test('an older pushed landing shows stale checked proof and a correction path across public views [E8,H16,R3]',
  { timeout: 120_000 }, async t => { // budget: hang ceiling for real Git, private push and CLI verification; not a speed target.
    const box = helpers.project();
    assert.equal(helpers.commitFile(box, box.repo, 'web/feature.txt', 'feature = 0\n', 'feat(web): legacy landing base [G1]').status, 0);
    box.git(box.web, 'merge', '-q', '--ff-only', 'main');
    const base = box.git(box.repo, 'rev-parse', 'HEAD');
    run(box, box.repo, 'add', 'web', 'Legacy landing review', '--specs', 'G1', '--check', 'test -f web/feature.txt', '--wait');
    run(box, box.web, 'claim', '1');
    assert.equal(helpers.commitFile(box, box.web, 'web/feature.txt', 'feature = 1\n', 'feat(web): legacy pushed feature [G1]').status, 0);
    const submitted = box.git(box.web, 'rev-parse', 'HEAD');
    run(box, box.web, 'submit', '1');
    const reviewer = join(box.dir, 'legacy-landing-reviewer');
    box.git(box.repo, 'worktree', 'add', '-q', '--detach', reviewer, submitted);
    run(box, reviewer, 'join', 'web');
    run(box, reviewer, 'verify', '1', 'accept', '--note', 'The original submitted feature passed.');
    const remote = join(box.dir, 'legacy-landing-remote.git');
    box.git(box.dir, 'init', '-q', '--bare', remote);
    box.git(box.repo, 'remote', 'add', 'origin', remote);
    box.git(box.repo, 'push', '-q', '-u', 'origin', 'main');
    // The older coordinator pushed B; this replica's retained main still has A.
    box.git(box.web, 'push', '-q', 'origin', `${submitted}:refs/heads/main`);
    const entry = { id: 1, commit: submitted, merge: submitted };
    const batch = { version: 1, id: 'real-legacy-push', state: 'pushed', base, tip: submitted,
      branch: 'refs/heads/main', root: box.repo, owner: 'fixture', logPath: join(box.dir, 'landing.log'),
      candidates: [entry], items: [entry], revision: 0 };
    withBoard(box.repo, board => store.recordLandingBatch(board, { agentId: 'coordinator', batch }));
    const archived = join(box.dir, 'engine12');
    mkdirSync(archived);
    unpackRelease('59a6e2b286ee852add0d68a659f1a1e6b3257c44', archived);
    const oldStore = await import(pathToFileURL(join(archived, 'src/board.js')).href);
    const oldExchange = await import(pathToFileURL(join(archived, 'src/exchange.js')).href);
    const oldEngine = await import(pathToFileURL(join(archived, 'src/engine.js')).href);
    const old = oldStore.openBoard(join(box.dir, 'old.sqlite'));
    t.after(() => oldStore.closeBoard(old));
    oldExchange.importBoard(old, withBoard(box.repo, exportBoard));
    const finish = oldEngine.prepareEngineMove(old, 'finishLandingBatch', [{ agentId: 'coordinator', id: batch.id, tip: submitted }], { id: 'actual-legacy-in-flight-finish' });
    assert.equal(finish.engine, 12);

    assert.equal(helpers.commitFile(box, box.repo, 'web/feature.txt', 'feature = 2\n', 'feat(web): newer main requirement [G1]').status, 0);
    const conflict = box.tryGit(reviewer, 'merge', '-q', '--no-edit', 'main');
    assert.notEqual(conflict.status, 0, 'the older feature conflicts with this replica\'s newer requirement');
    assert.match(`${conflict.stdout ?? ''}${conflict.stderr ?? ''}`, /CONFLICT \(content\)/u);
    assert.equal(helpers.commitFile(box, reviewer, 'web/feature.txt', 'feature = 3\n', 'fix(web): checked correction composition [G1]').status, 0);
    const checked = box.git(reviewer, 'rev-parse', 'HEAD');
    run(box, reviewer, 'verify', '1', 'accept', '--note', 'The newer checked composition passed its frozen check.');
    const verdicts = withBoard(box.repo, board => store.verdictsFor(board, 1));
    const outcome = withBoard(box.repo, board => applyEngineMove(board, finish, { sequence: 1, at: '2026-10-17T20:00:00.000Z' }));
    assert.equal(outcome.error, undefined, JSON.stringify(outcome));
    assert.equal(box.git(remote, 'rev-parse', 'main'), submitted, 'the immutable receipt names the actual earlier private push');
    assert.equal(box.tryGit(box.repo, 'merge-base', '--is-ancestor', checked, 'main').status, 1, 'the newer checked composition has not landed');
    const item = JSON.parse(run(box, box.repo, 'show', '1', '--json'));
    assert.equal(item.item_merged_commit, submitted);
    assert.equal(item.item_verdict_state?.code, 'STALE_VERDICT');
    assert.equal(item.item_verdict_state?.landingCode, 'LAND_ITEM_MOVED');
    assert.equal(item.item_verdict_state?.checked, checked);
    const explanation = run(box, box.repo, 'show', '1');
    assert.match(explanation, /create a correction item/u);
    assert.match(explanation, new RegExp(checked));
    assert.doesNotMatch(explanation, /then another agent runs pullboard verify 1 accept/u);
    assert.deepEqual(withBoard(box.repo, board => store.verdictsFor(board, 1)), verdicts, 'presentation does not rewrite proof');
    const api = await serveApi({ runCommand: main, projects: () => [{ root: box.repo, name: 'Older landing fixture' }] });
    t.after(() => api.close());
    const address = new URL(api.url);
    const detail = await fetchFresh(address.origin + '/api/v1/boards/' + withBoard(box.repo, store.boardId) + '/items/1',
      { headers: { 'x-pullboard-key': address.searchParams.get('k') } });
    assert.equal(detail.status, 200);
    assert.equal((await detail.json()).item.verdictState?.landingCode, 'LAND_ITEM_MOVED');
    assert.equal(snapshotState(relaySnapshot(box.repo), withBoard(box.repo, store.boardId)).items[0].verdictState?.landingCode, 'LAND_ITEM_MOVED');
    const missing = join(box.dir, 'legacy-landing-missing-objects');
    box.git(box.dir, 'clone', '-q', '--no-local', box.repo, missing);
    assert.notEqual(box.tryGit(missing, 'cat-file', '-e', checked).status, 0, 'this independent clone has not fetched the checked composition');
    withBoard(missing, board => importBoard(board, withBoard(box.repo, exportBoard)));
    const unavailable = JSON.parse(run(box, missing, 'show', '1', '--json'));
    assert.equal(unavailable.item_verdict_state?.landingCode, 'LAND_ITEM_MOVED');
    assert.equal(unavailable.item_verdict_state?.checked, checked);
    assert.match(run(box, missing, 'show', '1'), /create a correction item/u,
      'missing reviewed objects must never suggest re-reviewing an immutable landing');
    const refused = box.run(reviewer, 'verify', '1', 'accept', '--note', 'Cannot rewrite the original landing.');
    assert.equal(refused.code, 1);
    assert.match(refused.err, /NOT_SUBMITTED|ALREADY_MERGED/u, 'the existing merged-receipt guards stay in force');
    box.git(box.repo, 'merge', '-q', '--no-edit', checked);
    assert.equal(JSON.parse(run(box, box.repo, 'show', '1', '--json')).item_verdict_state, undefined,
      'a later correction containing the checked composition clears the derived warning without rewriting the old landing');
    assert.equal(withBoard(box.repo, board => store.getItem(board, 1)).item_merged_commit, submitted);
  });

/** A person's own session, through the stand-in GitHub's real OAuth, signed in as `login`. */
async function personSession(box, login) {
  box.providerState.signer = login;
  try {
    const start = await fetch(box.origin + '/auth/github/start', { redirect: 'manual' });
    const binding = start.headers.getSetCookie().find((value) => value.startsWith('pb_oauth_binding=')).split(';')[0];
    const approved = await fetch(start.headers.get('location'), { redirect: 'manual' });
    const callback = await fetch(approved.headers.get('location'), { redirect: 'manual', headers: { cookie: binding } });
    assert.equal(callback.status, 303, `${login} signs in`);
    return callback.headers.getSetCookie().find((value) => value.startsWith('pb_session=')).split(';')[0].slice('pb_session='.length);
  } finally { box.providerState.signer = 'alice'; }
}

/** Call the relay as one credential, returning the status and document. */
async function relayCall(box, token, method, path, body) {
  const response = await fetch(box.origin + path, { method, headers: { authorization: 'Bearer ' + token, 'x-pullboard-engine': String(PEOPLE_VERSION),
    ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  let document = null;
  try { document = await response.json(); } catch { /* An empty answer stays null. */ }
  return { status: response.status, document };
}

/** Seal one phone request the way the paired view does and send it with this person's session. */
async function phoneRequest(box, session, move) {
  const link = JSON.parse(readFileSync(box.linkFile, 'utf8'));
  const head = await relayCall(box, session, 'GET', '/api/v2/boards/' + link.board + '/state');
  assert.equal(head.status, 200, `this person reads the board: ${JSON.stringify(head.document)}`);
  const events = await relayCall(box, session, 'GET', `/api/v1/boards/${link.board}/events?after=${head.document.state.sequence}`);
  const sequence = Math.max(head.document.state.sequence, ...(events.document.events ?? []).map((event) => event.event_id)) + 1;
  const document = { version: 1, type: 'person-request', id: randomUUID(), move };
  const key = decodeBoardKey(readFileSync(box.keyFile, 'utf8').trim());
  const sealed = Buffer.from(await seal(key, new TextEncoder().encode(JSON.stringify(document)), { boardId: link.board, kind: 'request', sequence })).toString('base64url');
  const sent = await relayCall(box, session, 'POST', `/api/v1/boards/${link.board}/requests`, { sequence, sealed });
  assert.equal(sent.status, 200, `the relay stores the sealed request: ${JSON.stringify(sent.document)}`);
  return document.id;
}

/** The phone requests this board has received, by id. */
async function receivedRequests(box) {
  assert.equal((await box.cli('status')).code, 0, 'the coordinator reads the relay');
  const meta = (await box.cli('export')).document.tables.board_meta.find((row) => row.meta_key === 'relay_person_requests');
  return Object.fromEntries((meta ? JSON.parse(meta.meta_value) : []).map((record) => [record.id, record]));
}

/** Two people with write access to the fixture repository, alice and bob, and alice's linked board. */
async function teamBoard(t, approvers) {
  const box = await relayClientFixture(t);
  Object.assign(box.providerState, { people: { alice: { id: 7, permission: 'write' }, bob: { id: 8, permission: 'write' } }, signer: 'alice' });
  if (approvers) {
    const file = join(box.root, 'pullboard.json');
    writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, 'utf8')), approvers }, null, 2) + '\n');
    runFixtureGit(['add', 'pullboard.json'], { cwd: box.root, env: box.env });
    runFixtureGit(['-c', 'core.hooksPath=/dev/null', 'commit', '-q', '-m', 'chore: name the approvers'], { cwd: box.root, env: box.env });
  }
  assert.equal((await box.link()).code, 0, 'alice links the board, signed in as herself');
  return box;
}

test('the board knows its people: events name them, approvers decide [E3,E4,E20]', { timeout: 180_000 }, async (t) => { // budget: hang ceiling for two people's real CLI runs and relay calls; not a speed target.
  const box = await teamBoard(t, ['alice']);
  const link = JSON.parse(readFileSync(box.linkFile, 'utf8'));
  const alice = await personSession(box, 'alice');
  const bob = await personSession(box, 'bob');
  assert.deepEqual((await relayCall(box, alice, 'GET', `/api/v1/boards/${link.board}/approvers`)).document.approvers, ['alice'], 'relay on gave the relay the approvers pullboard.json names');

  // S4c: every move records the person who made it, and the agent if one did.
  assert.equal((await box.cli('add', box.lane, 'An item alice adds')).code, 0);
  const bobRoot = join(box.root, '..', 'bob-clone');
  runFixtureGit(['clone', '-q', box.root, bobRoot], { cwd: box.root, env: box.env });
  runFixtureGit(['remote', 'set-url', 'origin', 'git@github.com:fixture/repository.git'], { cwd: bobRoot, env: box.env });
  const bobHome = join(box.root, '..', 'bob-home');
  const bobEnv = { ...box.env, HOME: bobHome, PULLBOARD_HOME: join(bobHome, '.pullboard'), PULLBOARD_MACHINE_HOME: join(bobHome, 'machine') };
  cpSync(join(box.root, '.git', 'pullboard'), join(bobRoot, '.git', 'pullboard'), { recursive: true, filter: (path) => !path.endsWith('.lock') });
  mkdirSync(join(bobEnv.PULLBOARD_HOME, 'relay-keys'), { recursive: true, mode: 0o700 });
  cpSync(box.keyFile, join(bobEnv.PULLBOARD_HOME, 'relay-keys', link.board + '.key'));
  box.providerState.signer = 'bob';
  const bobOn = await relayFixtureChild(bobRoot, bobEnv, [CLI, 'relay', 'on', '--url', box.origin, '--json']);
  box.providerState.signer = 'alice';
  assert.equal(bobOn.code, 0, `bob signs in as himself on his own computer: ${bobOn.stderr}`);
  // One coordinator per board [E19]: bob's main checkout takes the coordinator to act, then alice takes it back.
  const bobTakes = await relayFixtureChild(bobRoot, bobEnv, [CLI, 'takeover', '--json']);
  assert.equal(bobTakes.code, 0, `bob's main checkout takes the coordinator: ${JSON.stringify(bobTakes.document?.error ?? null)}`);
  const bobAdd = await relayFixtureChild(bobRoot, bobEnv, [CLI, 'add', box.lane, 'An item bob adds', '--json']);
  assert.equal(bobAdd.code, 0, `bob adds an item: ${JSON.stringify(bobAdd.document?.error ?? null)}`);
  assert.equal((await box.cli('takeover')).code, 0, 'alice’s main checkout takes the coordinator back');
  const exported = (await box.cli('export')).document.tables;
  const events = exported.event;
  const madeBy = (title) => {
    const id = exported.item.find((item) => item.item_title === title)?.item_id;
    return events.filter((event) => event.event_kind === 'add' && event.item_id === id).map((event) => JSON.parse(event.event_detail).person);
  };
  assert.deepEqual(madeBy('An item alice adds'), ['alice'], 'alice’s move names alice');
  assert.deepEqual(madeBy('An item bob adds'), ['bob'], 'bob’s move names bob');
  assert.ok(events.filter((event) => event.event_kind === 'add').every((event) => event.event_by), 'each move still names the agent or seat that made it');

  // S4b: only an approver answers the person's decisions, and only an approver decides rows.
  const asked = await box.cli('shout', 'person', 'Ship the health endpoint as plain text or JSON?', '--decision');
  assert.equal(asked.code, 0);
  const decision = asked.document.id ?? asked.document.shout_id ?? asked.document.result?.id;
  const fromBob = await phoneRequest(box, bob, { verb: 'answer', item: Number(decision), args: { text: 'JSON' } });
  const fromAlice = await phoneRequest(box, alice, { verb: 'answer', item: Number(decision), args: { text: 'JSON' } });
  const requests = await receivedRequests(box);
  assert.equal(requests[fromBob].status, 'refused', 'bob, a writer but not an approver, cannot answer as the person');
  assert.equal(requests[fromBob].error.code, 'NOT_APPROVER');
  assert.notEqual(requests[fromAlice].status, 'refused', 'alice, an approver, answers as the person');
  const rowFromBob = await phoneRequest(box, bob, { verb: 'spec-approve', args: { ids: 'G1' } });
  assert.equal((await receivedRequests(box))[rowFromBob].error?.code, 'NOT_APPROVER', 'bob cannot approve a row');

  // E4: a change to the list takes effect only once an existing approver makes it.
  assert.equal((await relayCall(box, bob, 'PUT', `/api/v1/boards/${link.board}/approvers`, { approvers: ['bob'] })).document.error?.code, 'NOT_APPROVER', 'bob cannot make himself an approver');
  assert.deepEqual((await relayCall(box, bob, 'GET', `/api/v1/boards/${link.board}/approvers`)).document.approvers, ['alice']);

  // S9: a move no member can open is set aside, and only an approver unlinks the board or replaces its snapshot.
  const bobMachine = JSON.parse(readFileSync(join(bobRoot, '.git', 'pullboard', 'relay.json'), 'utf8')).token;
  const head = await relayCall(box, alice, 'GET', '/api/v2/boards/' + link.board + '/state');
  const after = await relayCall(box, alice, 'GET', `/api/v1/boards/${link.board}/events?after=${head.document.state.sequence}`);
  const next = Math.max(head.document.state.sequence, ...(after.document.events ?? []).map((event) => event.event_id)) + 1;
  const junk = await relayCall(box, bobMachine, 'POST', `/api/v1/boards/${link.board}/moves`, { sequence: next, sealed: randomBytes(64).toString('base64url') });
  assert.equal(junk.status, 200, 'a member’s credential can store bytes no key opens');
  const afterJunk = await box.cli('add', box.lane, 'After the junk');
  assert.equal(afterJunk.code, 0, `replay sets the unopenable move aside and the board moves on: ${afterJunk.stderr ?? ''}${JSON.stringify(afterJunk.document ?? {}).slice(0, 600)}`);
  assert.ok((await box.cli('export')).document.tables.event.some((event) => event.event_kind === 'relay_refused' && JSON.parse(event.event_detail).sequence === next), 'the set-aside move is on the record');
  const deleted = await relayCall(box, bob, 'DELETE', `/api/v1/boards/${link.board}`);
  assert.equal(deleted.document?.error?.code, 'NOT_APPROVER', 'bob cannot unlink the board');
  const replaced = await relayCall(box, bobMachine, 'PUT', `/api/v1/boards/${link.board}/state`, { sequence: next, sealed: randomBytes(64).toString('base64url') });
  assert.equal(replaced.document?.error?.code, 'NOT_APPROVER', 'bob’s computer cannot replace the snapshot');
  assert.equal((await box.cli('status')).code, 0, 'alice’s board still reads');
});

test('the board knows its people: a phone move names the phone’s person, refused or not [E3,E4]', { timeout: 180_000 }, async (t) => { // budget: hang ceiling for real CLI runs and relay calls; not a speed target.
  const box = await teamBoard(t, ['alice']);
  const bob = await personSession(box, 'bob');
  // Bob's phone adds an item; alice's computer carries it out, so the move is sent with alice's credential.
  const title = 'An item from bob’s phone';
  const added = await phoneRequest(box, bob, { verb: 'add', args: { lane: box.lane, title } });
  const asked = await box.cli('shout', 'person', 'Plain text or JSON?', '--decision');
  assert.equal(asked.code, 0);
  const decision = asked.document.id ?? asked.document.shout_id ?? asked.document.result?.id;
  const denied = await phoneRequest(box, bob, { verb: 'answer', item: Number(decision), args: { text: 'JSON' } });
  const requests = await receivedRequests(box);
  assert.equal(requests[added].status, 'done', 'bob’s phone adds the item');
  assert.equal(requests[denied].error?.code, 'NOT_APPROVER', 'bob’s phone cannot answer as the person');
  const tables = (await box.cli('export')).document.tables;
  const id = tables.item.find((item) => item.item_title === title)?.item_id;
  const add = tables.event.find((event) => event.event_kind === 'add' && event.item_id === id);
  const refused = tables.event.find((event) => event.event_kind === 'relay_refused' && JSON.parse(event.event_detail).sequence === requests[denied].sequence);
  assert.ok(add && refused, 'both are on the record');
  assert.equal(JSON.parse(add.event_detail).person, 'bob', 'the add names bob, whose phone asked for it, not alice, whose computer carried it out');
  assert.equal(JSON.parse(refused.event_detail).person, 'bob', 'the refused answer still names bob, who tried it');
});

test('a board that names no approvers takes person moves as before [E4]', { timeout: 120_000 }, async (t) => { // budget: hang ceiling for real CLI runs and relay calls; not a speed target.
  const box = await teamBoard(t, null);
  const link = JSON.parse(readFileSync(box.linkFile, 'utf8'));
  const bob = await personSession(box, 'bob');
  assert.equal((await relayCall(box, bob, 'GET', `/api/v1/boards/${link.board}/approvers`)).document.approvers, null, 'the relay holds no approvers for this board');
  const asked = await box.cli('shout', 'person', 'Plain text or JSON?', '--decision');
  const decision = asked.document.id ?? asked.document.shout_id ?? asked.document.result?.id;
  const fromBob = await phoneRequest(box, bob, { verb: 'answer', item: Number(decision), args: { text: 'JSON' } });
  assert.notEqual((await receivedRequests(box))[fromBob].status, 'refused', 'any writer’s session answers as the person, as today');
});


/** Every file under a directory, so a test can prove no secret was written anywhere in it. */
function filesUnder(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? filesUnder(join(directory, entry.name)) : [join(directory, entry.name)]);
}

test('every session reads and moves: terminal, SSH, agent, job or CI [E9,E18]', { timeout: 240_000 }, async (t) => { // budget: hang ceiling for real CLI runs on three homes and a loopback relay; not a speed target.
  const box = await sessionRelay(t);
  const cli = join(import.meta.dirname, '..', 'bin', 'pullboard.js');

  // S6d: on a machine with a keychain, relay on keeps the key in the owner-only file every session can read.
  const keychainBin = join(box.root, '..', 'keychain-bin');
  mkdirSync(keychainBin, { mode: 0o700 });
  for (const name of readdirSync(box.env.PATH)) symlinkSync(join(box.env.PATH, name), join(keychainBin, name));
  const keychainLog = join(box.root, '..', 'keychain-calls.log');
  for (const name of ['security', 'secret-tool']) {
    writeFileSync(join(keychainBin, name), `#!/bin/sh\necho "$1" >> ${JSON.stringify(keychainLog)}\n[ "$1" = search ] && exit 1\nexit 0\n`, { mode: 0o755 });
  }
  const plainPath = box.env.PATH;
  box.env.PATH = keychainBin;
  assert.equal((await box.link()).code, 0, 'relay on links the board on a machine with a keychain');
  box.env.PATH = plainPath;
  const keys = join(box.env.PULLBOARD_HOME, 'relay-keys');
  assert.deepEqual(readdirSync(keys).filter((name) => name.endsWith('.key')).length, 1, 'the key sits in one owner-only file');
  assert.equal(statSyncMode(box.keyFile), 0o600, 'the key file is owner-only');
  const writes = existsSync(keychainLog) ? readFileSync(keychainLog, 'utf8').split('\n').filter((call) => ['add-generic-password', 'store'].includes(call)) : [];
  assert.deepEqual(writes, [], 'relay on never writes the key to the keychain');

  // S6b: a session that cannot read the key (SSH, a scheduled job, a locked keychain) still reads the whole board.
  assert.equal((await box.cli('add', box.lane, 'Read from any session')).code, 0);
  renameSync(keys, keys + '.parked');
  try {
    for (const command of [['list'], ['show', '1'], ['inbox'], ['whoami'], ['status'], ['resume'], ['log']]) {
      const read = await box.cli(...command);
      assert.equal(read.code, 0, `${command[0]} reads without the key: ${JSON.stringify(read.document?.error ?? null)}`);
    }
    const move = await box.cli('add', box.lane, 'Needs the key');
    assert.equal(move.document?.error?.code, 'RELAY_KEY_MISSING', 'a move without the key is refused, never sent or lost');
  } finally { renameSync(keys + '.parked', keys); }

  // S6c: a CI or cloud session, with an agent token and the board key in its environment and no key file, reads and moves.
  // The project's committed setup is what every checkout, CI's included, gets.
  sessionGit(['add', '-A'], { cwd: box.root, env: box.env });
  sessionGit(['-c', 'core.hooksPath=/dev/null', 'commit', '-q', '-m', 'chore: set up pullboard'], { cwd: box.root, env: box.env });
  const seatRoot = join(box.root, '..', 'ci-seat');
  sessionGit(['worktree', 'add', '-q', '-b', 'ci-seat', seatRoot], { cwd: box.root, env: box.env });
  const joined = await box.cliAt(seatRoot, 'join', box.lane, '--model', 'fixture-model');
  assert.equal(joined.code, 0, `the person gives CI its own seat: ${JSON.stringify(joined.document?.error ?? null)}`);
  const seat = (await box.cliAt(seatRoot, 'whoami')).document;
  assert.equal((await box.cliAt(seatRoot, 'shout', 'coordinator', 'the CI seat is ready')).code, 0, 'the seat moves once, which mints its token');
  const link = JSON.parse(readFileSync(box.linkFile, 'utf8'));
  const token = link.agentTokens?.[seat.id]?.token;
  assert.match(token ?? '', /^pa_/u, 'the seat holds its own agent token');
  const ciRoot = join(box.root, '..', 'ci-clone');
  sessionGit(['clone', '-q', box.root, ciRoot], { cwd: box.root, env: box.env });
  sessionGit(['remote', 'set-url', 'origin', 'git@github.com:fixture/repository.git'], { cwd: ciRoot, env: box.env });
  const ciHome = join(box.root, '..', 'ci-home');
  mkdirSync(ciHome, { mode: 0o700 });
  const key = readFileSync(box.keyFile, 'utf8').trim();
  // The CI machine also has a keychain holding a legacy copy of the key; the session must not move it into a file.
  const ciKeychainBin = join(ciHome, 'keychain-bin');
  mkdirSync(ciKeychainBin, { mode: 0o700 });
  for (const name of readdirSync(box.env.PATH)) symlinkSync(join(box.env.PATH, name), join(ciKeychainBin, name));
  for (const name of ['security', 'secret-tool']) {
    writeFileSync(join(ciKeychainBin, name), '#!/bin/sh\ncase "$1" in search) exit 1;; find-generic-password|lookup) printf %s "$PULLBOARD_RELAY_KEY"; exit 0;; esac\nexit 0\n', { mode: 0o755 });
  }
  const ciEnv = { ...box.env, HOME: ciHome, PULLBOARD_HOME: join(ciHome, '.pullboard'), PULLBOARD_MACHINE_HOME: join(ciHome, 'machine'), PATH: ciKeychainBin,
    PULLBOARD_RELAY_TOKEN: token, PULLBOARD_RELAY_KEY: key, PULLBOARD_RELAY_URL: box.origin };
  const ci = (...args) => sessionChild(ciRoot, ciEnv, [cli, ...args, '--json']);
  const status = await ci('status');
  assert.equal(status.code, 0, 'CI reads the board');
  const listed = await ci('list', '--all');
  assert.ok(listed.document.items.some((item) => (item.title ?? item.item_title) === 'Read from any session'),
    `CI reads the board’s items: ${JSON.stringify(listed.document.items?.map((item) => item.title ?? item.item_title))} ${JSON.stringify(status.document).replaceAll(token, '<token>').replaceAll(key, '<key>').slice(0, 900)}`);
  const added = await ci('add', box.lane, 'Added from CI');
  assert.equal(added.code, 0, `CI moves on the board: ${JSON.stringify(added.document?.error ?? null)}`);
  assert.equal((await box.cli('status')).code, 0);
  const items = (await box.cli('export')).document.tables.item;
  assert.ok(items.some((item) => item.item_title === 'Added from CI'), 'the CI move reaches the person’s board');
  assert.equal(filesUnder(join(ciEnv.PULLBOARD_HOME, 'relay-keys')).length, 0, 'CI keeps no key file');
  const written = [...filesUnder(join(ciRoot, '.git', 'pullboard')), ...filesUnder(ciHome)].map((file) => readFileSync(file)).map((bytes) => bytes.toString('latin1'));
  assert.equal(written.some((text) => text.includes(token) || text.includes(key)), false, 'neither the token nor the key is written to disk');
  for (const output of [status, listed, added]) {
    const shown = JSON.stringify(output.document) + (output.failure ?? '');
    assert.equal(shown.includes(token) || shown.includes(key), false, 'no output repeats a secret');
  }
  // A clone already linked to another board keeps its link: the environment never overwrites it.
  const otherLink = join(ciRoot, '.git', 'pullboard', 'relay.json');
  const elsewhere = JSON.stringify({ ...JSON.parse(readFileSync(otherLink, 'utf8')), board: 'f'.repeat(32) });
  writeFileSync(otherLink, elsewhere, { mode: 0o600 });
  const warned = await ci('status');
  assert.match(JSON.stringify(warned.document?.diagnostics ?? []), /RELAY_LINKED/u, 'the environment names the link to another board and the read goes on');
  const relayRead = await ci('relay', 'status');
  assert.equal(relayRead.code, 0, `relay status is a read too, so it goes on: ${JSON.stringify(relayRead.document?.error?.code ?? null)}`);
  assert.match(JSON.stringify(relayRead.document?.diagnostics ?? []), /RELAY_LINKED/u, 'relay status names the link to another board');
  const refused = await ci('add', box.lane, 'Added across boards');
  assert.notEqual(refused.code, 0, 'a session on another board’s link does not move');
  for (const output of [warned, relayRead, refused]) {
    const shown = JSON.stringify(output.document) + (output.failure ?? '');
    assert.equal(shown.includes(token) || shown.includes(key), false, 'the refusal repeats no secret');
  }
  assert.equal(readFileSync(otherLink, 'utf8'), elsewhere, 'the other board’s link is left as it was');
});

/** A file's permission bits. */
function statSyncMode(file) { return lstatSync(file).mode & 0o777; }

test('one coordinator per board across machines [E19]', { timeout: relayWorkBudgetMs(12) }, async t => { // budget: hang ceiling for two linked devices' real CLI and relay round trips; not a speed target.
  const box = await relayClientFixture(t);
  await box.link();
  const pairing = await box.cli('relay', 'pair');
  const other = await box.otherDeviceJoin(pairing.document.code);
  /** A refusal's code and message as the CLI reports them. */
  const refusal = result => ({ code: result.document?.error?.code, message: String(result.document?.error?.message ?? '') });

  // The first device to act as coordinator holds it; the board keeps working there as it does today.
  assert.equal((await box.cli('add', box.lane, 'Planned on the first machine')).code, 0, 'the first machine coordinates');
  assert.equal((await box.cli('add', box.lane, 'Still planned on the first machine')).code, 0, 'the holder keeps coordinating');

  // On one machine, the main checkout is held by one agent session at a time; takeover passes it between sessions.
  /** Run the first machine's real CLI from a named agent session. */
  const inSession = (session, ...args) => relayFixtureChild(box.root, { ...box.env, CLAUDECODE: '1', CLAUDE_CODE_SESSION_ID: session },
    [resolve(import.meta.dirname, '../bin/pullboard.js'), ...args, '--json']);
  assert.equal((await inSession('first-session', 'add', box.lane, 'Planned in the first session')).code, 0, 'one agent session coordinates');
  assert.equal(refusal(await inSession('second-session', 'add', box.lane, 'Planned in a second session')).code, 'NOT_YOUR_CHECKOUT',
    'a second session acting as coordinator in the same main checkout is refused');
  assert.equal((await inSession('second-session', 'takeover')).code, 0, 'takeover passes the main checkout to the second session');
  assert.equal((await inSession('second-session', 'add', box.lane, 'Planned in the second session after takeover')).code, 0, 'the new session coordinates');
  assert.equal(refusal(await inSession('first-session', 'add', box.lane, 'Planned again in the first session')).code, 'NOT_YOUR_CHECKOUT',
    'the earlier session is refused after the takeover');

  // A second machine's main checkout acting as coordinator is refused, by name.
  const second = await other.cli('add', box.lane, 'Planned on the second machine');
  assert.notEqual(second.code, 0, 'a second coordinator is refused');
  assert.equal(refusal(second).code, 'COORDINATOR_HELD');
  const firstName = `computer ${JSON.parse(readFileSync(box.linkFile, 'utf8')).machine.slice(-8)}`;
  const secondName = `computer ${other.machine.slice(-8)}`;
  assert.notEqual(firstName, secondName, 'the two linked computers have different names');
  assert.ok(refusal(second).message.includes(firstName), `the refusal names the holding computer: ${refusal(second).message}`);
  assert.doesNotMatch(refusal(second).message, new RegExp(hostname(), 'u'), 'the name carries no host name');
  assert.match(refusal(second).message, /pullboard takeover/u, 'the refusal names the takeover');

  // Takeover passes the coordinator to the second machine, and the first is then refused by name.
  const taken = await other.cli('takeover');
  assert.equal(taken.code, 0, `takeover passes the coordinator: ${JSON.stringify(taken.document)}`);
  assert.equal(taken.document.coordinator, secondName, 'takeover reports the new holder');
  assert.equal(taken.document.previous, firstName, 'takeover reports the holder it replaced');
  assert.equal((await other.cli('add', box.lane, 'Planned on the second machine after takeover')).code, 0, 'the new holder coordinates');
  const first = await box.cli('add', box.lane, 'Planned again on the first machine');
  assert.equal(refusal(first).code, 'COORDINATOR_HELD', 'the earlier holder is now the second coordinator');
  assert.ok(refusal(first).message.includes(secondName), `the refusal names the new holder: ${refusal(first).message}`);

  // Both replicas agree on the items each holder made, and on no others.
  for (const device of [box, other]) {
    const titles = (await device.cli('list')).document.items.map(item => item.item_title);
    assert.deepEqual(titles.filter(title => title.startsWith('Planned') || title.startsWith('Still')).sort(),
      ['Planned in the first session', 'Planned in the second session after takeover', 'Planned on the first machine',
        'Planned on the second machine after takeover', 'Still planned on the first machine']);
  }
});

test('an agent session on a computer that does not hold the coordinator takes it over [E19]', { timeout: relayWorkBudgetMs(12) }, async t => { // budget: hang ceiling for two linked devices' real CLI and relay round trips; not a speed target.
  const box = await relayClientFixture(t);
  await box.link();
  const pairing = await box.cli('relay', 'pair');
  const other = await box.otherDeviceJoin(pairing.document.code);
  /** Run the second computer's real CLI from a named agent session. */
  const inSession = (...args) => relayFixtureChild(other.root, { ...other.env, CLAUDECODE: '1', CLAUDE_CODE_SESSION_ID: 'second-computer-session' },
    [resolve(import.meta.dirname, '../bin/pullboard.js'), ...args, '--json']);
  assert.equal((await box.cli('add', box.lane, 'Planned on the holding computer')).code, 0, 'the first computer holds the coordinator');
  const held = await inSession('add', box.lane, 'Planned before the takeover');
  assert.equal(held.document?.error?.code, 'COORDINATOR_HELD', 'the second computer is refused by name');
  assert.match(held.document.error.message, /pullboard takeover/u, 'the refusal names the takeover');
  const taken = await inSession('takeover');
  assert.equal(taken.code, 0, `the takeover the refusal names succeeds from the agent session: ${JSON.stringify(taken.document)}`);
  assert.equal(taken.document.coordinator, `computer ${other.machine.slice(-8)}`, 'the second computer now holds the coordinator');
  assert.equal((await inSession('add', box.lane, 'Planned after the takeover')).code, 0, 'the new holder coordinates');
  assert.equal((await box.cli('add', box.lane, 'Planned again on the first computer')).document?.error?.code, 'COORDINATOR_HELD', 'the earlier holder is refused');
});

/** Simulate a long holder and a polling waiter with the real board clock and lease operation. */
test('a landing lease renewal or waiter poll writes no board event [Q1,Q2,Q3]', t => {
  const directory = mkdtempSync(join(tmpdir(), 'pullboard-lease-events-'));
  let milliseconds = Date.parse('2026-01-01T00:00:00Z');
  const board = store.openBoard(join(directory, 'board.sqlite'), { now: () => new Date(milliseconds) });
  t.after(() => { store.closeBoard(board); rmSync(directory, { recursive: true, force: true }); });
  store.register(board, { lane: 'coordinator', path: directory });
  const owner = { agentId: 'coordinator', token: randomUUID(), branch: 'refs/heads/main', pid: process.pid };
  const waiter = { ...owner, token: randomUUID() };
  const granted = store.landingLeaseMove(board, { ...owner, action: 'request' });
  assert.equal(granted.acquired, true);
  assert.equal(store.landingLeaseMove(board, { ...waiter, action: 'request' }).position, 1);
  for (let second = 1; second <= 35 * 60; second += 1) {
    milliseconds += 1000;
    if (second % 5 === 0) {
      const renewed = store.landingLeaseMove(board, { ...owner, action: 'renew', generation: granted.generation });
      assert.equal(renewed.acquired, true, 'the same generation remains held throughout the simulation');
    }
    const queued = store.landingLeaseMove(board, { ...waiter, action: 'request' });
    assert.equal(queued.acquired, false, 'polling never steals a live holder');
  }
  store.landingLeaseMove(board, { ...owner, action: 'release', generation: granted.generation });
  const events = board.db.prepare("SELECT event_detail FROM event WHERE event_kind='landing_lease' ORDER BY event_id").all();
  assert.equal(events.length, 3, 'only grant, initial queue and release are board events across 35 minutes');
  const state = store.landingLeaseState(board);
  assert.equal(state.holder, null);
  assert.equal(state.line.length, 1, 'suppressing polling events does not discard the waiting command');
});


test('an agent grant narrows at claim and expires identically on independent replicas [E21]', () => {
  const box = helpers.project();
  for (const title of ['Claimed work', 'Other work']) {
    run(box, box.repo, 'add', 'web', title, '--specs', 'G1', '--check', 'test -f web/grant-proof');
  }
  run(box, box.repo, 'add', 'api', 'Other lane', '--specs', 'G2', '--check', 'test -f api/grant-proof');
  const fresh = join(box.dir, 'fresh-seat');
  box.git(box.repo, 'worktree', 'add', '-q', '--detach', fresh, 'main');
  run(box, fresh, 'join', 'web');
  const freshActor = withBoard(box.repo, board => store.listAgents(board).find(agent => agent.agent_path === fresh).agent_id);
  run(box, box.web, 'claim', '1');
  const actor = withBoard(box.repo, board => store.listAgents(board).find(agent => agent.agent_path === box.web).agent_id);
  const held = withBoard(box.repo, board => store.getItem(board, 1));
  const snapshot = withBoard(box.repo, exportBoard);
  const peer = join(box.dir, 'grant-replica');
  box.git(box.dir, 'clone', '-q', box.repo, peer);
  withBoard(peer, board => importBoard(board, snapshot));
  const roots = [box.repo, peer];
  const during = new Date(Date.parse(held.item_lease_until) - 1000).toISOString();
  const expired = new Date(Date.parse(held.item_lease_until) + 1).toISOString();
  /** Replay one sealed public engine move on both real SQLite replicas at its ordered receipt time. */
  const replay = (operation, args, at = during) => {
    const move = withBoard(box.repo, board => prepareEngineMove(board, operation, args));
    const outcomes = roots.map(root => withBoard(root, board => applyEngineMove(board, move,
      { sequence: appliedSequence(board) + 1, at })));
    assert.deepEqual(outcomes[0], outcomes[1], 'the same move has the same public result on both replicas');
    return outcomes[0];
  };
  /** Facts remain communication; escalation supplies the state-change grant witness. */
  const fact = (item, text, at, by = actor) => replay('appendFact', [item, { agentId: by, kind: 'note', text }], at);
  /** Escalation changes item state and must stay inside the computed grant. */
  const change = (item, note, at, by = actor) => replay('escalate', [item, { agentId: by, note }], at);
  assert.equal(fact(1, 'Own claimed item remains writable').error, undefined, 'positive own-item communication reached the engine');
  const before = roots.map(root => withBoard(root, board => store.getItem(board, 2)));
  const outside = change(2, 'This must not change another item');
  assert.equal(outside.error?.code, 'AGENT_GRANT_ITEM', 'claim narrows item mutations even inside the same lane');
  assert.deepEqual(roots.map(root => withBoard(root, board => store.getItem(board, 2))), before,
    'a refused state change cannot modify either replica');
  assert.equal(change(1, 'The expired lease no longer authorizes a move', expired).error?.code,
    'AGENT_GRANT_EXPIRED', 'ordered receipt time, not the receiving machine clock, ends the grant');
  // Administrative communication and release cannot be trapped behind the grant being reported.
  assert.equal(replay('shout', [{ from: actor, to: 'coordinator', text: 'My claim expired; arranging the next work.', lanes: ['web', 'api'] }], expired).error,
    undefined, 'ordinary coordination remains available after expiry');
  assert.equal(replay('release', [1, actor, 'Done with this claim.'], expired).error, undefined);
  assert.equal(change(1, 'Release does not revive an expired grant', expired).error?.code, 'AGENT_GRANT_EXPIRED',
    'a fresh claim is required after expiry even after administrative release');
  assert.equal(change(3, 'An agent cannot mutate another lane', expired, freshActor).error?.code, 'AGENT_GRANT_LANE',
    'a fresh unclaimed seat still has only its registered lane');
});

test('an agent grant narrows at claim without changing old receipts or permitting an old-engine bypass [E21,H16]', async t => {
  const { AGENT_GRANT_ENGINE } = await import('../src/agent-grant-engine.js');
  const box = helpers.project();
  const clock = { now: () => new Date('2026-10-01T00:00:00.000Z') };
  const boards = ['legacy-authority.sqlite', 'legacy-peer.sqlite'].map(name => store.openBoard(join(box.dir, name), clock));
  t.after(() => boards.forEach(board => store.closeBoard(board)));
  const legacy = AGENT_GRANT_ENGINE - 1;
  const head = box.git(box.repo, 'rev-parse', 'HEAD');
  /** Apply the same actual public engine record on both private replicas. */
  const apply = (operation, args, engine = legacy) => {
    const move = prepareEngineMove(boards[0], operation, args);
    move.engine = engine;
    const sequence = appliedSequence(boards[0]) + 1;
    const outcomes = boards.map(board => applyEngineMove(board, move, { sequence, at: clock.now().toISOString() }));
    assert.deepEqual(outcomes[0], outcomes[1]);
    assert.equal(outcomes[0].error, undefined, JSON.stringify(outcomes[0]));
    return { move, sequence, outcome: outcomes[0] };
  };
  apply('register', [{ lane: 'coordinator', path: box.repo, model: 'fixture-model' }]);
  const actor = apply('register', [{ lane: 'web', path: box.web, model: 'fixture-model' }]).outcome.result;
  const other = apply('register', [{ lane: 'web', path: join(box.dir, 'legacy-other-seat'), model: 'fixture-model' }]).outcome.result;
  for (const title of ['First', 'Second']) apply('addItem', [{ by: 'coordinator', lane: 'web', title,
    criterion: 'A real file must exist', specIds: [], check: 'test -f grant-proof' }]);
  /** Freeze an actual private Git revision; replicas receive only the canonical frozen value. */
  const freeze = item => {
    const text = JSON.stringify({ title: item.item_title, criterion: item.item_criterion,
      check: item.item_check, rows: [], policy: { version: 1, commit: head, verify: { policy: 'any', family: 'off' } } });
    return { text, digest: createHash('sha256').update(text).digest('hex') };
  };
  const options = { agentId: actor, lane: 'web', leaseMs: 60_000, freeze };
  apply('claim', [1, options]);
  const prior = apply('appendFact', [2, { agentId: actor, kind: 'note', text: 'Legacy behavior stays recorded.' }]);
  const forged = prepareEngineMove(boards[0], 'escalate', [2, { agentId: actor, note: 'Old engine cannot bypass the new claim.' }]);
  forged.engine = legacy;
  const oldPeer = prepareEngineMove(boards[0], 'escalate', [1, { agentId: other, note: 'Another old seat must understand the new item grant.' }]);
  oldPeer.engine = legacy;
  const oldTextPeer = prepareEngineMove(boards[0], 'escalate', ['1', { agentId: other, note: 'Numeric text cannot hide the newly claimed target from an old engine.' }]);
  oldTextPeer.engine = legacy;
  apply('claim', [1, options], AGENT_GRANT_ENGINE);
  for (const board of boards) {
    const before = store.itemThread(board, 2);
    assert.deepEqual(applyEngineMove(board, prior.move, { sequence: prior.sequence, at: clock.now().toISOString() }),
      prior.outcome, 'an acknowledged legacy outcome is returned unchanged after activation');
    assert.throws(() => applyEngineMove(board, forged, { sequence: appliedSequence(board) + 1, at: clock.now().toISOString() }),
      error => error.code === 'RELAY_MOVE' && error.message.includes(String(AGENT_GRANT_ENGINE)),
      'a freshly sealed old-engine move cannot bypass new-claim authority');
    assert.throws(() => applyEngineMove(board, oldPeer, { sequence: appliedSequence(board) + 1, at: clock.now().toISOString() }),
      error => error.code === 'RELAY_MOVE' && error.message.includes(String(AGENT_GRANT_ENGINE)),
      'another legacy seat cannot interpret a newly claimed item under old grant semantics');
    assert.throws(() => applyEngineMove(board, oldTextPeer, { sequence: appliedSequence(board) + 1, at: clock.now().toISOString() }),
      error => error.code === 'RELAY_MOVE' && error.message.includes(String(AGENT_GRANT_ENGINE)),
      'the same target expressed as numeric text still requires the new grant engine');
    assert.deepEqual(store.itemThread(board, 2), before, 'neither old receipt replay nor a forged old move adds a fact');
  }
});


test('an agent grant narrows at claim without trapping its own handoff facts [E21,B3]', () => {
  const box = helpers.project();
  for (const title of ['Claimed work', 'Unrelated work']) {
    run(box, box.repo, 'add', 'web', title, '--specs', 'G1', '--check', 'test -f web/grant-proof');
  }
  run(box, box.web, 'claim', '1');
  const actor = withBoard(box.repo, board => store.listAgents(board).find(agent => agent.agent_path === box.web).agent_id);
  const held = withBoard(box.repo, board => store.getItem(board, 1));
  const snapshot = withBoard(box.repo, exportBoard);
  const peer = join(box.dir, 'handoff-grant-replica');
  box.git(box.dir, 'clone', '-q', box.repo, peer);
  withBoard(peer, board => importBoard(board, snapshot));
  const roots = [box.repo, peer];
  const during = new Date(Date.parse(held.item_lease_until) - 1000).toISOString();
  const expired = new Date(Date.parse(held.item_lease_until) + 1).toISOString();
  /** Apply one genuine engine record at the same ordered time on independent databases. */
  const replay = (operation, args, at = during) => {
    const move = withBoard(box.repo, board => prepareEngineMove(board, operation, args));
    const outcomes = roots.map(root => withBoard(root, board => applyEngineMove(board, move,
      { sequence: appliedSequence(board) + 1, at })));
    assert.deepEqual(outcomes[0], outcomes[1]);
    return outcomes[0];
  };
  assert.equal(replay('openHandoff', [{ agentId: actor }]).error, undefined, 'a claim does not trap channel creation');
  const channels = roots.map(root => withBoard(root, board => board.db.prepare(
    "SELECT item_id FROM event WHERE event_by=? AND event_kind='handoff-open' ORDER BY event_id DESC LIMIT 1").get(actor).item_id));
  assert.equal(channels[0], channels[1]);
  /** Handoff and ordinary item facts both remain available without state-change authority. */
  const fact = (item, text, at) => replay('appendFact', [item, { agentId: actor, kind: 'note', text }], at);
  assert.equal(fact(channels[0], 'Context for the incoming seat').error, undefined,
    'the live build claim cannot block facts on its own handoff channel');
  assert.equal(fact(2, 'Findings also belong on ordinary items').error, undefined);
  assert.equal(fact(channels[0], 'More context after the build lease ended', expired).error, undefined);
  assert.equal(fact(2, 'Expiry does not block findings', expired).error, undefined);
});


test('an agent grant narrows at claim for accepted numeric-text item ids [E21,H16]', () => {
  const box = helpers.project();
  for (const title of ['Claimed work', 'Other work']) {
    run(box, box.repo, 'add', 'web', title, '--specs', 'G1', '--check', 'test -f web/grant-proof', '--wait');
  }
  run(box, box.web, 'claim', '1');
  const actor = withBoard(box.repo, board => store.listAgents(board).find(agent => agent.agent_path === box.web).agent_id);
  const held = withBoard(box.repo, board => store.getItem(board, 1));
  // Detached baseline completion would write only the source after this replica is copied.
  // The public synchronous path finishes both setup observations before capturing the prefix.
  for (const id of [1, 2]) {
    const baseline = withBoard(box.repo, board => store.getItem(board, id).item_check_baseline);
    assert.ok(baseline, 'each setup item retains its baseline observation');
    assert.notEqual(baseline.result, 'pending', 'no setup baseline can append after replica export');
  }
  const snapshot = withBoard(box.repo, exportBoard);
  const peer = join(box.dir, 'text-id-grant-replica');
  box.git(box.dir, 'clone', '-q', box.repo, peer);
  withBoard(peer, board => importBoard(board, snapshot));
  const roots = [box.repo, peer];
  const during = new Date(Date.parse(held.item_lease_until) - 1000).toISOString();
  const expired = new Date(Date.parse(held.item_lease_until) + 1).toISOString();
  /** Keep the public engine argument bytes while both replicas resolve the same native row. */
  const change = (item, note, at = during) => {
    const move = withBoard(box.repo, board => prepareEngineMove(board, 'escalate', [item, { agentId: actor, note }]));
    const outcomes = roots.map(root => withBoard(root, board => applyEngineMove(board, move,
      { sequence: appliedSequence(board) + 1, at })));
    assert.deepEqual(outcomes[0], outcomes[1]);
    return outcomes[0];
  };
  const before = roots.map(root => withBoard(root, board => store.itemThread(board, 2)));
  for (const item of ['2', '02', '2.0', ' 2 ']) {
    assert.equal(change(item, 'An alternate spelling does not enlarge authority').error?.code, 'AGENT_GRANT_ITEM',
      `the existing target ${JSON.stringify(item)} is still outside the claim`);
  }
  assert.deepEqual(roots.map(root => withBoard(root, board => store.itemThread(board, 2))), before,
    'numeric-text refusals add no item facts on either replica');
  assert.equal(change('1', 'Text cannot extend an expired lease', expired).error?.code, 'AGENT_GRANT_EXPIRED');
  assert.equal(change('999999', 'A missing target stays missing', expired).error?.code, 'NO_ITEM');
  assert.equal(change('not-an-id', 'Malformed text keeps its existing refusal', expired).error?.code, 'NO_ITEM');
  assert.equal(change('1', 'Accepted numeric text still names the own item').error, undefined,
    'a state change must preserve the existing accepted item-id form');
});

/** Real Git and two private SQLite replicas; seeded acceptances are lifecycle fixtures, not executed gates. */
test('an agent grant narrows at claim without trapping its own verdict withdrawal [E21,V2,V6,H16]', t => {
  const box = helpers.project();
  let instant = Date.parse('2026-10-24T00:00:00Z');
  const clock = { now: () => new Date(instant) };
  const boards = ['withdraw-grant-primary.sqlite', 'withdraw-grant-peer.sqlite']
    .map(name => store.openBoard(join(box.dir, name), clock));
  t.after(() => boards.forEach(board => store.closeBoard(board)));
  const primary = boards[0];
  store.register(primary, { lane: 'coordinator', path: box.repo });
  const builder = store.register(primary, { lane: 'web', path: box.web, route: 'strong', parent: 'withdraw-builder', session: 'builder-child' });
  const reviewer = store.register(primary, { lane: 'tests', path: join(box.dir, 'withdraw-reviewer'), route: 'strong', parent: 'withdraw-reviewer', session: 'reviewer-child' });
  const stranger = store.register(primary, { lane: 'tests', path: join(box.dir, 'withdraw-stranger'), route: 'strong', parent: 'withdraw-stranger', session: 'stranger-child' });
  /** Supply the ordinary frozen criterion for this explicitly synthetic lifecycle setup. */
  const freeze = item => ({ text: item.item_title, digest: `withdraw:${item.item_id}` });
  const prior = store.addItem(primary, { by: 'coordinator', lane: 'tests', title: 'Earlier reviewer build' });
  const priorClaim = store.claim(primary, prior, { agentId: reviewer, lane: 'tests', leaseMs: 1000, freeze });
  const commit = box.git(box.repo, 'rev-parse', 'HEAD');
  const tree = box.git(box.repo, 'rev-parse', 'HEAD^{tree}');
  /** Create a current, immutable acceptance through the public board lifecycle. */
  function accepted(title) {
    const id = store.addItem(primary, { by: 'coordinator', lane: 'web', title });
    store.claim(primary, id, { agentId: builder, lane: 'web', leaseMs: 60_000, freeze });
    submitBoardStateFixture(primary, id, { agentId: builder, commit, tree });
    store.reserveReview(primary, id, { agentId: reviewer, leaseMs: 60_000, policy: 'any' });
    store.verify(primary, id, { agentId: reviewer, decision: 'ACCEPT', policy: 'any', head: commit,
      digest: store.getItem(primary, id).item_frozen_digest, note: 'Private lifecycle state only; no gate execution claimed.' });
    return id;
  }
  const own = accepted('Acceptance held by the different-lane reviewer');
  const control = accepted('Coordinator withdrawal positive control');
  instant += 1001;
  assert.ok(priorClaim.leaseUntil < clock.now().toISOString(), 'the earlier build lease really expired');
  assert.equal(store.getItem(primary, prior).item_status, 'open', 'the normal reader also treats that claim as expired');
  const original = store.verdictsFor(primary, own)[0];
  importBoard(boards[1], exportBoard(primary));
  /** One ordinary ordered move has the same outcome on both independent SQLite replicas. */
  function replay(operation, args) {
    const move = prepareEngineMove(primary, operation, args);
    const outcomes = boards.map(board => applyEngineMove(board, move,
      { sequence: appliedSequence(board) + 1, at: clock.now().toISOString() }));
    assert.deepEqual(outcomes[0], outcomes[1], 'the two replicas agree on the actual engine result');
    return outcomes[0];
  }
  const positive = replay('reopen', [control, { agentId: 'coordinator', withdrawVerdict: true,
    note: 'Positive control of the existing withdrawal lifecycle' }]);
  assert.equal(positive.error, undefined, 'the fixture supports a valid current verdict withdrawal');
  const conflict = replay('reopen', [own, { agentId: reviewer, conflict: { files: ['web/page.js'], trunk: commit },
    note: 'Conflict administration is not a reviewer exception' }]);
  assert.ok(conflict.error, 'a reviewer cannot substitute conflict reopening for its own verdict withdrawal');
  const withdrawn = replay('reopen', [String(own), { agentId: reviewer, withdrawVerdict: true,
    note: 'The reviewer corrects its own current acceptance after its old claim expired' }]);
  assert.equal(withdrawn.error, undefined, 'own verdict withdrawal remains review administration across lanes and expired build claims');
  for (const board of boards) {
    assert.equal(store.getItem(board, own).item_status, 'open');
    const verdict = store.verdictsFor(board, own).find(row => row.verdict_id === original.verdict_id);
    assert.equal(verdict.withdrawn, true);
    assert.equal(verdict.verdict_commit, original.verdict_commit, 'the acceptance continues to name its original commit');
    assert.equal(verdict.verdict_note, original.verdict_note, 'withdrawal never rewrites the original proof note');
  }
  const unrelated = replay('reopen', [control, { agentId: stranger, withdrawVerdict: true, note: 'Not this seat’s verdict' }]);
  assert.ok(unrelated.error, 'the exception gives a stranger no reopening authority');
});


/** Append-only findings are communication, not authority to change item state. */
test('an agent grant narrows at claim but any joined seat can append attributed findings on every replica [E21,H16]', () => {
  const box = helpers.project();
  for (const title of ['Claimed work', 'Other work']) {
    run(box, box.repo, 'add', 'web', title, '--specs', 'G1', '--check', 'test -f web/grant-proof');
  }
  run(box, box.repo, 'add', 'api', 'Different lane', '--specs', 'G2', '--check', 'test -f api/grant-proof');
  const fresh = join(box.dir, 'finding-seat');
  box.git(box.repo, 'worktree', 'add', '-q', '--detach', fresh, 'main');
  run(box, fresh, 'join', 'web');
  const freshActor = withBoard(box.repo, board => store.listAgents(board).find(agent => agent.agent_path === fresh).agent_id);
  run(box, box.web, 'claim', '1');
  const actor = withBoard(box.repo, board => store.listAgents(board).find(agent => agent.agent_path === box.web).agent_id);
  const held = withBoard(box.repo, board => store.getItem(board, 1));
  const snapshot = withBoard(box.repo, exportBoard);
  const peer = join(box.dir, 'findings-replica');
  box.git(box.dir, 'clone', '-q', box.repo, peer);
  withBoard(peer, board => importBoard(board, snapshot));
  const roots = [box.repo, peer];
  const during = new Date(Date.parse(held.item_lease_until) - 1000).toISOString();
  const expired = new Date(Date.parse(held.item_lease_until) + 1).toISOString();
  /** Apply a genuine fact record on both private boards and inspect its public attribution. */
  const finding = (item, by, at, text) => {
    const move = withBoard(box.repo, board => prepareEngineMove(board, 'appendFact',
      [item, { agentId: by, kind: 'note', text }]));
    const outcomes = roots.map(root => withBoard(root, board => applyEngineMove(board, move,
      { sequence: appliedSequence(board) + 1, at })));
    assert.deepEqual(outcomes[0], outcomes[1], 'independent replicas agree on the public result');
    assert.equal(outcomes[0].error, undefined, `${text}: ${JSON.stringify(outcomes[0])}`);
    const threads = roots.map(root => withBoard(root, board => store.itemThread(board, item)));
    assert.deepEqual(threads[0], threads[1], 'the attributed finding is the same on both replicas');
    assert.ok(threads[0].some(entry => entry.type === 'fact' && entry.text === text && entry.by === by), 'the attributed finding is actually recorded');
  };
  finding(1, actor, during, 'Positive own-item finding');
  finding(2, actor, during, 'A different claim cannot block a finding');
  finding(3, freshActor, during, 'An unclaimed seat may report a different lane');
  finding(2, actor, expired, 'An expired build claim cannot block a finding');
  finding(3, actor, expired, 'No review reservation is required for a finding');
});


/** The activation boundary is an ordered engine prefix, not a client opening the database. */
test('an agent grant narrows at claim after the recorded engine high-water mark [E21,H16]', async t => {
  const { AGENT_GRANT_ENGINE } = await import('../src/agent-grant-engine.js');
  const box = helpers.project();
  const directory = join(box.dir, 'actual-pre-grant-writer');
  mkdirSync(directory);
  unpackRelease('e4b7c30d674cde73803f8e8cb3f53fb2f9f62621', directory);
  const oldStore = await import(pathToFileURL(join(directory, 'src/board.js')).href);
  const oldEngine = await import(pathToFileURL(join(directory, 'src/engine.js')).href);
  const oldExchange = await import(pathToFileURL(join(directory, 'src/exchange.js')).href);
  const old = oldStore.openBoard(':memory:');
  const replicas = [store.openBoard(':memory:'), store.openBoard(':memory:')];
  t.after(() => { oldStore.closeBoard(old); replicas.forEach(board => store.closeBoard(board)); });
  let sequence = 0;
  const at = new Date().toISOString();
  /** The accepted old writer records actual legacy move bytes and outcomes before activation. */
  const recordOld = (operation, args) => {
    const move = oldEngine.prepareEngineMove(old, operation, args);
    const receipt = { sequence: ++sequence, at };
    const outcome = oldEngine.applyEngineMove(old, move, receipt);
    assert.equal(outcome.error, undefined, JSON.stringify(outcome));
    return { move, receipt, outcome };
  };
  recordOld('register', [{ lane: 'coordinator', path: box.repo }]);
  const actor = recordOld('register', [{ lane: 'web', path: box.web }]).outcome.result;
  recordOld('addItem', [{ by: 'coordinator', lane: 'web', title: 'Legacy unclaimed work', criterion: 'Keep old history.' }]);
  const acknowledged = recordOld('appendFact', [1, { agentId: actor, kind: 'note', text: 'Recorded before activation.' }]);
  const snapshot = oldExchange.exportBoard(old);
  assert.ok(snapshot.tables.event.filter(event => ['join', 'claim', 'renew'].includes(event.event_kind))
    .every(event => JSON.parse(event.event_detail).grantEngine === undefined), 'the old writer emits no future marker');
  const frozen = JSON.stringify({ title: 'Legacy unclaimed work', criterion: 'Keep old history.', check: '', rows: [] });
  const staleClaim = oldEngine.prepareEngineMove(old, 'claim', [1, { agentId: actor, lane: 'web', leaseMs: 60_000,
    freeze: () => ({ text: frozen, digest: createHash('sha256').update(frozen).digest('hex') }) }]);
  const staleAdd = oldEngine.prepareEngineMove(old, 'addItem', [{ by: actor, lane: 'web', title: 'Fresh old-engine item', criterion: 'Must not bypass activation.' }]);
  assert.ok(staleClaim.engine < AGENT_GRANT_ENGINE);
  for (const board of replicas) importBoard(board, snapshot);
  const activation = prepareEngineMove(replicas[0], 'shout', [{ from: 'coordinator', to: actor, text: 'The modern engine is now recorded.', lanes: ['web'] }]);
  assert.ok(activation.engine >= AGENT_GRANT_ENGINE);
  const activationReceipt = { sequence: sequence + 1, at };
  const activated = replicas.map(board => applyEngineMove(board, activation, activationReceipt));
  assert.deepEqual(activated[0], activated[1]);
  assert.equal(activated[0].error, undefined);
  for (const board of replicas) {
    assert.deepEqual(applyEngineMove(board, acknowledged.move, acknowledged.receipt), acknowledged.outcome,
      'the acknowledged pre-activation receipt replays byte-for-byte after activation');
    const before = appliedSequence(board);
    for (const move of [staleClaim, staleAdd]) {
      assert.throws(() => applyEngineMove(board, move, { sequence: before + 1, at }),
        error => error.code === 'RELAY_MOVE' && error.message.includes(String(AGENT_GRANT_ENGINE)),
        'a newly ordered old-engine move cannot use wholly unmarked legacy seats or targets');
      assert.equal(appliedSequence(board), before, 'a version refusal leaves the ordered position retryable');
    }
    assert.equal(store.getItem(board, 1).item_status, 'open');
  }
});
