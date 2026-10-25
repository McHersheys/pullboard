/** Signed membership uses real Git policy, native replay and OpenSSH proofs [E17,H15,H16]. */
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as store from '../src/board.js';
import { exportBoard, importBoard } from '../src/exchange.js';
import { applyEngineMove, prepareEngineMove } from '../src/engine.js';
import { seal, unseal } from '../src/seal.js';
import { prepareBoardMembers, authorizeMember } from '../src/relay-membership.js';
import { runFixtureChild } from './fixture-child.js';
import { createE2eHelpers } from './e2e-helpers.js';

const helpers = createE2eHelpers();
after(helpers.cleanup);

test('an approver signed member list survives sealed native replay and revokes by revision [H15,H16,E17]', async t => {
  const box = helpers.project();
  const board = store.openBoard(join(box.repo, '.git', 'pullboard', 'board.sqlite'));
  const replica = store.openBoard(join(box.dir, 'replica.sqlite'));
  t.after(() => { store.closeBoard(replica); store.closeBoard(board); });
  const state = { board: store.boardId(board), repository: 'fixture/repository', login: 'alice' };
  const signingKey = join(box.dir, 'alice');
  assert.equal(runFixtureChild('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', signingKey], { encoding: 'utf8' }).status, 0);
  const publicKey = readFileSync(signingKey + '.pub', 'utf8').trim().split(' ').slice(0, 2).join(' ');
  const githubKeys = async login => login === 'alice' ? [publicKey] : [];
  const configFile = join(box.repo, 'pullboard.json');
  const config = JSON.parse(readFileSync(configFile, 'utf8'));
  await assert.rejects(prepareBoardMembers(box.repo, state, ['bob'], { githubKeys, revision: 1, signingKey }),
    error => error.code === 'NOT_APPROVER', 'no approvers cannot authorize a non-approver member');
  writeFileSync(configFile, JSON.stringify({ ...config, approvers: ['alice'] }, null, 2));
  box.git(box.repo, 'add', 'pullboard.json');
  box.git(box.repo, 'commit', '-q', '-m', 'chore: declare the independent approver');
  const document = await prepareBoardMembers(box.repo, state, ['bob'], { githubKeys, revision: 1, signingKey });
  const before = exportBoard(board);
  const move = prepareEngineMove(board, 'setBoardMembers', [{ agentId: 'coordinator', document }]);
  applyEngineMove(board, move);
  const eventCount = board.db.prepare('SELECT COUNT(*) AS n FROM event').get().n;
  store.setBoardMembers(board, { agentId: 'coordinator', document });
  assert.equal(board.db.prepare('SELECT COUNT(*) AS n FROM event').get().n, eventCount, 'an identical retry emits no second event');
  const key = randomBytes(32);
  const binding = { boardId: state.board, sequence: 1, kind: 'move' };
  const sealed = await seal(key, Buffer.from(JSON.stringify(move)), binding);
  importBoard(replica, before);
  applyEngineMove(replica, JSON.parse(Buffer.from(await unseal(key, sealed, binding)).toString('utf8')));
  assert.deepEqual(store.readBoardMembers(replica), document, 'native encrypted transport preserves the exact signed list');
  assert.equal(await authorizeMember(box.repo, state, store.readBoardMembers(replica), 'bob', { githubKeys }), true);
  await assert.rejects(authorizeMember(box.repo, state, { ...document, body: { ...document.body, members: ['mallory'] } }, 'mallory', { githubKeys }),
    error => error.code === 'RELAY_NOT_MEMBER', 'a board-key holder cannot change approver-signed members');
  await assert.rejects(authorizeMember(box.repo, { ...state, board: 'f'.repeat(32) }, document, 'bob', { githubKeys }),
    error => error.code === 'RELAY_NOT_MEMBER', 'the same signature authorizes no other board');
  const revoked = await prepareBoardMembers(box.repo, state, [], { githubKeys, revision: 2, signingKey });
  applyEngineMove(board, prepareEngineMove(board, 'setBoardMembers', [{ agentId: 'coordinator', document: revoked }]));
  await assert.rejects(authorizeMember(box.repo, state, store.readBoardMembers(board), 'bob', { githubKeys }),
    error => error.code === 'RELAY_NOT_MEMBER', 'the current empty revision revokes an additional member');
  assert.throws(() => store.setBoardMembers(board, { agentId: 'coordinator', document }), error => error.code === 'BOARD_MEMBERS_REVISION');
  assert.throws(() => store.setBoardMembers(board, { agentId: 'person', document: revoked }), error => error.code === 'COORDINATOR_ONLY');
  writeFileSync(configFile, JSON.stringify({ ...config, approvers: ['carol'] }, null, 2));
  box.git(box.repo, 'add', 'pullboard.json');
  box.git(box.repo, 'commit', '-q', '-m', 'chore: replace the independent approver');
  await assert.rejects(authorizeMember(box.repo, state, document, 'bob', { githubKeys }),
    error => error.code === 'RELAY_NOT_MEMBER', 'a removed approver cannot authorize even an otherwise valid historical list');
});
