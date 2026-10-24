/** Prove concurrent landing gates against actual private Git, SQLite and gate subprocesses [B3,V4]. */
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runFixtureChild } from './fixture-child.js';
import { GATE_SLOT_HELD_ENV, GATE_SLOT_POOL_ENV, GATE_SLOT_TOKEN_ENV, BROWSER_SLOT_HELD_ENV } from '../src/resources.js';

/** Read append-only subprocess markers; each completed line is one independently observed transition. */
function markers(path) { return readFileSync(path, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)); }

/** Add a bounded peer barrier to the existing real gate, leaving its TAP and red-item behavior intact. */
function observeGates(box) {
  const file = JSON.parse(box.gate.slice(5));
  const original = readFileSync(file, 'utf8');
  const trace = join(box.dir, 'parallel-gate-events.jsonl');
  const armed = join(box.dir, 'parallel-gates-armed');
  writeFileSync(trace, '');
  const observe = [
    '(function () {',
    "const fs = require('node:fs');",
    `const trace = ${JSON.stringify(trace)}; const armed = ${JSON.stringify(armed)};`,
    "if (!fs.existsSync(armed) || process.argv.includes('--alone')) return;",
    "const root = process.cwd(); const pid = process.pid; const files = fs.readdirSync(root + '/web').filter(name => /^land-[0-9]+\\.test\\.js$/.test(name)).sort();",
    "const mark = phase => fs.appendFileSync(trace, JSON.stringify({ phase, root, pid, files, at: Date.now() }) + '\\n');",
    "mark('start'); process.on('exit', () => mark('end'));",
    // Budget: a deterministic rendezvous ceiling, not a performance requirement. Serial code exits
    // this barrier without a peer and is rejected by the parent’s overlap assertion.
    'const deadline = Date.now() + 3000;',
    "while (Date.now() < deadline) { const rows = fs.readFileSync(trace, 'utf8').trim().split('\\n').filter(Boolean).map(line => JSON.parse(line)); const active = new Map(); for (const row of rows) { if (row.phase === 'start') active.set(row.pid, row.root); else active.delete(row.pid); } if (new Set(active.values()).size >= 2) break; Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10); }",
    // Keep both peers observably live after rendezvous, without asserting a wall-clock budget.
    'Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);',
    '})();',
  ].join('\n');
  writeFileSync(file, `${observe}\n${original}`);
  return { trace, armed };
}

/** Execute the public batch engine with an explicit configuration, bypassing only CLI config parsing.
 * This lets the BEFORE reach the absent scheduling behavior even before the new option is recognized.
 * The private board has no competing landing owner; every board transition uses its normal public writer.
 */
function runBatch(box, enabled) {
  const source = [
    `import * as store from ${JSON.stringify(pathToFileURL(join(import.meta.dirname, '../src/board.js')).href)};`,
    `import { loadConfig } from ${JSON.stringify(pathToFileURL(join(import.meta.dirname, '../src/config.js')).href)};`,
    `import { runLandingBatch } from ${JSON.stringify(pathToFileURL(join(import.meta.dirname, '../src/land.js')).href)};`,
    "import { join } from 'node:path';",
    'const root = process.argv[1]; const enabled = process.argv[2] === "true";',
    'const board = store.openBoard(join(root, ".git", "pullboard", "board.sqlite"));',
    'try { const config = loadConfig(root); config.landing = { ...config.landing, parallel: enabled };',
    'const result = await runLandingBatch({ root, board, config, owner: "coordinator", maximum: 3, write: async (operation, args) => store[operation](board, ...args), say: () => {}, checkLease: async () => {}, checkLeaseNow: () => {} });',
    'console.log(JSON.stringify(result)); } finally { store.closeBoard(board); }',
  ].join('\n');
  const env = { ...box.env };
  for (const key of [GATE_SLOT_HELD_ENV, GATE_SLOT_POOL_ENV, GATE_SLOT_TOKEN_ENV, BROWSER_SLOT_HELD_ENV]) delete env[key];
  const result = runFixtureChild(process.execPath, ['--input-type=module', '-e', source, box.repo, String(enabled)], { cwd: box.repo, env, encoding: 'utf8' });
  assert.equal(result.status, 0, `${result.failure ?? result.stderr}\n${result.stdout}`);
  return JSON.parse(result.stdout.trim());
}

/** Check the largest number of simultaneous actual gate PIDs in distinct candidate worktrees. */
function overlap(rows) {
  const active = new Map();
  let maximum = 0;
  for (const row of rows) {
    if (row.phase === 'start') active.set(row.pid, row.root); else active.delete(row.pid);
    maximum = Math.max(maximum, new Set(active.values()).size);
  }
  assert.equal(active.size, 0, 'all observed gate children ended before the landing returned');
  return maximum;
}

/** Land A and C while returning the actual red B; enabled and disabled modes share the same assertions. */
export function assertParallelLanding({ landProject, itemWorktree, submitItem, acceptItem, json }) {
  for (const enabled of [true, false]) {
    const box = landProject();
    const observed = observeGates(box);
    mkdirSync(box.env.PULLBOARD_MACHINE_HOME, { recursive: true });
    // This is the private fixture’s own pool, never a setting on the user's machine.
    writeFileSync(join(box.env.PULLBOARD_MACHINE_HOME, 'settings.json'), JSON.stringify({ gateSlots: 2, browserSlots: 2 }));
    box.env.LAND_SUPPRESS_RED = '1';
    const entries = [1, 2, 3].map(number => itemWorktree(box, number));
    for (const [index, entry] of entries.entries()) submitItem(box, entry, index === 1 ? 'RED\n' : 'PASS\n');
    for (const entry of entries) acceptItem(box, entry);
    delete box.env.LAND_SUPPRESS_RED;
    writeFileSync(observed.armed, 'armed');
    const result = runBatch(box, enabled);
    assert.deepEqual(result.landed, [entries[0].item, entries[2].item], 'green A and independent C land while B is returned');
    assert.deepEqual(result.culprits.map(row => row.id), [entries[1].item]);
    assert.equal(json(box, box.repo, 'show', String(entries[1].item)).item_status, 'open');
    assert.equal(box.git(box.repo, 'rev-parse', 'main'), result.batch.tip);
    assert.equal(box.git(box.remote, 'rev-parse', 'main'), result.batch.tip);
    const rows = markers(observed.trace);
    const maximum = overlap(rows);
    if (enabled) {
      assert.ok(maximum >= 2, 'candidate gates execute concurrently in distinct worktrees');
      const starts = rows.filter(row => row.phase === 'start');
      const sets = starts.map(row => row.files.join(','));
      for (const wanted of ['land-1.test.js', 'land-1.test.js,land-2.test.js', 'land-1.test.js,land-2.test.js,land-3.test.js']) assert.equal(sets.filter(value => value === wanted).length, 1, `each exact prefix executes once: ${wanted}`);
      assert.equal(sets.filter(value => value === 'land-1.test.js,land-3.test.js').length, 1, 'C is checked once on A, with no serial retry or pre-push rerun');
      assert.equal(sets.filter(value => value === 'land-2.test.js').length, 1, 'the distinct B-alone control confirms culpability rather than blaming an interaction');
    } else assert.equal(maximum, 1, 'the default serial behavior remains serial');
  }
}
