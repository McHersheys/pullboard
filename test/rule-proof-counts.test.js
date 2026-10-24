/** Rule proof counts come from trunk gate evidence, not a row merely naming a test [S1,A1,A2]. */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { serveApi } from '../src/api.js';
import * as store from '../src/board.js';
import { main } from '../src/cli.js';
import { receiptBody } from '../src/gate-run-receipt.js';
import { clearProofCounters } from '../src/proof-counters.js';
import {
  ruleProofCounts,
  ruleProofWindow,
} from '../src/rule-proof-counts.js';
import { loadSpec } from '../src/spec.js';
import { createE2eHelpers } from './e2e-helpers.js';
import { fetchFresh } from './http-fixture.js';

const helpers = createE2eHelpers();
test.after(helpers.cleanup);
const GATE = 'node --test test/proven.test.js test/both.test.js';
const SPEC = `# Rule proof fixture

## P · Rules
- P1 [approved, must] The first test has proof. | gate: test/proven.test.js
- P2 [approved, must] An unexecuted test has no proof. | gate: test/unproven.test.js
- P3 [approved, must] A recent trunk failure is remembered. | gate: test/contradicted.test.js
- P4 [approved, must] Current green does not erase a recent red. | gate: test/both.test.js
- P5 [approved, must] A review is not machine evidence. | gate: review
- P6 [approved, must] An ungated row remains visible.
- P7 [draft, aim] A draft is outside approved counts. | gate: test/draft.test.js
`;

/** A real private Git/SQLite project; historical receipts below are seeded fixture records, not claimed executions. */
function fixture(spec = SPEC) {
  const box = helpers.sandbox();
  const root = join(box.dir, 'repo');
  mkdirSync(root);
  box.git(root, 'init', '-q', '-b', 'main');
  writeFileSync(join(root, 'SPEC.md'), spec);
  assert.equal(box.run(root, 'init').code, 0);
  writeFileSync(join(root, 'pullboard.json'), JSON.stringify({ ...helpers.CONFIG, gate: GATE }));
  mkdirSync(join(root, 'test'), { recursive: true });
  for (const file of ['proven', 'unproven', 'contradicted', 'both', 'draft']) {
    writeFileSync(join(root, 'test', `${file}.test.js`), `import { test } from 'node:test';\ntest('${file}', () => {});\n`);
  }
  box.git(root, 'add', '-A');
  box.git(root, 'commit', '-q', '-m', 'chore(fixture): initialize rule proof fixture');
  const original = box.git(root, 'rev-parse', 'HEAD').trim();
  writeFileSync(join(root, 'advance.txt'), 'a new trunk tree\n');
  box.git(root, 'add', 'advance.txt');
  box.git(root, 'commit', '-q', '-m', 'chore(fixture): advance the rule proof trunk');
  const head = box.git(root, 'rev-parse', 'HEAD').trim();
  const board = store.openBoard(join(root, '.git', 'pullboard', 'board.sqlite'), undefined, { isMain: true });
  return { ...box, root, board, original, head };
}

/** Append a bound, schema-valid historical fixture receipt through the board's ordinary recording operation. */
function seedRun(box, { head = box.head, main = head, green = true, days = 0, command = GATE, failures = [], kind = 'gate' } = {}) {
  const receipt = { version: 1, id: randomUUID(), kind, head, main,
    tree: box.git(box.root, 'rev-parse', `${head}^{tree}`).trim(),
    command: createHash('sha256').update(command).digest('hex'), green, failures,
    at: new Date(Date.now() - days * 86_400_000).toISOString(), load: { average: [0, 0, 0], cpus: 1, freeMB: 100 } };
  const folder = join(box.root, '.git', 'pullboard', 'gate-receipts');
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, `${receipt.id}.json`), receiptBody(receipt));
  store.recordGateRun(box.board, { agentId: 'coordinator', receipt, lane: 'web' });
}

/** Read the public status JSON and actual authenticated HTTP state for the same board. */
async function documents(box, api) {
  const result = box.run(box.root, 'status', '--json');
  assert.equal(result.code, 0, result.err);
  const headers = { 'x-pullboard-key': new URL(api.url).searchParams.get('k') };
  const origin = new URL(api.url).origin;
  const response = await fetchFresh(`${origin}/api/v1/boards/${store.boardId(box.board)}/state`, { headers });
  assert.equal(response.status, 200);
  const body = await response.json();
  return [JSON.parse(result.out), body.state];
}

