/** Read only code-sign clones mapped by this launch's live process group [C7]. */
import { execFileSync } from 'node:child_process';
import { lstatSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** Resolve Apple's per-user cleanup-on-boot directory without trusting a supplied environment path. */
function cloneRoot() {
  const user = execFileSync('/usr/bin/getconf', ['DARWIN_USER_DIR'], { encoding: 'utf8', timeout: 2_000 }).trim();
  return realpathSync(join(dirname(user.replace(/\/$/u, '')), 'X'));
}

/** Capture directory identities only while the direct owned leader still reserves its group. */
export function observedChromeClones(child) {
  if (process.platform !== 'darwin' || !child?.pid || child.exitCode !== null || child.signalCode !== null) return [];
  const output = execFileSync('/bin/ps', ['-ww', '-axo', 'pid=,ppid=,pgid=,comm='], {
    encoding: 'utf8', timeout: 2_000, maxBuffer: 8 * 1024 * 1024,
  });
  const rows = output.split('\n').flatMap(line => {
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/u.exec(line);
    return match ? [{ pid: Number(match[1]), ppid: Number(match[2]), pgid: Number(match[3]), executable: match[4] }] : [];
  });
  if (!rows.some(row => row.pid === child.pid && row.ppid === process.pid && row.pgid === child.pid)) return [];
  const root = cloneRoot();
  const found = new Map();
  for (const row of rows.filter(row => row.pgid === child.pid)) {
    const directory = /^(.*\/(?:com\.google\.Chrome|org\.chromium\.Chromium)\.code_sign_clone\/code_sign_clone\.[A-Za-z0-9]{6})(?:\/|$)/u.exec(row.executable)?.[1];
    if (!directory) continue;
    try {
      const canonical = realpathSync(directory);
      if (canonical !== directory || dirname(dirname(canonical)) !== root) continue;
      const stat = lstatSync(canonical);
      if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid()) continue;
      found.set(canonical, { path: canonical, dev: stat.dev, ino: stat.ino });
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return [...found.values()];
}
