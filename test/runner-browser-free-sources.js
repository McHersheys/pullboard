/** Generated browser-admission fixture source data [C7]. */
// Browser-bound only under the broad classifier: a Node child with no Chrome reference.
export const FREE = "import { test } from 'node:test';\nimport { spawnSync } from 'node:child_process';\n"
  + "test('browser-free file ran', () => { if (spawnSync(process.execPath, ['-e', '0']).status !== 0) throw new Error('child failed'); });\n";
// Browser-bound under either classifier: a process starter beside a Chrome executable name.
export const CHROME = "import { test } from 'node:test';\nimport { spawnSync } from 'node:child_process';\nconst chrome = 'google-chrome';\n"
  + "test('browser-bound file ran', () => { if (process.env.PULLBOARD_FIXTURE_NEVER_SET) spawnSync(chrome, ['--version']); });\n";
// A test body that prints and throws the refusal text: an ordinary red, never a lease refusal.
export const MARKER = "import { test } from 'node:test';\n"
  + "test('marker file ran', () => { console.log('[BROWSER_SLOT_REQUIRED] printed by a test'); throw new Error('[BROWSER_SLOT_REQUIRED] thrown by a test'); });\n";

