/** @pullboard-test-loads src/brief.js src/board.js */
/** External references stay distinct from the board's requirement and dependency links [C7]. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { join } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
import { briefSections } from '../src/brief.js';
import * as store from '../src/board.js';
import { minimumMoveEngine } from '../src/move-registry.js';
import { REFERENCE_ENGINE } from '../src/reference-engine.js';
import { createE2eHelpers } from './e2e-helpers.js';
import { referenceLines } from '../src/reference-lines.js';
import { bridgeProject, bridgeProvider, landBridgeItems, runBridgeCLI } from './pr-bridge-fixture.js';

test('reference points 19 and 23: only explicitly labelled lines can acknowledge someone [C7]', () => {
  const brief = 'Reference: https://example.com/public @Reporter\nprivate unlabelled continuation @PrivatePerson\nReference: https://example.com/private';
  assert.deepEqual(referenceLines(brief), [
    { text: 'https://example.com/public @Reporter', target: 'https://example.com/public', handle: 'Reporter' },
    { text: 'https://example.com/private', target: 'https://example.com/private', handle: null },
  ]);
});

test('reference point 23: actual PR create and update publish handled references and keep all others private [C7,B3,R3]', async t => {
  const box = bridgeProject(t);
  const publicReference = 'https://example.com/acknowledged-report';
  const privateReference = 'https://example.com/PRIVATE-REFERENCE-SENTINEL';
  const privateContinuation = 'PRIVATE-CONTINUATION-SENTINEL @PrivatePerson';
  const entries = landBridgeItems(box, { briefs: [
    `Reference: ${publicReference} @Reporter\n${privateContinuation}\nReference: ${privateReference}`,
    'Reference: PRIVATE-CONVERSATION-SENTINEL',
  ] });
  const provider = await bridgeProvider(t, box);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const published = await runBridgeCLI(box, 'publish', '--json');
    assert.equal(published.code, 0, published.err || published.out);
    assert.equal(provider.pulls.length, 1);
    const pull = provider.pulls[0];
    assert.ok(pull.body.includes(publicReference), 'the acknowledged reference is included in the actual provider body');
    assert.ok(pull.body.includes('@Reporter'));
    for (const entry of entries) assert.ok(pull.body.includes(entry.commit), 'existing exact accepted receipt remains');
    assert.equal(box.git(box.remote, 'rev-parse', 'main'), box.published, 'the protected remote remains unchanged');
  }
  const outgoing = JSON.stringify(provider.requests.filter(request => request.method !== 'GET').map(request => request.body));
  for (const secret of [privateReference, privateContinuation, 'PRIVATE-CONVERSATION-SENTINEL', '@PrivatePerson']) {
    assert.equal(outgoing.includes(secret), false, `unhandled private reference never leaves the board: ${secret}`);
  }
  assert.equal(provider.requests.some(request => request.path.endsWith('/merge') && request.method !== 'GET'), false);
});

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

test('historical brief references retain their old routing grammar and replay floor [C7,H16]', t => {
  const e2e = createE2eHelpers();
  const box = e2e.project('true');
  const board = store.openBoard(join(box.repo, '.git/pullboard/board.sqlite'));
  t.after(() => { store.closeBoard(board); e2e.cleanup(); });
  const brief = 'Files: web/site.js\nReference: H21';
  assert.deepEqual(briefSections(brief, { references: false }).files, ['web/site.js', 'Reference: H21']);
  const addition = { by: 'coordinator', lane: 'web', title: 'Historical reference', brief };
  assert.equal(minimumMoveEngine('addItem', [addition]), 1, 'unstructured historical text never gains a new replay floor');
  assert.equal(minimumMoveEngine('editItem', [1, { agentId: 'coordinator', brief }]), 1);
  board.executionEngineVersion = REFERENCE_ENGINE - 1;
  const id = store.addItem(board, addition);
  store.editItem(board, id, { agentId: 'coordinator', brief });
  delete board.executionEngineVersion;
  store.editItem(board, id, { agentId: 'coordinator', criterion: 'An unrelated edit preserves legacy text.' });
  assert.equal(store.getItem(board, id).item_brief, brief);
  assert.throws(() => store.addItem(board, addition), { code: 'REFERENCE_IS_BOARD' }, 'new moves use the new validation');
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


/** Exercise the actual Submit lifecycle with a private changelog owned by the fixture's lane. */
function submitReferenceFixture(t, { handled, matchingAddition }) {
  const e2e = createE2eHelpers();
  t.after(() => e2e.cleanup());
  const box = e2e.project('true');
  const target = 'https://example.invalid/conversations/reference-submit-20';
  const handle = 'ReferenceReporter';
  const acknowledgement = `${target} @${handle}`;
  const configFile = join(box.repo, 'pullboard.json');
  const config = JSON.parse(readFileSync(configFile, 'utf8'));
  config.lanes.web.owns.push('CHANGELOG.md');
  writeFileSync(configFile, JSON.stringify(config, null, 2) + '\n');
  // An old matching line is insufficient: point 20 concerns what this item's change adds.
  writeFileSync(join(box.repo, 'CHANGELOG.md'), `# Changelog\n\n## Earlier release\n- Earlier work: ${acknowledgement}\n`);
  box.git(box.repo, 'add', 'pullboard.json', 'CHANGELOG.md');
  box.git(box.repo, 'commit', '-q', '-m', 'chore: prepare reference changelog fixture [G1]');
  box.git(box.web, 'merge', '-q', '--ff-only', 'main');
  const reference = handled ? acknowledgement : target;
  const added = box.run(box.repo, 'add', 'web', 'Submit reference reminder', '--specs', 'G1',
    '--criterion', 'The private reference change remains green.', '--check', 'test -f web/reference-change.txt',
    '--brief', `${e2e.LIGHT_BRIEF}Reference: ${reference}\n`, '--json');
  assert.equal(added.code, 0, added.err || added.out);
  const id = JSON.parse(added.out).item.item_id;
  const claimed = box.run(box.web, 'claim', String(id));
  assert.equal(claimed.code, 0, claimed.err || claimed.out);
  if (matchingAddition) {
    const file = join(box.web, 'CHANGELOG.md');
    writeFileSync(file, readFileSync(file, 'utf8') + `\n## Unreleased\n- New reference change: ${acknowledgement}\n`);
  }
  const committed = e2e.commitFile(box, box.web, 'web/reference-change.txt', 'PASS\n',
    'feat(web): exercise reference submit [G1]');
  assert.equal(committed.status, 0, committed.stderr || committed.stdout);
  const submitted = box.run(box.web, 'submit', String(id), '--json');
  assert.equal(submitted.code, 0, submitted.err || submitted.out);
  const shown = box.run(box.repo, 'show', String(id), '--json');
  assert.equal(shown.code, 0, shown.err || shown.out);
  assert.equal(JSON.parse(shown.out).item_status, 'submitted', 'the reminder never prevents the native submission');
  return { submitted, target, handle };
}

test('reference point 20: Submit reminds without refusing and only for missing newly added acknowledgements [C7]', async t => {
  await t.test('an old matching line does not hide the missing addition', t => {
    const { submitted, target, handle } = submitReferenceFixture(t, { handled: true, matchingAddition: false });
    const output = `${submitted.out}\n${submitted.err}`;
    const reminders = output.split(/\r?\n/u).filter(line => /changelog/iu.test(line));
    assert.ok(reminders.some(line => line.includes(target) && line.includes(`@${handle}`)),
      'successful Submit reminds about the exact handled reference missing from this change');
  });
  await t.test('a matching newly added changelog line needs no reminder', t => {
    const { submitted } = submitReferenceFixture(t, { handled: true, matchingAddition: true });
    assert.doesNotMatch(`${submitted.out}\n${submitted.err}`, /changelog/iu,
      'the actual added acknowledgement satisfies the reminder');
  });
  await t.test('an unhandled reference needs no acknowledgement or reminder', t => {
    const { submitted } = submitReferenceFixture(t, { handled: false, matchingAddition: false });
    assert.doesNotMatch(`${submitted.out}\n${submitted.err}`, /changelog/iu,
      'private unhandled references do not acquire an acknowledgement check');
  });
});
