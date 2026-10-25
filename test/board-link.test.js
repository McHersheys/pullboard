/** Bilateral board links disclose only authorized state and retain real SSH consent [E32,H16,H17]. */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import * as store from '../src/board.js';
import { addSigner } from '../src/signature.js';
import { runFixtureChild, runFixtureGit, fixtureChildMessage } from './fixture-child.js';

/** Create an isolated native board with its established SSH signer authority. */
function signedBoard(t, name) {
  const directory = mkdtempSync(join(tmpdir(), 'pullboard-board-link-'));
  const root = join(directory, 'repo');
  const key = join(directory, 'signer');
  mkdirSync(root);
  const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'Link fixture', GIT_AUTHOR_EMAIL: 'link@example.invalid',
    GIT_COMMITTER_NAME: 'Link fixture', GIT_COMMITTER_EMAIL: 'link@example.invalid' };
  const generated = runFixtureChild('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', key], { env, encoding: 'utf8' });
  assert.equal(generated.status, 0, fixtureChildMessage(generated));
  const git = (...args) => runFixtureGit(args, { cwd: root, env, encoding: 'utf8' });
  const initialized = git('init', '-q', '-b', 'main');
  assert.equal(initialized.status, 0, fixtureChildMessage(initialized));
  writeFileSync(join(root, 'README.md'), 'Private board-link fixture.\n');
  assert.equal(git('add', '.').status, 0);
  const committed = git('commit', '-q', '-m', 'fixture: establish board signer root');
  assert.equal(committed.status, 0, fixtureChildMessage(committed));
  addSigner(root, { by: name, key: key + '.pub' });
  const board = store.openBoard(join(root, '.git', 'pullboard', 'board.sqlite'));
  t.after(() => { store.closeBoard(board); rmSync(directory, { recursive: true, force: true }); });
  return { root, key, by: name, board, reference: { boardId: store.boardId(board), organization: 'fixture', handle: name } };
}

/** Obtain genuine independent approval of the exact same link document from both boards. */
async function consent(api, authority, parent, child, linkId, disclosure = 'states', generation = 1) {
  let record = { version: 1, linkId, parent: parent.reference, child: child.reference,
    generation, disclosure, approvals: [], revocation: null };
  record = await api.approveBoardLink(record, parent.reference.boardId, authority, { by: parent.by, key: parent.key });
  return api.approveBoardLink(record, child.reference.boardId, authority, { by: child.by, key: child.key });
}

test('a signed two-sided link carries only its disclosure mode and refuses a cycle [E32,H16,H17]', async t => {
  const loaded = await import('../src/board-link.js').then(api => ({ api }), error => ({ error }));
  assert.equal(loaded.error, undefined, 'the shared production board-link boundary must exist');
  const api = loaded.api;
  const { createSshBoardLinkAuthority } = await import('../src/board-link-ssh.js');
  const parent = signedBoard(t, 'parent');
  const child = signedBoard(t, 'child');
  const second = signedBoard(t, 'second');
  const authority = createSshBoardLinkAuthority([parent, child, second]);
  const record = await consent(api, authority, parent, child, 'parent-child');
  assert.match(record.approvals[0].signature, /BEGIN SSH SIGNATURE/u, 'the existing SSH authority signs real consent');
  assert.match(record.approvals[1].signature, /BEGIN SSH SIGNATURE/u);
  assert.equal(readFileSync(join(parent.root, '.pullboard', 'signers'), 'utf8').includes('parent'), true);
  await api.applyBoardLink(parent.board, record, authority);
  await api.applyBoardLink(child.board, record, authority);
  assert.deepEqual(api.readBoardLinks(parent.board), [record]);
  assert.deepEqual(api.resolveBoardReference([parent.reference, child.reference], 'fixture/child'), child.reference);
  assert.deepEqual(api.resolveBoardReference([parent.reference, child.reference], { boardId: child.reference.boardId }), child.reference);
  const announcement = api.boardStateAnnouncement(parent.board, { linkId: record.linkId,
    sourceBoardId: child.reference.boardId, destinationBoardId: parent.reference.boardId,
    generation: 1, position: 7,
    rows: [{ board: child.reference.boardId, id: 8, state: 'claimed', title: 'private title', criterion: 'private criterion', note: 'private note' }] });
  assert.deepEqual(announcement.rows, [{ board: child.reference.boardId, id: 8, state: 'claimed' }]);
  assert.equal(JSON.stringify(announcement).includes('private'), false);
  assert.equal(announcement.generation, 1);
  assert.equal(announcement.position, 7);
  assert.deepEqual(api.discloseBoardState('counts', announcement.rows), { claimed: 1 });
  assert.deepEqual(api.discloseBoardState('nothing', announcement.rows), []);
  const secondParent = await consent(api, authority, second, child, 'second-child', 'counts');
  await api.applyBoardLink(parent.board, secondParent, authority);
  assert.equal(api.readBoardLinks(parent.board).length, 2, 'the graph supports more than one parent');
  const cycle = await consent(api, authority, child, parent, 'child-parent');
  await assert.rejects(api.applyBoardLink(parent.board, cycle, authority), error => error.code === 'BOARD_LINK_CYCLE');
  assert.equal(api.readBoardLinks(parent.board).length, 2, 'refused cycles never persist');
  const revoked = await api.revokeBoardLink(record, child.reference.boardId, authority, { by: child.by, key: child.key });
  await api.applyBoardLink(parent.board, revoked, authority);
  assert.throws(() => api.boardStateAnnouncement(parent.board, { linkId: record.linkId,
    sourceBoardId: child.reference.boardId, destinationBoardId: parent.reference.boardId,
    generation: 1, position: 8, rows: [] }), error => error.code === 'BOARD_LINK_INACTIVE');
  await assert.rejects(api.applyBoardLink(parent.board, record, authority), error => error.code === 'BOARD_LINK_CONFLICT',
    'replaying old consent cannot undo a signed revocation');
});
