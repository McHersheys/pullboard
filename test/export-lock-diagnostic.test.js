/** Temporary private live-lock diagnostic for #1181; not a product acceptance contract [A7,H16,C7]. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { locked } from '../src/relay-lock.js';
import { legacyRelayClientFixture } from './relay-client-fixture.js';

test('private export diagnostic distinguishes a live relay lock from local export work [A7,H16,C7]', async t => {
  const box = await legacyRelayClientFixture(t);
  await box.link();
  let acquired;
  let release;
  const ready = new Promise(resolve => { acquired = resolve; });
  const released = new Promise(resolve => { release = resolve; });
  const holder = locked(box.linkFile, async () => {
    t.diagnostic('private relay lock acquired by diagnostic process ' + process.pid);
    acquired();
    await released;
  });
  await ready;
  try {
    const result = await box.cliWithSnapshotUploads(0, 'export');
    assert.equal(result.code, 0, 'a local export should complete while the independent private relay sender is held');
  } finally {
    release();
    await holder;
    t.diagnostic('private relay lock released');
  }
});
