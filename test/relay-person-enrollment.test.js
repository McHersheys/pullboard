/** Independent person-root enrollment and opaque account envelopes [H15]. */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { test } from 'node:test';
import { createDeviceKeys } from '../src/relay-device-keys.js';

/** Load the independent verifier only after proving that the production capability exists. */
async function personAPI() {
  assert.equal(existsSync(new URL('../src/relay-person-keys.js', import.meta.url)), true,
    'an independent person-root verifier is required before relay enrollment can release a wrap');
  return await import('../src/relay-person-keys.js');
}

/** Bind the exact device key and board grants to a single person-authorized challenge. */
function request(keys, overrides = {}) {
  return { v: 1, account: '42', device: keys.deviceId, publicKey: keys.publicKey,
    origin: 'https://pullboard.example', nonce: Buffer.alloc(32, 17).toString('base64url'),
    expires: 1_800_000_060_000, grants: ['a'.repeat(32)], ...overrides };
}

test('person enrollment verifies the trusted root and exact account device origin nonce expiry grants [H15]', async () => {
  const api = await personAPI();
  const root = await api.createPersonRoot();
  const stranger = await api.createPersonRoot();
  const keys = await createDeviceKeys();
  const other = await createDeviceKeys();
  const body = request(keys);
  const expected = { account: body.account, origin: body.origin, nonce: body.nonce,
    grants: body.grants, now: 1_800_000_000_000 };
  const signed = await api.signPersonEnrollment(root.privateKey, body);
  assert.equal(root.privateKey.extractable, false);
  await assert.rejects(crypto.subtle.exportKey('jwk', root.privateKey));
  assert.equal(JSON.stringify(signed).includes('privateKey'), false);
  assert.deepEqual(await api.authenticatePersonEnrollment(root.publicKey, signed, expected), body);
  for (const changed of [
    { ...signed, publicKey: other.publicKey },
    { ...signed, device: other.deviceId },
    { ...signed, account: '43' },
    { ...signed, origin: 'https://relay-attacker.example' },
    { ...signed, nonce: Buffer.alloc(32, 18).toString('base64url') },
    { ...signed, expires: body.expires + 1 },
    { ...signed, grants: ['b'.repeat(32)] },
  ]) await assert.rejects(api.authenticatePersonEnrollment(root.publicKey, changed, expected),
    { code: 'PERSON_ENROLL_AUTH' });
  await assert.rejects(api.authenticatePersonEnrollment(stranger.publicKey, signed, expected),
    { code: 'PERSON_ENROLL_AUTH' }, 'a relay-supplied replacement trust root is not the locally trusted root');
  await assert.rejects(api.authenticatePersonEnrollment(root.publicKey, signed,
    { ...expected, now: body.expires }), { code: 'PERSON_ENROLL_EXPIRED' });
  await assert.rejects(api.authenticatePersonEnrollment(root.publicKey, signed,
    { ...expected, revoked: true }), { code: 'PERSON_ENROLL_REVOKED' });
});

test('account envelopes require independently retained key and exact account context [H15]', async () => {
  const api = await personAPI();
  const recovery = crypto.getRandomValues(new Uint8Array(32));
  const vault = crypto.getRandomValues(new Uint8Array(32));
  const context = { account: '42', keyId: 'person-root-1', revision: 1 };
  const envelope = await api.sealAccountEnvelope(recovery, vault, context);
  const again = await api.sealAccountEnvelope(recovery, vault, context);
  assert.notEqual(envelope.nonce, again.nonce);
  const serialized = JSON.stringify(envelope);
  for (const bytes of [recovery, vault]) assert.equal(serialized.includes(Buffer.from(bytes).toString('base64url')), false);
  assert.deepEqual(await api.openAccountEnvelope(recovery, envelope, context), vault);
  for (const expected of [{ ...context, account: '43' }, { ...context, revision: 2 }, { ...context, keyId: 'other-root' }]) {
    await assert.rejects(api.openAccountEnvelope(recovery, envelope, expected), { code: 'PERSON_ENVELOPE_AUTH' });
  }
  await assert.rejects(api.openAccountEnvelope(crypto.getRandomValues(new Uint8Array(32)), envelope, context),
    { code: 'PERSON_ENVELOPE_AUTH' });
  const tampered = { ...envelope, ciphertext: Buffer.alloc(48).toString('base64url') };
  await assert.rejects(api.openAccountEnvelope(recovery, tampered, context), { code: 'PERSON_ENVELOPE_AUTH' });
});
