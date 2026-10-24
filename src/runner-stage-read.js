/** Read a privacy-safe runner capacity snapshot for one explicit stats window [C7,O5]. */
import { retainedReceipts } from './gate-receipt.js';
import { localRunnerDescriptor } from './runner-load.js';
import {
  listResources,
  runnerResourceStatus,
} from './resources.js';
import { loadMachineSettings } from './settings.js';
import { runnerStage } from './runner-stage.js';

const PLATFORMS = new Set(['aix', 'android', 'darwin', 'freebsd', 'linux', 'openbsd', 'sunos', 'win32']);

/** Return a platform only when an actual structured executor receipt reports a recognized OS. */
function reportedPlatform(receipts, id) {
  return receipts.filter(receipt => receipt.runner?.id === id)
    .sort((left, right) => Date.parse(right.finishedAt) - Date.parse(left.finishedAt))
    .map(receipt => receipt.runner?.capabilities?.os)
    .find(platform => typeof platform === 'string' && PLATFORMS.has(platform)) ?? null;
}

/** Build current descriptors from validated settings and the live admission databases. */
function currentRunners(settings, receipts) {
  const machineResources = listResources({ scope: 'machine' });
  const gate = machineResources.find(resource => resource.name === 'gate');
  const browserPool = machineResources.find(resource => resource.name === 'browser');
  const localCapacity = gate?.capacity ?? settings.gateSlots;
  const browserCapacity = browserPool?.capacity ?? settings.browserSlots;
  const local = localRunnerDescriptor(localCapacity, browserCapacity > 0);
  const gateHolders = gate?.holders ?? [];
  local.active = gateHolders.some(holder => holder.timing) ? localCapacity
    : gateHolders.filter(holder => holder.slot !== 'short').length;
  local.browserSlots = browserCapacity;
  local.browserActive = gateHolders.filter(holder => holder.browser).length;
  const remotes = runnerResourceStatus(settings.runners ?? []).map(runner => ({
    id: runner.host,
    kind: runner.kind ?? 'ssh',
    slots: { current: runner.slots, limit: runner.slots, elastic: false },
    capabilities: { os: reportedPlatform(receipts, runner.host), browser: runner.browser > 0 },
    active: runner.holders.some(holder => holder.timing === 1) ? runner.slots : runner.inUse,
    browserSlots: runner.browser,
    browserActive: runner.browserInUse,
    ...(runner.unavailable ? { unavailable: true } : {}),
    ...(runner.draining ? { draining: true } : {}),
  }));
  return [local, ...remotes];
}

/** Read retained physical-run receipts and live capacity for exactly `[from,to)`. */
export function readRunnerStage(root, { from, to }) {
  const receipts = retainedReceipts(root, { from, to });
  const settings = loadMachineSettings();
  const runners = currentRunners(settings, receipts);
  return runnerStage(runners, receipts, { from, to });
}
