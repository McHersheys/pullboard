/** Window projections of the canonical lifecycle observer; absent evidence is never a zero [R1,R2]. */
import { Refused } from './refused.js';

const MINUTE = 60_000;
export const WINDOW_STAGES = ['build', 'reviewWait', 'review', 'sendBackIdle', 'mergeWait'];
const TARGETS = { build: 240, reviewWait: 30, review: 60, sendBackIdle: 30, mergeWait: 60 };
const LABELS = { build: 'building', reviewWait: 'waiting for a reviewer', review: 'in review',
  sendBackIdle: 'sent back, idle', mergeWait: 'waiting to land' };

/** Enable interval observations only for an explicitly requested window, not persistent proof counters. */
export function newWindowTrace() {
  return { cursor: null, entries: [], intervals: [], missing: [], submissions: 0, rejections: 0 };
}

/** Observe a transition already accepted by moveFlowItem, without replaying another state machine. */
export function observeFlowStage(item, stage, at, by) {
  const trace = item.windowTrace;
  if (!trace || item.mergeAt !== undefined) return;
  const prior = trace.cursor;
  if (prior?.stage === stage) return;
  if (prior && Number.isFinite(at) && at >= prior.start) {
    trace.intervals.push({ ...prior, end: at, completedBy: by });
  } else if (prior && !trace.missing.includes(prior.stage)) trace.missing.push(prior.stage);
  trace.cursor = stage ? { stage, start: at, by } : null;
  if (trace.cursor) trace.entries.push({ ...trace.cursor });
}

/** A verdict without a recorded reservation cannot divide waiting from review work. */
export function observeFlowVerdict(item, by) {
  const trace = item.windowTrace;
  if (!trace || trace.cursor?.stage === 'review' && trace.cursor.by === by) return;
  for (const stage of ['reviewWait', 'review']) if (!trace.missing.includes(stage)) trace.missing.push(stage);
  trace.cursor = null;
}

/** Preserve a missing required boundary without substituting a different move's timestamp. */
export function observeFlowGap(item) {
  const trace = item.windowTrace;
  if (!trace?.cursor) return;
  if (!trace.missing.includes(trace.cursor.stage)) trace.missing.push(trace.cursor.stage);
  trace.cursor = null;
}

/** Freeze nested observations along with the existing immutable prepared lifecycle. */
export function frozenWindowTrace(trace) {
  return Object.freeze({ ...trace, cursor: trace.cursor ? Object.freeze({ ...trace.cursor }) : null,
    entries: Object.freeze(trace.entries.map(row => Object.freeze({ ...row }))),
    intervals: Object.freeze(trace.intervals.map(row => Object.freeze({ ...row }))),
    missing: Object.freeze([...trace.missing]) });
}

/** Accept positive durations with an explicit unit; timestamps continue to use the separate --since option. */
export function flowWindowMinutes(value) {
  const match = /^(\d+(?:\.\d+)?)(m|h|d)$/u.exec(String(value));
  const minutes = match ? Number(match[1]) * { m: 1, h: 60, d: 1440 }[match[2]] : NaN;
  if (!(minutes > 0) || !Number.isFinite(minutes)) {
    throw new Refused('USAGE', 'use pullboard stats --window with a positive duration, for example --window 6h, --window 30m or --window 1d');
  }
  return minutes;
}

/** The reference uses discrete quarter indices and the arithmetic median, including even sample counts. */
function quartiles(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const count = sorted.length;
  const middle = Math.floor(count / 2);
  return { fastQuarterMinutes: count ? sorted[Math.min(count - 1, Math.floor(count / 4))] : null,
    medianMinutes: count ? count % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2 : null,
    slowQuarterMinutes: count ? sorted[Math.min(count - 1, Math.floor(count * 3 / 4))] : null,
    worstMinutes: count ? sorted.at(-1) : null };
}

/** Classify an observed tail; reviewer eligibility stays explicitly unknown without a recorded observation. */
function tailItem(item, stage, minutes) {
  const trace = item.windowTrace;
  const cause = stage === 'build' ? trace.submissions >= 3 ? 'rework' : 'long-build'
    : { reviewWait: 'reviewer-wait', review: 'slow-review', sendBackIdle: 'send-back-idle', mergeWait: 'landing-queue' }[stage];
  return { id: item.id, minutes, cause, submissions: trace.submissions, rejections: trace.rejections,
    ...(stage === 'reviewWait' ? { eligibility: 'unmeasured' } : {}) };
}

/** Sum only closed intervals; an omitted or incomplete stage is not a measured zero-minute visit. */
function stageMinutes(item, stage) {
  const trace = item.windowTrace;
  if (!trace || trace.missing.includes(stage)) return null;
  const rows = trace.intervals.filter(row => row.stage === stage && row.end <= item.mergeAt);
  return rows.length ? rows.reduce((sum, row) => sum + (row.end - row.start) / MINUTE, 0) : null;
}

