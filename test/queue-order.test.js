/** Local release completion and deterministic ordering boundaries [C7,V4]. */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { addItem, addMilestone, closeBoard, openBoard } from '../src/board.js';
import { runFixtureGit } from './fixture-child.js';
import { captureReleaseQueue, localReleaseRank } from '../src/release-queue.js';
import { orderedWaiters } from '../src/queue-order.js';

test('release priority uses only local verified work, leaving external references alone [C7,V4]', () => {
  const releases = [
    { items: [{ id: 'elsewhere#1', status: 'unavailable' }, { id: 1, status: 'verified' }] },
    { items: [{ id: 2, status: 'claimed' }] },
    { items: [{ id: 3, status: 'open' }] },
  ];
  assert.deepEqual([1, 2, 3, 4].sort((a, b) => localReleaseRank(releases, a) - localReleaseRank(releases, b)), [2, 3, 1, 4],
    'an unknown external reference cannot make completed local work outrank the current release');
  const localOnly = releases.map(release => ({ items: release.items.filter(entry => typeof entry.id === 'number') }));
  assert.deepEqual([1, 2, 3, 4].map(id => localReleaseRank(releases, id)), [1, 2, 3, 4].map(id => localReleaseRank(localOnly, id)));
});

test('release ordering preserves opportunity positions and already aged arrivals [C7,V4]', () => {
  const now = Date.UTC(2026, 9, 17, 2);
  const order = { reviewsFirst: false, currentReleaseFirst: true, ageMs: 60_000 };
  /** Build one otherwise-tied waiter with a captured board rank and controlled age. */
  const row = (ticket, board, rank, waited = 0) => ({ ticket, board_key: board, release_rank: rank, release_aware: 1, since: new Date(now - waited).toISOString() });
  const line = [row(1, 'A', 2), row(2, 'B', 0), row(3, 'A', 0)];
  const ordered = orderedWaiters(line, now, order);
  assert.deepEqual(ordered.map(entry => entry.ticket), [3, 2, 1]);
  assert.deepEqual(ordered.map(entry => entry.queue_ticket ?? entry.ticket), [1, 2, 3]);
  const remaining = ordered.filter(entry => entry.ticket !== 3);
  assert.deepEqual(orderedWaiters(remaining, now, order).map(entry => entry.ticket), [2, 1], 'consumed opportunities cannot be reused');
  assert.deepEqual(orderedWaiters([row(1, 'A', 2, 61_000), row(2, 'A', 0)], now, order).map(entry => entry.ticket), [1, 2],
    'release-only admission also protects an aged unplanned run');
});

test('a run from a private clone keeps its release rank [C7,O5]', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pullboard-clone-rank-'));
  try {
    const env = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))), GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
      GIT_AUTHOR_NAME: 'F', GIT_AUTHOR_EMAIL: 'f@example.invalid', GIT_COMMITTER_NAME: 'F', GIT_COMMITTER_EMAIL: 'f@example.invalid' };
    const git = (cwd, ...args) => runFixtureGit(args, { cwd, env, encoding: 'utf8', stdio: 'pipe' });
    const repo = join(dir, 'repo');
    mkdirSync(repo);
    git(repo, 'init', '-q', '-b', 'main');
    git(repo, 'commit', '-q', '--allow-empty', '-m', 'chore: init');
    mkdirSync(join(repo, '.git', 'pullboard'));
    const board = openBoard(join(repo, '.git', 'pullboard', 'board.sqlite'));
    const current = addItem(board, { by: 'coordinator', lane: 'web', title: 'Current' });
    const later = addItem(board, { by: 'coordinator', lane: 'web', title: 'Later' });
    addMilestone(board, { agentId: 'coordinator', name: 'Now', items: [current] });
    addMilestone(board, { agentId: 'coordinator', name: 'Next', items: [later] });
    closeBoard(board);
    const clone = join(dir, 'clone');
    git(dir, 'clone', '-q', '--shared', repo, clone);
    const fromClone = captureReleaseQueue(clone, current);
    const fromBoard = captureReleaseQueue(repo, current);
    assert.ok(fromClone, 'the clone finds the board it was cloned from');
    assert.deepEqual(fromClone, fromBoard, 'the clone and the board checkout see the same board and rank');
    const now = Date.UTC(2026, 9, 17, 2);
    const order = { reviewsFirst: false, currentReleaseFirst: true, ageMs: 60_000 };
    const row = (ticket, queued) => ({ ticket, board_key: queued.board, release_rank: queued.rank, release_aware: 1, since: new Date(now).toISOString() });
    const ordinary = row(1, captureReleaseQueue(repo, later));
    const cloned = row(2, fromClone);
    assert.deepEqual(orderedWaiters([ordinary, cloned], now, order).map(entry => entry.ticket), [2, 1], 'the clone-started current-release run is admitted first');
    assert.equal(captureReleaseQueue(dir, current), undefined, 'a directory with no board keeps its queue position');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
