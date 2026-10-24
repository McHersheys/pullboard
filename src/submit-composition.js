/** Opted-in submission proofs run a committed composition with the pinned current trunk [M1,V4]. */
import { contains } from './git.js';
import { Refused } from './refused.js';

/** Refuse before execution, and again after it, if the exact main snapshot was not proved. */
export function requireSubmitComposition(root, candidate, trunk, expectedMain) {
  if (trunk.commit !== expectedMain || !contains(root, trunk.commit, candidate)) {
    throw new Refused('MAIN_NOT_COMPOSED', `the submission must contain current main ${trunk.commit.slice(0,12)} and prove that same snapshot; merge main into this worktree, commit the composition, then run pullboard submit <id> again`);
  }
}
