/** Custody of a runner job's processes: who the job started, proven from its own record, and stopping them [C7]. */
import { spawnSync } from 'node:child_process';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  readSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import {
  delimiter,
  dirname,
  join,
} from 'node:path';
import { pathToFileURL } from 'node:url';
import { bornNear } from './process-census.js';
import { parseProcessCensus } from './process-census.js';

const safePath = [dirname(process.execPath), process.env.PATH || '/usr/local/bin:/usr/bin:/bin'].join(delimiter);

/** Read one all-process POSIX census; a failed or malformed census is never interpreted as an empty machine. */
export function processCensus() {
  const result = spawnSync('/bin/ps', ['-axo', 'pid=,ppid=,pgid=,lstart=,stat=,comm='], {
    encoding: 'utf8', timeout: 2_000, maxBuffer: 8 * 1024 * 1024,
    env: { PATH: safePath, LANG: 'C', LC_ALL: 'C', TZ: 'UTC' },
  });
  if (result.error || result.status !== 0 || typeof result.stdout !== 'string') return null;
  return parseProcessCensus(result.stdout);
}

/** Add a kernel start-time identity when procfs is available; otherwise retain a conservative census tuple. */
export function processIdentity(row) {
  let birth = '';
  let exact = false;
  try {
    const stat = readFileSync(`/proc/${row.pid}/stat`, 'utf8');
    const close = stat.lastIndexOf(')');
    const fields = stat.slice(close + 2).trim().split(/\s+/u);
    if (close > 0 && Number(fields[1]) === row.ppid && Number(fields[2]) === row.pgid && /^\d+$/u.test(fields[19] ?? '')) {
      birth = `proc:${fields[19]}`;
      exact = true;
    }
  } catch { /* macOS and other POSIX hosts use the validated census tuple below. */ }
  if (!birth) birth = `ps:${row.started}`;
  return { ...row, birth, exact };
}

/** Make a private Node preload that records only child identity and a one-way command digest. */
function writeChildJournalPreload(directory) {
  const journalDirectory = join(directory, 'child-journal');
  mkdirSync(journalDirectory, { mode: 0o700 });
  const overflowPath = join(journalDirectory, 'overflow');
  const source = `
import diagnostics from 'node:diagnostics_channel';
import { closeSync, openSync, statSync, writeSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
const directory = ${JSON.stringify(journalDirectory)};
const overflowPath = ${JSON.stringify(overflowPath)};
const instance = randomUUID();
process.env.PULLBOARD_RUNNER_INSTANCE = instance;
const file = join(directory, 'children-' + process.pid + '.jsonl');
const fd = openSync(file, 'a', 0o600);
let bytes = statSync(file).size;
let overflow = false;
const limit = 131072;
function record(value) {
  if (overflow) return;
  try {
    const line = JSON.stringify(value) + '\\n';
    const size = Buffer.byteLength(line);
    if (bytes + size > limit) {
      overflow = true;
      try { writeFileSync(overflowPath, 'journal limit reached\\n', { flag: 'wx', mode: 0o600 }); } catch {}
      return;
    }
    writeSync(fd, line);
    bytes += size;
  } catch {
    try { writeFileSync(overflowPath, 'journal write failed\\n', { flag: 'wx', mode: 0o600 }); } catch {}
    overflow = true;
  }
}
record({ type: 'boot', pid: process.pid, ppid: process.ppid, instance, started: Math.round(performance.timeOrigin) });
const channel = diagnostics.channel('child_process');
const seen = new WeakSet();
channel.subscribe(message => {
  try {
    const child = message?.process;
    if (!child || typeof child.once !== 'function' || seen.has(child)) return;
    seen.add(child);
    const writeReceipt = () => {
      if (!Number.isSafeInteger(child.pid) || child.pid < 1) return;
      const commandSha256 = createHash('sha256').update(JSON.stringify({ command: child.spawnfile ?? '', args: child.spawnargs ?? [] })).digest('hex');
      record({ type: 'spawn', pid: child.pid, ppid: process.pid, instance, commandSha256, at: Date.now() });
    };
    if (Number.isSafeInteger(child.pid)) writeReceipt();
    else child.once('spawn', writeReceipt);
  } catch {
    try { writeFileSync(overflowPath, 'child receipt could not be recorded\\n', { flag: 'wx', mode: 0o600 }); } catch {}
  }
});
process.once('exit', () => { try { closeSync(fd); } catch {} });
`;
  const preload = join(directory, 'child-spawn-preload.mjs');
  writeFileSync(preload, source, { mode: 0o600, flag: 'wx' });
  return { preload, journalDirectory, overflowPath, nodeOptions: `--import=${pathToFileURL(preload).href}` };
}

