/** Counterfactual queue boundaries, conservative evidence and text-free inputs [R1,R2,A1]. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { replayFlow } from '../src/flow-replay.js';
import { main } from '../src/cli.js';

const BASE = Date.parse('2026-10-20T00:00:00Z');
/** Structural native events with deliberately unreadable private detail. */
function events(moves) {
  return moves.map(([minute, kind, item, by], index) => ({ event_id: index + 1,
    event_at: new Date(BASE + minute * 60_000).toISOString(), event_kind: kind, item_id: item, event_by: by,
    get event_detail() { throw new Error('private detail must never be read'); } }));
}

/** One complete rejected attempt followed by successful measured rework. */
function rework() {
  return events([[0, 'add', 1, 'coordinator'], [1, 'claim', 1, 'web-1'], [3, 'submit', 1, 'web-1'],
    [3, 'reserve', 1, 'review-1'], [4, 'reject', 1, 'review-1'], [5, 'claim', 1, 'web-2'],
    [8, 'submit', 1, 'web-2'], [9, 'reserve', 1, 'review-1'], [11, 'accept', 1, 'review-1'],
    [13, 'merged', 1, 'coordinator']]);
}

test('replay retains rejected work and fixed seats without reading private detail [R1,R2]', () => {
  const input = rework();
  const recorded = replayFlow(input);
  assert.deepEqual(recorded.replay.items[0].stages, { build: 5, reviewWait: 1, review: 3, sendBackIdle: 1, mergeWait: 2 });
  assert.equal(recorded.replay.items[0].cycleMinutes, 12);
  const predicted = replayFlow(input, { order: [1] });
  assert.equal(predicted.replay.items[0].cycleMinutes, 10, 'remove observed queue waits, not the rejected work');
  assert.equal(predicted.replay.stages.build.medianMinutes, 5);
  assert.equal(predicted.replay.stages.review.medianMinutes, 3);
  assert.deepEqual(new Set(predicted.history.events.map(event => event.event_by)), new Set(['coordinator', 'web-1', 'web-2', 'review-1']));
  assert.deepEqual(replayFlow([...input].reverse(), { order: [1] }), predicted, 'event ids and times define the same input ordering');
});

test('unmeasured cycles are reported rather than invented as zero work [R1,R2]', () => {
  const input = events([[0, 'add', 1, 'coordinator'], [0, 'add', 2, 'coordinator'], [1, 'claim', 1, 'web-1'], [2, 'submit', 1, 'web-1'],
    [3, 'accept', 1, 'review-1'], [4, 'merged', 1, 'coordinator']]);
  const result = replayFlow(input);
  assert.deepEqual(result.replay.items, []);
  assert.deepEqual(result.replay.unmeasured.map(item => item.id), [1, 2]);
  assert.match(result.replay.unmeasured[0].reasons.join(' '), /review boundary/u);
  assert.deepEqual(result.replay.stages.build, { count: 0, fastQuarterMinutes: null, medianMinutes: null, slowQuarterMinutes: null, worstMinutes: null });
});

test('recorded landing ties follow event order and hypothetical WIP does not manufacture seats [R1,R2]', () => {
  const input = events([[0, 'add', 1, 'coordinator'], [0, 'add', 2, 'coordinator'],
    [0, 'claim', 1, 'web-1'], [0, 'claim', 2, 'web-2'], [1, 'submit', 1, 'web-1'], [1, 'submit', 2, 'web-2'],
    [1, 'reserve', 2, 'review-1'], [2, 'accept', 2, 'review-1'], [2, 'reserve', 1, 'review-1'],
    [3, 'accept', 1, 'review-1'], [5, 'merged', 2, 'coordinator'], [5, 'merged', 1, 'coordinator']]);
  assert.deepEqual(replayFlow(input).replay.landingOrder, [2, 1]);
  const changed = replayFlow(input, { order: [1, 2], settings: { reviewWip: 2 } });
  assert.equal(changed.replay.items.find(item => item.id === 2).stages.reviewWait, 1,
    'the one observed reviewer still reviews one item at a time even when global review WIP is two');
});

test('replay refuses invalid limits, unknown item priorities and malformed structural history [R1,R2,A1]', () => {
  for (const policy of [{ order: [1, 1] }, { order: [999] }, { settings: { reviewWip: 0 } },
    { settings: { buildWip: 1.5 } }, { settings: { gateSlots: 10 } }, { extra: true }]) {
    assert.throws(() => replayFlow(rework(), policy), /USAGE/u);
  }
  const invalid = rework();
  invalid[0] = { event_id: 1, event_at: 'not a timestamp', event_kind: 'add', item_id: 1, event_by: 'coordinator' };
  assert.throws(() => replayFlow(invalid), /USAGE/u);
});


test('show retains its boolean history flag while flow accepts a history file [R1,A1]', async () => {
  let out = '', err = '';
  const code = await main(['help', 'show', '--history'], { stdout: { isTTY: false, write: text => { out += text; } },
    stderr: { write: text => { err += text; } } });
  assert.equal(code, 0, err);
  assert.match(out, /--history/u);
});


test('a clock rollback refuses replay instead of silently reordering native history [R1,R2]', () => {
  const input = rework();
  input[1].event_at = new Date(BASE - 60_000).toISOString();
  assert.throws(() => replayFlow(input), /clocks moved backwards in native event order/u);
  assert.throws(() => replayFlow([...input].reverse(), { order: [1] }), /clocks moved backwards/u,
    'array order cannot hide rollback by placing lower timestamps first');
});


/** Public board control names are replay inputs; internal stage capacities are not a second settings API. */
test('replay accepts modelled board controls and explicitly refuses unmodelled controls [R1,R2,A1]', () => {
  const settings = { reviewsFirst: true, wipPerReviewer: 1.5, landingBatchSize: 2, landingCadenceMinutes: 5 };
  const result = replayFlow(rework(), { settings });
  assert.equal(result.replay.mode, 'predicted');
  assert.deepEqual(result.replay.policy.settings, settings);
  assert.equal(result.replay.items[0].cycleMinutes, 10, 'recorded work is retained while observed queue waits are not imposed');
  assert.deepEqual(result.replay.items[0].stages,
    { build: 5, reviewWait: 0, review: 3, sendBackIdle: 0, mergeWait: 2 });
  for (const key of ['barReady', 'takeoverMinutes']) {
    for (const value of [false, key === 'barReady' ? true : 30]) {
      assert.throws(() => replayFlow(rework(), { settings: { [key]: value } }),
        new RegExp(key + '.*not modelled by replay', 'u'), 'unknown authority is never silently ignored');
    }
  }
  for (const key of ['buildWip', 'reviewWip', 'landingWip']) {
    assert.throws(() => replayFlow(rework(), { settings: { [key]: 2 } }), /USAGE/u,
      'internal limits are not accepted as public board settings');
  }
});
