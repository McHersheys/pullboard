/** Native process observations exercise real durable board notifications [A6,H16]. */
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import * as store from '../src/board.js';
import { runFixtureGit } from './fixture-child.js';
import { scanHealthSentinel } from '../src/health-sentinel.js';

// CPU time is observed, not burned: the native utility port supplies an exact ps/lsof transcript.
test('the sentinel names an agent process past 20 CPU minutes once [A6,H16]', async t => {
  const { agentCpuFindings } = await import('../src/sentinel-cpu.js');
  const directory = mkdtempSync(join(tmpdir(), 'pullboard-cpu-'));
  const root = join(directory, 'repo'), work = join(directory, 'core');
  mkdirSync(root); mkdirSync(work);
  runFixtureGit(['init', '-q', '-b', 'main'], { cwd: root });
  const file = join(directory, 'board.sqlite'), board = store.openBoard(file);
  store.register(board, { lane: 'coordinator', path: root });
  const seat = store.register(board, { lane: 'core', path: work });
  t.after(() => { store.closeBoard(board); rmSync(directory, { recursive: true }); });
  let birth = 'Mon Oct 19 12:00:00 2026', cpu = '21:30.00', cwd = work, present = true;
  const calls = [];
  const run = (command, args) => {
    calls.push([command, args]);
    if (command === '/bin/ps') return present ? ` 4321 ${cpu} ${birth} /usr/bin/git\n 4322 19:59.99 ${birth} /usr/bin/node\n` : '';
    assert.equal(command, '/usr/sbin/lsof');
    return `p4321\nn${cwd}\n`;
  };
  const observe = () => agentCpuFindings(board.db, { platform: 'darwin', run });
  const scan = () => {
    const observation = scanHealthSentinel(file, { root, config: {}, now: new Date(), cpu: observe });
    if (observation) store.recordHealthFindings(board, { agentId: 'coordinator', ...observation });
  };
  scan();
  const notices = () => store.allShouts(board).filter(row => row.shout_to === 'coordinator' && row.shout_text.startsWith('Stuck:') && row.shout_text.includes('AGENT_CPU'));
  assert.equal(notices().length, 1);
  for (const value of ['4321', 'git', seat, '21.50 CPU minutes']) assert.ok(notices()[0].shout_text.includes(value), value);
  assert.equal(notices()[0].shout_from, 'sentinel');
  cpu = '01:22:30'; scan(); scan();
  assert.equal(notices().length, 1, 'increasing CPU time does not create another process episode');
  present = false; scan(); present = true; scan();
  assert.equal(notices().length, 1, 'a temporary observation gap cannot repeat a recorded process alert');
  birth = 'Mon Oct 19 13:00:00 2026'; scan();
  assert.equal(notices().length, 2, 'a reused PID with a different birth is a different process');
  cwd = join(directory, 'core-other'); mkdirSync(cwd); birth = 'Mon Oct 19 14:00:00 2026';
  scan(); assert.equal(notices().length, 2, 'a path-prefix sibling is not an agent worktree');
  cwd = work; cpu = '20:00.00'; scan();
  assert.equal(notices().length, 2, 'exactly twenty CPU minutes has not exceeded twenty minutes');
  cpu = '1-00:00:01';
  assert.equal(observe()[0].why.includes('1440.02 CPU minutes'), true, 'day-form CPU time is parsed');
  assert.ok(calls.some(([command, args]) => command === '/bin/ps' && args.includes('time=')));
  assert.ok(calls.some(([command]) => command === '/usr/sbin/lsof'));
});
