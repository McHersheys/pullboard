/** @pullboard-test-input source-tree */
/** @pullboard-test-input test-tree */
/** @pullboard-test-loads src/move-registry.js src/moves/*.js */
/** Move-only registry discovery preserves a pinned historical resolution and real replay [C7,V4,H3,H16]. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { runFixtureChild } from './fixture-child.js';
import { unpackRelease } from './release-archive.js';
import * as store from '../src/board.js';
import { exportBoard, importBoard } from '../src/exchange.js';
import { applyEngineMove, ENGINE_OPERATIONS } from '../src/engine.js';
import { relayMoveActor } from '../src/relay-sender.js';
import { NEXT_STEPS } from '../src/next-step-words.js';
import { MOVE_REGISTRY, minimumMoveEngine } from '../src/move-registry.js';
import { PROOF_RUN_ENGINE } from '../src/proof-run-engine.js';
import { REGISTRY_AT } from './move-registry-fixture.js';

const SNAPSHOT = JSON.parse(readFileSync(new URL('./move-registry-baseline.json', import.meta.url), 'utf8'));
const CONSUMERS = ['src/engine.js', 'src/relay-sender.js', 'src/next-step-words.js'];

/** Hash the real consumer bytes so seed declarations cannot quietly edit a central list. */
function consumerHashes(root) {
  return Object.fromEntries(CONSUMERS.map(file => [file, createHash('sha256').update(readFileSync(join(root, file))).digest('hex')]));
}

