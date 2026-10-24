/** Match accepted candidates by their reviewed Git merge changes, never declared brief paths [B3,R3]. */
import { tryGit } from './git.js';
import { Refused } from './refused.js';

/** Preview one reviewed commit against the immutable trunk, including both sides of a rename. */
export function landingChangedFiles(root, base, commit) {
  const merged = tryGit(root, ['merge-tree', '--write-tree', '-z', base, commit]);
  const tree = merged.stdout.split('\0')[0];
  if (![0, 1].includes(merged.status) || !/^[a-f0-9]{40,64}$/u.test(tree)) {
    throw new Refused('LAND_MERGE', 'Git could not read the reviewed landing paths; restore its objects before composing the batch');
  }
  // Name-status starts with an ASCII status, so tryGit's trim cannot alter a leading-space path.
  // The final NUL also preserves trailing path whitespace; no-renames makes old and new paths explicit.
  const diff = tryGit(root, ['diff', '--name-status', '--no-renames', '-z', base, tree]);
  const fields = diff.stdout.split('\0');
  if (fields.at(-1) === '') fields.pop();
  if (diff.status !== 0 || fields.length % 2 || fields.some((value, index) => index % 2 === 0
    ? !/^[ADMTUXB]$/u.test(value) : !value)) {
    throw new Refused('LAND_MERGE', 'Git could not read the reviewed landing paths; restore its objects before composing the batch');
  }
  return fields.filter((_, index) => index % 2 === 1);
}
