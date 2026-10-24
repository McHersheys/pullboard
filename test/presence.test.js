/** Seat identity survives heartbeat-based presence changes on a real SQLite board [B3]. */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import * as store from '../src/board.js';

test('a seat presence moves live to idle to gone from its heartbeat [B3]', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'pullboard-presence-'));
  let at = Date.parse('2026-10-24T12:00:00Z');
  const board = store.openBoard(join(root, 'board.sqlite'), { now: () => new Date(at) });
  t.after(() => { store.closeBoard(board); rmSync(root, { recursive: true, force: true }); });
  const id = store.register(board, { lane: 'core', path: join(root, 'seat') });
  const identity = store.agentById(board, id);
  assert.equal(store.listAgents(board).find(seat => seat.agent_id === id).presence, 'live');
  at += 10 * 60_000 - 1;
  assert.equal(store.listAgents(board).find(seat => seat.agent_id === id).presence, 'live');
  at += 1;
  assert.equal(store.listAgents(board).find(seat => seat.agent_id === id).presence, 'idle');
  at += 20 * 60_000;
  assert.equal(store.listAgents(board).find(seat => seat.agent_id === id).presence, 'gone');
  assert.equal(store.agentById(board, id).agent_id, identity.agent_id);
  assert.equal(store.agentById(board, id).agent_path, identity.agent_path);
});

test('local heartbeats revive a seat without changing exported history or a remote copy [B3,A7]', async (t) => {
  const { heartbeatSeat } = await import('../src/seat-presence.js');
  const { exportBoard, importBoard } = await import('../src/exchange.js');
  const root = mkdtempSync(join(tmpdir(), 'pullboard-presence-local-'));
  let at = Date.parse('2026-10-24T12:00:00Z');
  const clock = { now: () => new Date(at) };
  const board = store.openBoard(join(root, 'board.sqlite'), clock);
  const remote = store.openBoard(join(root, 'remote.sqlite'), clock);
  t.after(() => { store.closeBoard(board); store.closeBoard(remote); rmSync(root, { recursive: true, force: true }); });
  const id = store.register(board, { lane: 'core', path: join(root, 'seat') });
  const before = exportBoard(board);
  at += 30 * 60_000;
  assert.equal(store.agentById(board, id).presence, 'gone');
  assert.equal(heartbeatSeat(board, id), true);
  assert.equal(store.agentById(board, id).presence, 'live');
  assert.equal(store.agentById(board, id).heartbeatAt, clock.now().toISOString());
  assert.deepEqual(exportBoard(board), before, 'heartbeat is not native history or exported state');
  importBoard(remote, before);
  assert.equal(store.agentById(remote, id).presence, 'gone', 'a foreign registration is not a local heartbeat');
  assert.equal(store.agentById(remote, id).heartbeatAt, null);
  assert.equal(heartbeatSeat(board, 'missing-seat'), false);
});

test('status and session hooks heartbeat the local seat without a shared board write [B3,I6]', async (t) => {
  const { createE2eHelpers } = await import('./e2e-helpers.js');
  const { readFileSync } = await import('node:fs');
  const { DatabaseSync } = await import('node:sqlite');
  const { projectState } = await import('../src/serve.js');
  const helpers = createE2eHelpers();
  t.after(helpers.cleanup);
  const box = helpers.project('true');
  const file = join(box.repo, '.git', 'pullboard', 'board.sqlite');
  const local = new DatabaseSync(`${file}.presence.sqlite`);
  t.after(() => local.close());
  local.prepare('UPDATE heartbeat SET at=? WHERE seat=?').run('2000-01-01T00:00:00.000Z', 'web-1');
  local.exec('CREATE TABLE writes(n INTEGER NOT NULL); INSERT INTO writes VALUES(0); CREATE TRIGGER count_heartbeat AFTER UPDATE ON heartbeat BEGIN UPDATE writes SET n=n+1; END');
  const board = store.openBoard(file);
  const events = board.db.prepare('SELECT COUNT(*) AS n FROM event').get().n;
  board.db.exec('BEGIN IMMEDIATE');
  const status = box.run(box.web, 'status', '--json');
  board.db.exec('ROLLBACK');
  assert.equal(status.code, 0, status.err + status.out);
  const summary = JSON.parse(status.out);
  assert.equal(summary.agents.find(seat => seat.agent_id === 'web-1').presence, 'live');
  assert.equal(local.prepare('SELECT n FROM writes').get().n, 1, 'one presence row update per read command');
  assert.equal(board.db.prepare('SELECT COUNT(*) AS n FROM event').get().n, events);
  const state = projectState(box.repo, { board });
  assert.equal(state.agents.find(seat => seat.agent_id === 'web-1').presence, 'live');
  store.closeBoard(board);
  const settings = JSON.parse(readFileSync(join(box.repo, '.claude', 'settings.json'), 'utf8'));
  for (const event of ['SessionStart', 'Stop', 'SessionEnd']) {
    const commands = settings.hooks[event].flatMap(entry => entry.hooks.map(hook => hook.command));
    assert.ok(commands.some(command => command.includes(event === 'SessionStart' ? 'pullboard resume' : 'pullboard heartbeat')), event);
  }
  const heartbeat = box.run(box.web, 'heartbeat', '--json');
  assert.equal(heartbeat.code, 0, heartbeat.err + heartbeat.out);
  assert.equal(JSON.parse(heartbeat.out).presence, 'live');
});