/** Run one fixture child, preserving both streams whenever setup or discovery fails. */
function run(root, command, args) {
  const result = runFixtureChild(command, args, { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  return result.stdout;
}

/** One independent feature file declares all four routing dimensions without a shared edit. */
function seedDeclaration(name, engine, itemIdFirstArgument, step) {
  return `/** Independent fixture board move [C7,V4]. */
/** Preserve this fixture move's explicit engine floor. */
function minimumEngine() { return ${engine}; }
/** Read the fixture actor from exactly its declared argument. */
function actor(move) { return move.args[1]?.agentId ?? null; }
export default { operation: ${JSON.stringify(name)}, order: ${engine + 1000}, engine: ${engine}, minimumEngine,
  itemIdFirstArgument: ${itemIdFirstArgument}, actor, nextSteps: { ${JSON.stringify(name.toUpperCase())}: ${JSON.stringify(step)} } };
`;
}

test('today\'s move order, actors, recovery text and recorded SQLite prefix are unchanged [C7,V4,H3,H16]', t => {
  assert.deepEqual(ENGINE_OPERATIONS.filter(name => name !== 'recordProofRun'), SNAPSHOT.operations);
  assert.equal(ENGINE_OPERATIONS.filter(name => name === 'recordProofRun').length, 1);
  assert.deepEqual(Object.fromEntries(Object.entries(NEXT_STEPS).filter(([key]) => key !== 'SHOUT_TOO_LONG' && !key.startsWith('PROOF_RUN_'))), SNAPSHOT.nextSteps);
  assert.equal(minimumMoveEngine('recordProofRun', [{ landingFence: {}, receipt: { environment: {} } }, { cause: 'conflict:new' }]), PROOF_RUN_ENGINE);
  assert.equal(MOVE_REGISTRY.recordProofRun.engine, PROOF_RUN_ENGINE);
  assert.equal(MOVE_REGISTRY.recordProofRun.itemIdFirstArgument, false);
  assert.equal(relayMoveActor({ operation: 'recordProofRun', args: [{ agentId: 'proof-seat' }] }), 'proof-seat');
  assert.equal(relayMoveActor({ operation: 'recordProofRun', args: [] }), null);
  assert.ok(NEXT_STEPS.SHOUT_TOO_LONG);
  for (const code of ['UNAVAILABLE', 'UNBOUND', 'ACTOR', 'STALE', 'CHANGED']) assert.ok(NEXT_STEPS['PROOF_RUN_' + code]);
  for (const operation of SNAPSHOT.operations) {
    assert.deepEqual(SNAPSHOT.actorVectors.map(vector => relayMoveActor({ operation, ...vector })), SNAPSHOT.actors[operation], operation);
  }
  assert.equal(relayMoveActor({ operation: 'toString', args: [] }), null, 'object prototype names are not moves');
  const directory = mkdtempSync(join(tmpdir(), 'pullboard-registry-replay-'));
  const board = store.openBoard(join(directory, 'replica.sqlite'), { now: () => new Date(REGISTRY_AT) });
  t.after(() => { store.closeBoard(board); rmSync(directory, { recursive: true, force: true }); });
  importBoard(board, SNAPSHOT.replay.initial);
  for (const { move, options, outcome } of SNAPSHOT.replay.records) {
    assert.deepEqual(applyEngineMove(board, move, options), outcome, move.operation);
    assert.deepEqual(applyEngineMove(board, move, options), outcome, 'same-position retry returns its immutable receipt');
  }
  assert.equal(JSON.stringify(exportBoard(board)), JSON.stringify(SNAPSHOT.replay.acceptedExpected), 'items, events, receipts and replay cursor retain accepted-main bytes for the exact historical moves');
});

test('two new board moves declared in two files need no edit to engine.js, relay-sender.js or next-step-words.js [C7,V4,H3,H16]', t => {
  const directory = mkdtempSync(join(tmpdir(), 'pullboard-registry-discovery-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const root = join(directory, 'repo');
  mkdirSync(root);
  unpackRelease('HEAD', root);
  run(root, 'git', ['init', '-b', 'main']);
  const before = consumerHashes(root);
  mkdirSync(join(root, 'src/moves'), { recursive: true });
  writeFileSync(join(root, 'src/moves/seedAlpha.js'), seedDeclaration('seedAlpha', 9, true, 'repair the first seeded move'));
  writeFileSync(join(root, 'src/moves/seedBeta.js'), seedDeclaration('seedBeta', 11, false, 'repair the second seeded move'));
  run(root, 'git', ['add', '.']);
  run(root, 'git', ['-c', 'user.name=Registry Fixture', '-c', 'user.email=registry@example.test', 'commit', '-m', 'fixture: two independent declarations']);
  const child = `
import {ENGINE_OPERATIONS} from './src/engine.js';
import {relayMoveActor} from './src/relay-sender.js';
import {NEXT_STEPS} from './src/next-step-words.js';
import {readFileSync,mkdirSync,writeFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import * as store from './src/board.js';
import {registryFixtureBoard,REGISTRY_AT} from './test/move-registry-fixture.js';
const root=process.cwd();
const result={operations:ENGINE_OPERATIONS,alphaActor:relayMoveActor({operation:'seedAlpha',args:[7,{agentId:'seed-agent'}]}),
  alphaStep:NEXT_STEPS.SEEDALPHA,betaStep:NEXT_STEPS.SEEDBETA};
if(ENGINE_OPERATIONS.includes('seedAlpha')&&ENGINE_OPERATIONS.includes('seedBeta')) {
  const {MOVE_REGISTRY,minimumMoveEngine,discoverMoves}=await import('./src/move-registry.js');
  const {importsIn}=await import('./src/module-imports.js');
  const snapshot=JSON.parse(readFileSync('./test/move-registry-baseline.json','utf8'));
  const boards=new Map();
  try {
    const forbidden=new Set(['src/board.js','src/engine.js','src/relay-sender.js','src/next-step-words.js','src/move-registry.js','src/git.js']);
    const seen=new Set();
    let pending=readdirSync('./src/moves').filter(file=>file.endsWith('.js')).map(file=>pathToFileURL(join(root,'src/moves',file)).href);
    while(pending.length) {
      const level=[...new Set(pending)].filter(file=>!seen.has(file));pending=[];
      for(const file of level) {
        const relative=fileURLToPath(file).slice(root.length+1);
        if(forbidden.has(relative))throw Error('move declarations load a forbidden writer/consumer '+relative);
        seen.add(file);
      }
      const edges=importsIn(level.map(file=>readFileSync(fileURLToPath(file),'utf8')));
      for(const [index,imports] of edges.entries())for(const specifier of imports) {
        if(specifier==='node:child_process')throw Error('move declarations load a process launcher');
        if(specifier.startsWith('node:'))continue;
        if(!specifier.startsWith('.'))throw Error('unknown move import '+specifier);
        pending.push(new URL(specifier,level[index]).href);
      }
    }
    result.pureImportClosure=true;
    result.itemIds=Object.values(MOVE_REGISTRY).filter(move=>move.itemIdFirstArgument).map(move=>move.operation);
    result.floors=snapshot.floorCases.map(entry=>{
      if(entry.state&&!boards.has(entry.state))boards.set(entry.state,registryFixtureBoard(root,entry.state));
      return minimumMoveEngine(entry.operation,entry.args,entry.state?boards.get(entry.state):undefined,new Date(REGISTRY_AT));
    });
    result.seedFloors=[minimumMoveEngine('seedAlpha',[]),minimumMoveEngine('seedBeta',[])];
    result.refusals=[];
    const invalidCases=[['bad name.js', ${JSON.stringify(seedDeclaration('badName', 1, false, 'fix'))}],
      ['wrongName.js',${JSON.stringify(seedDeclaration('differentName', 1, false, 'fix'))}],
      ['zeroFloor.js',${JSON.stringify(seedDeclaration('zeroFloor', 0, false, 'fix'))}]];
    for(const [index,[file,source]] of invalidCases.entries()) {
      const folder=join(root,'invalid-'+index);mkdirSync(folder);writeFileSync(join(folder,file),source);
      try {await discoverMoves(pathToFileURL(folder+'/'));result.refusals.push(false);}catch{result.refusals.push(true);}
    }
    const conflict=join(root,'conflicting-steps');mkdirSync(conflict);
    writeFileSync(join(conflict,'first.js'),${JSON.stringify(seedDeclaration('first', 1, false, 'first').replace('FIRST:', 'SHARED:'))}.replace('"FIRST"','"SHARED"'));
    writeFileSync(join(conflict,'second.js'),${JSON.stringify(seedDeclaration('second', 2, false, 'second'))}.replace('"SECOND"','"SHARED"'));
    try {await discoverMoves(pathToFileURL(conflict+'/'));result.conflictingStepRefused=false;}catch{result.conflictingStepRefused=true;}
  } finally {for(const board of boards.values())store.closeBoard(board);}
}
process.stdout.write(JSON.stringify(result));`;
  const result = JSON.parse(run(root, process.execPath, ['--input-type=module', '-e', child]));
  assert.ok(result.operations.includes('seedAlpha'), 'the first independent operation file is discovered');
  assert.ok(result.operations.includes('seedBeta'), 'the second independent operation file is discovered');
  assert.deepEqual(result.operations.filter(name => !name.startsWith('seed') && name !== 'recordProofRun'), SNAPSHOT.operations, 'existing order does not move');
  assert.deepEqual(result.seedFloors, [9, 11]);
  assert.equal(result.pureImportClosure, true, 'routing metadata never imports its consumers, board writers or Git/process launchers');
  assert.equal(result.alphaActor, 'seed-agent');
  assert.equal(result.alphaStep, 'repair the first seeded move');
  assert.equal(result.betaStep, 'repair the second seeded move');
  assert.deepEqual(result.itemIds.filter(name => !name.startsWith('seed')).sort(), [...SNAPSHOT.itemIdFirstArgument].sort());
  assert.ok(result.itemIds.includes('seedAlpha'));
  assert.ok(!result.itemIds.includes('seedBeta'));
  assert.deepEqual(result.floors, SNAPSHOT.floorCases.map(entry => entry.expected), 'all historical first-match floor vectors retain their results');
  assert.deepEqual(result.refusals, [true, true, true], 'bad names, mismatched identities and invalid floors fail closed');
  assert.equal(result.conflictingStepRefused, true, 'two declarations cannot silently disagree about recovery guidance');
  assert.deepEqual(consumerHashes(root), before, 'the three central consumers were never edited to add either move');
});
