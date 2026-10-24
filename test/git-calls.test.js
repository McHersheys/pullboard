/** Count real Git child processes and prove command-scoped facts refresh after a commit [C7]. */
import assert from 'node:assert/strict';
import {
  createHash,
  randomUUID,
} from 'node:crypto';
import * as store from '../src/board.js';
import { receiptBody } from '../src/gate-run-receipt.js';
import { runFixtureExecFile as execFileSync, runFixtureChild as spawnSync, runFixtureChild } from './fixture-child.js';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { delimiter, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import { main } from '../src/cli.js';
import { headCommit, withGitFacts } from '../src/git.js';
import { serveApi } from '../src/api.js';
import { pathToFileURL } from 'node:url';
import { fetchFresh } from './http-fixture.js';

const BIN = resolve(import.meta.dirname, '../bin/pullboard.js');
const RUN_MODULE = pathToFileURL(resolve(import.meta.dirname, '../src/run.js')).href;
const CONFIG_MODULE = pathToFileURL(resolve(import.meta.dirname, '../src/config.js')).href;
const GIT_MODULE = pathToFileURL(resolve(import.meta.dirname, '../src/git.js')).href;

/** Find the real Git executable before the fixture adds its counting shim to PATH. */
function realGitPath() {
  const path = process.env.PATH.split(delimiter).map((entry) => join(entry || '.', 'git'));
  const found = path.find((candidate) => existsSync(candidate));
  assert.ok(found, 'the test environment has Git on PATH');
  return found;
}

/** Build a private real repo and linked agent worktree with an instrumented Git executable. */
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'pullboard-git-calls-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const repo = join(dir, 'repo');
  const worker = join(dir, 'worker');
  const home = join(dir, 'home');
  const shims = join(dir, 'shims');
  const calls = join(dir, 'git-calls.log');
  mkdirSync(repo);
  mkdirSync(shims);
  const realGit = realGitPath();
  const gitShim = join(shims, 'git');
  const pullboardShim = join(shims, 'pullboard');
  writeFileSync(gitShim, '#!/bin/sh\nprintf "git\\n" >> "$PULLBOARD_GIT_CALLS"\nexec "$PULLBOARD_REAL_GIT" "$@"\n');
  chmodSync(gitShim, 0o755);
  writeFileSync(pullboardShim, `#!/bin/sh\nexec '${process.execPath}' '${BIN}' "$@"\n`);
  chmodSync(pullboardShim, 0o755);
  const env = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    PULLBOARD_HOME: join(home, '.pullboard'),
    PULLBOARD_MACHINE_HOME: join(home, '.pullboard-machine'),
    PULLBOARD_GIT_CALLS: calls,
    PULLBOARD_REAL_GIT: realGit,
    PATH: `${shims}${delimiter}${process.env.PATH}`,
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'Test Agent',
    GIT_AUTHOR_EMAIL: 'agent@example.com',
    GIT_COMMITTER_NAME: 'Test Agent',
    GIT_COMMITTER_EMAIL: 'agent@example.com',
  };
  writeFileSync(join(repo, 'pullboard.json'), JSON.stringify({
    spec: 'SPEC.md', practice: 'DOCTRINE.md', gate: 'true',
    lanes: { core: { owns: ['src/'], specs: ['C7'] } },
  }));
  writeFileSync(join(repo, 'SPEC.md'), '# Test spec\n\n## C · Core\n- C7 [approved, must] A command reads each Git fact once. | gate: test/git-calls.test.js\n');
  const git = (cwd, ...args) => {
    const result = runFixtureChild(realGit, args, { cwd, env, encoding: 'utf8', stdio: 'pipe' });
    if (result.status !== 0) throw new Error(result.failure);
    return result.stdout.trim();
  };
  const run = (cwd, ...args) => runFixtureChild(process.execPath, [BIN, ...args], { cwd, env, encoding: 'utf8' });
  const ok = (cwd, ...args) => {
    const result = run(cwd, ...args);
    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
    return result;
  };
  git(repo, 'init', '-q', '-b', 'main');
  ok(repo, 'init');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'chore(repo): initialize Git-call fixture');
  git(repo, 'worktree', 'add', '-q', '-b', 'core/worker', worker);
  ok(worker, 'join', 'core', '--route', 'light', '--family', 'codex');
  return { dir, repo, worker, calls, env, git, run, ok };
}

