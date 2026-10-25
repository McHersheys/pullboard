/** Registry obligations survive submit deferral and use the project's own runner [C7,V4,V16]. */
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';
import { createE2eHelpers } from './e2e-helpers.js';

const e2e = createE2eHelpers();
after(e2e.cleanup);

/** Write a private fixture input without changing the repository under test. */
function put(root, path, text) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
}

/** Commit through the private board's real installed hooks. */
function commit(box, root, message) {
  box.git(root, 'add', '-A');
  box.git(root, 'commit', '-q', '-m', message);
}

/** Set accepted registry policy and one real move guard with no JavaScript import edge to new leaves. */
function registryBox() {
  const box = e2e.project('true');
  const config = JSON.parse(readFileSync(join(box.repo, 'pullboard.json'), 'utf8'));
  config.lanes.web.owns.push('src/', 'test/');
  config.affectedTests = 'env -u NODE_TEST_CONTEXT node --test --test-reporter=tap';
  config.submitGate = 'landing';
  config.submitDeferAbove = 1;
  config.registryGuards = [{ inputs: ['src/moves/**'], tests: ['test/relay-credential.test.js'] }];
  put(box.repo, 'pullboard.json', JSON.stringify(config));
  put(box.repo, 'package.json', '{"type":"module"}\n');
  put(box.repo, 'src/moves/known.js', 'export const operation = "known";\n');
  put(box.repo, 'test/relay-credential.test.js', [
    "import { readdirSync } from 'node:fs';",
    "import assert from 'node:assert/strict';",
    "import { test } from 'node:test';",
    "test('each move has an actor credential [G1]', () => {",
    "  const credentials = new Set(['known.js']);",
    "  for (const move of readdirSync(new URL('../src/moves/', import.meta.url)))",
    "    assert.ok(credentials.has(move), 'missing actor credential for ' + move);",
    '});',
  ].join('\n'));
  put(box.repo, 'web/item.test.js', "import { test } from 'node:test';\ntest('item works [G1]', () => {});\n");
  commit(box, box.repo, 'test: accepted registry policy');
  box.git(box.web, 'merge', '-q', '--ff-only', 'main');
  const made = box.run(box.repo, 'add', 'web', 'new move fixture', '--specs', 'G1',
    '--criterion', 'The item and its registry obligations pass.', '--check', 'node --test web/item.test.js', '--json');
  assert.equal(made.code, 0, made.err + made.out);
  const id = JSON.parse(made.out).item.item_id;
  assert.equal(box.run(box.web, 'claim', String(id)).code, 0);
  return { ...box, id };
}

test('submit runs the move registry guard for an item that adds a move and refuses it by name when the credential is missing [C7,V4,V16]', () => {
  const box = registryBox();
  put(box.web, 'src/moves/newMove.js', 'export const operation = "newMove";\n');
  // An unrelated source change makes the normal import selection exceed its submit budget.
  put(box.web, 'src/other.js', 'export const other = 1;\n');
  for (const number of [1, 2]) put(box.web, `web/other${number}.test.js`,
    "import { other } from '../src/other.js';\nimport { test } from 'node:test';\ntest('other works [G1]', () => {});\n");
  commit(box, box.web, 'feat(core): add fixture move [G1]');
  const submitted = box.run(box.web, 'submit', String(box.id));
  assert.equal(submitted.code, 1, 'a green item check cannot defer a touched registry guard: ' + submitted.out);
  assert.match(submitted.err + submitted.out, /test\/relay-credential\.test\.js/u, 'the refusal names the guard');
  assert.match(submitted.err + submitted.out, /missing actor credential for newMove\.js/u, 'the refusal retains the missing entry');
  const state = box.run(box.web, 'show', String(box.id), '--json');
  assert.equal(state.code, 0, state.err);
  assert.equal(JSON.parse(state.out).item.item_status, 'claimed', 'the rejected proof records no submission');
});
