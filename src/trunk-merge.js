/** In-memory Git conflict computation without loading check execution or resource admission [V4,C7]. */
import { spawnSync } from 'node:child_process';
import { cleanGitEnvironment } from './git.js';
import { mainCheckout } from './git.js';
import { trunkRef } from './trusted-policy-read.js';
import { Refused } from './refused.js';

/** Merge a commit onto the trunk tip in memory: the ref, the tip, and the conflicting files or null [B34,V6].
 *
 * @param {string} root
 * @param {string} commit
 * @param {string} [retainedRef]
 * @returns {{ ref: string, commit: string, files: string[] | null }}
 */
export function trunkMerge(root, commit, retainedRef = trunkRef(root)) {
  const checkout = mainCheckout(root);
  const branchRef = checkout?.branch ?? retainedRef;
  if (!branchRef?.startsWith('refs/heads/')) throw new Refused('NO_TRUNK', 'no trunk branch was recorded; check out the trunk branch in the main checkout once and run pullboard inbox');
  const tip = spawnSync('git', ['--no-replace-objects', 'rev-parse', '--verify', '--quiet', branchRef + '^{commit}'], { cwd: root, env: cleanGitEnvironment(), encoding: 'utf8' });
  if (tip.status !== 0) throw new Refused('NO_TRUNK', 'the recorded trunk branch has no readable tip; check out the trunk branch in the main checkout once and run pullboard inbox');
  const result = spawnSync('git', ['--no-replace-objects', '-c', 'core.quotepath=false', 'merge-tree', '--write-tree', '--name-only', '-z', tip.stdout.trim(), commit], {
    cwd: root, env: cleanGitEnvironment(), encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
  });
  if (result.status === 0) return { ref: branchRef, commit: tip.stdout.trim(), files: null };
  if (result.status !== 1) throw new Refused('MERGE_CHECK_FAILED', 'Git could not check the candidate against the trunk; use Git 2.38 or newer, restore its objects and retry');
  const records = result.stdout.split('\0').slice(1);
  const end = records.indexOf('');
  return { ref: branchRef, commit: tip.stdout.trim(), files: records.slice(0, end < 0 ? records.length : end) };
}


/** Verify exactly the recorded immutable commits, independent of this machine's current trunk. */
export function recordedTrunkMerge(gitDirectory, head, trunk) {
  const result = spawnSync('git', ['--no-replace-objects', `--git-dir=${gitDirectory}`, '-c', 'core.quotepath=false',
    'merge-tree', '--write-tree', '--name-only', '-z', trunk, head], {
    env: cleanGitEnvironment(), encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
  });
  if (result.status === 0) return null;
  if (result.status !== 1) throw new Refused('MERGE_CHECK_FAILED', 'fetch the recorded submitted and trunk commits, then resume this move; Git could not verify its immutable conflict');
  const records = result.stdout.split('\0').slice(1), end = records.indexOf('');
  return records.slice(0, end < 0 ? records.length : end);
}