/** Close a still-held cursor at its recorded expiry for observation-only traffic counts. */
function trafficTrace(item, now) {
  const trace = item.windowTrace;
  if (!trace?.cursor) return trace;
  const { stage } = trace.cursor;
  const until = stage === 'build' ? item.leaseUntil : stage === 'review' ? item.reserve?.until : NaN;
  if (!Number.isFinite(until) || until > now || until < trace.cursor.start) return trace;
  const entries = stage === 'review' ? [...trace.entries, { stage: 'reviewWait', start: until, by: 'clock' }] : trace.entries;
  return { ...trace, entries, intervals: [...trace.intervals, { ...trace.cursor, end: until, completedBy: 'clock' }] };
}

/** Count visits in the window, including unfinished work, and only name seats observed doing that work. */
function stageTraffic(items, stage, since, now) {
  let arrivals = 0, completions = 0;
  const seats = new Set();
  for (const item of items) {
    const trace = trafficTrace(item, now);
    for (const row of trace?.entries ?? []) {
      if (row.stage !== stage || row.start < since || row.start > now) continue;
      arrivals += 1;
      if (['build', 'review'].includes(stage) && row.by && !['clock', 'board', 'person'].includes(row.by)) seats.add(row.by);
    }
    for (const row of trace?.intervals ?? []) {
      if (row.stage !== stage || row.end < since || row.end > now) continue;
      completions += 1;
      if (row.completedBy && !['clock', 'board', 'person'].includes(row.completedBy)) seats.add(row.completedBy);
    }
  }
  return { arrivals, completions, seats: [...seats].sort() };
}

/** Project landed item totals and stage traffic from the same prepared canonical lifecycle facts. */
export function projectFlowWindow(prepared, minutes, now) {
  const bounds = flowWindowBounds(minutes, now);
  const since = now - minutes * MINUTE;
  const landed = prepared.items.filter(item => item.mergeAt >= since && item.mergeAt <= now);
  const stages = Object.fromEntries(WINDOW_STAGES.map(stage => {
    const measured = landed.map(item => ({ item, minutes: stageMinutes(item, stage) })).filter(row => row.minutes !== null);
    const values = measured.map(row => row.minutes);
    return [stage, { count: values.length, ...quartiles(values), totalMinutes: values.reduce((sum, value) => sum + value, 0),
      unmeasuredCompleted: landed.length - values.length, targetMinutes: TARGETS[stage],
      overTargetMinutes: values.reduce((sum, value) => sum + Math.max(0, value - TARGETS[stage]), 0),
      ...stageTraffic(prepared.items, stage, since, now),
      tail: measured.sort((a, b) => b.minutes - a.minutes || a.item.id - b.item.id).slice(0, 3)
        .map(row => tailItem(row.item, stage, row.minutes)) }];
  }));
  const constraint = WINDOW_STAGES.reduce((largest, stage) => stages[stage].overTargetMinutes > (largest ? stages[largest].overTargetMinutes : 0) ? stage : largest, null);
  return { ...bounds,
    landedItems: landed.length,
    arrivals: { added: prepared.dailyEvents.filter(event => event.kind === 'added' && event.at >= since && event.at <= now).length, landed: landed.length },
    stages, constraint: { stage: constraint, overTargetMinutes: constraint ? stages[constraint].overTargetMinutes : 0 } };
}

/** Render the measured window without substituting zero for absent quartiles or undocumented eligibility. */
export function flowWindowLines(window) {
  const time = value => value === null ? 'unmeasured' : `${Number(value.toFixed(2))} min`;
  return [`flow window: ${window.since} to ${window.until} · ${window.arrivals.added} added · ${window.landedItems} landed`,
    ...WINDOW_STAGES.flatMap(stage => {
      const row = window.stages[stage];
      return [`${LABELS[stage]}: ${row.count} measured · fast quarter ${time(row.fastQuarterMinutes)} · median ${time(row.medianMinutes)} · slow quarter ${time(row.slowQuarterMinutes)} · worst ${time(row.worstMinutes)} · ${row.unmeasuredCompleted} unmeasured`,
        `  ${row.arrivals} arrivals · ${row.completions} completions · seats ${row.seats.join(', ') || 'none observed'} · ${time(row.overTargetMinutes)} over ${time(row.targetMinutes)} target`,
        ...row.tail.map(item => `  #${item.id}: ${time(item.minutes)} · ${item.cause}${item.eligibility ? ' (eligibility unmeasured; check eligible reviewers)' : ''}`)];
    }),
    `constraint: ${window.constraint.stage ? LABELS[window.constraint.stage] : 'none measured over target'} · ${time(window.constraint.overTargetMinutes)} over target`];
}

/** Share exact validated window boundaries with line-capacity decisions. */
export function flowWindowBounds(minutes, now) {
  if (!(minutes > 0) || !Number.isFinite(minutes) || !Number.isFinite(new Date(now - minutes * MINUTE).getTime())) {
    throw new Refused('USAGE', 'use pullboard stats --window with a positive finite duration, for example --window 6h');
  }
  const since = now - minutes * MINUTE;
  return { since: new Date(since).toISOString(), until: new Date(now).toISOString(), durationMinutes: minutes };
}
