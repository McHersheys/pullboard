/** A decision records where it came from, and pullboard why <file> names the decisions behind a file [N29,B29,P6]. */
import assert from 'node:assert/strict';
import { runFixtureChild, runFixtureGit } from './fixture-child.js';
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, test } from 'node:test';
import { minimumMoveEngine } from '../src/move-registry.js';
import { DECISION_ORIGIN_ENGINE } from '../src/decision-origin-engine.js';
import { originOf } from '../src/decision-origin.js';

const BIN = resolve(import.meta.dirname, '../bin/pullboard.js');
const sandboxes = [];
const SPEC = '# Why fixture\n\n## G · Goals\n- G1 [approved, must] The feature works. | gate: test\n';

after(() => {
  for (const dir of sandboxes) rmSync(dir, { recursive: true, force: true });
});

/** Make an isolated real-Git repo with a board, a coordinator, one web builder and two web items. */
function fixture() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'pullboard-why-')));
  sandboxes.push(dir);
  const shims = join(dir, 'bin');
  mkdirSync(shims);
  writeFileSync(join(shims, 'pullboard'), `#!/bin/sh\nexec "${process.execPath}" "${BIN}" "$@"\n`, { mode: 0o755 });
  chmodSync(join(shims, 'pullboard'), 0o755);
  const env = {
    ...process.env,
    PATH: `${shims}:${process.env.PATH}`,
    GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'Test Agent', GIT_AUTHOR_EMAIL: 'agent@example.com',
    GIT_COMMITTER_NAME: 'Test Agent', GIT_COMMITTER_EMAIL: 'agent@example.com',
    PULLBOARD_HOME: join(dir, 'home'), PULLBOARD_MACHINE_HOME: join(dir, 'machine-home'),
  };
  for (const name of Object.keys(env)) if (name.startsWith('GIT_') && !name.startsWith('GIT_CONFIG') && !name.startsWith('GIT_AUTHOR') && !name.startsWith('GIT_COMMITTER')) delete env[name];
  delete env.PULLBOARD_RELAY_TOKEN;
  const repo = join(dir, 'repo');
  mkdirSync(repo);
  /** Run Git in this private fixture with its isolated identity. */
  const git = (cwd, ...args) => runFixtureGit(args, { cwd, env });
  /** Run the actual CLI in a fixture checkout and keep both output streams. */
  const run = (cwd, ...args) => {
    const result = runFixtureChild(process.execPath, [BIN, ...args], { cwd, env, encoding: 'utf8' });
    return { code: result.status, out: result.stdout ?? '', err: result.failure ?? result.stderr ?? '' };
  };
  /** Run a command that must succeed with --json and return its one document. */
  const json = (cwd, ...args) => {
    const result = run(cwd, ...args, '--json');
    assert.equal(result.code, 0, `${args.join(' ')}: ${result.err}${result.out}`);
    return JSON.parse(result.out);
  };
  git(repo, 'init', '-q', '-b', 'main');
  assert.equal(run(repo, 'init').code, 0);
  writeFileSync(join(repo, 'pullboard.json'), JSON.stringify({
    gate: 'true', spec: 'SPEC.md', verify: 'any', lease: '2h',
    lanes: { web: { owns: ['web/'], specs: ['G1'] } },
  }, null, 2));
  writeFileSync(join(repo, 'SPEC.md'), SPEC);
  mkdirSync(join(repo, 'web'));
  writeFileSync(join(repo, 'web', 'shared.txt'), 'one\ntwo\nthree\n');
  writeFileSync(join(repo, 'web', 'other.txt'), 'other\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'chore: create why fixture');
  for (const title of ['First item', 'Second item']) {
    json(repo, 'add', 'web', title, '--specs', 'G1', '--criterion', `${title} works`, '--check', 'true');
  }
  return { git, repo, run, json };
}

