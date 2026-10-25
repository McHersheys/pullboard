/** Flow size buckets retain the exact observed Git comparison on the native submission [R1,R2,V4]. */
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import * as store from '../src/board.js';
import { createE2eHelpers } from './e2e-helpers.js';

test('a native submit records its immutable changed-line base and head for flow buckets [R1,R2,V4]', { timeout: 60_000 }, t => {
  const helpers = createE2eHelpers();
  t.after(helpers.cleanup);
  const box = helpers.project('true');
  const added = box.run(box.repo, 'add', 'web', 'Measure submitted lines', '--specs', 'G1',
    '--criterion', 'The measured page exists.', '--check', 'test -f web/size.txt');
  assert.equal(added.code, 0, added.out + added.err);
  const claimed = box.run(box.web, 'claim', '1');
  assert.equal(claimed.code, 0, claimed.out + claimed.err);
  const base = box.git(box.repo, 'rev-parse', 'main');
  mkdirSync(join(box.web, 'web'), { recursive: true });
  writeFileSync(join(box.web, 'web/size.txt'), Array.from({ length: 100 }, (_, n) => `line ${n}\n`).join(''));
  box.git(box.web, 'add', 'web/size.txt');
  box.git(box.web, 'commit', '-q', '-m', 'feat(web): add measured page [G1]');
  const head = box.git(box.web, 'rev-parse', 'HEAD');
  const submitted = box.run(box.web, 'submit', '1');
  assert.equal(submitted.code, 0, submitted.out + submitted.err);
  const json = box.run(box.repo, 'stats', '--json');
  assert.equal(json.code, 0, json.out + json.err);
  const report = JSON.parse(json.out).stats.flow.report;
  assert.ok(report, 'stats JSON includes the same event-derived report');
  assert.deepEqual(report.items.find(item => item.id === 1).sizeBuckets['100to300'],
    { accepted: 0, decided: 0, rate: null, unknown: 1 }, 'a real undecided 100-line first attempt has a known bucket and an unknown verdict');
  const text = box.run(box.repo, 'stats');
  assert.equal(text.code, 0, text.out + text.err);
  assert.match(text.out, /flow report/u);
  assert.match(text.out, /waiting for an agent/u);
  assert.match(text.out, /filed for later/u);
  assert.match(text.out, /item #1/u);
  const board = store.openBoard(join(box.repo, '.git/pullboard/board.sqlite'));
  try {
    const events = store.events(board);
    const submission = events.findLast(event => event.event_kind === 'submit');
    const detail = JSON.parse(submission.event_detail);
    assert.deepEqual(detail.submissionSize, { base, head, lines: 100, method: 'added-plus-deleted-no-renames' },
      'the observed count is bound to the actual submit comparison, rather than reconstructed from later main');
    assert.equal(detail.commit, head);
    const before = submission.event_detail;
    writeFileSync(join(box.repo, 'later.txt'), 'later trunk change\n');
    box.git(box.repo, 'add', 'later.txt');
    box.git(box.repo, 'commit', '-q', '-m', 'chore: advance the fixture trunk');
    assert.equal(store.events(board).find(event => event.event_id === submission.event_id).event_detail, before,
      'advancing the trunk leaves the earlier submission measurement unchanged');
  } finally { store.closeBoard(board); }
});
