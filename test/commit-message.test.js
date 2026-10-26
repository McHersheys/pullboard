/** The shared commit-message builder and parser: ids fill what fits, then +N, with every row in a trailer (RFC 0005) [C7,B3,R3]. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  HEADER_LIMIT,
  buildCommitMessage,
  commitMessageProblems,
  headerRows,
  parseCommitMessage,
  specOrder,
} from '../src/commit-message.js';
import { checkLandingMessages, landingMessage, landingRows } from '../src/land.js';
import { citedIds, parseSpec } from '../src/spec.js';

/** Row ids A1..An, the shape a long cited set takes. */
const rowsUpTo = (count, letter = 'A') => Array.from({ length: count }, (_, index) => `${letter}${index + 1}`);

/** Parse a built message and build it again from the parse: both directions must be exact. */
function roundTrip(input) {
  const built = buildCommitMessage(input);
  const parsed = parseCommitMessage(built.message);
  assert.equal(parsed.header, built.header);
  assert.equal(parsed.type, input.type);
  assert.equal(parsed.scope, input.scope);
  assert.equal(parsed.item, input.item);
  assert.deepEqual(parsed.rows, input.rows.length ? input.rows : null, 'Pullboard-Rows carries every row, or is absent');
  assert.deepEqual(parsed.shown, input.rows.slice(0, parsed.shown.length), 'the header shows the first rows');
  assert.equal(parsed.shown.length + parsed.more, input.rows.length, '+N counts exactly the rows the header leaves out');
  const again = buildCommitMessage({ type: parsed.type, scope: parsed.scope, title: parsed.title, item: parsed.item, rows: parsed.rows ?? [] });
  assert.equal(again.message, built.message, 'building from the parse writes the same bytes');
  assert.deepEqual(commitMessageProblems(built.message, { item: input.item, rows: input.rows }), []);
  assert.ok(built.header.length <= HEADER_LIMIT, built.header);
  assert.deepEqual(parsed.trailers.map((entry) => entry.key), ['Pullboard-Item', ...(input.rows.length ? ['Pullboard-Rows'] : [])], 'the trailers come in the fixed order');
  assert.ok(built.message.endsWith(built.trailers), 'the trailers are the last paragraph');
  return { built, parsed };
}

test('one row: the header shows it and the trailers name the item then the row [C7,B3,R3]', () => {
  const { built } = roundTrip({ type: 'feat', scope: 'merge', title: 'Person-only moves are signed', item: 408, rows: ['E22'] });
  assert.equal(built.message, 'feat(merge): person-only moves are signed [E22]\n\nPullboard-Item: #408\nPullboard-Rows: E22');
});

test('many consecutive rows fill the header, then +N stands for the rest [C7,B3,R3]', () => {
  const twelve = roundTrip({ type: 'chore', scope: 'merge', title: 'Land the batch', item: 7, rows: rowsUpTo(12) });
  assert.equal(twelve.built.header, 'chore(merge): land the batch [A1,A2,A3,A4,A5,A6,A7,A8,A9,A10,A11,A12]', 'every row shows when they all fit');
  const twenty = roundTrip({ type: 'chore', scope: 'merge', title: 'Land the batch', item: 7, rows: rowsUpTo(20) });
  assert.equal(twenty.built.header, 'chore(merge): land the batch [A1,A2,A3,A4,A5,A6,A7,A8,A9,A10,A11,+9]');
  assert.equal(twenty.parsed.more, 9);
  // The ids fill what fits: one more shown id would cross the limit.
  const longer = `chore(merge): land the batch [${[...rowsUpTo(12), '+8'].join(',')}]`;
  assert.ok(longer.length > HEADER_LIMIT, longer);
});

test('scattered ids land in spec order, doctrine rows after the spec rows [C7,B3,R3]', () => {
  const spec = parseSpec('# Spec\n\n## A\n- A2 [approved, must] Two.\n## C\n- C7 [approved, must] Seven.\n## M\n- M3 [approved, must] Three.\n## Z\n- Z9 [approved, must] Nine.\n');
  const rows = specOrder(['Z9', 'doctrine:PB1', 'A2', 'M3', 'C7', 'A2'], spec);
  assert.deepEqual(rows, ['A2', 'C7', 'M3', 'Z9', 'doctrine:PB1'], 'spec order, duplicates once, doctrine last');
  const { built } = roundTrip({ type: 'chore', scope: 'merge', title: 'Scattered rows land', item: 9, rows });
  assert.equal(built.message, 'chore(merge): scattered rows land [A2,C7,M3,Z9,doctrine:PB1]\n\nPullboard-Item: #9\nPullboard-Rows: A2,C7,M3,Z9,doctrine:PB1');
});

test('36 rows never refuse: the header keeps the title and the trailer keeps all 36 [C7,B3,R3]', () => {
  const rows = rowsUpTo(36);
  const { built, parsed } = roundTrip({ type: 'docs', scope: 'merge', title: 'Update the handbook', item: 1326, rows });
  assert.equal(built.header, 'docs(merge): update the handbook [A1,A2,A3,A4,A5,A6,A7,A8,A9,A10,+26]');
  assert.equal(built.trailers, `Pullboard-Item: #1326\nPullboard-Rows: ${rows.join(',')}`);
  assert.equal(parsed.rows.length, 36);
  // The title keeps priority: a title that needs the whole header still lands, showing only +N.
  const long = roundTrip({ type: 'chore', scope: 'merge', title: 'A VERY LONG TITLE '.repeat(10), item: 91, rows });
  assert.equal(long.built.header, 'chore(merge): a very long title a very long title a very long [+36]');
});

