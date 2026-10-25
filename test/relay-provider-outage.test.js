/** Provider failures stay distinct from permission loss; remote writes still fail closed [H8,H10,H16]. */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createGitHubClient } from '../relay/github.js';
import { createRelayAuth, ACCESS_WINDOW_MS } from '../relay/auth.js';
import { serveRelay } from '../relay/service.js';
import { ENGINE_VERSION } from '../src/machine.js';
import { githubFixture } from './relay-fixture.js';

const REPOSITORY = '/repos/fixture/repository';
const PERMISSION = REPOSITORY + '/collaborators/fixture-user/permission';
const USER = { id: '7', login: 'fixture-user' };

test('header-evidenced GitHub rate limits are unavailable, not access denials [H8]', async (t) => {
  const provider = await githubFixture(t);
  const client = createGitHubClient(provider.config);
  const cases = [
    { status: 403, headers: { 'x-ratelimit-remaining': '0' }, code: 'GITHUB_UNAVAILABLE' },
    { status: 403, headers: { 'retry-after': '60', 'x-ratelimit-remaining': '17' }, code: 'GITHUB_UNAVAILABLE' },
    { status: 429, headers: {}, code: 'GITHUB_UNAVAILABLE' },
    { status: 503, headers: {}, code: 'GITHUB_UNAVAILABLE' },
    { status: 401, headers: {}, code: 'NO_REPO_ACCESS' },
    { status: 403, headers: { 'x-ratelimit-remaining': '17' }, code: 'NO_REPO_ACCESS' },
    { status: 403, headers: { 'retry-after': 'invalid' }, code: 'NO_REPO_ACCESS' },
    { status: 404, headers: {}, code: 'NO_REPO_ACCESS' },
  ];
  // Both the installation lookup and the public-repository permission fallback used to swallow a 403.
  for (const path of [REPOSITORY + '/installation', REPOSITORY, PERMISSION]) {
    for (const scenario of cases) await t.test(`${path}: ${scenario.status} ${JSON.stringify(scenario.headers)}`, async () => {
      provider.state.public = false;
      provider.state.providerFailure = { path, status: scenario.status, headers: scenario.headers };
      await assert.rejects(client.access(USER, 'fixture/repository'), { code: scenario.code });
    });
  }
  provider.state.public = true;
  provider.state.providerFailure = { path: PERMISSION, status: 403, headers: { 'retry-after': '60' } };
  await assert.rejects(client.access(USER, 'fixture/repository'), { code: 'GITHUB_UNAVAILABLE' },
    'a public repository does not turn a transient permission failure into role none');
});

test('GitHub outage refuses the sealed write with 503 and does not cache a denial [H8,H16]', async (t) => {
  const provider = await githubFixture(t);
  const root = mkdtempSync(join(tmpdir(), 'pullboard-provider-outage-'));
  let now = Date.now();
  const auth = createRelayAuth({ database: join(root, 'auth.sqlite'), github: createGitHubClient(provider.config), now: () => now });
  let service;
  t.after(async () => { await service?.close(); auth.close(); rmSync(root, { recursive: true, force: true }); });
  const grant = await auth.beginDevice();
  provider.state.deviceAuthorized = true;
  now += grant.interval * 1000;
  const person = await auth.pollDevice(grant.ticket);
  const board = 'b'.repeat(32);
  await auth.linkBoard(person.token, board, 'fixture/repository');
  service = await serveRelay({ directory: join(root, 'journal'), auth, port: 0, maintenanceMs: 0 });
  const origin = `http://127.0.0.1:${service.port}`;
  const headers = { authorization: `Bearer ${person.token}`, 'x-pullboard-engine': String(ENGINE_VERSION), 'content-type': 'application/json' };
  const baseline = await fetch(`${origin}/api/v1/boards/${board}/state`, {
    method: 'PUT', headers, body: JSON.stringify({ sequence: 0, sealed: 'AQ' }),
  });
  assert.equal(baseline.status, 200);
  await baseline.arrayBuffer();
  now += ACCESS_WINDOW_MS;
  await auth.authenticate(person.token, { board });
  provider.state.providerFailure = { path: PERMISSION, status: 403, headers: { 'x-ratelimit-remaining': '0' } };
  const refused = await fetch(`${origin}/api/v1/boards/${board}/moves`, {
    method: 'POST', headers, body: JSON.stringify({ sequence: 1, sealed: 'Ag' }),
  });
  assert.equal(refused.status, 503);
  assert.equal((await refused.json()).error.code, 'GITHUB_UNAVAILABLE');
  assert.equal((await auth.authenticate(person.token, { board })).permission, 'write',
    'the failed fresh write check does not poison the still-valid read cache');
  delete provider.state.providerFailure;
  now += ACCESS_WINDOW_MS;
  assert.equal((await auth.authenticate(person.token, { board })).permission, 'write',
    'provider recovery is observed without a false negative-cache delay');
  const events = await fetch(`${origin}/api/v1/boards/${board}/events?after=0`, { headers });
  assert.equal(events.status, 200);
  assert.deepEqual((await events.json()).events, [], 'the unavailable permission check stores no move');
  const sent = await fetch(`${origin}/api/v1/boards/${board}/moves`, {
    method: 'POST', headers, body: JSON.stringify({ sequence: 1, sealed: 'Ag' }),
  });
  assert.equal(sent.status, 200);
  await sent.arrayBuffer();
  provider.state.providerFailure = { path: PERMISSION, status: 403, headers: {} };
  await assert.rejects(auth.authenticate(person.token, { board, write: true }), { code: 'NO_REPO_ACCESS' });
  await assert.rejects(auth.authenticate(person.token, { board }), { code: 'NO_REPO_ACCESS' },
    'a real denial still invalidates an allowed read');
});
