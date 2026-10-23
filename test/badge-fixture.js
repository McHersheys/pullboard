/** Real landing proof for board-derived badge endpoint commits [B3,V1,R3]. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Require both documents in the exact landed, clean tip of a real private project's complete lifecycle. */
export function assertBadgeLanding(e2e) {
  const box = e2e.project('node --test web/badge.test.cjs');
  const path = join(box.repo, 'pullboard.json');
  const config = JSON.parse(readFileSync(path, 'utf8'));
  writeFileSync(path, JSON.stringify({ ...config, landing: { publish: 'separate' } }, null, 2));
  box.git(box.repo, 'add', 'pullboard.json');
  box.git(box.repo, 'commit', '-q', '-m', 'chore: configure private badge landing');
  box.git(box.web, 'merge', '-q', '--ff-only', 'main');
  const added = box.run(box.repo, 'add', 'web', 'Badge landing', '--criterion', 'The native probe passes.', '--check', 'node --test web/badge.test.cjs', '--json');
  assert.equal(added.code, 0, `${added.err}\n${added.out}`);
  const id = JSON.parse(added.out).item.item_id;
  const claimed = box.run(box.web, 'claim', String(id));
  assert.equal(claimed.code, 0, claimed.err);
  const committed = e2e.commitFile(box, box.web, 'web/badge.test.cjs', "const { test } = require('node:test'); test('the badge landing probe passes [G1]', () => {});\n", 'test(web): add private badge landing probe [G1]');
  assert.equal(committed.status, 0, committed.stderr);
  const commit = box.git(box.web, 'rev-parse', 'HEAD');
  const submitted = box.run(box.web, 'submit', String(id));
  assert.equal(submitted.code, 0, `${submitted.err}\n${submitted.out}`);
  box.git(box.repo, 'switch', '-q', '--detach', commit);
  try {
    const accepted = box.run(box.repo, 'verify', String(id), 'accept', '--as', 'coordinator', '--note', 'The private native probe passed at the submitted commit.');
    assert.equal(accepted.code, 0, `${accepted.err}\n${accepted.out}`);
  } finally { box.git(box.repo, 'switch', '-q', 'main'); }
  const result = box.run(box.repo, 'land', '--json');
  assert.equal(result.code, 0, `${result.err}\n${result.out}`);
  const landed = JSON.parse(result.out);
  assert.deepEqual(landed.landed, [id]);
  const documents = ['items', 'checked'].map(name => JSON.parse(box.git(box.repo, 'show', `${landed.batch.tip}:docs/badges/${name}.json`)));
  assert.equal(documents[0].message, '1 items');
  assert.equal(documents[1].message, '100%');
  assert.equal(box.git(box.repo, 'rev-parse', 'HEAD'), landed.batch.tip);
  assert.equal(box.git(box.repo, 'status', '--porcelain'), '', 'the endpoint refresh is committed with the landed tip');
}
