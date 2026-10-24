/** Native provenance rejects borrowed evidence and keeps unknown facts explicit [C7,H16]. */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import * as store from '../src/board.js';
import { prepareEngineMove, applyEngineMove } from '../src/engine.js';
import { boardReceiptStore, receiptBody, receiptFields } from '../src/gate-run-receipt.js';
import { proofCounts } from '../src/proof-provenance.js';
import { recordNativeProof } from '../src/proof-cli.js';
import { createE2eHelpers } from './e2e-helpers.js';

test('a real failed native check records its actual exit without invented test counters [C7,H16]', (t) => {
  const helpers = createE2eHelpers();
  t.after(helpers.cleanup);
  const command = `${JSON.stringify(process.execPath)} -e "process.exit(7)"`;
  const box = helpers.project(command);
  const board = store.openBoard(join(box.repo, '.git/pullboard/board.sqlite'));
  t.after(() => store.closeBoard(board));
  const id = store.addItem(board, { by: 'coordinator', lane: 'web', title: 'A real red proof',
    criterion: 'The process exits successfully.', specIds: ['G1'], check: command });
  const claim = box.run(box.web, 'claim', String(id), '--json');
  assert.equal(claim.code, 0, claim.err || claim.out);
  mkdirSync(join(box.web, 'web'), { recursive: true });
  writeFileSync(join(box.web, 'web/uncommitted.txt'), 'not in a commit\n');
  const check = box.run(box.web, 'check', String(id), '--yes', '--json');
  assert.equal(check.code, 1, check.out);
  const shown = box.run(box.repo, 'show', String(id), '--json');
  assert.equal(shown.code, 0, shown.err || shown.out);
  const [receipt] = JSON.parse(shown.out).proofReceipts;
  assert.equal(receipt.kind, 'check');
  assert.equal(receipt.exitCode, 7);
  assert.equal(receipt.sourceClean, false);
  assert.equal(receipt.commit, null, 'a dirty check cannot attest the committed HEAD');
  assert.equal(receipt.tree, null, 'a dirty check cannot attest the committed tree');
  assert.deepEqual(receipt.counts, { passed: null, failed: null, skipped: null });
  assert.deepEqual(receipt.environment, { node: process.versions.node, platform: process.platform, arch: process.arch });
});

test('proof counters retain explicit totals and do not invent success from missing output [C7,H16]', () => {
  const unknown = { passed: null, failed: null, skipped: null };
  assert.deepEqual(proofCounts('no test reporter\n'), unknown);
  assert.deepEqual(proofCounts('# pass 1\n# fail 0\n'), unknown);
  assert.deepEqual(proofCounts('    # pass 9\n    # fail 0\n    # skipped 0'), unknown, 'nested child summaries are not added twice');
  assert.deepEqual(proofCounts('# pass 2\n# fail 1\n# skipped 3\nℹ pass 4\nℹ fail 0\nℹ skipped 1'),
    { passed: 6, failed: 1, skipped: 4 });
  assert.deepEqual(proofCounts('# pass 1\n# fail 0\n# skipped 0\n# pass 8'), unknown,
    'an incomplete later summary cannot turn the whole run into a known total');
});

test('an executed run without its receipt cannot publish an outcome [C7,H16]', async () => {
  let moves = 0;
  const services = { ordered: () => { moves += 1; }, withBoard: () => { moves += 1; }, resourceAgent: () => 'web-1' };
  await assert.rejects(recordNativeProof({}, { item_id: 1 }, { proofReceiptId: null }, services),
    error => error.code === 'PROOF_RUN_UNAVAILABLE');
  await recordNativeProof({}, { item_id: 1 }, { executed: false }, services);
  assert.equal(moves, 0, 'a zero-execution refusal creates no proof receipt');
});

test('proof receipts bind the native actor and replay without the origin filesystem [C7,H16]', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'pullboard-proof-receipts-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const board = store.openBoard(join(directory, 'board.sqlite'));
  const replica = store.openBoard(':memory:');
  t.after(() => { store.closeBoard(replica); store.closeBoard(board); });
  let item;
  for (const target of [board, replica]) {
    store.register(target, { lane: 'coordinator', path: '/proof-coordinator' });
    store.register(target, { lane: 'web', path: '/proof-builder' });
    store.register(target, { lane: 'web', path: '/proof-peer' });
    item = store.addItem(target, { by: 'coordinator', lane: 'web', title: 'A synthetic receipt boundary' });
  }
  // This is synthetic storage-boundary evidence, not a claim that this fixture ran a gate.
  const receipt = { version: 2, id: '00000000-0000-4000-8000-00000000c0de', kind: 'check',
    head: 'a'.repeat(40), tree: 'b'.repeat(40), main: null, command: 'c'.repeat(64), green: false,
    failures: [], load: null, at: '2026-10-23T00:00:00.000Z',
    proof: { item, frozenDigest: null, seat: 'web-1', environment: null, runner: null, exitCode: 7,
      counts: { passed: null, failed: null, skipped: null }, durationMs: 37, sourceClean: false } };
  assert.throws(() => store.recordProofRun(board, { agentId: 'web-1', itemId: item, receipt }),
    error => error.code === 'PROOF_RUN_UNBOUND', 'caller-written fields without a native file never establish a direct proof');
  mkdirSync(boardReceiptStore(board));
  writeFileSync(join(boardReceiptStore(board), `${receipt.id}.json`), receiptBody(receipt));
  assert.throws(() => store.recordProofRun(board, { agentId: 'web-2', itemId: item, receiptId: receipt.id }),
    error => error.code === 'PROOF_RUN_ACTOR', 'a peer cannot appropriate a real native receipt');
  assert.throws(() => prepareEngineMove(board, 'recordProofRun', [{ agentId: 'web-1', itemId: item,
    receipt: { ...receipt, proof: { ...receipt.proof, exitCode: 0 } } }]), error => error.code === 'PROOF_RUN_UNBOUND');
  const args = [{ agentId: 'web-1', itemId: item, receiptId: receipt.id }];
  const move = prepareEngineMove(board, 'recordProofRun', args, { actor: 'web-1' });
  const recorded = store.recordProofRun(board, args[0]);
  assert.equal(recorded.exitCode, 7);
  assert.equal(recorded.environment, null, 'missing executor identity never becomes controller identity');
  assert.equal(recorded.parentSession, null, 'a legacy seat never becomes recorded-parent assurance');
  assert.deepEqual(recorded.counts, receipt.proof.counts);
  applyEngineMove(replica, move, { sequence: 1, at: receipt.at });
  const [{ eventId, ...replayed }] = store.proofReceipts(replica, item);
  assert.deepEqual(replayed, recorded);
  assert.equal(store.proofReceipts(board, item).length, 1);
  store.recordProofRun(board, args[0]);
  assert.equal(store.proofReceipts(board, item).length, 1, 'retrying the same receipt is idempotent');
  assert.equal(receiptFields({ ...receipt, proof: { ...receipt.proof, environment: { node: '22', platform: 'darwin' } } }), null);
});
