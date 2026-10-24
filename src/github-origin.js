/** GitHub origin discovery without loading relay transport [C7,H16]. */
import { tryGit } from './git.js';
import { Refused } from './refused.js';

/** Resolve the actual GitHub origin; optional discovery leaves ineligible local projects alone. */
export function originRepository(root, { optional = false } = {}) {
  const remote = tryGit(root, ['remote', 'get-url', 'origin']);
  if (remote.status !== 0 && optional) return null;
  if (remote.status !== 0) throw new Refused('RELAY_ORIGIN', 'add a GitHub origin remote before running pullboard relay on');
  let repository;
  const ssh = /^git@github\.com:([^\s?#]+)$/.exec(remote.stdout);
  if (ssh) repository = ssh[1];
  else {
    try {
      const url = new URL(remote.stdout);
      if (url.hostname === 'github.com' && !url.password && !url.search && !url.hash &&
          ((url.protocol === 'https:' && !url.username) || (url.protocol === 'ssh:' && url.username === 'git')) && !url.port) repository = url.pathname.slice(1);
    } catch { /* A local path or another host is not a GitHub repository. */ }
  }
  repository = repository?.replace(/\.git$/, '');
  if (!repository || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository) || repository.split('/').some((part) => ['.', '..'].includes(part))) {
    if (optional) return null;
    throw new Refused('RELAY_ORIGIN', 'origin must name a GitHub owner/repository using HTTPS or git SSH; fix origin and run pullboard relay on');
  }
  return repository;
}
