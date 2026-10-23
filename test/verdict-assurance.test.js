/** Assurance distinguishes recorded parent independence from procedural review [V1,B3]. */
import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import * as store from '../src/board.js';
import { main } from '../src/cli.js';
import { runFixtureGit } from './fixture-child.js';
import { submitFixture } from './board-submit-fixture.js';

/** Real Git and SQLite, with one item per independently declared parent pair. */
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'pullboard-verdict-assurance-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  runFixtureGit(['init', '-q', '-b', 'main'], { cwd: root });
  writeFileSync(join(root, 'pullboard.json'), JSON.stringify({ gate: 'true', lanes: { web: { owns: ['web/'] } } }));
  writeFileSync(join(root, 'SPEC.md'), '# Assurance fixture\n## G\n- G1 [approved, must] Reviews state their assurance. | gate: true\n');
  mkdirSync(join(root, '.git', 'pullboard'), { recursive: true });
  const board = store.openBoard(join(root, '.git', 'pullboard', 'board.sqlite'));
  t.after(() => store.closeBoard(board));
  return { root, board };
}

/** Build and accept once without inventing a gate execution for the board-state fixture. */
function accepted(box, builderParent, reviewerParent) {
  const number = store.listAgents(box.board).length;
  const builderPath = join(box.root, `builder-${number}`);
  const reviewerPath = join(box.root, `reviewer-${number}`);
  const builder = store.register(box.board, { lane: 'web', path: builderPath, parent: builderParent });
  const reviewer = store.register(box.board, { lane: 'web', path: reviewerPath, parent: reviewerParent });
  const id = store.addItem(box.board, { by: 'coordinator', lane: 'web', title: 'Assurance evidence', criterion: 'Review states its assurance', check: 'true' });
  const digest = 'f'.repeat(64);
  store.claim(box.board, id, { agentId: builder, lane: 'web', leaseMs: 3600000,
    freeze: () => ({ text: JSON.stringify({ rows: [] }), digest }) });
  const commit = String(id).padStart(40, 'a');
  submitFixture(box.board, id, { agentId: builder, commit, tree: String(id).padStart(40, 'b') });
  store.verify(box.board, id, { agentId: reviewer, decision: 'ACCEPT', policy: 'any', head: commit, digest,
    note: 'Changed the private fixture edge; its assertion failed, then passed when restored.' });
  return { id, reviewerPath };
}

test('[V1,B3] verdicts record independent assurance only for recorded different parents and show prints the tier', async (t) => {
  const box = fixture(t);
  const independent = accepted(box, 'parent-P', 'parent-Q');
  assert.equal(store.verdictsFor(box.board, independent.id)[0].assurance, 'independent');
  for (const parents of [[undefined, 'parent-Q'], ['parent-P', undefined], [undefined, undefined]]) {
    const procedural = accepted(box, ...parents);
    assert.equal(store.verdictsFor(box.board, procedural.id)[0].assurance, 'procedural');
  }
  let stdout = '';
  let stderr = '';
  const code = await main(['show', String(independent.id)], { cwd: box.root,
    stdout: { isTTY: false, write: part => { stdout += part; } },
    stderr: { write: part => { stderr += part; } } });
  assert.equal(code, 0, stderr);
  assert.match(stdout, /assurance: independent/u);
});
