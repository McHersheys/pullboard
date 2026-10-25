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
  let board = null;
  t.after(() => { if (board) store.closeBoard(board); rmSync(directory, { recursive: true, force: true }); });
  const root = join(directory, 'repo');
  const key = join(directory, 'signer');
  mkdirSync(root);
  const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'Link fixture', GIT_AUTHOR_EMAIL: 'link@example.invalid',
    GIT_COMMITTER_NAME: 'Link fixture', GIT_COMMITTER_EMAIL: 'link@example.invalid' };
  const generated = runFixtureChild('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', key], { env, encoding: 'utf8' });
  assert.equal(generated.status, 0, fixtureChildMessage(generated));
  const git = (...args) => runFixtureGit(args, { cwd: root, env, encoding: 'utf8' });
  git('init', '-q', '-b', 'main');
  writeFileSync(join(root, 'README.md'), 'Private board-link fixture.\n');
  git('add', '.');
  git('commit', '-q', '-m', 'fixture: establish board signer root');
  addSigner(root, { by: name, key: key + '.pub' });
  board = store.openBoard(join(root, '.git', 'pullboard', 'board.sqlite'));
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

/** Start the existing authenticated relay with real stand-in OAuth and private native snapshots. */
async function linkRelay(t, boards, authority) {
  const { githubFixture } = await import('./relay-fixture.js');
  const { createGitHubClient } = await import('../relay/github.js');
  const { createRelayAuth } = await import('../relay/auth.js');
  const { serveRelay } = await import('../relay/service.js');
  const { request } = await import('../src/relay.js');
  const { generateBoardKey, seal } = await import('../src/seal.js');
  const { exportBoard } = await import('../src/exchange.js');
  const { ENGINE_VERSION } = await import('../src/machine.js');
  const provider = await githubFixture(t);
  const directory = mkdtempSync(join(tmpdir(), 'pullboard-link-relay-'));
  let time = Date.now();
  const auth = createRelayAuth({ database: join(directory, 'auth.sqlite'),
    github: createGitHubClient(provider.config), now: () => time });
  let service = null;
  t.after(async () => {
    try { if (service) await service.close(); }
    finally { auth.close(); rmSync(directory, { recursive: true, force: true }); }
  });
  const grant = await auth.beginDevice();
  provider.state.deviceAuthorized = true;
  time += grant.interval * 1000;
  const person = await auth.pollDevice(grant.ticket);
  for (const box of boards) await auth.linkBoard(person.token, box.reference.boardId, 'fixture/repository');
  service = await serveRelay({ directory: join(directory, 'relay'), auth, maintenanceMs: 0,
    now: () => time, boardLinkAuthority: authority });
  let origin = 'http://127.0.0.1:' + service.port;
  const states = new Map();
  for (const box of boards) {
    const board = box.reference.boardId;
    const key = await generateBoardKey();
    const snapshot = await seal(key, Buffer.from(JSON.stringify(exportBoard(box.board))), { boardId: board, kind: 'snapshot', sequence: 0 });
    const uploaded = await fetch(origin + '/api/v1/boards/' + board + '/state', { method: 'PUT',
      headers: { authorization: 'Bearer ' + person.token, 'x-pullboard-engine': String(ENGINE_VERSION), 'content-type': 'application/json' },
      body: JSON.stringify({ sequence: 0, sealed: Buffer.from(snapshot).toString('base64url') }) });
    assert.equal(uploaded.status, 200, JSON.stringify(await uploaded.json()));
    const issued = await auth.issueToken(person.token, { board, agent: 'link-agent' });
    states.set(board, { url: origin, token: issued.token, board, agent: 'link-agent' });
  }
  return { states, request,
    async restart() {
      await service.close();
      service = await serveRelay({ directory: join(directory, 'relay'), auth, maintenanceMs: 0,
        now: () => time, boardLinkAuthority: authority });
      origin = 'http://127.0.0.1:' + service.port;
      for (const state of states.values()) state.url = origin;
    },
  };
}

