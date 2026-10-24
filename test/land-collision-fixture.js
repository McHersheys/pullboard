/** Exercise collision-free batches against real private Git, hooks, board settings and remotes [B3,R3,R1]. */
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import * as store from '../src/board.js';

/** Same-path independent edits split only when enabled; a disjoint item still rides the first batch. */
export function assertCollisionFreeLanding({ landProject, itemWorktree, submitItem, acceptItem, json, onBoard }) {
  for (const enabled of [false, true]) {
    const box = landProject();
    const shared = 'web/land-1.test.js';
    writeFileSync(join(box.repo, shared), 'BASE first\nunchanged middle\nBASE last\n');
    box.git(box.repo, 'add', shared);
    box.git(box.repo, 'commit', '-q', '-m', 'test: shared landing base [G1]');
    const entries = [itemWorktree(box, 1, shared), itemWorktree(box, 2, shared), itemWorktree(box, 3)];
    submitItem(box, entries[0], 'A first\nunchanged middle\nBASE last\n');
    submitItem(box, entries[1], 'BASE first\nunchanged middle\nB last\n');
    submitItem(box, entries[2]);
    for (const entry of entries) acceptItem(box, entry);
    if (enabled) onBoard(box, board => store.setLineSetting(board, { agentId: 'coordinator', key: 'collisionFreeBatch', value: true,
      reason: 'private same-path accepted items must land separately', window: { accepted: 3 } }));
    else onBoard(box, board => assert.equal(store.lineSettings(board).collisionFreeBatch ?? false, false));
    const first = json(box, box.repo, 'land', '--max', '3');
    assert.deepEqual(first.landed, (enabled ? [entries[0], entries[2]] : entries).map(entry => entry.item));
    assert.deepEqual(first.conflicts, []);
    assert.deepEqual(first.culprits, []);
    if (enabled) {
      assert.equal(json(box, box.repo, 'show', String(entries[1].item)).item_status, 'verified', 'deferred overlap keeps its verdict');
      const second = json(box, box.repo, 'land', '--max', '3');
      assert.deepEqual(second.landed, [entries[1].item], 'the deferred item leads the next batch');
      assert.deepEqual(second.conflicts, []);
      assert.deepEqual(second.culprits, []);
    }
    for (const entry of entries) {
      const item = json(box, box.repo, 'show', String(entry.item));
      assert.equal(item.item_status, 'verified');
      assert.ok(item.item_merged_commit, 'every accepted item lands without reopening');
    }
    assert.equal(box.git(box.repo, 'show', 'main:' + shared), 'A first\nunchanged middle\nB last');
    assert.equal(box.git(box.remote, 'rev-parse', 'main'), box.git(box.repo, 'rev-parse', 'main'), 'the actual gated tip was pushed');
  }
}
