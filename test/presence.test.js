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
