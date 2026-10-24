/** GUI requirements are explicit file metadata and fresh execution-user domain observations [C7,V4]. */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { testsNeedGui } from '../src/gui-admission.js';
import { guiSession } from '../src/gui-session.js';

test('GUI admission reads an explicit file marker rather than Chrome headless arguments [C7,V4]', t => {
  const root = mkdtempSync(join(tmpdir(), 'pullboard-gui-marker-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, 'native.test.js'), '/** @pullboard-test-gui */\nconst flags = ["--headless=new"];');
  writeFileSync(join(root, 'ordinary.test.js'), 'const flags = ["--headless=new"];');
  assert.equal(testsNeedGui(root, ['native.test.js']), true);
  assert.equal(testsNeedGui(root, ['ordinary.test.js']), false);
  assert.equal(testsNeedGui(root, ['missing.test.js']), false);
});

test('GUI-domain observations distinguish confirmed presence, known absence, and unknown [C7,V4]', () => {
  const calls = [];
  const present = guiSession({ platform: 'darwin', getuid: () => 501, run: (...args) => { calls.push(args); return { status: 0, signal: null }; } });
  assert.equal(present, true);
  assert.deepEqual(calls[0].slice(0, 2), ['/bin/launchctl', ['print', 'gui/501']]);
  assert.equal(calls[0][2].timeout, 1000);
  assert.equal(guiSession({ platform: 'darwin', getuid: () => 501, run: () => ({ status: 113, stderr: 'Could not find domain for\n' }) }), false);
  assert.equal(guiSession({ platform: 'darwin', getuid: () => 501, run: () => ({ status: 125, stderr: 'Could not print domain: 125: Domain does not support specified action\n' }) }), null);
  assert.equal(guiSession({ platform: 'darwin', getuid: () => 501, run: () => ({ status: 0, error: new Error('timeout') }) }), null);
  assert.equal(guiSession({ platform: 'darwin', getuid: () => 501, run: () => ({ status: null, signal: 'SIGKILL' }) }), null);
  assert.equal(guiSession({ platform: 'darwin', getuid: () => -1, run: () => { throw new Error('must not run'); } }), null);
  assert.equal(guiSession({ platform: 'linux', run: () => { throw new Error('must not run'); } }), null);
});