test('no rows: no brackets and no Pullboard-Rows trailer [C7,B3,R3]', () => {
  const { built, parsed } = roundTrip({ type: 'test', scope: 'merge', title: 'Every test run an agent starts goes through the runner pool', item: 1219, rows: [] });
  assert.equal(built.message, 'test(merge): every test run an agent starts goes through the runner pool\n\nPullboard-Item: #1219');
  assert.equal(parsed.rows, null);
  assert.deepEqual(parsed.shown, []);
});

test('the parser reads trailers only as the last paragraph and +N is never an id [C7,B3,R3]', () => {
  const parsed = parseCommitMessage('fix(core): read the rows [A1,A2,+3]\n\nWhy it matters.\n\nPullboard-Item: #12\nPullboard-Rows: A1,A2,A3,A4,A5\n');
  assert.deepEqual({ type: parsed.type, scope: parsed.scope, title: parsed.title, shown: parsed.shown, more: parsed.more, body: parsed.body, item: parsed.item, rows: parsed.rows },
    { type: 'fix', scope: 'core', title: 'read the rows', shown: ['A1', 'A2'], more: 3, body: 'Why it matters.', item: 12, rows: ['A1', 'A2', 'A3', 'A4', 'A5'] });
  const trailing = parseCommitMessage('fix(core): read the rows [A1]\n\nPullboard-Item: #12\n\ntext after the trailers');
  assert.equal(trailing.item, null, 'text after the trailers leaves the message with none');
  assert.deepEqual(citedIds('chore(merge): land it [A1,A2,+34]'), ['A1', 'A2']);
  assert.deepEqual(citedIds('chore(merge): land it [+36]'), []);
  assert.deepEqual(citedIds('feat(web): add the page [G1, K1.2]'), ['G1', 'K1.2'], 'a hand-written header still reads');
  assert.deepEqual(headerRows('fix: handle [x] in the middle of text'), { shown: [], more: 0, rest: 'fix: handle [x] in the middle of text' });
  assert.deepEqual(commitMessageProblems('chore(merge): land it [A2,+1]\n\nPullboard-Item: #3\nPullboard-Rows: A1,A2', { item: 3, rows: ['A1', 'A2'] }),
    ['its header ids are not the first rows followed by +N for the rest']);
});

test('a landing names the refrozen rows in spec order, and a batch checks every message before merging [C7,B3,R3]', () => {
  const spec = parseSpec('# Spec\n\n## A\n- A1 [approved, must] One.\n- A2 [approved, must] Two.\n- A3 [approved, must] Three.\n');
  const claimed = { item_id: 5, item_lane: 'core', item_title: 'Refrozen rows', item_spec_ids: 'A3,A1',
    item_frozen: JSON.stringify({ title: 'Refrozen rows', criterion: 'c', rows: [{ id: 'A3' }, { id: 'A1' }] }) };
  assert.deepEqual(landingRows(claimed, spec), ['A1', 'A3']);
  // A refreeze after the claim replaced the frozen set: the landing writes the final frozen rows.
  const refrozen = { ...claimed, item_frozen: JSON.stringify({ title: 'Refrozen rows', criterion: 'c2', rows: [{ id: 'A3' }, { id: 'A2' }, { id: 'A1' }] }) };
  assert.equal(landingMessage(refrozen, { spec }).message, 'chore(merge): refrozen rows [A1,A2,A3]\n\nPullboard-Item: #5\nPullboard-Rows: A1,A2,A3');
  const none = { item_id: 6, item_lane: 'docs', item_title: 'No rows', item_spec_ids: '', item_frozen: JSON.stringify({ rows: [] }) };
  assert.equal(landingMessage(none, { spec }).message, 'docs(merge): no rows\n\nPullboard-Item: #6');
  const many = { item_id: 8, item_lane: 'core', item_title: 'Many rows', item_spec_ids: rowsUpTo(36).join(',') };
  assert.equal(landingMessage(many).rows.length, 36, 'no citation count refuses');
  const checked = checkLandingMessages([refrozen, none, many], spec);
  assert.deepEqual([...checked.keys()], [5, 6, 8]);
  // A malformed row id (never written by the spec) fails the check for the whole batch, naming the item.
  const broken = { ...many, item_id: 9, item_spec_ids: '', item_frozen: JSON.stringify({ rows: [{ id: 'A1' }, { id: 'A2,A3' }] }) };
  assert.throws(() => checkLandingMessages([refrozen, broken], spec), (error) => {
    assert.equal(error.code, 'LAND_HEADER');
    assert.match(error.message, /#9/u);
    assert.doesNotMatch(error.message, /shorten|cut|remove|fewer|cited set/iu, 'no refusal advises removing citations');
    return true;
  });
});
