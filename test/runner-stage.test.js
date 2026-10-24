/** The requested stats window reports measured runner capacity from private Git/SQLite state [C7,O5]. */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import * as store from '../src/board.js';
import { main } from '../src/cli.js';
import { localRunnerDescriptor } from '../src/runner-load.js';
import { recordReceipt } from '../src/gate-receipt.js';
import * as runnerApi from '../src/runners.js';
import { runFixtureGit } from './fixture-child.js';

/** Capture the actual CLI response while supplying a deterministic observation clock. */
async function run(root, args, clock) {
  let stdout = '';
  let stderr = '';
  const code = await main(args, { cwd: root, clock,
    stdout: { isTTY: false, write: text => { stdout += text; } },
    stderr: { write: text => { stderr += text; } } });
  return { code, stdout, stderr, data: args.includes('--json') ? JSON.parse(stdout) : null };
}

test('[C7,O5] stats --window includes measured runner capacity and slot-wait quartiles from private receipts', async t => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'pullboard-runner-stage-')));
  const machineHome = join(root, 'machine');
  t.after(() => rmSync(root, { recursive: true, force: true }));
  runFixtureGit(['init', '-q', '-b', 'main'], { cwd: root, stdio: 'pipe' });
  writeFileSync(join(root, 'pullboard.json'), JSON.stringify({ lanes: { web: { owns: ['web/'] } } }));
  const now = Date.parse('2026-10-24T12:00:00.000Z');
  const board = store.openBoard(join(root, '.git', 'pullboard', 'board.sqlite'), { now: () => new Date(now) });
  t.after(() => store.closeBoard(board));

  const priorMachineHome = process.env.PULLBOARD_MACHINE_HOME;
  process.env.PULLBOARD_MACHINE_HOME = machineHome;
  try {
    mkdirSync(machineHome, { recursive: true });
    writeFileSync(join(machineHome, 'settings.json'), JSON.stringify({ gateSlots: 2, browserSlots: 1 }));
    const runner = { ...localRunnerDescriptor(2, true), active: 0 };
    const admittedAt = new Date(now - 10_000).toISOString();
    const finishedAt = new Date(now - 9_000).toISOString();
    recordReceipt(root, { at: finishedAt, kind: 'check', waitMs: 50, runMs: 500,
      admissionMs: 1, setupMs: 2, evidenceMs: 3, slot: { kind: 'ordinary' },
      runner, admittedAt, finishedAt, timing: false, inherited: false, occupiedSlots: 1,
      exclusive: false, unfencedClients: [] });

    const output = await run(root, ['stats', '--window', '1h', '--json'], { now: () => new Date(now) });
    assert.equal(output.code, 0, output.stderr);
    const capacity = output.data.window.executionCapacity;
    const local = capacity.runners.find(row => row.id === runner.id);
    assert.ok(local, 'the real machine resource snapshot includes the local executor');
    assert.equal(local.runsServed, 1);
    assert.ok(local.busyShare > 0 && local.busyShare < 1, 'the structured run occupies only its measured part of the requested window');
    assert.deepEqual(capacity.slotWait, { fastQuarterMs: 50, medianMs: 50, slowQuarterMs: 50, worstMs: 50, count: 1 });
    const text = await run(root, ['stats', '--window', '1h'], { now: () => new Date(now) });
    assert.equal(text.code, 0, text.stderr);
    assert.match(text.stdout, /runner slot waits: fast 0\.05s · median 0\.05s · slow 0\.05s · worst 0\.05s \(1 measured\)/u);
  } finally {
    if (priorMachineHome === undefined) delete process.env.PULLBOARD_MACHINE_HOME;
    else process.env.PULLBOARD_MACHINE_HOME = priorMachineHome;
  }
});


test('[C7,O5] browser work waits when ordinary slots are free but browser slots are full', () => {
  const window = { from: '2026-10-24T11:00:00.000Z', to: '2026-10-24T12:00:00.000Z' };
  const stage = runnerApi.runnerStage([{
    id: 'local:test', kind: 'local', slots: { current: 2, limit: 2, elastic: false },
    capabilities: { os: 'darwin', browser: true }, active: 1, browserSlots: 1, browserActive: 1,
  }], [], window);
  assert.deepEqual(runnerApi.placeRunner(stage, { capabilities: { browser: true } }), { action: 'wait' });
  assert.deepEqual(runnerApi.placeRunner(stage, { capabilities: { browser: false } }), { action: 'run', runnerId: 'local:test' });

  const unknownBrowserUse = runnerApi.runnerStage([{
    id: 'local:unknown-browser-use', kind: 'local', slots: { current: 2, limit: 2, elastic: false },
    capabilities: { os: 'darwin', browser: true }, active: 1,
  }], [], window);
  assert.deepEqual(runnerApi.placeRunner(unknownBrowserUse, { capabilities: { browser: true } }), { action: 'wait' });
});


test('[C7,O5] legacy receipt timestamps leave runner shares and counts unknown', () => {
  const runners = ['local:a', 'ssh:b'].map((id, index) => ({
    id, kind: index ? 'ssh' : 'local', slots: { current: 2, limit: 2, elastic: false },
    capabilities: { os: null, browser: null }, active: 0,
  }));
  const stage = runnerApi.runnerStage(runners, [{
    at: '2026-10-24T11:30:00.000Z', waitMs: 10, runMs: 20,
  }], { from: '2026-10-24T11:00:00.000Z', to: '2026-10-24T12:00:00.000Z' });
  assert.deepEqual(stage.runners.map(row => [row.busyShare, row.runsServed]), [[null, null], [null, null]]);
  assert.deepEqual(stage.slotWait, { fastQuarterMs: 10, medianMs: 10, slowQuarterMs: 10, worstMs: 10, count: 1 });
});
