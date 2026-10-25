/** Real train merges retain additive registry changes and refuse edits [B3,R3,C7]. */
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
import { json } from './land-board-fixture.js';

const e2e = createE2eHelpers();
after(e2e.cleanup);
const FILE = 'src/api-moves.js';
const BASE = "const MOVES = {\n  base: { item: true },\n};\nexport { MOVES };\n";

/** Create a real private board and remote whose web builders own the fixture registry. */
function project() {
  const box = e2e.project('true');
  const path = join(box.repo, 'pullboard.json');
  const config = JSON.parse(readFileSync(path, 'utf8'));
  config.lanes.web.owns.push('src/');
  config.affectedTests = 'true';
  writeFileSync(path, JSON.stringify(config, null, 2));
  mkdirSync(join(box.repo, 'src'), { recursive: true });
  writeFileSync(join(box.repo, FILE), BASE);
  box.git(box.repo, 'add', '-A');
  box.git(box.repo, 'commit', '-q', '-m', 'chore: configure private train registry');
  box.git(box.web, 'merge', '-q', '--ff-only', 'main');
  const remote = join(box.dir, 'origin.git');
  box.git(box.dir, 'init', '-q', '--bare', remote);
  box.git(box.repo, 'remote', 'add', 'origin', remote);
  box.git(box.repo, 'push', '-q', '-u', 'origin', 'main');
  return { ...box, remote };
}

/** Submit and independently verify a real item from its own private checkout. */
function item(box, number, text) {
  const path = join(box.dir, `builder-${number}`);
  box.git(box.repo, 'worktree', 'add', '-q', '--detach', path, 'main');
  json(box, path, 'join', 'web');
  const added = json(box, box.repo, 'add', 'web', `Registry addition ${number}`, '--specs', 'G1',
    '--criterion', 'retain this registry entry', '--check', 'true');
  const id = added.item.item_id;
  json(box, path, 'claim', String(id));
  writeFileSync(join(path, FILE), text);
  const commit = e2e.commitFile(box, path, FILE, text, `feat(web): registry addition ${number} [G1]`);
  assert.equal(commit.status, 0, commit.stderr);
  const head = box.git(path, 'rev-parse', 'HEAD');
  json(box, path, 'submit', String(id));
  box.git(box.repo, 'checkout', '-q', '--detach', head);
  try { json(box, box.repo, 'verify', String(id), 'accept', '--as', 'coordinator', '--note', 'private registry item checked'); }
  finally { box.git(box.repo, 'checkout', '-q', 'main'); }
  return id;
}

test('the train keeps both added registry entries and lands without a reopen [B3,R3,C7]', () => {
  const box = project();
  const first = item(box, 1, BASE.replace('  base:', '  alpha: { item: true },\n  base:'));
  const second = item(box, 2, BASE.replace('  base:', '  beta: { item: true },\n  base:'));
  const landed = json(box, box.repo, 'land', '--max', '2');
  assert.deepEqual(landed.landed, [first, second], 'both independently verified additions land');
  assert.deepEqual(landed.conflicts, []);
  const source = box.git(box.repo, 'show', `main:${FILE}`);
  assert.match(source, /alpha:.*\n  beta:.*\n  base:/u, 'stable order preserves both entries');
  const resolutions = landed.batch.resolutions ?? [];
  assert.ok(resolutions.some(entry => entry.id === second && entry.files.includes(FILE)), 'the native landing batch records its mechanical resolution');
  for (const id of [first, second]) {
    const state = json(box, box.repo, 'show', String(id));
    assert.equal(state.item_status, 'verified');
    assert.ok(state.item_merged_commit);
  }
  assert.equal(box.git(box.remote, 'rev-parse', 'main'), box.git(box.repo, 'rev-parse', 'main'));
});

test('a registry edit remains a conflict and reopens instead of being unioned [B3,R3,C7]', () => {
  const box = project();
  const first = item(box, 1, BASE.replace('item: true', 'item: false'));
  const second = item(box, 2, BASE.replace('item: true', "positions: ['id']"));
  const landed = json(box, box.repo, 'land', '--max', '2');
  assert.ok(landed.conflicts.some(entry => entry.id === second));
  assert.equal(json(box, box.repo, 'show', String(second)).item_status, 'open');
  assert.deepEqual(landed.landed, [first]);
});
