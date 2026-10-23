/** Parse one all-process POSIX census for the runner worker's cleanup checks [C7]. */
import { createHash } from 'node:crypto';

/**
 * Parse `ps -axo pid=,ppid=,pgid=,lstart=,stat=,comm=` output into rows keyed by pid.
 * A malformed census is never read as an empty machine, so any row it cannot trust returns null.
 * Rows with no process group (pgid 0) are skipped: Linux lists its kernel threads that way, and
 * they can never belong to a worker's process groups. Rejecting them made every census on a real
 * Linux host null, so runner cleanup could never be verified.
 *
 * @param {string} stdout - The census text.
 * @returns {Map<number, {pid:number, ppid:number, pgid:number, started:string, state:string, processSha256:string}>|null}
 */
export function parseProcessCensus(stdout) {
  const rows = new Map();
  for (const line of stdout.split(/\r?\n/u)) {
    if (!line.trim()) continue;
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+([A-Z][a-z]{2})\s+([A-Z][a-z]{2})\s+(\d{1,2})\s+(\d{2}:\d{2}:\d{2})\s+(\d{4})\s+(\S+)\s+(.+?)\s*$/u.exec(line);
    if (!match) return null;
    const pid = Number(match[1]);
    const ppid = Number(match[2]);
    const pgid = Number(match[3]);
    if (![pid, ppid, pgid].every(Number.isSafeInteger) || pid < 1 || ppid < 0 || pgid < 0 || rows.has(pid)) return null;
    if (pgid === 0) continue;
    const started = `${match[4]} ${match[5]} ${match[6]} ${match[7]} ${match[8]}`;
    const processSha256 = createHash('sha256').update(match[10]).digest('hex');
    rows.set(pid, { pid, ppid, pgid, started, state: match[9], processSha256 });
  }
  return rows.size ? rows : null;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Whether a census row's process started at the given moment, from a census read with TZ=UTC. The census gives
 * whole seconds, and a process starts at most a moment before the record of it, so the window is one second before
 * that second to three after, for a loaded host. Hosts hand out pids in order, so a reused pid cannot start inside it.
 *
 * @param {{started: string}} row - A row from parseProcessCensus.
 * @param {number} ms - When the job's own record says the process started, in epoch milliseconds.
 * @returns {boolean}
 */
export function bornNear(row, ms) {
  const match = /^[A-Z][a-z]{2} ([A-Z][a-z]{2}) (\d{1,2}) (\d{2}):(\d{2}):(\d{2}) (\d{4})$/u.exec(row?.started ?? '');
  const month = match ? MONTHS.indexOf(match[1]) : -1;
  if (month < 0 || !Number.isFinite(ms)) return false;
  const second = Date.UTC(Number(match[6]), month, Number(match[2]), Number(match[3]), Number(match[4]), Number(match[5]));
  return second - 1_000 <= ms && ms < second + 3_000;
}
