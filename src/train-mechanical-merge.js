/** Conservative additive-only resolution of explicitly known registry/table regions [B3,R3,C7]. */
import { writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { cleanGitEnvironment } from './git.js';

/** Locate a known keyed region without interpreting or executing candidate JavaScript. */
function region(path, source) {
  const lines = source.split('\n');
  let start;
  let end;
  let key;
  if (path === 'src/api-moves.js') {
    start = lines.indexOf('const MOVES = {');
    end = lines.indexOf('};', start + 1);
    const field = "(?:[A-Za-z][A-Za-z0-9]*): (?:true|false|\\[(?:'[A-Za-z0-9-]+'(?:, '[A-Za-z0-9-]+')*)?\\])";
    const entry = new RegExp(`^  (?:'([a-z][a-z0-9-]*)'|([A-Za-z][A-Za-z0-9]*)): \\{ ${field}(?:, ${field})* \\},$`, 'u');
    key = line => entry.exec(line)?.slice(1).find(Boolean);
  } else if (path === 'docs/formats.md') {
    start = lines.indexOf('| Format | Version | Version source | Upgrade rule |');
    if (lines[start + 1] !== '| --- | --- | --- | --- |') return null;
    start += 1;
    end = lines.indexOf('<!-- format-versions:end -->', start + 1);
    key = line => /^\| `([^`|]+)` \| `\d+` \| .+ \| .+ \|$/u.exec(line)?.[1];
  } else return null;
  if (start < 0 || end <= start) return null;
  const entries = lines.slice(start + 1, end).map(line => ({ key: key(line), line }));
  if (entries.some(entry => !entry.key) || new Set(entries.map(entry => entry.key)).size !== entries.length) return null;
  return { prefix: lines.slice(0, start + 1).join('\n'), suffix: lines.slice(end).join('\n'), entries };
}

/** Only insertions are admissible: every original entry and every surrounding byte stays unchanged. */
function additions(base, side) {
  if (!side || side.prefix !== base.prefix || side.suffix !== base.suffix) return null;
  const original = new Map(base.entries.map(entry => [entry.key, entry.line]));
  let position = 0;
  const gaps = Array.from({ length: base.entries.length + 1 }, () => []);
  for (const entry of side.entries) {
    if (original.has(entry.key)) {
      if (base.entries[position]?.key !== entry.key || original.get(entry.key) !== entry.line) return null;
      position += 1;
    } else gaps[position].push(entry);
  }
  return position === base.entries.length ? gaps : null;
}

/** Preserve both contributors' entry order, using the key only to break independent insertion ties. */
function mergeGap(left, right) {
  const entries = new Map();
  const edges = new Map();
  for (const side of [left, right]) {
    for (const entry of side) {
      if (entries.has(entry.key) && entries.get(entry.key) !== entry.line) return null;
      entries.set(entry.key, entry.line);
      if (!edges.has(entry.key)) edges.set(entry.key, new Set());
    }
    for (let index = 1; index < side.length; index += 1) edges.get(side[index - 1].key).add(side[index].key);
  }
  const result = [];
  while (entries.size) {
    const key = [...entries.keys()].sort().find(candidate => ![...edges.values()].some(next => next.has(candidate)));
    if (key === undefined) return null;
    result.push({ key, line: entries.get(key) });
    entries.delete(key);
    edges.delete(key);
  }
  return result;
}

/** Return a union only when all three exact sources differ solely by permitted keyed insertions. */
export function mergeMechanicalSources(path, ancestor, ours, theirs) {
  const base = region(path, ancestor);
  if (!base) return null;
  const left = additions(base, region(path, ours));
  const right = additions(base, region(path, theirs));
  if (!left || !right) return null;
  const locations = new Map();
  const entries = [];
  for (let index = 0; index < left.length; index += 1) {
    const gap = mergeGap(left[index], right[index]);
    if (!gap) return null;
    for (const entry of gap) {
      if (locations.has(entry.key) && locations.get(entry.key) !== index) return null;
      locations.set(entry.key, index);
      entries.push(entry);
    }
    if (base.entries[index]) entries.push(base.entries[index]);
  }
  if (!locations.size) return null;
  return { source: [base.prefix, ...entries.map(entry => entry.line), base.suffix].join('\n'), keys: [...locations.keys()] };
}

/** Resolve every unmerged file together, or leave the entire merge untouched for normal reopening. */
export function resolveMechanicalMerge(root, files) {
  const resolutions = [];
  for (const path of files) {
    const index = spawnSync('git', ['--no-optional-locks', 'ls-files', '--stage', '-z', '--', path],
      { cwd: root, env: cleanGitEnvironment(), encoding: 'utf8' });
    const records = (index.stdout ?? '').split('\0').filter(Boolean);
    const modes = records.map(record => /^(100644|100755) [a-f0-9]+ [123]\t/u.exec(record)?.[1]);
    if (index.status !== 0 || records.length !== 3 || modes.some(mode => !mode || mode !== modes[0])) return null;
    const stages = [1, 2, 3].map(stage => spawnSync('git', ['--no-optional-locks', 'show', `:${stage}:${path}`],
      { cwd: root, env: cleanGitEnvironment(), encoding: 'utf8' }));
    if (stages.some(stage => stage.status !== 0)) return null;
    const merged = mergeMechanicalSources(path, ...stages.map(stage => stage.stdout));
    if (!merged) return null;
    resolutions.push({ path, ...merged });
  }
  for (const entry of resolutions) writeFileSync(join(root, entry.path), entry.source);
  return resolutions.map(({ path, keys }) => ({ path, keys }));
}
