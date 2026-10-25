/** Route work shortages reach the coordinator through the existing durable observer [A6,N2,B13]. */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import * as store from '../src/board.js';
import { scanHealthSentinel } from '../src/health-sentinel.js';
import { loadConfig } from '../src/config.js';
import { runFixtureGit } from './fixture-child.js';

/** Keep the board, Git and injected observation clock private to this case. */
function fixture(t) {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'pullboard-route-capacity-')));
  let board = null;
  t.after(() => { if (board) store.closeBoard(board); rmSync(directory, { recursive: true, force: true }); });
  const root = join(directory, 'repo');
  mkdirSync(root);
  const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'Route fixture', GIT_AUTHOR_EMAIL: 'route@example.invalid',
    GIT_COMMITTER_NAME: 'Route fixture', GIT_COMMITTER_EMAIL: 'route@example.invalid' };
  runFixtureGit(['init', '-q', '-b', 'main'], { cwd: root, env });
  writeFileSync(join(root, 'pullboard.json'), JSON.stringify({ gate: 'true', lanes: { core: { owns: ['src/'] } } }));
  runFixtureGit(['add', '.'], { cwd: root, env });
  runFixtureGit(['commit', '-q', '-m', 'test: private route fixture'], { cwd: root, env });
  const file = join(root, '.git', 'pullboard', 'board.sqlite');
  const clock = { at: Date.parse('2026-10-25T00:00:00Z'), now() { return new Date(this.at); } };
  board = store.openBoard(file, clock);
  store.register(board, { lane: 'coordinator', path: root });
  const config = loadConfig(root);
  /** Publish only the real observer's captured snapshot, with ordinary revision validation. */
  function scan() {
    const observation = scanHealthSentinel(file, { root, config, now: clock.now() });
    return observation ? store.recordHealthFindings(board, { agentId: 'coordinator', ...observation }) : null;
  }
  /** Keep the seeded mid items valid under the ordinary cold-build brief requirement. */
  function addFree(title) {
    return store.addItem(board, { by: 'coordinator', lane: 'core', title, route: 'mid',
      criterion: 'The private fixture item can be built cold.', check: 'false',
      brief: 'Files:\n- src/fixture.js\nTest:\nThe fixture test asserts its declared behavior.' });
  }
  return { directory, root, file, board, clock, config, scan, addFree };
}

test('the coordinator is told to split work when a route has more idle seats than free items [A6,N2,B13]', t => {
  const box = fixture(t);
  const agents = [1, 2].map(number => store.register(box.board,
    { lane: 'core', path: join(box.directory, 'seat-' + number), route: 'mid' }));
  box.addFree('One free item');
  box.clock.at += 31 * 60_000;
  for (const agent of agents) store.shout(box.board, { from: agent, to: 'coordinator', text: 'Available now', lanes: ['core'] });
  const observation = scanHealthSentinel(box.file, { root: box.root, config: box.config, now: box.clock.now() });
  const shortage = observation.findings.find(finding => finding.cause === 'ROUTE_WORK_SHORTAGE' && finding.detail.route === 'mid');
  assert.ok(shortage, 'the ordinary observer identifies too little claimable mid work for two idle mid seats');
  assert.equal(shortage.detail.free, 1);
  assert.equal(shortage.detail.idle, 2);
  box.scan();
  const notices = store.allShouts(box.board).filter(row => row.shout_from === 'sentinel'
    && row.shout_to === 'coordinator' && row.shout_text.includes('ROUTE_WORK_SHORTAGE'));
  assert.equal(notices.length, 1);
  assert.match(notices[0].shout_text, /mid/u);
  assert.match(notices[0].shout_text, /1 free/u);
  assert.match(notices[0].shout_text, /2 idle/u);
  assert.match(notices[0].shout_text, /split/iu);
  const eventCount = store.events(box.board).length;
  assert.equal(box.scan(), null, 'identical shortages do not keep shouting');
  assert.equal(store.events(box.board).length, eventCount);
  box.addFree('Second free item');
  assert.ok(box.scan().resolved.includes(shortage.key), 'enough claimable work resolves the shortage');
});
