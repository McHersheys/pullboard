/** Real mixed Git history retains complete citations without mistaking previews for requirements [C7,S8]. */
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { commitCitations } from '../src/history.js';
import { createE2eHelpers } from './e2e-helpers.js';

const e2e = createE2eHelpers();
after(e2e.cleanup);

/** Build ordinary Git history without installing hooks that would prohibit legacy-format fixtures. */
function historyFixture() {
  const box = e2e.sandbox();
  const root = join(box.dir, 'history');
  mkdirSync(root);
  box.git(root, 'init', '-q', '-b', 'main');
  writeFileSync(join(root, 'SPEC.md'), '# Spec\n\n## G · Goals\n- G1 [approved, must] Preserve history. | gate: test\n');
  box.git(root, 'add', 'SPEC.md');
  box.git(root, 'commit', '-q', '-m', 'chore: establish the spec [G1]');
  const first = box.git(root, 'rev-parse', 'HEAD').trim();
  /** Make a real commit and return the same short object name the public history reader reports. */
  function commit(message) {
    box.git(root, 'commit', '-q', '--allow-empty', '-m', message);
    return box.git(root, 'rev-parse', '--short', 'HEAD').trim();
  }
  return { box, root, first, commit };
}

test('mixed old and new Git commits retain full trailer rows and legacy header citations [C7,S8]', () => {
  const { root, first, commit } = historyFixture();
  const old = commit('fix(core): legacy requirements [G2, G3]');
  const modern = commit('feat(merge): a short preview [G4,+2]\n\nPullboard-Item: #4\nPullboard-Rows: G4,G5,G6');
  const found = commitCitations(root, first);
  assert.deepEqual([...found.keys()].sort(), ['G1', 'G2', 'G3', 'G4', 'G5', 'G6']);
  for (const id of ['G2', 'G3']) assert.equal(found.get(id), 'commit ' + old);
  for (const id of ['G4', 'G5', 'G6']) assert.equal(found.get(id), 'commit ' + modern);
  assert.equal(found.has('+2'), false, 'a preview count is never a spec row');
});

test('a final rows trailer takes precedence over header citations and retains newest attribution [C7,S8]', () => {
  const { root, first, commit } = historyFixture();
  commit('fix(core): older requirement [G7]');
  const latest = commit('fix(merge): header is only a preview [G8]\n\nPullboard-Item: #7\nPullboard-Rows: G7,G9');
  const found = commitCitations(root, first);
  assert.equal(found.get('G7'), 'commit ' + latest);
  assert.equal(found.get('G9'), 'commit ' + latest);
  assert.equal(found.has('G8'), false, 'a trailer-bearing commit never adds a second header-derived row set');
});

test('body examples and post-trailer prose do not invent historical rows [C7,S8]', () => {
  const { root, first, commit } = historyFixture();
  commit('fix(core): legacy body example [G2]\n\nPullboard-Rows: G99\nThis paragraph is explanatory prose.');
  commit('fix(core): legacy trailing prose [G3]\n\nPullboard-Rows: G98\n\nText after the trailers.');
  const found = commitCitations(root, first);
  assert.deepEqual([...found.keys()].sort(), ['G1', 'G2', 'G3']);
});

test('a legacy preview without full trailers preserves only the rows actually named [C7,S8]', () => {
  const { root, first, commit } = historyFixture();
  commit('fix(core): incomplete historical preview [G2,+4]');
  const found = commitCitations(root, first);
  assert.deepEqual([...found.keys()].sort(), ['G1', 'G2']);
});
