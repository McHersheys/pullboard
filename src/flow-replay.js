/** Deterministic scheduling of observed intervals; predictions are not measurements of an alternate live queue. */
import { Refused } from './refused.js';
import {
  replayHistory,
  replayObservations,
} from './flow-replay-history.js';

const MINUTE = 60_000;
const SETTINGS = { buildWip: 'build', reviewWip: 'review', landingWip: 'landing' };

/** Accept only hypothetical replay limits, never writing machine or board settings. */
function replayPolicy(input, observations) {
  const source = input ?? {};
  if (!source || typeof source !== 'object' || Array.isArray(source)
    || Object.keys(source).some(key => !['order', 'settings'].includes(key))) throw new Refused('USAGE', 'replay policy is an object with order and settings; read pullboard help flow');
  const order = source.order ?? 'recorded';
  if (order !== 'recorded' && (!Array.isArray(order) || order.some(id => !Number.isSafeInteger(id) || id < 1)
    || new Set(order).size !== order.length || order.some(id => !observations.items.some(item => item.id === id)))) {
    throw new Refused('USAGE', 'replay order is recorded or a list of distinct measured item ids');
  }
  const limits = source.settings ?? {};
  if (!limits || typeof limits !== 'object' || Array.isArray(limits)
    || Object.entries(limits).some(([key, value]) => !Object.hasOwn(SETTINGS, key) || !Number.isSafeInteger(value) || value < 1)) {
    throw new Refused('USAGE', 'replay settings accept positive buildWip, reviewWip and landingWip limits only');
  }
  const settings = Object.fromEntries(Object.entries(SETTINGS).map(([key, stage]) => [key, limits[key] ?? observations.stages[stage]]));
  const recorded = order === 'recorded' && Object.entries(SETTINGS).every(([key, stage]) => settings[key] === observations.stages[stage]);
  return { order, settings, recorded };
}

/** Match the existing flow window's quartile convention, retaining nulls when no interval is measured. */
function quartiles(values) {
  const sorted = [...values].sort((a, b) => a - b), count = sorted.length, middle = Math.floor(count / 2);
  return { count, fastQuarterMinutes: count ? sorted[Math.floor(count / 4)] : null,
    medianMinutes: count ? count % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2 : null,
    slowQuarterMinutes: count ? sorted[Math.min(count - 1, Math.floor(3 * count / 4))] : null,
    worstMinutes: count ? sorted.at(-1) : null };
}

/** Schedule each recorded attempt on its recorded seat; explicit order breaks ready-queue ties without preemption. */
function schedule(observations, policy) {
  const pending = new Map(observations.tasks.map(task => [task.id, task]));
  const completed = new Map(), running = [];
  const arrival = new Map(observations.items.map(item => [item.id, item.arrival]));
  const rank = new Map((Array.isArray(policy.order) ? policy.order : []).map((id, index) => [id, index]));
  const capacity = Object.fromEntries(Object.entries(SETTINGS).map(([key, stage]) => [stage, policy.settings[key]]));
  let now = observations.origin;
  /** A measured task starts after arrival, its prior stage and the seat's recorded availability. */
  const readyAt = task => Math.max(arrival.get(task.item), observations.resources.get(task.by).available,
    task.prior ? completed.get(task.prior.id)?.end ?? Infinity : -Infinity, policy.recorded ? task.start : -Infinity);
  /** Recorded decisions preserve their exact start constraints; counterfactual order selects among ready tasks. */
  const compare = (a, b) => policy.recorded ? a.start - b.start || a.id - b.id :
    (rank.get(a.item) ?? Infinity) - (rank.get(b.item) ?? Infinity) || arrival.get(a.item) - arrival.get(b.item) || a.item - b.item || a.id - b.id;
  while (pending.size || running.length) {
    for (let i = running.length - 1; i >= 0; i -= 1) {
      if (running[i].end <= now) { const row = running.splice(i, 1)[0]; completed.set(row.task.id, row); }
    }
    for (const task of [...pending.values()].sort(compare)) {
      if (readyAt(task) > now || running.filter(row => row.task.stage === task.stage).length >= capacity[task.stage]
        || running.filter(row => row.task.by === task.by).length >= observations.resources.get(task.by).capacity) continue;
      pending.delete(task.id);
      running.push({ task, start: now, end: now + task.duration });
    }
    if (!pending.size && !running.length) break;
    const next = Math.min(...running.map(row => row.end), ...[...pending.values()].map(readyAt).filter(at => at > now));
    if (!Number.isFinite(next)) throw new Refused('USAGE', 'replay history has an unschedulable dependency; export a complete lifecycle history');
    now = next;
  }
  return completed;
}

/** Reproduce complete recorded cycles or predict alternate scheduling with identical arrivals, seats and work intervals. */
export function replayFlow(events, inputPolicy) {
  const history = replayHistory(events), observations = replayObservations(history), policy = replayPolicy(inputPolicy, observations);
  const times = schedule(observations, policy);
  const items = observations.items.map(item => {
    const first = times.get(item.tasks[0].id), last = times.get(item.tasks.at(-1).id);
    const values = { build: 0, reviewWait: 0, review: 0, sendBackIdle: 0, mergeWait: 0 };
    for (const task of item.tasks) {
      const row = times.get(task.id), prior = task.prior && times.get(task.prior.id);
      if (task.stage === 'build') { values.build += task.duration / MINUTE; if (prior) values.sendBackIdle += (row.start - prior.end) / MINUTE; }
      if (task.stage === 'review') { values.review += task.duration / MINUTE; values.reviewWait += (row.start - prior.end) / MINUTE; }
      if (task.stage === 'landing') values.mergeWait += (row.end - prior.end) / MINUTE;
    }
    return { id: item.id, arrivalAt: new Date(item.arrival).toISOString(), claimAt: new Date(first.start).toISOString(),
      landedAt: new Date(last.end).toISOString(), cycleMinutes: (last.end - first.start) / MINUTE, stages: values };
  });
  const landingOrder = [...items].sort((a, b) => Date.parse(a.landedAt) - Date.parse(b.landedAt)
    || (policy.recorded ? observations.items.find(item => item.id === a.id).landedEvent - observations.items.find(item => item.id === b.id).landedEvent : 0) || a.id - b.id).map(item => item.id);
  const stages = Object.fromEntries(['build', 'reviewWait', 'review', 'sendBackIdle', 'mergeWait'].map(stage => [stage, quartiles(items.map(item => item.stages[stage]))]));
  return { history, replay: { mode: policy.recorded ? 'recorded' : 'predicted', policy: { order: policy.order, settings: policy.settings },
    items, landingOrder, stages, unmeasured: observations.unmeasured,
    assumptions: ['Recorded lifecycle intervals are retained, not interpreted as CPU time.',
      'Seat identities and their observed concurrency are fixed; WIP limits are hypothetical replay inputs only.',
      'Predicted queue times are not timings measured by running an alternate live policy.',
      'Incomplete or abandoned attempts remain unmeasured, never zero-duration work.'] } };
}
