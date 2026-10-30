/** Lossless front coding at the move boundary; stored review paths remain exact literal strings. */
import { createHash } from 'node:crypto';
import { Refused } from './refused.js';
import { COMPACT_VERDICT_REVIEW_ENGINE } from './compact-verdict-review-engine.js';

const FORMAT = 'pullboard-review-path-prefix-v1';
// Same maximum as the existing Git path-capture reader, not a worker resource quota.
const MAX_BYTES = 32 * 1024 * 1024;
/** Measure the UTF-8 wire size, including non-ASCII filenames. */
const bytes = text => new TextEncoder().encode(text).length;
/** Bind the complete expanded JSON array, not just the encoded suffixes. */
const hash = text => createHash('sha256').update(text).digest('hex');
/** Refuse without guessing coverage or exposing any path. */
const bad = () => new Refused('BAD_VERDICT_REVIEW', 'the lossless review paths are invalid; retain the original move and restore its exact encoded paths');

/** Match the native review validator's literal repository-relative path grammar. */
function validPath(path) {
  return typeof path === 'string' && !path.includes('\0') && path.split('/').every(part => part && part !== '.' && part !== '..');
}

/** Count shared UTF-16 code units; slice uses the same units, including split surrogate pairs. */
function prefixOf(a, b) {
  let n = 0; while (n < a.length && n < b.length && a[n] === b[n]) n += 1; return n;
}

/** Encode a sorted unique literal array without dropping or generalizing any path. */
export function compactReviewPaths(paths) {
  if (!Array.isArray(paths) || !paths.every(validPath) || JSON.stringify(paths) !== JSON.stringify([...new Set(paths)].sort())) throw bad();
  const text = JSON.stringify(paths), size = bytes(text);
  if (size > MAX_BYTES) throw bad();
  let previous = '';
  const entries = paths.map(path => { const n = prefixOf(previous, path), row = [n, path.slice(n)]; previous = path; return row; });
  return { format: FORMAT, bytes: size, sha256: hash(text), entries };
}

/** Bound expansion and validate canonical order, length and digest before native verification. */
export function expandReviewPaths(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).sort().join(',') !== 'bytes,entries,format,sha256' || value.format !== FORMAT
      || !Number.isSafeInteger(value.bytes) || value.bytes < 2 || value.bytes > MAX_BYTES
      || typeof value.sha256 !== 'string' || !/^[0-9a-f]{64}$/u.test(value.sha256) || !Array.isArray(value.entries) || value.entries.length > value.bytes) throw bad();
  let previous = '', size = 2;
  const paths = [];
  for (const row of value.entries) {
    if (!Array.isArray(row) || row.length !== 2 || !Number.isSafeInteger(row[0]) || row[0] < 0
        || row[0] > previous.length || typeof row[1] !== 'string' || bytes(row[1]) > value.bytes) throw bad();
    const path = previous.slice(0, row[0]) + row[1];
    size += bytes(JSON.stringify(path)) + (paths.length ? 1 : 0);
    if (size > value.bytes || !validPath(path) || paths.length && previous >= path || prefixOf(previous, path) !== row[0]) throw bad();
    paths.push(path); previous = path;
  }
  const text = JSON.stringify(paths);
  if (size !== value.bytes || hash(text) !== value.sha256) throw bad();
  return paths;
}

/** Compact only when smaller; preserve the caller's args and every other move field. */
export function compactReviewMove(move) {
  if (move.operation !== 'verify' || !Array.isArray(move.args?.[1]?.review?.paths)) return move;
  const paths = compactReviewPaths(move.args[1].review.paths);
  if (bytes(JSON.stringify(paths)) >= bytes(JSON.stringify(move.args[1].review.paths))) return move;
  return { ...move, engine: Math.max(move.engine, COMPACT_VERDICT_REVIEW_ENGINE), args: [move.args[0],
    { ...move.args[1], review: { ...move.args[1].review, paths } }, ...move.args.slice(2)] };
}

/** Stop a compact envelope mislabeled as an older feature engine before receipt or cursor writes. */
export function requireCompactReviewEngine(move) {
  const paths = move?.operation === 'verify' ? move.args?.[1]?.review?.paths : undefined;
  if (paths !== undefined && !Array.isArray(paths) && move.engine < COMPACT_VERDICT_REVIEW_ENGINE)
    throw new Refused('ENGINE_VERSION', 'compact review paths require the lossless review-path engine; do not replay or discard this move with an older reader');
}

/** Expand only wire paths; the board and its freshness projector still receive the original array. */
export function expandReviewArgs(move, args) {
  requireCompactReviewEngine(move);
  if (move.operation === 'verify' && args[1]?.review && !Array.isArray(args[1].review.paths))
    args[1].review.paths = expandReviewPaths(args[1].review.paths);
  return args;
}
