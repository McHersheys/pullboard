/** @pullboard-test-loads src/brief.js src/board.js */
/** External references stay distinct from the board's requirement and dependency links [C7]. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { briefSections } from '../src/brief.js';
import { createE2eHelpers } from './e2e-helpers.js';

test('reference point 19: repeated external references remain separate labelled brief entries [C7]', () => {
  const references = [
    'https://github.com/example/project/issues/10 @Reporter',
    'a private conversation with the maintainer',
    'src/feature.js:12@' + 'a'.repeat(40),
  ];
  const brief = ['Files: web/site.js', ...references.map(value => 'Reference: ' + value), 'Test: node --test test/site.test.js'].join('\n');
  const sections = briefSections(brief);
  assert.deepEqual(sections.reference, references, 'every reference has its own entry, preserving private text and the explicit acknowledgement');
  assert.deepEqual(sections.files, ['web/site.js'], 'references never become file instructions');
  assert.deepEqual(sections.test, ['node --test test/site.test.js']);
});

test('reference point 22: add and edit refuse board-only references with the right flags [C7]', t => {
  const e2e = createE2eHelpers();
  const box = e2e.project('true');
  t.after(() => e2e.cleanup());
  const valid = box.run(box.repo, 'add', 'web', 'An external reference', '--brief', 'Reference: https://example.com/report', '--json');
  assert.equal(valid.code, 0, valid.err || valid.out);
  const id = JSON.parse(valid.out).item.item_id;
  for (const [reference, flag] of [['H21', '--specs H21'], ['#17', '--after'], ['17', '--after']]) {
    for (const args of [
      ['add', 'web', 'Board ids have their own flags'],
      ['edit', String(id)],
    ]) {
      const result = box.run(box.repo, ...args, '--brief', 'Reference: ' + reference, '--json');
      assert.equal(result.code, 1, `${args[0]} must refuse Reference: ${reference}; ${result.out}${result.err}`);
      const refusal = JSON.parse(result.out).error;
      assert.equal(refusal.code, 'REFERENCE_IS_BOARD');
      assert.ok(refusal.message.includes(flag), refusal.message);
    }
  }
});
