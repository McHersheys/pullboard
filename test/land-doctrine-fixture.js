/** Real landing controls for automatically tightened doctrine counts [B3,R3,D1,D3]. */
import assert from 'node:assert/strict';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Configure private tier-one landing with one person-approved, held quality check. */
function configure(box, command, count) {
  const path = join(box.repo, 'pullboard.json');
  const config = JSON.parse(readFileSync(path, 'utf8'));
  writeFileSync(path, JSON.stringify({ ...config, landing: { publish: 'separate' } }, null, 2));
  appendFileSync(join(box.repo, 'DOCTRINE.md'),
    `\n## Q · Quality\n- Q1 [approved, must] The quality count only falls. | gate: check ${command} | count: ${count}\n`);
  box.git(box.repo, 'add', '-A');
  box.git(box.repo, 'commit', '-q', '-m', 'chore: configure held landing quality');
}

/** Parse a successful private command without hiding its actual stdout or stderr. */
function json(box, ...args) {
  const result = box.run(box.repo, ...args, '--json');
  assert.equal(result.code, 0, `${result.err}\n${result.out}`);
  return JSON.parse(result.out);
}

/** Prove a lower count reaches the committed trunk, while interacting green items cannot raise it. */
export function assertLandingDoctrineCounts({ landProject, itemWorktree, submitItem, acceptItem }) {
  const falling = landProject();
  mkdirSync(join(falling.repo, 'web'), { recursive: true });
  writeFileSync(join(falling.repo, 'web/markers.txt'), 'TODO first\nTODO second\n');
  configure(falling, 'grep -n TODO web/markers.txt', 2);
  const improved = itemWorktree(falling, 1, 'web/markers.txt');
  submitItem(falling, improved, 'TODO second\n');
  acceptItem(falling, improved);
  const oldRemote = falling.git(falling.remote, 'rev-parse', 'main');
  const landed = json(falling, 'land');
  assert.deepEqual(landed.landed, [improved.item]);
  const committed = falling.git(falling.repo, 'show', `${landed.batch.tip}:DOCTRINE.md`);
  assert.match(committed, /Q1 .*\| count: 1$/mu, 'the lower count is committed at the exact landed tip');
  assert.match(readFileSync(join(falling.repo, 'DOCTRINE.md'), 'utf8'), /Q1 .*\| count: 1$/mu);
  assert.equal(falling.git(falling.repo, 'rev-parse', 'HEAD'), landed.batch.tip);
  assert.equal(falling.git(falling.remote, 'rev-parse', 'main'), oldRemote, 'tier-one tightening never publishes');
  assert.deepEqual(landed.batch.doctrineCounts, [{ id: 'Q1', before: 2, count: 1 }], 'the durable report names both counts');
  const unchanged = json(falling, 'land');
  assert.deepEqual(unchanged.landed, [], 'a completed tightening is not committed twice');

  const rising = landProject();
  const source = "const fs = require('node:fs'); if (fs.existsSync('web/land-1.test.js') && fs.existsSync('web/land-2.test.js')) console.log('interacting problems');";
  writeFileSync(join(rising.repo, 'quality.cjs'), source);
  configure(rising, 'node quality.cjs', 0);
  const entries = [itemWorktree(rising, 1), itemWorktree(rising, 2)];
  for (const entry of entries) { submitItem(rising, entry); acceptItem(rising, entry); }
  const before = rising.git(rising.repo, 'rev-parse', 'main');
  const result = rising.run(rising.repo, 'land', '--json');
  const report = JSON.parse(result.out);
  assert.equal(rising.git(rising.repo, 'rev-parse', 'main'), before, 'combined higher count holds the trunk');
  assert.deepEqual(report.landed ?? [], [], `${result.err}\n${result.out}`);
  assert.match(`${result.err}\n${result.out}`, /Q1.*(?:rose|1.*0)/su, 'the higher count explains the hold');
  assert.match(rising.git(rising.repo, 'show', 'main:DOCTRINE.md'), /Q1 .*\| count: 0$/mu, 'no count is raised');
}