/** Clear the per-command count and read the number of Git processes the CLI started. */
function resetAndCount(box, cwd, ...args) {
  writeFileSync(box.calls, '');
  const result = box.run(cwd, ...args);
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
  const count = readFileSync(box.calls, 'utf8').trim().split('\n').filter(Boolean).length;
  return { result, count };
}

/** Run one isolated Node scenario with the real Git-counting shim and only repository-redirect selectors cleared. */
function readFactScenario(box, root, body) {
  const script = `import { codeIsFromMain, headCommit, withGitFacts, withGitReadFacts } from ${JSON.stringify(GIT_MODULE)};\n${body}`;
  const env = { ...box.env };
  // Keep the fixture's config and author settings; clear only selectors that redirect repository discovery.
  for (const name of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_CEILING_DIRECTORIES',
    'GIT_DISCOVERY_ACROSS_FILESYSTEM', 'GIT_IMPLICIT_WORK_TREE', 'GIT_OBJECT_DIRECTORY',
    'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_SHALLOW_FILE', 'GIT_GRAFT_FILE']) delete env[name];
  const result = runFixtureChild(process.execPath, ['--input-type=module', '-e', script, root], {
    cwd: box.dir, env, encoding: 'utf8',
  });
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
  return JSON.parse(result.stdout.trim());
}

test('help starts no Git and linked-worktree status spawns at most four Git processes [C7]', (t) => {
  const box = fixture(t);
  const version = resetAndCount(box, box.dir, '--version');
  assert.equal(version.count, 0, '--version has no repository work to do');
  const help = resetAndCount(box, box.dir, 'help');
  assert.equal(help.count, 0, 'global help has no repository work to do');
  const status = resetAndCount(box, box.worker, 'status', '--json');
  assert.ok(status.count <= 4, `linked-worktree status started ${status.count} Git processes`);
  assert.equal(JSON.parse(status.result.stdout).me.id, 'core-1');
});

/** Record schema-valid private fixture history, never represented as a real gate execution. */
function seedRuleBudgetRun(box, { green = true, days = 0, tree, command, failures = [] } = {}) {
  const head = box.git(box.repo, 'rev-parse', 'HEAD');
  const gate = JSON.parse(readFileSync(join(box.repo, 'pullboard.json'), 'utf8')).gate;
  const receipt = { version: 1, id: randomUUID(), kind: 'gate', head, main: head,
    tree: tree ?? box.git(box.repo, 'rev-parse', 'HEAD^{tree}'),
    command: createHash('sha256').update(command ?? gate).digest('hex'), green, failures,
    at: new Date(Date.now() - days * 86_400_000).toISOString(), load: { average: [0, 0, 0], cpus: 1, freeMB: 100 } };
  const folder = join(box.repo, '.git', 'pullboard', 'gate-receipts');
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, `${receipt.id}.json`), receiptBody(receipt));
  const board = store.openBoard(join(box.repo, '.git', 'pullboard', 'board.sqlite'), undefined, { isMain: true });
  try { store.recordGateRun(board, { agentId: 'coordinator', receipt, lane: 'core' }); }
  finally { store.closeBoard(board); }
}