test('a decision records its origin and pullboard why names the decisions behind a file [N29,B29,P6]', () => {
  const box = fixture();
  const web = box.json(box.repo, 'worktree', 'web', '--route', 'strong', '--model', 'fixture-model').path;

  writeFileSync(join(box.repo, 'web', 'shared.txt'), 'one\nTWO\nthree\n');
  box.git(box.repo, 'commit', '-q', '-am', 'feat(web): change line two [G1]\n\nPullboard-Item: #1');
  writeFileSync(join(box.repo, 'web', 'other.txt'), 'other, changed\n');
  box.git(box.repo, 'commit', '-q', '-am', 'feat(web): change the other file [G1]\n\nPullboard-Item: #2');

  const ask = box.json(web, 'shout', 'coordinator', 'Keep line two upper case?', '--decision').id;
  const answer = box.json(box.repo, 'answer', String(ask), 'Keep it upper case', '--implies', '1',
    '--origin', 'person-relayed', '--rationale', 'the person wants it to read as a heading').id;
  const askOther = box.json(web, 'shout', 'coordinator', 'Change the other file?', '--decision').id;
  const answerOther = box.json(box.repo, 'answer', String(askOther), 'Change it', '--implies', '2').id;

  const third = box.json(web, 'shout', 'coordinator', 'One more?', '--decision').id;
  const forged = box.run(box.repo, 'answer', String(third), 'x', '--origin', 'person');
  assert.notEqual(forged.code, 0, 'an agent cannot name the person as the origin');
  assert.match(forged.err, /BAD_ORIGIN/u);

  const file = box.json(box.repo, 'why', 'web/shared.txt');
  assert.equal(file.file, 'web/shared.txt');
  assert.deepEqual(file.items.map((item) => item.id), [1], 'only the item whose landed commit touched the file');
  assert.deepEqual(file.rows.map((row) => row.id), ['G1']);
  assert.equal(file.decisions.length, 1, 'only the decision implying that item');
  assert.deepEqual({ id: file.decisions[0].id, statement: file.decisions[0].statement, rationale: file.decisions[0].rationale,
    decidedBy: file.decisions[0].decidedBy, relayedBy: file.decisions[0].relayedBy, origin: file.decisions[0].origin },
  { id: answer, statement: 'Keep it upper case', rationale: 'the person wants it to read as a heading',
    decidedBy: 'coordinator', relayedBy: 'coordinator', origin: 'person-relayed' });

  const text = box.run(box.repo, 'why', 'web/shared.txt');
  assert.equal(text.code, 0, text.err);
  assert.match(text.out, /person-relayed/u);
  assert.match(text.out, /Keep it upper case/u);

  assert.deepEqual(box.json(box.repo, 'why', 'web/shared.txt:2').items.map((item) => item.id), [1], 'the changed line');
  assert.deepEqual(box.json(box.repo, 'why', 'web/shared.txt:1').items, [], 'a line no landed commit touched');
  const other = box.json(box.repo, 'why', 'web/other.txt');
  assert.deepEqual(other.decisions.map((entry) => [entry.id, entry.origin]), [[answerOther, 'agent']], 'an answer that names no origin is an agent decision');

  assert.equal(originOf({}), 'unknown', 'a decision with no recorded origin is unknown');
  assert.equal(originOf({ provenance: { origin: 'inherited' } }), 'inherited');
  assert.equal(box.json(box.repo, 'why', 'web/missing.txt').items.length, 0, 'a file no commit touched has nothing behind it');
});


test('decision origin and rationale retain their floor when an answer implies an item [H16,N29]', () => {
  for (const detail of [{ origin: 'agent' }, { rationale: 'the recorded reason' }]) {
    for (const options of [{ implies: [1] }, { cause: 'conflict:src/fixture.js' }, { cause: 'sentinel:fixture' }]) {
      const args = [1, { agentId: 'coordinator', text: 'Keep the change', ...options, ...detail }];
      assert.ok(minimumMoveEngine('answerDecision', args) >= DECISION_ORIGIN_ENGINE,
        `every mixed answer retains its recorded origin meaning: ${JSON.stringify(args)}`);
    }
  }
});