test('sealed board-link delivery authenticates both boards and retains exact retries after restart [E32,H16,H17]', async t => {
  const loaded = await import('../src/board-link-relay.js').then(api => ({ api }), error => ({ error }));
  assert.equal(loaded.error, undefined, 'the common authenticated delivery dispatcher must exist');
  const transportApi = loaded.api;
  const api = await import('../src/board-link.js');
  const { createSshBoardLinkAuthority } = await import('../src/board-link-ssh.js');
  const { createBoardLinkCapability } = await import('../src/board-link-envelope.js');
  const { generateBoardKey, seal, unseal } = await import('../src/seal.js');
  const parent = signedBoard(t, 'parent');
  const child = signedBoard(t, 'child');
  const authority = createSshBoardLinkAuthority([parent, child]);
  const record = await consent(api, authority, parent, child, 'sealed-link');
  await api.applyBoardLink(parent.board, record, authority);
  await api.applyBoardLink(child.board, record, authority);
  const box = await linkRelay(t, [parent, child], authority);
  const sender = transportApi.createBoardLinkRelayTransport(box.states.get(child.reference.boardId));
  const receiver = transportApi.createBoardLinkRelayTransport(box.states.get(parent.reference.boardId));
  await sender.publish(record);
  const linkKey = await generateBoardKey();
  const capability = createBoardLinkCapability(record, linkKey);
  const parentKey = await generateBoardKey();
  const privateParent = await seal(parentKey, Buffer.from('unrelated private parent content'),
    { boardId: parent.reference.boardId, kind: 'snapshot', sequence: 0 });
  assert.equal(Buffer.from(await unseal(parentKey, privateParent,
    { boardId: parent.reference.boardId, kind: 'snapshot', sequence: 0 })).toString(), 'unrelated private parent content');
  await assert.rejects(unseal(linkKey, privateParent,
    { boardId: parent.reference.boardId, kind: 'snapshot', sequence: 0 }), error => error.code === 'SEAL_AUTH_FAILED',
    'a child’s per-link key cannot open other parent content');
  const context = { linkId: record.linkId, generation: 1, sourceBoardId: child.reference.boardId,
    destinationBoardId: parent.reference.boardId, position: 10, correlationId: 'state-10',
    rows: [{ board: child.reference.boardId, id: 1, state: 'claimed', title: 'must stay private' }] };
  const ports = { authority, capability, transport: sender };
  const receipt = await transportApi.deliverBoardState(child.board, context, ports);
  assert.deepEqual(await transportApi.deliverBoardState(child.board, context, ports), receipt, 'a retry returns the same durable outcome');
  await box.restart();
  assert.deepEqual(await transportApi.deliverBoardState(child.board, context, ports), receipt, 'a restart does not duplicate delivery');
  const messages = await receiver.read();
  assert.equal(messages.deliveries.length, 1);
  const delivered = messages.deliveries[0];
  assert.deepEqual(await sender.send(delivered.envelope), receipt, 'the restarted HTTP dispatcher returns its durable retry receipt');
  assert.equal((await receiver.read()).deliveries.length, 1, 'an actual HTTP retry does not append another envelope');
  const plain = await capability.open(delivered.envelope);
  assert.deepEqual(plain.rows, [{ board: child.reference.boardId, id: 1, state: 'claimed' }]);
  assert.equal(JSON.stringify(plain).includes('must stay private'), false);
  const received = await transportApi.receiveBoardState(parent.board, delivered, { authority, capability });
  const eventCount = parent.board.db.prepare('SELECT COUNT(*) AS n FROM event').get().n;
  assert.deepEqual(await transportApi.receiveBoardState(parent.board, delivered, { authority, capability }), received);
  assert.equal(parent.board.db.prepare('SELECT COUNT(*) AS n FROM event').get().n, eventCount, 'consumer retry makes no second event');
  await assert.rejects(transportApi.deliverBoardState(child.board, { ...context,
    rows: [{ board: child.reference.boardId, id: 1, state: 'submitted' }] }, ports), error => error.code === 'BOARD_LINK_CONFLICT');
  await assert.rejects(box.request(box.states.get(child.reference.boardId),
    '/api/v1/boards/' + parent.reference.boardId + '/link-deliveries', {}, { ignoreRelayEnvironmentToken: true }),
    error => error.code === 'TOKEN_BOARD', 'a child token cannot read a parent inbox');
  const revoked = await api.revokeBoardLink(record, parent.reference.boardId, authority, { by: parent.by, key: parent.key });
  await receiver.publish(revoked);
  await assert.rejects(transportApi.deliverBoardState(child.board, { ...context, correlationId: 'state-11', position: 11 }, ports),
    error => error.code === 'BOARD_LINK_INACTIVE', 'authoritative revocation blocks a source whose local catalog is stale');
});