test('populated rule receipt history preserves the linked status Git budget and current proof [C7,S1,A1]', (t) => {
  const box = fixture(t);
  const config = JSON.parse(readFileSync(join(box.repo, 'pullboard.json'), 'utf8'));
  config.gate = 'node --test test/proven.test.js';
  writeFileSync(join(box.repo, 'pullboard.json'), JSON.stringify(config));
  writeFileSync(join(box.repo, 'SPEC.md'), '# Rule budget fixture\n\n## C · Core\n' +
    '- C7 [approved, must] Current trunk proof stays cheap to read. | gate: test/proven.test.js\n' +
    '- C8 [approved, must] Recent red remains visible. | gate: test/red.test.js\n');
  mkdirSync(join(box.repo, 'test'));
  for (const name of ['proven', 'red']) writeFileSync(join(box.repo, 'test', `${name}.test.js`),
    `import { test } from 'node:test';\ntest('${name}', () => {});\n`);
  box.git(box.repo, 'add', '-A');
  box.git(box.repo, 'commit', '-q', '-m', 'test(fixture): add committed rule gates');
  box.git(box.worker, 'merge', '-q', '--ff-only', 'main');
  seedRuleBudgetRun(box, { green: false, days: 8, failures: [{ file: 'test/proven.test.js', name: 'expired red' }] });
  seedRuleBudgetRun(box, { green: false, days: 2, failures: [{ file: 'test/red.test.js', name: 'recent red' }] });
  seedRuleBudgetRun(box, { tree: 'f'.repeat(40) });
  seedRuleBudgetRun(box, { command: 'true' });
  seedRuleBudgetRun(box);
  const current = resetAndCount(box, box.worker, 'status', '--json');
  assert.ok(current.count <= 4, `populated linked-worktree status started ${current.count} Git processes`);
  assert.deepEqual(JSON.parse(current.result.stdout).ruleCounts,
    { approved: 2, gated: 2, ungated: 0, proven: 1, unproven: 1, contradicted: 1 });
  box.git(box.repo, 'pack-refs', '--all', '--prune');
  const packed = resetAndCount(box, box.worker, 'status', '--json');
  assert.ok(packed.count <= 4, `packed-ref status started ${packed.count} Git processes`);
  assert.deepEqual(JSON.parse(packed.result.stdout).ruleCounts, JSON.parse(current.result.stdout).ruleCounts);
  advanceHead(box, 'advance trunk after recorded proof');
  seedRuleBudgetRun(box, { tree: 'e'.repeat(40) });
  seedRuleBudgetRun(box, { command: 'true' });
  const advanced = resetAndCount(box, box.worker, 'status', '--json');
  assert.ok(advanced.count <= 4, `advanced-trunk status started ${advanced.count} Git processes`);
  assert.deepEqual(JSON.parse(advanced.result.stdout).ruleCounts,
    { approved: 2, gated: 2, ungated: 0, proven: 0, unproven: 2, contradicted: 1 },
    'old green, wrong tree and wrong command prove nothing on the new tip; recent red is independent');
});

