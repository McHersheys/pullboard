/** Fresh, bounded Git facts for the ordinary resume card; detailed diagnostics stay explicit [N19,D1]. */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { realpathSync } from 'node:fs';
import { statSync } from 'node:fs';
import { join } from 'node:path';
import * as store from './board.js';
import { CONFIG_FILE } from './config.js';
import { DOCTRINE_FILE } from './config.js';
import { LEGACY_DOCTRINE_FILE } from './config.js';
import { configFromSource } from './config.js';
import { withCommittedFiles } from './committed-file-reader.js';
import { appliedDoctrine } from './doctrine.js';
import { doctrineFromSource } from './doctrine.js';
import { agentDoctrine } from './doctrine-rulings.js';
import { cleanGitEnvironment } from './git.js';
import { headCommit } from './git.js';
import { mainCheckout } from './git.js';
import { tryGit } from './git.js';
import { Refused } from './refused.js';

/** Compare actual filesystem identities without granting a guessed metadata parent project authority. */
function samePath(left, right) {
  try { return Boolean(left && right) && realpathSync.native(left) === realpathSync.native(right); }
  catch { return false; }
}

/** Read one NUL-delimited listing, so unusual path characters never become record separators. */
function worktrees(root) {
  const result = spawnSync('git', ['--no-replace-objects', '-c', 'core.quotepath=false', 'worktree', 'list', '--porcelain', '-z'], {
    cwd: root, env: cleanGitEnvironment(), encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
  });
  if (result.status !== 0) throw new Refused('NO_POLICY', 'the worktree facts could not be read; run pullboard resume --diagnostics');
  return result.stdout.split('\0\0').filter(Boolean).map(block => {
    const fields = block.split('\0');
    return { path: fields.find(field => field.startsWith('worktree '))?.slice(9),
      branch: fields.find(field => field.startsWith('branch '))?.slice(7) };
  });
}

/** Validate the primary's normal .git directory; separate metadata retains the established registry/Git fallback. */
async function primaryPath(info, listed) {
  const primary = listed[0]?.path;
  const marker = primary && join(primary, '.git');
  try {
    if (marker && statSync(marker).isDirectory() && samePath(marker, info.commonDir)) return primary;
  } catch { /* A missing or nonstandard primary must use the existing fail-closed resolver. */ }
  const { primaryCheckoutRoot } = await import('./cli.js');
  return primaryCheckoutRoot(info);
}

/** Read shared committed guidance and exact applied decisions through one Git child, not working-file authority. */
async function sharedDoctrine(ctx, board, primary, main) {
  if (!main?.commit) return agentDoctrine(ctx, board);
  const snapshot = await withCommittedFiles(ctx.info.root, async read => {
    const config = await read(main.commit, CONFIG_FILE);
    if (config === null) return ctx.doctrine;
    let name = configFromSource(config).practice;
    let source = await read(main.commit, name);
    if (source === null && [DOCTRINE_FILE, LEGACY_DOCTRINE_FILE].includes(name)) {
      const alias = name === DOCTRINE_FILE ? LEGACY_DOCTRINE_FILE : DOCTRINE_FILE;
      const other = await read(main.commit, alias);
      if (other !== null) { name = alias; source = other; }
    }
    return doctrineFromSource(source, name);
  });
  const file = primary && join(primary, snapshot.name);
  const current = file && existsSync(file) ? readFileSync(file, 'utf8') : null;
  return appliedDoctrine(snapshot, store.rowDecisions(board), current);
}

/** Keep the command's verified trunk/HEAD snapshot, current branch and complete shared doctrine together. */
export async function readResumeSources(ctx, board) {
  const root = ctx.info.root;
  const main = mainCheckout(root);
  const listed = worktrees(root);
  const primary = await primaryPath(ctx.info, listed);
  const current = listed.find(entry => samePath(entry.path, root));
  const branch = current ? current.branch?.replace(/^refs\/heads\//u, '') ?? 'HEAD'
    : tryGit(root, ['rev-parse', '--abbrev-ref', 'HEAD']).stdout || 'HEAD';
  let ahead;
  let behind;
  if (main?.commit && !ctx.info.isMain) {
    const head = headCommit(root);
    const compared = head && tryGit(root, ['rev-list', '--left-right', '--count', `${main.commit}...${head}`]);
    const counts = compared?.status === 0 && /^([0-9]+)\s+([0-9]+)$/u.exec(compared.stdout);
    if (!counts) throw new Refused('NO_POLICY', 'the branch could not be compared with main; run pullboard resume --diagnostics');
    behind = Number(counts[1]); ahead = Number(counts[2]);
  }
  return { doctrine: await sharedDoctrine(ctx, board, primary, main), branch, mainRef: main?.branch, ahead, behind };
}
