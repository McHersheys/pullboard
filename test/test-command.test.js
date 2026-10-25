/** pullboard test runs named test files on the runner pool, and names a failure main already has [C7]. */
import assert from 'node:assert/strict';
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import {
  after,
  test,
} from 'node:test';
import { createE2eHelpers } from './e2e-helpers.js';
import {
  HOST,
  installSshStandIn,
} from './runner-ssh-fixture.js';

const e2e = createE2eHelpers();
after(e2e.cleanup);

const PASSES = "import { test } from 'node:test';\ntest('passes', () => {});\n";
const HANGS = "import { test } from 'node:test';\ntest('hangs', () => new Promise(() => {}));\n";
const FAILS = "import assert from 'node:assert/strict';\nimport { test } from 'node:test';\ntest('fails here', () => assert.equal(1, 2));\n";

test('pullboard test runs files on the runner pool with a per-file timeout [C7]', { timeout: 240_000 }, async () => { // budget: hang ceiling for the stand-in runner's three worker runs; not a speed target.
  const box = e2e.project('true');
  // One stand-in runner, preferred, and no local slot at all: a run that stayed on this machine could not start.
  const bin = join(box.dir, 'runner-bin');
  const worker = join(box.dir, 'runner-worker');
  const home = join(box.dir, 'runner-home');
  const requests = join(box.dir, 'runner-requests.jsonl');
  for (const folder of [bin, worker, home, join(home, '.pullboard')]) mkdirSync(folder, { recursive: true });
  box.env.PATH = `${bin}:${box.env.PATH}`;
  installSshStandIn({ bin, worker, home, machineHome: join(home, '.pullboard'), requests });
  assert.equal(box.run(box.repo, 'runner', 'add', HOST, '--slots', '2', '--browser', '1').code, 0);
  for (const [key, value] of [['gate.runnersFirst', 'on'], ['browserSlots', '0'], ['gateSlots', '0']]) {
    const set = box.run(box.repo, 'settings', key, value);
    assert.equal(set.code, 0, `${key} ${value}: ${set.err}`);
  }
  // Main holds the focused runner, with its per-test timeout, and a test that hangs on main as well.
  const config = JSON.parse(readFileSync(join(box.repo, 'pullboard.json'), 'utf8'));
  writeFileSync(join(box.repo, 'pullboard.json'), JSON.stringify({ ...config, affectedTests: 'node --test --test-timeout=3000' }, null, 2));
  mkdirSync(join(box.repo, 'test'));
  for (const [name, text] of [['ok', PASSES], ['hang', HANGS], ['changed', PASSES]]) writeFileSync(join(box.repo, 'test', `${name}.test.js`), text);
  box.git(box.repo, 'add', '-A');
  box.git(box.repo, 'commit', '-q', '-m', 'test: focused runner and three test files');
  box.git(box.web, 'merge', '-q', '--ff-only', 'main');
  // The agent's change is not committed: the runner still runs exactly what is in its worktree.
  writeFileSync(join(box.web, 'test', 'changed.test.js'), FAILS);

  const started = Date.now();
  const ran = box.run(box.web, 'test', 'test/ok.test.js', 'test/hang.test.js', 'test/changed.test.js', '--json');
  const seconds = (Date.now() - started) / 1000;
  assert.equal(ran.code, 1, `a red file makes the run red: ${ran.err}`);
  const result = JSON.parse(ran.out);
  assert.equal(result.runner, HOST, 'the files ran on the registered runner');
  assert.match(result.output, /^ok \d+ - .*passes/mu, 'the TAP of a passing file comes back as the runner printed it');
  assert.match(result.output, /fails here/u, 'the uncommitted change ran on the runner');
  assert.match(result.output, /timed? ?out|cancelled/iu, 'the hanging test stops at its timeout');
  assert.ok(seconds < 200, `the hung file never holds the run past its timeout (${seconds}s)`);
  const known = Object.fromEntries(result.known.map((entry) => [entry.file, entry.result]));
  assert.equal(known['test/hang.test.js'], 'red', 'the hang fails on main too, so it reads as a known main failure');
  assert.equal(known['test/changed.test.js'], 'green', 'the changed file passes on main, so its failure is new');
  assert.equal(known['test/ok.test.js'], undefined, 'a passing file needs no main comparison');
  const calls = readFileSync(requests, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  assert.ok(calls.length >= 2 && calls.every((call) => call.host === HOST), 'the run and its main comparisons all went to the runner');

  const text = box.run(box.web, 'test', 'test/hang.test.js');
  assert.equal(text.code, 1);
  assert.match(text.err, new RegExp(`red on ${HOST}`, 'u'), 'the text form names where it ran');
  assert.match(text.err, /known main failure: test\/hang\.test\.js fails on main/u, 'and names the failure main already has');
});
