import { outsideSensitivity } from './outside-sensitive.js';
/** Read GitHub public source metadata; never post, execute PR programs or use its executable settings. */
import { spawnSync } from 'node:child_process';
import { Refused } from './refused.js';
import { git } from './git.js';

/** Recognize one public GitHub issue or pull URL without allowing arbitrary API/fetch endpoints. */
export function outsideURL(value) {
  const match = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\/(pull|issues)\/([1-9][0-9]*)\/?$/u.exec(value ?? '');
  if (!match || !Number.isSafeInteger(Number(match[3]))) throw new Refused('OUTSIDE_URL', 'use a GitHub pull request or issue URL: pullboard intake https://github.com/owner/repo/pull/123');
  return { repository: match[1], kind: match[2] === 'pull' ? 'pull-request' : 'issue', number: Number(match[3]) };
}

/** A bounded read-only GitHub API request; authenticated gh never receives a posting verb. */
function read(root, route) {
  const result = spawnSync('gh', ['api', '--paginate', '--slurp', route], { cwd: root, encoding: 'utf8', timeout: 30_000, maxBuffer: 8 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Refused('OUTSIDE_FETCH', 'GitHub metadata could not be read; authenticate gh for this repository, then run intake again');
  try { const value = JSON.parse(result.stdout); return Array.isArray(value) && value.every(Array.isArray) ? value.flat() : Array.isArray(value) && value.length === 1 && !Array.isArray(value[0]) ? value[0] : value; }
  catch { throw new Refused('OUTSIDE_FETCH', 'GitHub returned unreadable metadata; restore gh API access before intake'); }
}

/** Fetch exact PR objects using Git only; preserve author and sign-off by never rewriting its commit. */
export function githubSource(root, url) {
  const source = outsideURL(url);
  const prefix = `repos/${source.repository}`;
  const data = read(root, `${prefix}/${source.kind === 'pull-request' ? 'pulls' : 'issues'}/${source.number}`);
  const comments = read(root, `${prefix}/issues/${source.number}/comments?per_page=100`);
  const reviews = source.kind === 'pull-request' ? read(root, `${prefix}/pulls/${source.number}/reviews?per_page=100`) : [];
  const replies = [...(Array.isArray(comments) ? comments : []), ...(Array.isArray(reviews) ? reviews : [])];
  const common = { ...source, url, title: String(data.title ?? ''), author: data.user?.login, state: data.state,
    maintainerReplied: replies.some(comment => ['OWNER', 'MEMBER', 'COLLABORATOR'].includes(comment.author_association)), updatedAt: data.updated_at };
  if (source.kind === 'issue') return common;
  if (!/^[a-f0-9]{40}$/u.test(data.head?.sha ?? '') || !/^[a-f0-9]{40}$/u.test(data.base?.sha ?? '')) throw new Refused('OUTSIDE_FETCH', 'GitHub did not return exact commit IDs; read the pull request again');
  const files = read(root, `${prefix}/pulls/${source.number}/files?per_page=100`);
  if (!Array.isArray(files) || files.length >= 100) throw new Refused('OUTSIDE_FETCH', 'this pull request needs a complete bounded changed-file list; split it below 100 files before intake');
  // The server-owned pull ref, rather than the contributor-controlled clone URL, supplies objects.
  git(root, ['fetch', '--no-tags', '--no-recurse-submodules', `https://github.com/${source.repository}.git`, `refs/pull/${source.number}/head`]);
  const fetched = git(root, ['rev-parse', 'FETCH_HEAD^{commit}']).trim();
  if (fetched !== data.head.sha) throw new Refused('OUTSIDE_HEAD_CHANGED', 'the pull request moved while intake fetched it; read and intake its new exact head');
  const paths = [...new Set(files.flatMap(file => [file.filename, ...(file.previous_filename ? [file.previous_filename] : [])]))];
  if (paths.some(path => typeof path !== 'string' || path.includes('\n') || path.startsWith('/') || path.split('/').includes('..'))) throw new Refused('OUTSIDE_FETCH', 'GitHub returned an invalid changed path; restore its file metadata');
  const changed = git(root, ['diff', '--no-ext-diff', '--no-textconv', '--no-renames', '--name-only', '-z', `${data.base.sha}...${fetched}`]).split('\0').filter(Boolean);
  if (changed.length !== paths.length || changed.some(path => !paths.includes(path))) throw new Refused('OUTSIDE_FETCH', 'the changed-file list differs from the fetched exact commit; refresh GitHub metadata');
  const sensitivity = outsideSensitivity(root, data.base.sha, fetched, paths);
  return { ...common, commit: fetched, tree: git(root, ['rev-parse', `${fetched}^{tree}`]).trim(), base: data.base.sha, files: paths, sensitivity, sensitive: sensitivity.length > 0 };
}
