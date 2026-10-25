/** Client-local round-trip evidence; a relay HTTP health response never establishes sync health [H5,C2]. */
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  writeFileSync,
} from 'node:fs';
import {
  dirname,
  join,
} from 'node:path';
import { repoInfo } from './git.js';
import { Refused } from './refused.js';

const WINDOW_MS = 600000;
const STEPS = new Set(['sign-in', 'push', 'pull', 'unseal', 'version', 'complete']);

/** Keep observations outside native history and outside sealed snapshots. */
function healthFile(root) {
  return join(repoInfo(root).commonDir, 'pullboard', 'relay-health.sqlite');
}

/** Read one private telemetry record without creating a file for a status read. */
function historyAt(file) {
  if (!existsSync(file)) return null;
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const row = db.prepare('SELECT value FROM relay_health WHERE id=1').get();
    return row ? JSON.parse(row.value) : null;
  } finally { db.close(); }
}

/** Format only observations this client made, with a real locally queued move count. */
function projection(history, queued, now) {
  const last = history?.samples?.at(-1);
  const stale = !last || now - Date.parse(last.at) > 120000;
  const status = !last || stale ? 'unknown' : history.degradedSince ? 'degraded' : 'healthy';
  const since = history?.degradedSince ?? null;
  const time = since ? since.slice(11, 16) : '';
  const text = status === 'degraded'
    ? `relay degraded since ${time}; your moves are queued locally (${queued})`
    : status === 'healthy' ? `relay healthy; last sealed round trip ${Math.round(last.roundTripMs)} ms`
      : 'relay health unknown; no recent sealed round trip';
  return { status, since, lastAt: last?.at ?? null, roundTripMs: last?.roundTripMs ?? null,
    alertSince: history?.alertSince ?? null, pendingNotifications: history?.pendingNotices?.length ?? 0,
    relayVersion: last?.relayVersion ?? null, step: last?.step ?? null, code: last?.code ?? null,
    consecutiveFailures: history?.consecutiveFailures ?? 0, p95Ms: history?.p95Ms ?? null, queued, text };
}

/** A status read neither contacts the relay nor treats an old success as current health. */
export function readRelayHealth(root, { queued = 0, now = Date.now() } = {}) {
  return readRelayHealthFile(healthFile(root), { queued, now });
}

/** Read the same client-local record when the transport already knows its shared Git directory. */
export function readRelayHealthFile(file, { queued = 0, now = Date.now() } = {}) {
  if (!Number.isSafeInteger(queued) || queued < 0 || !Number.isFinite(now)) {
    throw new Refused('RELAY_HEALTH', 'read relay health with a nonnegative queued move count and a valid clock');
  }
  try { return projection(historyAt(file), queued, now); }
  catch { return projection(null, queued, now); }
}

/** Keep the durable record limited to safe protocol facts, never transport error messages or credentials. */
function sampleOf(result, now) {
  if (!result || typeof result.ok !== 'boolean' || !STEPS.has(result.step)
    || !Number.isFinite(result.roundTripMs) || result.roundTripMs < 0 || !Number.isFinite(now)
    || result.relayVersion !== null && result.relayVersion !== undefined && !Number.isSafeInteger(result.relayVersion)) {
    throw new Refused('RELAY_HEALTH', 'record a completed bounded relay probe with its failed step and elapsed time');
  }
  return { at: new Date(now).toISOString(), ok: result.ok, step: result.step,
    code: typeof result.code === 'string' && /^[A-Z][A-Z0-9_]{0,79}$/u.test(result.code) ? result.code : 'RELAY_CANARY_FAILURE',
    roundTripMs: result.roundTripMs, relayVersion: result.relayVersion ?? null };
}

/** Derive alerts from consecutive probes or a complete ten-minute latency window. */
function advance(previous, sample, now) {
  const history = previous ?? { version: 1, monitoringSince: sample.at, samples: [], consecutiveFailures: 0,
    degradedSince: null, alertSince: null, p95Ms: null };
  history.samples = history.samples.filter(entry => Date.parse(entry.at) >= now - WINDOW_MS && Date.parse(entry.at) <= now);
  history.samples.push(sample);
  history.samples = history.samples.slice(-128);
  history.consecutiveFailures = sample.ok ? 0 : history.consecutiveFailures + 1;
  const times = history.samples.filter(entry => entry.ok).map(entry => entry.roundTripMs).sort((a, b) => a - b);
  const windowReady = now - Date.parse(history.monitoringSince) >= WINDOW_MS && times.length >= 10;
  history.p95Ms = windowReady ? times[Math.max(0, Math.ceil(times.length * 0.95) - 1)] : null;
  const slow = history.p95Ms !== null && history.p95Ms > 2000;
  const wasAlert = Boolean(history.alertSince);
  if (!sample.ok || slow) history.degradedSince ??= sample.at;
  else history.degradedSince = null;
  if (history.consecutiveFailures >= 2 || slow) history.alertSince ??= history.degradedSince ?? sample.at;
  else if (sample.ok) history.alertSince = null;
  const transition = !wasAlert && history.alertSince ? 'alert' : wasAlert && !history.alertSince ? 'recovery' : null;
  const finding = history.alertSince ? { key: 'relay-canary', cause: 'RELAY_CANARY', item: null,
    subject: 'relay', title: 'sealed round trips are degraded', since: history.alertSince,
    why: slow ? `Ten-minute p95 is ${Math.round(history.p95Ms)} ms` : `Two consecutive probes failed at ${sample.step} (${sample.code})`,
    next: 'inspect pullboard relay canary; keep working locally while queued moves await the relay', owner: 'coordinator' } : null;
  if (transition) {
    history.pendingNotices ??= [];
    history.pendingNotices.push({ id: randomUUID(), kind: transition, at: sample.at, finding,
      step: sample.step, code: sample.code });
  }
  return { history, transition, finding };
}