test('the server reports how many rule rows are proven, unproven and contradicted [S1,A1,A2]', async (t) => {
  const box = fixture();
  const empty = fixture('# No approved rules\n');
  t.after(() => { store.closeBoard(box.board); store.closeBoard(empty.board); });
  seedRun(box, { head: box.original }); // Green on the previous tree is not current proof.
  seedRun(box, { command: 'true' }); // A different opaque green command proves none of these test files.
  seedRun(box, { green: false, days: 2, failures: [
    { file: 'test/contradicted.test.js', name: 'contradicted' },
    { file: 'test/contradicted.test.js', name: 'another failure in the same row' },
    { file: 'test/both.test.js', name: 'both' },
  ] });
  seedRun(box, { green: false, days: 8, failures: [{ file: 'test/unproven.test.js', name: 'too old' }] });
  seedRun(box, { green: false, main: box.original, failures: [{ file: 'test/unproven.test.js', name: 'branch failure' }] });
  const api = await serveApi({ runCommand: main, isMain: true,
    projects: () => [{ root: box.root, name: 'Rule proof fixture' }, { root: empty.root, name: 'Empty rule fixture' }] });
  t.after(() => api.close());
  const before = await documents(box, api);
  const unproven = { approved: 6, gated: 5, ungated: 1, proven: 0, unproven: 5, contradicted: 2 };
  assert.deepEqual(before.map(document => document.ruleCounts), [unproven, unproven]);
  seedRun(box);
  const after = await documents(box, api);
  const proven = { ...unproven, proven: 2, unproven: 3 };
  assert.deepEqual(after.map(document => document.ruleCounts), [proven, proven], 'current green and this-week red are independent counts; API event invalidation refreshes both');
  const none = { approved: 0, gated: 0, ungated: 0, proven: 0, unproven: 0, contradicted: 0 };
  assert.deepEqual((await documents(empty, api)).map(document => document.ruleCounts), [none, none]);
});

test('a read-only legacy board retains recent red counts and exact expiry without warming proof indexes [S1,A1,A2,C7]', (t) => {
  const box = fixture();
  t.after(() => store.closeBoard(box.board));
  seedRun(box, { green: false, days: 2,
    failures: [{ file: 'test/contradicted.test.js', name: 'legacy recent red' }] });
  seedRun(box, { green: false, days: 1, kind: 'submit',
    failures: [{ file: 'test/unproven.test.js', name: 'submission is not trunk gate proof' }] });
  seedRun(box);
  const runs = store.gateRuns(box.board);
  const red = runs.find(run => run.kind === 'gate' && !run.green);
  const submit = runs.find(run => run.kind === 'submit');
  assert.ok(red && submit, 'the private board has validated historical receipts of both kinds');
  // A pre-projection board or a disposable cache loss keeps its authoritative native history.
  clearProofCounters(box.board);
  const rows = loadSpec(box.root, { spec: 'SPEC.md' }).rows;
  const snapshot = box.board.db.prepare('SELECT event_id,event_detail FROM event ORDER BY event_id').all();
  const changes = box.board.db.prepare('SELECT total_changes() AS n').get().n;
  box.board.db.exec('PRAGMA query_only=ON');
  const week = 7 * 86_400_000;
  const end = Date.parse(red.at) + week;
  const atBoundary = ruleProofCounts(box.root, box.board, rows, { now: end });
  assert.equal(atBoundary.contradicted, 1, 'recent native trunk red remains visible at the inclusive seven-day boundary');
  assert.equal(atBoundary.proven, 0, 'missing coverage projection never invents green proof');
  assert.deepEqual(ruleProofWindow(box.board, new Date(end).toISOString()), {
    events: [red.eventId, submit.eventId], nextExpiry: new Date(end + 1).toISOString(),
  }, 'the window deliberately retains submit-red invalidation while proof counts exclude it');
  const expired = ruleProofCounts(box.root, box.board, rows, { now: end + 1 });
  assert.equal(expired.contradicted, 0, 'the native red expires one millisecond after seven days without a write');
  assert.deepEqual(ruleProofWindow(box.board, new Date(end + 1).toISOString()), {
    events: [submit.eventId], nextExpiry: new Date(Date.parse(submit.at) + week + 1).toISOString(),
  });
  assert.equal(box.board.db.prepare('SELECT total_changes() AS n').get().n, changes);
  assert.deepEqual(box.board.db.prepare('SELECT event_id,event_detail FROM event ORDER BY event_id').all(), snapshot);
});