/**
 * Track job descendants by PID plus OS start identity, joining spawn receipts with fresh census rows. The hooks
 * default to this host; a test passes a scripted census and a recording kill (#1063).
 *
 * @param {string} directory - The job's private run directory, where the child journal lives.
 * @param {{ census?: () => Map<number, object>|null, kill?: (pid: number, signal: string|number) => void, selfPid?: number,
 *   tick?: () => void, timedOut?: () => boolean, warn?: (reason: string) => void, intervalMs?: number }} [hooks]
 */
export function createDescendantTracker(directory, { census: processCensusHook = processCensus, kill = (pid, signal) => process.kill(pid, signal),
  selfPid = process.pid, tick = () => {}, timedOut = () => false, warn = () => {}, intervalMs = 250 } = {}) {
  const initial = processCensusHook();
  if (!initial) throw new Error('initial process identity census failed');
  const baseline = new Map([...initial].map(([pid, row]) => [pid, processIdentity(row)]));
  const journal = writeChildJournalPreload(directory);
  const roots = new Set();
  const rootLaunchIdentities = new Map();
  const known = new Map();
  const retired = new Set();
  const eventsByChild = new Map();
  const pendingIdentities = new Map();
  const consumedEvents = new Set();
  let eventCount = 0;
  const detachedGroups = new Map();
  const offsets = new Map();
  const partial = new Map();
  const instancePids = new Map();
  // Each job Node process's own boot record: its pid and start time, written into this job's private journal.
  const boots = new Map();
  const overflowPath = journal.overflowPath;
  let current = baseline;
  let uncertain = false;
  let censusFailure = false;
  let reason = '';
  let uncertainReason = '';
  let busy = false;
  let warned = false;
  let timer = null;
  let stoppingPromise = null;

  /** Keep permanent custody failures distinct from earlier, potentially resolved pending observations. */
  function markUncertain(message) {
    uncertain = true;
    uncertainReason ||= message;
    reason ||= message;
  }

  /**
   * Take custody of a live process proven to be this job's. A group lives inside one session, and a session holds
   * only descendants of the job process that made it, so while that process lives its group is the job's too: record
   * the group with its leader's start time. A group whose leader is already gone has no start time to check a reused
   * number against, so it gets no custody; nor does a group led by a process that was here before the job (#1063).
   * `byGroup` marks a process whose only proof is its group, which never proves the group in turn.
   */
  function adopt(row, commandSha256, ownedPids, byGroup = false) {
    known.set(row.pid, { ...row, commandSha256, root: false, group: row.pgid, ...(byGroup ? { byGroup: true } : {}) });
    const leader = current.get(row.pgid);
    const foreign = leader && baseline.get(row.pgid)?.birth === leader.birth;
    if (!detachedGroups.has(row.pgid) && leader && !foreign && !/^Z/u.test(leader.state)) detachedGroups.set(row.pgid, leader.birth);
    pendingIdentities.delete(row.pid);
    ownedPids.add(row.pid);
  }

  /**
   * Whether this census still proves group `pgid` is the job's: its recorded leader is alive with its recorded start
   * time, or a member proven by its own receipt, boot record or ancestry is. Group membership alone proves nothing.
   */
  function groupProven(pgid) {
    const leaderStarted = detachedGroups.get(pgid);
    for (const row of current.values()) {
      if (row.pgid !== pgid || /^Z/u.test(row.state)) continue;
      if (row.pid === pgid && leaderStarted && row.birth === leaderStarted) return true;
      const identity = known.get(row.pid);
      if (identity && !identity.byGroup && identity.birth === row.birth && !retired.has(`${row.pid}:${row.birth}`)) return true;
    }
    return false;
  }

  function readJournal() {
    if (existsSync(overflowPath)) { markUncertain('child spawn journal overflow or write failure'); }
    let total = 0;
    const files = readdirSync(journal.journalDirectory).filter(name => /^children-\d+\.jsonl$/u.test(name)).sort();
    // A full suite creates one journal per Node process; align this count with
    // the event and identity bounds while retaining the byte bounds below.
    if (files.length > 100_000) { markUncertain('child spawn journal file limit exceeded'); return; }
    for (const name of files) {
      const file = join(journal.journalDirectory, name);
      let size;
      try { size = statSync(file).size; } catch { markUncertain('child spawn journal could not be inspected'); continue; }
      total += size;
      if (!Number.isSafeInteger(size) || size > 131_072 || total > 8 * 1024 * 1024) {
        markUncertain('child spawn journal size limit exceeded'); continue;
      }
      const offset = offsets.get(name) ?? 0;
      if (size < offset) { markUncertain('child spawn journal changed unexpectedly'); continue; }
      if (size === offset) continue;
      const length = size - offset;
      const fd = openSync(file, 'r');
      let text;
      try {
        const bytes = Buffer.alloc(length);
        const read = readSync(fd, bytes, 0, length, offset);
        if (read !== length) { markUncertain('child spawn journal read was incomplete'); continue; }
        text = (partial.get(name) ?? '') + bytes.toString('utf8');
      } finally { closeSync(fd); }
      offsets.set(name, size);
      const lines = text.split('\n');
      partial.set(name, lines.pop() ?? '');
      for (const line of lines) {
        if (!line) continue;
        if (line.length > 4_096) { markUncertain('child spawn journal record is oversized'); continue; }
        let record;
        try { record = JSON.parse(line); } catch { markUncertain('child spawn journal record is invalid'); continue; }
        if (record.type === 'boot' && Number.isSafeInteger(record.pid) && record.pid > 0 && typeof record.instance === 'string') {
          instancePids.set(record.instance, record.pid);
          // A boot record without its start time still binds receipts; it only proves nothing by itself.
          if (Number.isFinite(record.started)) boots.set(record.pid, [...(boots.get(record.pid) ?? []), record.started].slice(-4));
        } else if (record.type === 'spawn' && Number.isSafeInteger(record.pid) && record.pid > 0
          && Number.isSafeInteger(record.ppid) && record.ppid > 0
          && typeof record.instance === 'string' && /^[a-f0-9]{64}$/u.test(record.commandSha256)) {
          const childEvents = eventsByChild.get(record.pid) ?? [];
          eventCount += 1;
          childEvents.push({ ...record, eventId: `${name}:${eventCount}` });
          eventsByChild.set(record.pid, childEvents);
          if (eventCount > 100_000) { markUncertain('child spawn journal event limit exceeded'); return; }
        } else { markUncertain('child spawn journal identity is invalid'); }
      }
    }
  }

  function observe() {
    if (busy) return current;
    busy = true;
    try {
      readJournal();
      const rawCensus = processCensusHook();
      if (!rawCensus) { censusFailure = true; return null; }
      censusFailure = false;
      const census = new Map([...rawCensus].map(([pid, row]) => [pid, processIdentity(row)]));
      current = census;
      // A process first seen without its recorded parent stays unowned while alive.
      // Once a later census proves that exact birth identity gone, retire its receipts
      // so a reused PID cannot be adopted from stale launch evidence.
      for (const [pid, pending] of pendingIdentities) {
        const row = current.get(pid);
        if (row?.birth === pending.birth && !/^Z/u.test(row.state)) continue;
        for (const eventId of pending.eventIds) consumedEvents.add(eventId);
        pendingIdentities.delete(pid);
      }
      for (const [pid, identity] of known) {
        const row = current.get(pid);
        if (!row || row.birth !== identity.birth) retired.add(`${pid}:${identity.birth}`);
        else if (retired.has(`${pid}:${identity.birth}`)) {
          markUncertain('a previously observed process identity reappeared');
        }
      }
      const ownedPids = new Set();
      for (const pid of roots) {
        const row = current.get(pid);
        if (!row) continue;
        const prior = known.get(pid);
        const launched = rootLaunchIdentities.get(pid);
        if (prior && prior.birth !== row.birth) continue;
        if (launched && launched.birth !== row.birth) continue;
        if (!launched && row.ppid !== selfPid) continue;
        if (!launched && row.pgid !== pid) continue;
        if (retired.has(`${pid}:${row.birth}`)) { markUncertain('a retired process identity reappeared'); continue; }
        if (!launched) rootLaunchIdentities.set(pid, row);
        known.set(pid, { ...row, commandSha256: prior?.commandSha256 ?? '', root: true, group: pid });
        if (!detachedGroups.has(pid)) detachedGroups.set(pid, row.birth);
        ownedPids.add(pid);
      }
      // Every identity the job already proved stays owned while it lives, even after its parent exits (#1063).
      for (const [pid, identity] of known) {
        const row = current.get(pid);
        if (row && row.birth === identity.birth && !/^Z/u.test(row.state) && !retired.has(`${pid}:${row.birth}`)) ownedPids.add(pid);
      }

      for (const row of current.values()) {
        if (/^Z/u.test(row.state)) continue;
        for (const event of eventsByChild.get(row.pid) ?? []) {
          if (consumedEvents.has(event.eventId)) continue;
          const parentPid = instancePids.get(event.instance);
          // A preload instance exists only in the private job environment. The receipt
          // binds its child to that exact process instance even after the parent exits.
          if (!parentPid || parentPid !== event.ppid) continue;
          const prior = known.get(row.pid);
          if (retired.has(`${row.pid}:${row.birth}`)) { markUncertain('a retired process identity reappeared'); continue; }
          if (prior && prior.birth === row.birth) { consumedEvents.add(event.eventId); ownedPids.add(row.pid); continue; }
          if (!prior && baseline.get(row.pid)?.birth === row.birth) { consumedEvents.add(event.eventId); continue; }
          // The receipt and the census both carry a start time. A process born when a job process spawned it is that
          // child, even if its parent exited before any census saw the two together; a reused pid starts later (#1063).
          if ((row.ppid !== event.ppid || !ownedPids.has(event.ppid)) && bornNear(row, event.at)) {
            adopt(row, event.commandSha256, ownedPids);
            consumedEvents.add(event.eventId);
            continue;
          }
          // A spawn receipt must be observed while its exact parent instance still owns it.
          // A same-numbered PID first seen after reparenting is ambiguous and never adopted.
          if (row.ppid !== event.ppid) {
            const pending = pendingIdentities.get(row.pid);
            if (!pending || pending.birth !== row.birth) pendingIdentities.set(row.pid, { birth: row.birth, eventIds: new Set() });
            pendingIdentities.get(row.pid).eventIds.add(event.eventId);
            consumedEvents.add(event.eventId);
            reason ||= 'spawned process was first observed after reparenting';
            continue;
          }
          if (!ownedPids.has(event.ppid)) {
            pendingIdentities.set(row.pid, { birth: row.birth, eventIds: new Set([event.eventId]) });
            consumedEvents.add(event.eventId);
            reason ||= 'spawn receipt parent has not been independently identified';
            continue;
          }
          const parent = known.get(event.ppid);
          const inheritedGroup = parent?.group ?? [...roots].find(rootPid => known.get(rootPid)?.group === row.pgid);
          const group = row.pgid === row.pid ? row.pid : inheritedGroup;
          if (group === undefined) {
            pendingIdentities.set(row.pid, { birth: row.birth, eventIds: new Set([event.eventId]) });
            consumedEvents.add(event.eventId);
            reason ||= 'spawned process group has no owned parent';
            continue;
          }
          if (row.pgid === row.pid) detachedGroups.set(row.pid, row.birth);
          known.set(row.pid, { ...row, commandSha256: event.commandSha256, root: false, group });
          consumedEvents.add(event.eventId);
          pendingIdentities.delete(row.pid);
          ownedPids.add(row.pid);
        }
      }

      // A Node process that wrote its own boot record into this job's private journal is the job's, once the
      // census shows it born when it said it was (#1063).
      for (const [pid, starts] of boots) {
        const row = current.get(pid);
        if (!row || /^Z/u.test(row.state) || ownedPids.has(pid) || retired.has(`${pid}:${row.birth}`)) continue;
        if (baseline.get(pid)?.birth === row.birth) continue;
        if (known.get(pid)?.birth === row.birth) ownedPids.add(pid);
        else if (starts.some(started => bornNear(row, started))) adopt(row, '', ownedPids);
      }

      // Process ancestry captures non-Node children; journal receipts retain ownership after reparenting.
      let changed = true;
      while (changed) {
        changed = false;
        for (const row of current.values()) {
          if (!ownedPids.has(row.ppid)) continue;
          const prior = known.get(row.pid);
          if (retired.has(`${row.pid}:${row.birth}`)) { markUncertain('a retired process identity reappeared'); continue; }
          if (prior && prior.birth === row.birth) { ownedPids.add(row.pid); continue; }
          if (!prior && baseline.get(row.pid)?.birth === row.birth) continue;
          const parent = known.get(row.ppid);
          const group = row.pgid === row.pid ? row.pid : parent?.group;
          if (group === undefined) {
            pendingIdentities.set(row.pid, { birth: row.birth, eventIds: new Set() });
            reason ||= 'descendant process group has no owned parent';
            continue;
          }
          if (row.pgid === row.pid) detachedGroups.set(row.pid, row.birth);
          known.set(row.pid, { ...row, commandSha256: '', root: false, group });
          pendingIdentities.delete(row.pid);
          ownedPids.add(row.pid); changed = true;
        }
      }
      // Every member of a group the job owns is the job's (see adopt), so census each one even after its launcher
      // exited, but only while this census still proves the group (groupProven). The kernel reuses a leader's number
      // for a new group only once the old group is gone, so a reused leader ends custody; a self-proven member still
      // inside it would contradict that, and stays uncertain. Custody that cannot be proven is dropped, never used:
      // its group-only members turn unidentified, cleanup cannot verify, and the controller reruns locally (#1063).
      for (const [pgid, leaderStarted] of detachedGroups) {
        const leader = current.get(pgid);
        const reused = leader && leader.birth !== leaderStarted;
        if (reused && [...current.values()].some(row => row.pgid === pgid && row.pid !== pgid && !/^Z/u.test(row.state)
          && !known.get(row.pid)?.byGroup && known.get(row.pid)?.birth === row.birth)) {
          markUncertain('detached process group identity was reused');
        }
        if (!reused && groupProven(pgid)) continue;
        detachedGroups.delete(pgid);
        for (const row of current.values()) {
          const identity = known.get(row.pid);
          if (row.pgid !== pgid || !identity?.byGroup || identity.birth !== row.birth || /^Z/u.test(row.state)) continue;
          known.delete(row.pid);
          ownedPids.delete(row.pid);
          pendingIdentities.set(row.pid, { birth: row.birth, eventIds: new Set() });
          reason ||= 'process group custody could not be proven';
        }
      }
      for (const row of current.values()) {
        if (/^Z/u.test(row.state) || !detachedGroups.has(row.pgid)) continue;
        const prior = known.get(row.pid);
        if (retired.has(`${row.pid}:${row.birth}`)) { markUncertain('a retired process identity reappeared'); continue; }
        if (prior && prior.birth === row.birth) { ownedPids.add(row.pid); continue; }
        if (baseline.get(row.pid)?.birth === row.birth) continue;
        adopt(row, '', ownedPids, true);
      }
      // A recorded PGID does not prove an unseen member belongs to this job. Keep
      // the lease fail-closed when a root group contains a process lacking identity evidence.
      for (const rootPid of roots) {
        for (const row of current.values()) {
          if (row.pgid !== rootPid || /^Z/u.test(row.state)) continue;
          const identity = known.get(row.pid);
          if (identity?.birth === row.birth) continue;
          if (baseline.get(row.pid)?.birth === row.birth) continue;
          pendingIdentities.set(row.pid, { birth: row.birth, eventIds: new Set() });
          reason ||= 'owned process group contains an unidentified member';
        }
      }
      if (known.size > 100_000) { markUncertain('owned process identity limit exceeded'); }
      // Refresh live PGID/start data only when the PID still has the same start identity.
      for (const pid of ownedPids) {
        const row = current.get(pid);
        const prior = known.get(pid);
        if (!row || prior?.birth !== row.birth) continue;
        Object.assign(prior, row);
        // A detached child is forked into its parent's group and calls setsid a moment later. A census in that window
        // records the parent's group; once this proven identity leads its own group, track that group instead (#888).
        if (!prior.root && row.pgid === row.pid && prior.group !== row.pid) {
          prior.group = row.pid;
          detachedGroups.set(row.pid, row.birth);
        }
      }
      return current;
    } catch {
      censusFailure = true; return null;
    } finally { busy = false; }
  }

  function registerRoot(pid) {
    if (!Number.isSafeInteger(pid) || pid < 1) return;
    roots.add(pid);
    // Bind the spawned leader while its actual parent is still this worker; later
    // group membership alone is never sufficient to adopt an unknown process.
    const census = processCensusHook();
    const row = census?.get(pid);
    if (row && row.ppid === selfPid && row.pgid === pid) rootLaunchIdentities.set(pid, processIdentity(row));
  }

  function liveDescendants() {
    const active = [];
    for (const [pid, identity] of known) {
      if (identity.root) continue;
      const row = current.get(pid);
      if (row && row.birth === identity.birth && !retired.has(`${pid}:${identity.birth}`) && !/^Z/u.test(row.state)) active.push({ ...identity });
    }
    return active;
  }

  function signalOwnedGroup(pgid, signal) {
    const census = observe();
    tick();
    if (!census || censusFailure) return null;
    // A journal error does not revoke known ownership, but an unidentified live
    // member prevents signaling the whole group until its identity is resolved.
    if ([...pendingIdentities].some(([pid, identity]) => {
      const row = current.get(pid);
      return row?.pgid === pgid && row.birth === identity.birth && !/^Z/u.test(row.state);
    })) return null;
    // Signal a whole group only while this census proves it is still the job's, never on recorded custody (#1063).
    if (!groupProven(pgid)) return false;
    try { kill(-pgid, signal); }
    catch (error) {
      if (error.code === 'ESRCH') return false;
      // macOS answers EPERM for a group whose members exited but are not yet reaped. Throwing here escaped cleanup and
      // skipped the lease release (#888, and the load flake in #850); retry on a fresh census instead, and say so.
      if (error.code === 'EPERM') {
        process.stderr.write(`runner: signal to process group ${pgid} answered EPERM; its members have exited, so the next census decides\n`);
        return null;
      }
      throw error;
    }
    return true;
  }

  async function stopDescendantsLoop() {
    // Retry through ambiguous censuses rather than releasing the host lease on an unproven drain.
    for (;;) {
      const census = observe();
      tick();
      if (!census) {
        if (!warned) { warn(reason); warned = true; }
        await new Promise(resolvePause => setTimeout(resolvePause, 1_000));
        continue;
      }
      if (censusFailure) { await new Promise(resolvePause => setTimeout(resolvePause, 250)); continue; }
      const live = liveDescendants();
      if (!live.length && !pendingIdentities.size && (!uncertain || timedOut())) return;
      if ((pendingIdentities.size || uncertain) && !warned) {
        warn(reason || 'unresolved process identity remains live');
        warned = true;
      }
      if (!live.length) { await new Promise(resolvePause => setTimeout(resolvePause, 250)); continue; }
      // Signal each confirmed owned process group once; use PID signals only with exact kernel identity.
      const signaledGroups = new Set();
      for (const identity of live) {
        const row = current.get(identity.pid);
        if (!row || row.birth !== identity.birth || retired.has(`${identity.pid}:${identity.birth}`) || /^Z/u.test(row.state)) continue;
        const ownedGroup = identity.group;
        if (Number.isSafeInteger(ownedGroup) && row.pgid === ownedGroup && !signaledGroups.has(ownedGroup)) {
          const result = signalOwnedGroup(ownedGroup, 'SIGTERM');
          if (result === null) { censusFailure = true; break; }
          if (result) signaledGroups.add(ownedGroup);
          continue;
        }
        if (!identity.exact) { markUncertain('descendant lacks a safe process-group identity'); break; }
        try { kill(identity.pid, 'SIGTERM'); }
        catch (error) { if (error.code !== 'ESRCH') { markUncertain('owned descendant could not be stopped safely'); } }
      }
      const deadline = Date.now() + 2_000;
      while (Date.now() < deadline) {
        await new Promise(resolvePause => setTimeout(resolvePause, 50));
        if (!observe()) break;
        if (!liveDescendants().length) break;
      }
      if (!current || !liveDescendants().length) continue;
      const killedGroups = new Set();
      for (const identity of liveDescendants()) {
        const row = current.get(identity.pid);
        if (!row || row.birth !== identity.birth || retired.has(`${identity.pid}:${identity.birth}`) || /^Z/u.test(row.state)) continue;
        const ownedGroup = identity.group;
        if (Number.isSafeInteger(ownedGroup) && row.pgid === ownedGroup && !killedGroups.has(ownedGroup)) {
          const result = signalOwnedGroup(ownedGroup, 'SIGKILL');
          if (result === null) { censusFailure = true; break; }
          if (result) killedGroups.add(ownedGroup);
          continue;
        }
        if (!identity.exact) { markUncertain('descendant lacks a safe process-group identity'); break; }
        try { kill(identity.pid, 'SIGKILL'); }
        catch (error) { if (error.code !== 'ESRCH') { markUncertain('owned descendant could not be killed safely'); } }
      }
      await new Promise(resolvePause => setTimeout(resolvePause, 100));
    }
  }

  function stopDescendants() {
    if (!stoppingPromise) {
      stoppingPromise = stopDescendantsLoop().finally(() => { stoppingPromise = null; });
    }
    return stoppingPromise;
  }

  async function verifyAfterGroups() {
    for (;;) {
      const census = observe();
      tick();
      if (census && (!uncertain || timedOut()) && !censusFailure) {
        const liveRoots = [...roots].some(pid => {
          const row = current.get(pid);
          const knownRoot = known.get(pid);
          return row && knownRoot?.birth === row.birth && !/^Z/u.test(row.state);
        });
        if (!liveRoots && !liveDescendants().length && !pendingIdentities.size) return;
      }
      if (!warned) { warn(reason || 'owned process identity remains live'); warned = true; }
      await new Promise(resolvePause => setTimeout(resolvePause, 1_000));
    }
  }

  timer = setInterval(() => { if (!busy) observe(); }, intervalMs);
  timer.unref();
  return {
    nodeOptions: journal.nodeOptions,
    /** Describe the last observed cleanup state without treating it as a fresh ownership proof. */
    cleanupState() {
      return { reason: uncertainReason || reason, uncertain, censusFailure, knownCount: known.size,
        pending: [...pendingIdentities].slice(0, 16).map(([pid, identity]) => ({ pid, birth: identity.birth })),
        live: liveDescendants().slice(0, 16).map(({ pid, birth, group }) => ({ pid, birth, group })) };
    },
    registerRoot,
    /** Take one census now; a test drives custody through it. */
    observe,
    stopDescendants,
    /** Revalidate a process group immediately before signaling; null means census ambiguity. */
    signalOwnedGroup,
    verifyAfterGroups,
    stopMonitoring() { clearInterval(timer); },
  };
}
