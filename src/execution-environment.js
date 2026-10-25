import {
  lstatSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import {
  join,
  relative,
} from 'node:path';
import { pathToFileURL } from 'node:url';

/** Exact executor identity for gate receipts and landing policy [E27,E28]. */

/** Capture this process on the host that actually executes the command. */
export function executionEnvironment() {
  return { platform: process.platform, arch: process.arch, node: process.versions.node };
}

/** Validate bounded identity without substituting this host for an unknown old receipt. */
export function environmentProblem(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== 3 || !['platform', 'arch', 'node'].every(key => Object.hasOwn(value, key))) return 'needs platform, arch and node';
  if (!['platform', 'arch'].every(key => typeof value[key] === 'string' && /^[a-z0-9_]{1,32}$/u.test(value[key]))) return 'platform and arch are bounded system identifiers';
  if (typeof value.node !== 'string' || value.node.length > 80 || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u.test(value.node)) return 'node names one exact Node version';
  return '';
}

/** Require all three exact fields; unknown historical environments never match by inference. */
export function sameEnvironment(left, right) {
  return !environmentProblem(left) && !environmentProblem(right)
    && ['platform', 'arch', 'node'].every(key => left[key] === right[key]);
}

/** Name an executor when an old verdict differs from its landing host. */
export function environmentLabel(value) {
  return environmentProblem(value) ? 'an unknown environment' : `${value.platform}/${value.arch}, Node ${value.node}`;
}

/** Typed landing fields require the engine that understands their hold and executor semantics. */
export function carriesLandingEnvironment(batch) {
  return ['environment', 'environmentWarnings', 'testDefects'].some(key => Object.hasOwn(batch ?? {}, key))
    || batch?.state === 'test-defect' || Array.isArray(batch?.gateResults) && batch.gateResults.some(gate => Object.hasOwn(gate ?? {}, 'environment'));
}


/** The exact trusted preload reports from inside each Node process, independently of its launcher. */
export function runtimeCaptureSource(directory) {
  return `import { writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
const directory=${JSON.stringify(directory)};
const file=directory+'/runtime-'+process.pid+'-'+randomUUID()+'.json';
writeFileSync(file,JSON.stringify({pid:process.pid,environment:{platform:process.platform,arch:process.arch,node:process.version.slice(1)},file:null}),{flag:'wx',mode:0o400});
// Node's --test parent only starts workers; retain capture until the actual test process boots.
// User code sees its original NODE_OPTIONS, not this recorder's injected option.
if (!process.execArgv.includes('--test')) {
  const token='--import='+import.meta.url;
  const options=process.env.NODE_OPTIONS;
  if (options===token) delete process.env.NODE_OPTIONS;
  else if (options?.endsWith(' '+token)) process.env.NODE_OPTIONS=options.slice(0,-token.length-1);
}
`;
}

/** Reuse only the exact native recorder for an admitted worker after its parent restores caller options. */
export function testRuntimeImport(directory = process.env.PULLBOARD_RUNTIME_CAPTURE_DIR) {
  if (!directory) return null;
  const file = join(directory, 'test-runtime-preload.mjs');
  try {
    return readFileSync(file, 'utf8') === runtimeCaptureSource(directory) ? pathToFileURL(file).href : null;
  } catch { return null; /* An absent or foreign recorder never becomes an import. */ }
}

/** Bind a closed admitted worker's self-report to the file selected by its parent, never by test stdout. */
export function bindTestRuntime(pid, file) {
  const directory = process.env.PULLBOARD_RUNTIME_CAPTURE_DIR;
  if (!directory) return null;
  try {
    const names = readdirSync(directory).filter(name => name.startsWith('runtime-' + pid + '-') && name.endsWith('.json'));
    if (names.length !== 1) return false;
    const path = join(directory, names[0]);
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.mode & 0o222) return false;
    const own = JSON.parse(readFileSync(path, 'utf8'));
    if (own.pid !== pid || own.file !== null || environmentProblem(own.environment)) return false;
    const bound = { pid, environment: own.environment, file: relative(process.cwd(), file).replaceAll('\\', '/') };
    if (!testRuntimeRows([bound])) return false;
    writeFileSync(join(directory, 'binding-' + pid + '.json'), JSON.stringify({ pid, file: bound.file }), { flag: 'wx', mode: 0o600 });
    return true;
  } catch { return false; /* A missing child report cannot be replaced by the parent's identity. */ }
}

