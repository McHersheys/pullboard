/** Counts distinguish named rule gates from committed trunk execution evidence [S1,A1,A2]. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  mainCheckout,
  tryGit,
} from './git.js';
import { literalShellWords } from './literal-shell-words.js';
import { receiptFields } from './gate-run-receipt.js';

const WEEK = 7 * 86_400_000;
const FILE = /^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*\.(?:[cm]?js|cts)$/u;

/** Read schema-valid recorded runs only; old or incomplete receipts cannot prove a row. */
function runs(board) {
  return board.db.prepare("SELECT event_id, event_by, event_detail FROM event WHERE event_kind = 'gate-run' ORDER BY event_id").all().flatMap(row => {
    try {
      const run = receiptFields(JSON.parse(row.event_detail).run);
      return run ? [{ ...run, event: row.event_id, by: row.event_by }] : [];
    } catch { return []; }
  });
}

/** Only explicit test-file declarations identify a machine gate; review and opaque commands do not. */
function rowFiles(row) {
  const files = String(row.gate ?? '').split(',').map(file => file.trim().replace(/^\.\//u, ''));
  return files.length && files.every(file => FILE.test(file) && !file.split('/').includes('..')) ? files : [];
}

/** Parse one literal Node test selection without pretending filtered, sharded or unknown options ran the file. */
function selectedFiles(args, tracked, canonical) {
  const files = [];
  for (let at = 0; at < args.length; at += 1) {
    const arg = args[at];
    if (/^--test-concurrency=\d+$/u.test(arg)) continue;
    if (arg === '--test-concurrency') { if (!/^\d+$/u.test(args[++at] ?? '')) return []; continue; }
    if (arg.startsWith('-')) return [];
    const file = arg.replace(/^\.\//u, '');
    if (!FILE.test(file) || !tracked.has(file)) return [];
    files.push(file);
  }
  // The canonical runner deliberately selects tracked .test.js/.test.mjs entry points, not helper modules.
  if (!files.length) return canonical ? [...tracked]
    .filter(file => !file.split('/').some(part => part === 'node_modules' || part.startsWith('.')))
    .filter(file => /(?:^|\/)[^/]+\.test\.(?:js|mjs)$/u.test(file)) : [];
  return files;
}

/** Known external tools leave the parent shell's directory/environment intact; shell builtins do not. */
function keepsShellContext(words) {
  return words && (words[0] === 'node' || words[0] === process.execPath
    || words[0] === 'npm' && (words[1] === 'test' && words.length === 2 || words[1] === 'run' && words.length === 3));
}

/** Resolve supported configured test commands at the receipt's committed source; opaque commands prove no file. */
function includedFiles(root, commit, command, tracked, depth = 0) {
  if (depth > 4) return [];
  const words = literalShellWords(command);
  if (!words) {
    // A green AND chain proves its selected commands only if no earlier part changed the shell's cwd/environment.
    const parts = command.split(' && ');
    return parts.length > 1 && parts.every(part => keepsShellContext(literalShellWords(part)))
      ? parts.flatMap(part => includedFiles(root, commit, part, tracked, depth + 1)) : [];
  }
  if (words[0] === 'npm' && (words[1] === 'test' && words.length === 2 || words[1] === 'run' && words.length === 3)) {
    try {
      const source = tryGit(root, ['show', `${commit}:package.json`]);
      const manifest = JSON.parse(source.stdout);
      if (Object.hasOwn(manifest, 'workspaces') || tracked.has('.npmrc')) return [];
      const script = manifest.scripts?.[words[1] === 'test' ? 'test' : words[2]];
      return typeof script === 'string' ? includedFiles(root, commit, script, tracked, depth + 1) : [];
    } catch { return []; }
  }
  if (words[0] !== 'node' && words[0] !== process.execPath) return [];
  if (words[1] === '--test') return selectedFiles(words.slice(2), tracked, false);
  if (words[1]?.replace(/^\.\//u, '') === 'bin/run-tests.js' && tracked.has('bin/run-tests.js')) {
    const source = tryGit(root, ['show', `${commit}:bin/run-tests.js`]);
    if (source.status !== 0 || source.stdout !== readFileSync(new URL('../bin/run-tests.js', import.meta.url), 'utf8')) return [];
    return selectedFiles(words.slice(2), tracked, true);
  }
  return [];
}

/** Count the board's approved Spec rows against current trunk gates and independently recent trunk failures. */
export function ruleProofCounts(root, board, rows, { now = board.clock.now().getTime() } = {}) {
  const approved = rows.filter(row => row.status === 'approved');
  const gated = approved.filter(row => String(row.gate ?? '').trim());
  const counts = { approved: approved.length, gated: gated.length, ungated: approved.length - gated.length, proven: 0, unproven: gated.length, contradicted: 0 };
  if (!gated.length) return counts;
  const history = runs(board).filter(run => run.by === 'coordinator' && run.head === run.main && ['gate', 'land'].includes(run.kind));
  const failures = new Set(history.filter(run => !run.green && Date.parse(run.at) <= now && Date.parse(run.at) >= now - WEEK).flatMap(run => run.failures.map(failure => failure.file)));
  counts.contradicted = gated.filter(row => rowFiles(row).some(file => failures.has(file))).length;
  const trunk = mainCheckout(root);
  if (!trunk?.commit || !trunk.branch) return counts;
  try {
    const config = JSON.parse(tryGit(root, ['show', `${trunk.commit}:pullboard.json`]).stdout);
    if (typeof config.gate !== 'string' || !config.gate.trim()) return counts;
    const command = createHash('sha256').update(config.gate).digest('hex');
    const tree = tryGit(root, ['rev-parse', `${trunk.commit}^{tree}`]).stdout.trim();
    if (!history.some(run => run.green && run.head === trunk.commit && run.tree === tree && run.command === command)) return counts;
    const tracked = new Set(tryGit(root, ['ls-tree', '-rz', trunk.commit]).stdout.split('\0')
      .filter(entry => /^(?:100644|100755) blob /u.test(entry)).map(entry => entry.slice(entry.indexOf('\t') + 1)));
    const included = new Set(includedFiles(root, trunk.commit, config.gate, tracked));
    counts.proven = gated.filter(row => { const files = rowFiles(row); return files.length > 0 && files.every(file => included.has(file)); }).length;
    counts.unproven = gated.length - counts.proven;
  } catch { /* Missing committed inputs leave named gates unproven, never green. */ }
  return counts;
}

/** The time-dependent receipt window is a cache input, with an expiry even when no board event changes. */
export function ruleProofWindow(board, now) {
  const at = Date.parse(now);
  const candidates = runs(board).filter(run => !run.green && run.by === 'coordinator' && run.head === run.main);
  const active = candidates.filter(run => Date.parse(run.at) <= at && Date.parse(run.at) >= at - WEEK);
  const boundaries = candidates.flatMap(run => [Date.parse(run.at), Date.parse(run.at) + WEEK + 1]).filter(time => time > at);
  return { events: active.map(run => run.event), nextExpiry: boundaries.length ? new Date(boundaries.reduce((a, b) => Math.min(a, b))).toISOString() : null };
}