/** Serialize local observations in a separate SQLite file; the real board and relay cursor are untouched. */
export function observeRelayHealth(root, result, options = {}) {
  return observeRelayHealthFile(healthFile(root), result, options);
}

/** Record a transport observation when its link path is already available, without rediscovering Git. */
export function observeRelayHealthFile(file, result, { now = Date.now(), alerts = true } = {}) {
  const sample = sampleOf(result, now);
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  try { writeFileSync(file, '', { flag: 'wx', mode: 0o600 }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  const db = new DatabaseSync(file);
  try {
    db.exec('PRAGMA busy_timeout=1000; CREATE TABLE IF NOT EXISTS relay_health(id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL); BEGIN IMMEDIATE');
    const saved = db.prepare('SELECT value FROM relay_health WHERE id=1').get();
    const previous = saved ? JSON.parse(saved.value) : null;
    const priorAlert = previous?.alertSince ?? null;
    const priorFailures = previous?.consecutiveFailures ?? 0;
    const priorNotices = structuredClone(previous?.pendingNotices ?? []);
    const updated = advance(previous, sample, now);
    // Ordinary client transport failures update status; only the configured canary raises monitor alerts.
    if (!alerts) {
      updated.transition = null; updated.finding = null;
      updated.history.alertSince = priorAlert;
      updated.history.consecutiveFailures = priorFailures;
      updated.history.pendingNotices = priorNotices;
    }
    db.prepare('INSERT INTO relay_health(id,value) VALUES (1,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value')
      .run(JSON.stringify(updated.history));
    db.exec('COMMIT');
    return { health: projection(updated.history, 0, now), transition: updated.transition, finding: updated.finding };
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch { /* A schema refusal may precede the transaction. */ }
    throw error;
  } finally { db.close(); }
}

/** Retry alert/recovery delivery after an outage; a local observation is never a remote receipt. */
export function pendingRelayCanaryNotices(root) {
  return historyAt(healthFile(root))?.pendingNotices ?? [];
}

/** Remove only a notice the normal native move recorded, including its ordinary offline outbox. */
export function markCanaryNoticeRecorded(root, id) {
  const db = new DatabaseSync(healthFile(root));
  try {
    db.exec('PRAGMA busy_timeout=1000; BEGIN IMMEDIATE');
    const row = db.prepare('SELECT value FROM relay_health WHERE id=1').get();
    if (row) {
      const history = JSON.parse(row.value);
      history.pendingNotices = (history.pendingNotices ?? []).filter(notice => notice.id !== id);
      db.prepare('UPDATE relay_health SET value=? WHERE id=1').run(JSON.stringify(history));
    }
    db.exec('COMMIT');
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch { /* Keep the original storage refusal. */ }
    throw error;
  } finally { db.close(); }
}

/** Claim one due minute atomically so multiple local views cannot run duplicate monitor ticks. */
export function claimRelayCanaryTick(root, now = Date.now()) {
  if (!Number.isFinite(now)) throw new Refused('RELAY_HEALTH', 'run the canary with a valid local clock');
  const file = healthFile(root);
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  try { writeFileSync(file, '', { flag: 'wx', mode: 0o600 }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  const db = new DatabaseSync(file);
  try {
    db.exec('PRAGMA busy_timeout=1000; CREATE TABLE IF NOT EXISTS canary_schedule(id INTEGER PRIMARY KEY CHECK(id=1), next_due REAL NOT NULL)');
    return db.prepare('INSERT INTO canary_schedule(id,next_due) VALUES (1,?) ON CONFLICT(id) DO UPDATE SET next_due=excluded.next_due WHERE canary_schedule.next_due<=?')
      .run(now + 60000, now).changes === 1;
  } finally { db.close(); }
}
