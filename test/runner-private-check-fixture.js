/** Real reviewer checks preserve trusted policy, exact source and complete runner evidence [C7,V4]. */
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as store from '../src/board.js';
import { submitFixture } from './board-submit-fixture.js';
import { HOST, installSshStandIn, shellQuote } from './runner-ssh-fixture.js';
import { awaitRoundTrip, phaseCounts, startToolingCli } from './runner-tooling-fixture.js';
import { once } from 'node:events';

/** Require public setup to succeed before interpreting any review behavior. */
function document(result) {
  assert.equal(result.code, 0, result.out + result.err);
  return JSON.parse(result.out);
}

/** Submit an immutable legacy fixture through the existing historical receipt helper. */
function historicalSubmission(box, id, commit) {
  box.git(box.web, 'update-ref', `refs/pullboard/items/${id}/${commit.slice(0, 12)}`, commit);
  const board = store.openBoard(join(box.repo, '.git/pullboard/board.sqlite'));
  try { submitFixture(board, id, { agentId: 'web-1', commit, tree: box.git(box.web, 'rev-parse', `${commit}^{tree}`) }); }
  finally { store.closeBoard(board); }
}

/** Run public native reviews through two registered SSH stand-ins, never the live machine's runner pool. */
export async function privateReviewRunnerCase(t, e2e) {
  const box = e2e.project('true');
  const config = JSON.parse(readFileSync(join(box.repo, 'pullboard.json'), 'utf8'));
  const install = 'node -e ' + shellQuote("const fs=require('node:fs');fs.mkdirSync('web/.deps',{recursive:true});fs.writeFileSync('web/.deps/installed','trusted install');console.log('TRUSTED_PRIVATE_INSTALL');");
  config.check = { install, timeout: '2m' };
  config.lanes.web.owns.push('pullboard.json');
  writeFileSync(join(box.repo, 'pullboard.json'), JSON.stringify(config, null, 2));
  box.git(box.repo, 'add', 'pullboard.json');
  box.git(box.repo, 'commit', '-q', '-m', 'test: trusted private review policy [G1]');
  box.git(box.web, 'merge', '-q', '--ff-only', 'main');
  mkdirSync(join(box.web, 'web'));
  writeFileSync(join(box.web, 'web/.gitignore'), '.deps/\n');
  writeFileSync(join(box.web, 'web/check.cjs'), `const assert = require('node:assert/strict');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
assert.equal(fs.readFileSync('web/.deps/installed', 'utf8'), 'trusted install');
const pool = process.env.PULLBOARD_GATE_SLOT_POOL;
const db = new DatabaseSync(pool, { readOnly: true });
const holder = db.prepare('SELECT pid FROM holder WHERE token = ?').get(process.env.PULLBOARD_GATE_SLOT_TOKEN);
db.close();
assert.ok(holder && holder.pid > 0, 'the check inherits a genuine worker lease');
if (process.argv[2] === 'large') {
  const chunk = 'raw phase bytes ' + 'x'.repeat(4000) + '\\n';
  for (let count = 0; count < 17000; count++) process.stdout.write(chunk);
}
console.log('PRIVATE_CHECK_OBSERVATION ' + JSON.stringify({ head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), cwd: process.cwd(), pool, installed: true }));
`);
  // Candidate policy must not replace the install or shared deadline frozen by the owner.
  const candidateConfig = { ...config, check: { install: 'exit 83', timeout: '1ms' } };
  writeFileSync(join(box.web, 'pullboard.json'), JSON.stringify(candidateConfig, null, 2));
  const commit = e2e.attackCommit(box, box.web);
  const reviewer = join(box.dir, 'reviewer');
  box.git(box.repo, 'worktree', 'add', '-q', '--detach', reviewer, commit);
  document(box.run(reviewer, 'join', 'api', '--json'));
  const bin = join(box.dir, 'ssh-bin');
  const worker = join(box.dir, 'worker');
  const remoteHome = join(box.dir, 'worker-home');
  const remoteMachineHome = join(remoteHome, '.pullboard');
  const requests = join(box.dir, 'ssh-requests.jsonl');
  for (const folder of [bin, worker, remoteHome, remoteMachineHome, box.env.PULLBOARD_MACHINE_HOME]) mkdirSync(folder, { recursive: true });
  installSshStandIn({ bin, worker, home: remoteHome, machineHome: remoteMachineHome, requests });
  box.env.PATH = bin + ':' + box.env.PATH;
  for (const key of ['PULLBOARD_GATE_SLOT_HELD', 'PULLBOARD_GATE_SLOT_POOL', 'PULLBOARD_GATE_SLOT_TOKEN', 'PULLBOARD_BROWSER_SLOT_HELD']) delete box.env[key];
  for (const host of [HOST, HOST + '-setup']) document(box.run(box.repo, 'runner', 'add', host, '--slots', '1', '--browser', '1', '--json'));
  document(box.run(box.repo, 'settings', 'gate.runnersFirst', 'on', '--json'));
  const expectedHosts = [HOST, HOST + '-setup'];
  for (const [index, suffix] of ['', ' large'].entries()) {
    const id = index + 1;
    document(box.run(box.repo, 'add', 'web', 'Trusted remote check ' + id, '--criterion', 'the trusted installed check completes at the immutable commit', '--check', 'node web/check.cjs' + suffix, '--specs', 'G1', '--json'));
    document(box.run(box.web, 'claim', String(id), '--json'));
    historicalSubmission(box, id, commit);
    const before = phaseCounts(requests + '.phases');
    const child = startToolingCli(reviewer, box.env, ['verify', String(id), 'accept', '--note', 'trusted remote review fixture', '--json']);
    let stdout = '', stderr = '';
    child.stdout.setEncoding('utf8').on('data', part => { stdout += part; });
    child.stderr.setEncoding('utf8').on('data', part => { stderr += part; });
    const closed = once(child, 'close').then(([status, signal]) => ({ status, signal, stdout, stderr }));
    const result = await awaitRoundTrip(child, closed, requests + '.phases', before, { 'remote run': 120_000 });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const dispatched = existsSync(requests) ? readFileSync(requests, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];
    assert.equal(dispatched.length, id, 'a review check runs on a runner at the exact commit instead of silently running locally');
    assert.equal(dispatched.at(-1).host, expectedHosts[index], 'successive reviews rotate across the registered runners');
    const shown = document(box.run(box.repo, 'show', String(id), '--json'));
    assert.equal(shown.item_status, 'verified');
    assert.ok(shown.verdicts.at(-1).verdict_note.includes(expectedHosts[index]), 'the durable verdict records which runner executed the check');
    const outputs = join(box.repo, '.git/pullboard/check-output');
    const files = readdirSync(outputs).filter(name => name.startsWith(`check-${id}-${commit.slice(0, 12)}-`) && name.endsWith('.log'));
    assert.equal(files.length, 1, 'the complete install and check output is retained once');
    const output = readFileSync(join(outputs, files[0]), 'utf8');
    assert.match(output, /TRUSTED_PRIVATE_INSTALL/u, 'the owner-trusted install ran, not the candidate policy or npm ci');
    const observation = JSON.parse(output.split('\n').find(line => line.startsWith('PRIVATE_CHECK_OBSERVATION ')).slice('PRIVATE_CHECK_OBSERVATION '.length));
    assert.equal(observation.head, commit);
    assert.notEqual(observation.cwd, reviewer);
    assert.match(observation.cwd, /[/\\]jobs[/\\][^/\\]+[/\\]checkout$/u, 'the worker uses a fresh private checkout');
    assert.equal(observation.pool, join(remoteMachineHome, 'resources.sqlite'), 'the private check carries the remote worker lease, never the controller token');
    if (index === 1) assert.ok(statSync(join(outputs, files[0])).size > 64 * 1024 ** 2, 'full raw phase artifacts survive beyond the generic transport capture limit');
  }
}