/** Validate bounded self-reported child rows; historical absence remains unknown. */
export function testRuntimeRows(value) {
  if (value === null) return null;
  if (!Array.isArray(value) || !value.length || value.length > 100_000) return null;
  const rows = [];
  const pids = new Set();
  for (const row of value) {
    if (!row || Object.keys(row).sort().join(',') !== 'environment,file,pid'
      || !Number.isSafeInteger(row.pid) || row.pid < 1 || pids.has(row.pid) || environmentProblem(row.environment)
      || row.file !== null && (typeof row.file !== 'string' || !row.file || row.file.length > 4096 || /[\r\n\0\\]/u.test(row.file) || row.file.startsWith('/') || /^[A-Za-z]:/u.test(row.file)
        || row.file.split('/').some(part => !part || part === '.' || part === '..'))) return null;
    pids.add(row.pid);
    rows.push({ pid: row.pid, environment: { ...row.environment }, file: row.file });
  }
  return rows;
}

/** Keep the common actual test-child identity only when every selected child agrees; otherwise unknown. */
export function testRuntimeEnvironment(rows) {
  const checked = testRuntimeRows(rows);
  if (!checked) return null;
  const files = checked.filter(row => row.file !== null);
  const selected = files.length ? files : checked;
  const first = selected[0].environment;
  return selected.every(row => sameEnvironment(first, row.environment)) ? { ...first } : null;
}

/** Capture actual Node children in a private run directory without changing test output or the machine pool. */
export function captureTestRuntimes(env) {
  const directory = mkdtempSync(join(tmpdir(), 'pullboard-test-runtimes-'));
  const preload = join(directory, 'test-runtime-preload.mjs');
  writeFileSync(preload, runtimeCaptureSource(directory), { flag: 'wx', mode: 0o600 });
  let finished = false;
  return {
    env: { ...env, NODE_OPTIONS: [env.NODE_OPTIONS, '--import=' + pathToFileURL(preload).href].filter(Boolean).join(' '),
      PULLBOARD_RUNTIME_CAPTURE_DIR: directory },
    /** Read bounded child reports only after command close, then remove the private capture directory. */
    finish() {
      if (finished) return null;
      finished = true;
      try {
        const names = readdirSync(directory).filter(name => /^runtime-[0-9]+-[a-f0-9-]+\.json$/u.test(name));
        if (names.length > 100_000) return null;
        const rows = [];
        let bytes = 0;
        for (const name of names.sort()) {
          const file = join(directory, name);
          const stat = lstatSync(file);
          bytes += stat.size;
          if (!stat.isFile() || stat.mode & 0o222 || stat.size > 8192 || bytes > 8 * 1024 * 1024) return null;
          const row = JSON.parse(readFileSync(file, 'utf8'));
          if (row.file !== null) return null;
          const binding = join(directory, 'binding-' + row.pid + '.json');
          try {
            const boundStat = lstatSync(binding);
            if (!boundStat.isFile() || boundStat.size > 8192) return null;
            const bound = JSON.parse(readFileSync(binding, 'utf8'));
            if (Object.keys(bound).sort().join(',') !== 'file,pid' || bound.pid !== row.pid) return null;
            row.file = bound.file;
          } catch (error) { if (error.code !== 'ENOENT') return null; }
          rows.push(row);
        }
        const checked = testRuntimeRows(rows);
        if (!checked) return null;
        const files = checked.filter(row => row.file !== null);
        return files.length ? files : checked;
      } catch { return null; /* Missing or incomplete self-reports stay unknown, never become the launcher runtime. */ }
      finally { rmSync(directory, { recursive: true, force: true }); }
    },
  };
}
