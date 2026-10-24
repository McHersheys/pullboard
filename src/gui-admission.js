/** Explicit test-file desktop requirements, independent of Chrome command-line flags [C7,V4]. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { explicitCheckFiles } from './browser-admission.js';

/** Only an explicit file annotation requests a GUI; --headless does not establish this capability. */
export function testsNeedGui(root, files) {
  return files.some(file => {
    try { return /^\s*(?:\/\*\*?[^]*?@pullboard-test-gui\b[^]*?\*\/)/u.test(readFileSync(resolve(root, file), 'utf8')); }
    catch { return false; } // Missing files retain their normal execution failure; they cannot add an inferred capability.
  });
}

/** Read the project's tracked Node test files when an opaque full gate supplies no explicit selection. */
export function projectNeedsGui(root) {
  const result = spawnSync('git', ['ls-files', '-z', '--', 'test', 'tests'], { cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 ** 2 });
  return result.status === 0 && testsNeedGui(root, result.stdout.split('\0').filter(file => /\.test\.[cm]?js$/u.test(file)));
}

/** Classify an explicit accepted check by its selected files; opaque commands conservatively use the project's annotations. */
export async function checkNeedsGui(root, command) {
  const files = await explicitCheckFiles(root, command);
  return files ? testsNeedGui(root, files) : projectNeedsGui(root);
}