test('a runner sees the new HEAD after it commits its item [C7]', (t) => {
  const box = fixture(t);
  box.ok(box.repo, 'add', 'core', 'Refresh cached HEAD', '--specs', 'C7', '--route', 'light',
    '--criterion', 'the runner reads the commit it just made', '--check', 'test -f src/result.txt',
    '--brief', 'Files: src/result.txt\nTest: the runner creates the result file.');
  const agent = join(box.dir, 'agent.sh');
  writeFileSync(agent, '#!/bin/sh\nmkdir -p src\nprintf result > src/result.txt\n');
  chmodSync(agent, 0o700);
  const run = box.ok(box.worker, 'run', '--agent-light', `sh ${agent}`, '--items', '1', '--attempts', '1', '--minutes', '1');
  assert.match(run.stdout, /submitted #1/u);
  const current = box.git(box.worker, 'rev-parse', 'HEAD');
  const shown = JSON.parse(box.ok(box.repo, 'show', '1', '--json').stdout);
  assert.equal(shown.item_commit, current, 'submit records the HEAD created by this command');
});

/** Create a promise gate for a deterministic overlap between command fact scopes. */
function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

/** Advance the fixture branch using real Git plumbing without running its checkout hooks. */
function advanceHead(box, label, branch = 'main') {
  const parent = box.git(box.repo, 'rev-parse', 'HEAD');
  const tree = box.git(box.repo, 'rev-parse', 'HEAD^{tree}');
  const commit = execFileSync(box.env.PULLBOARD_REAL_GIT, ['commit-tree', tree, '-p', parent], {
    cwd: box.repo, env: box.env, input: label, encoding: 'utf8',
  }).trim();
  box.git(box.repo, 'update-ref', `refs/heads/${branch}`, commit);
  return commit;
}

/** Read a code reference through the running local API using a SHA-shaped current branch name. */
async function readServedBranchCode(api, branch) {
  const address = new URL(api.url);
  const headers = { 'x-pullboard-key': address.searchParams.get('k') };
  const listing = await fetchFresh(address, { headers });
  assert.equal(listing.status, 200);
  const board = (await listing.json()).boards[0];
  assert.ok(board?.id, 'the fixture board is listed');
  const path = `${address.pathname}/${encodeURIComponent(board.id)}/code?ref=${encodeURIComponent(`SPEC.md:1@${branch}`)}`;
  const response = await fetchFresh(address.origin + path, { headers });
  const document = await response.json();
  assert.equal(response.status, 200, JSON.stringify(document));
  return document.code.commit;
}

test('a live serve request sees a commit made while the server stays open [C7]', async (t) => {
  const box = fixture(t);
  const branch = 'a1b2c3d4e5f6';
  box.git(box.repo, 'branch', '-m', branch);
  const original = box.git(box.repo, 'rev-parse', 'HEAD');
  await withGitFacts(async () => {
    assert.equal(headCommit(box.repo), original, 'the long-lived command has an initial cached HEAD');
    const api = await serveApi({ secret: 'git-facts-test-key', runCommand: main, projects: () => [{ root: box.repo, name: 'Git facts fixture' }] });
    try {
      assert.equal(await readServedBranchCode(api, branch), original);
      const advanced = advanceHead(box, 'advance the served branch', branch);
      assert.notEqual(advanced, original);
      assert.equal(await readServedBranchCode(api, branch), advanced, 'the next HTTP request resolves the branch after its commit');
    } finally {
      await api.close();
    }
  });
});

test('the runner invalidates cached HEAD immediately after its own commit [C7]', (t) => {
  const box = fixture(t);
  const before = box.git(box.worker, 'rev-parse', 'HEAD');
  mkdirSync(join(box.worker, 'src'));
  writeFileSync(join(box.worker, 'src', 'runner-result.txt'), 'built\n');
  const item = { item_id: 1, item_title: 'runner commit refreshes HEAD', item_lane: 'core', item_spec_ids: 'C7' };
  const script = `import { commitWork } from ${JSON.stringify(RUN_MODULE)};
import { loadConfig } from ${JSON.stringify(CONFIG_MODULE)};
import { withGitFacts } from ${JSON.stringify(GIT_MODULE)};
const root = process.cwd();
const item = JSON.parse(process.env.PULLBOARD_TEST_ITEM);
const result = await withGitFacts(() => commitWork(root, item, loadConfig(root), ['src/runner-result.txt']));
console.log(JSON.stringify(result));`;
  const env = { ...box.env, PULLBOARD_TEST_ITEM: JSON.stringify(item) };
  const result = runFixtureChild(process.execPath, ['--input-type=module', '-e', script], { cwd: box.worker, env, encoding: 'utf8' });
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
  const committed = JSON.parse(result.stdout.trim());
  assert.equal(committed.ok, true, committed.output);
  assert.notEqual(committed.commit, before, 'the runner reports the HEAD created by its commit');
  assert.equal(committed.commit, box.git(box.worker, 'rev-parse', 'HEAD'));
});

test('settled and concurrent commands do not share Git-fact caches [C7]', async (t) => {
  const box = fixture(t);
  const settledRead = deferred();
  const releaseSettled = deferred();
  const settledAgain = deferred();
  let delayed;
  await withGitFacts(async () => {
    const initial = headCommit(box.repo);
    delayed = (async () => {
      await releaseSettled.promise;
      const first = headCommit(box.repo);
      settledRead.resolve(first);
      await settledAgain.promise;
      return headCommit(box.repo);
    })();
    assert.equal(headCommit(box.repo), initial, 'facts are reused while this command remains active');
  });
  const firstCommit = advanceHead(box, 'expire command cache one');
  releaseSettled.resolve();
  assert.equal(await settledRead.promise, firstCommit, 'a callback inherited from a settled command reads fresh Git state');
  const secondCommit = advanceHead(box, 'expire command cache two');
  settledAgain.resolve();
  assert.equal(await delayed, secondCommit, 'the expired callback does not retain its first late read');

  const aRead = deferred();
  const releaseA = deferred();
  const bRead = deferred();
  const releaseB = deferred();
  const a = withGitFacts(async () => {
    const first = headCommit(box.repo);
    aRead.resolve();
    await releaseA.promise;
    return [first, headCommit(box.repo)];
  });
  await aRead.promise;
  const thirdCommit = advanceHead(box, 'concurrent command cache one');
  const b = withGitFacts(async () => {
    const first = headCommit(box.repo);
    bRead.resolve();
    await releaseB.promise;
    return [first, headCommit(box.repo)];
  });
  await bRead.promise;
  const fourthCommit = advanceHead(box, 'concurrent command cache two');
  releaseA.resolve();
  releaseB.resolve();
  assert.deepEqual(await a, [secondCommit, secondCommit], 'one active command keeps its own fact values');
  assert.deepEqual(await b, [thirdCommit, thirdCommit], 'a concurrent command has a separate fact scope');
  assert.equal(headCommit(box.repo), fourthCommit, 'outside a command scope Git facts are read directly');
});

test('API read facts persist across request scopes and refresh after ref changes [A2,N26,C7]', (t) => {
  const box = fixture(t);
  const result = readFactScenario(box, box.repo, `
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
const root = process.argv[1];
const calls = process.env.PULLBOARD_GIT_CALLS;
const readRequest = () => withGitFacts(() => withGitReadFacts(() => headCommit(root)));
const initial = await readRequest();
writeFileSync(calls, '');
const repeated = await readRequest();
const repeatedCalls = readFileSync(calls, 'utf8').trim().split('\\n').filter(Boolean).length;
const mutation = await withGitReadFacts(async () => {
  const before = headCommit(root);
  const realGit = process.env.PULLBOARD_REAL_GIT;
  const git = (args, input) => execFileSync(realGit, args, { cwd: root, input, encoding: 'utf8' }).trim();
  const parent = git(['rev-parse', 'HEAD']);
  const tree = git(['rev-parse', 'HEAD^{tree}']);
  const next = git(['-c', 'user.name=Test Agent', '-c', 'user.email=agent@example.com', 'commit-tree', tree, '-p', parent], 'external ref change');
  git(['update-ref', 'refs/heads/main', next]);
  const command = await withGitFacts(() => headCommit(root));
  const after = headCommit(root);
  return { before, next, command, after };
});
console.log(JSON.stringify({ initial, repeated, repeatedCalls, mutation }));
`);
  assert.ok(result.initial, 'the fixture starts with a committed HEAD');
  assert.equal(result.repeated, result.initial, 'a fresh API request reads the same HEAD');
  assert.equal(result.repeatedCalls, 0, 'a warm read-fact cache starts no Git process on the next request');
  assert.notEqual(result.mutation.next, result.mutation.before, 'the fixture advances its branch outside Pullboard');
  assert.equal(result.mutation.command, result.mutation.next, 'a nested command scope bypasses the API read cache');
  assert.equal(result.mutation.after, result.mutation.next, 'the next API read sees and refreshes the changed ref');
});

test('an installed-source provenance miss is reused outside Git [A2,N26,C7]', (t) => {
  const box = fixture(t);
  const result = readFactScenario(box, box.dir, `
import { readFileSync, writeFileSync } from 'node:fs';
const root = process.argv[1];
const calls = process.env.PULLBOARD_GIT_CALLS;
const first = withGitReadFacts(() => codeIsFromMain(root));
writeFileSync(calls, '');
const repeated = withGitReadFacts(() => codeIsFromMain(root));
const repeatedCalls = readFileSync(calls, 'utf8').trim().split('\\n').filter(Boolean).length;
console.log(JSON.stringify({ first, repeated, repeatedCalls }));
`);
  assert.equal(result.first, true, 'source without Git metadata has installed-source provenance');
  assert.equal(result.repeated, true, 'the same negative repository discovery remains consistent');
  assert.equal(result.repeatedCalls, 0, 'a repeated installed-source read does not retry Git discovery');
});

test('API HEAD facts remain null outside Git [A2,N26,C7]', (t) => {
  const box = fixture(t);
  const result = readFactScenario(box, box.dir, `
import { headTree } from ${JSON.stringify(GIT_MODULE)};
const root = process.argv[1];
let facts;
try {
  facts = withGitReadFacts(() => ({ head: headCommit(root), tree: headTree(root) }));
  facts.refusal = null;
} catch (error) {
  facts = { head: undefined, tree: undefined, refusal: { name: error.name, code: error.code ?? null } };
}
console.log(JSON.stringify(facts));
`);
  assert.equal(result.refusal, null, 'an API read outside a Git repository returns normally');
  assert.deepEqual({ head: result.head, tree: result.tree }, { head: null, tree: null },
    'missing HEAD facts stay null rather than turning into a NOT_A_REPO refusal');
});
