/** @pullboard-test-input source-tree */
/** @pullboard-test-loads src/board.js src/code-map.js src/commands/map.js src/commands/merged.js src/commands/index.js src/cli-main.js src/cli-help.js src/help.js src/land.js src/templates.js test/board-submit-fixture.js */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, test } from 'node:test';
import * as store from '../src/board.js';
import { submitFixture } from './board-submit-fixture.js';
import { createE2eHelpers } from './e2e-helpers.js';
import { agentsBlock } from '../src/templates.js';

const e2e = createE2eHelpers();
after(e2e.cleanup);

test('pullboard map prints the overview, a card and an item slice from one scan [C7]', t => {
  const box = e2e.project();
  t.after(() => e2e.cleanup());
  const configPath = join(box.repo, 'pullboard.json');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  config.lanes.web.owns.push('src/', 'bin/', 'test/');
  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
  mkdirSync(join(box.repo, 'src'), { recursive: true });
  mkdirSync(join(box.repo, 'bin'), { recursive: true });
  mkdirSync(join(box.repo, 'test'), { recursive: true });
  const templateDecoy = 'const templateDecoy = ' + String.fromCharCode(96)
    + 'import { ghost } from "./ghost.js"; function fakeTemplate() {}' + String.fromCharCode(96) + ';';
  writeFileSync(join(box.repo, 'src/home.js'), [
    '/** Render the fixture home page.',
    ' * @returns {string} page markup',
    ' */',
    'export function renderHome() { return \"home\"; }',
    '/* function fakeExport() { return 0; } */',
    'const decoy = ' + JSON.stringify("import { hidden } from './hidden.js'; function fakeString() {}") + ';',
    templateDecoy,
    'const unsupportedObjectMethod = { nestedMethod() { return true; } };',
  ].join('\n') + '\n');
  writeFileSync(join(box.repo, 'src/public.js'), "export { renderHome as displayHome } from './home.js';\n");
  writeFileSync(join(box.repo, 'bin/start.js'), "import { displayHome as render } from '../src/public.js';\nexport function start() { return render(); }\n");
  writeFileSync(join(box.repo, 'test/home.test.js'), "import { renderHome } from '../src/home.js';\nvoid renderHome;\n");
  box.git(box.repo, 'add', '-A');
  box.git(box.repo, 'commit', '-q', '-m', 'test(core): add code map source fixture');
  const added = box.run(box.repo, 'add', 'web', 'Map fixture item', '--criterion',
    'src/home.js exports renderHome and test/home.test.js imports it', '--specs', 'G1', '--check', 'true', '--route', 'light',
    '--brief', 'Files: src/home.js, src/public.js, bin/start.js, test/home.test.js\nTest: map output follows imports and ignores misleading source text', '--json');
  assert.equal(added.code, 0, added.out + added.err);
  const itemId = JSON.parse(added.out).item.item_id;
  const board = store.openBoard(join(box.repo, '.git', 'pullboard', 'board.sqlite'));
  store.ensureCoordinator(board, box.repo);
  const agent = store.agentAt(board, box.web);
  assert.ok(agent, 'the fixture builder remains joined to its web lane');
  const agentId = agent.agent_id;
  const claimHead = box.git(box.repo, 'rev-parse', 'HEAD');
  const frozen = JSON.stringify({ criterion: 'src/home.js exports renderHome and test/home.test.js imports it' });
  const digest = createHash('sha256').update(frozen).digest('hex');
  store.claim(board, itemId, { agentId, lane: 'web', leaseMs: 3_600_000,
    freeze: () => ({ text: frozen, digest }), head: claimHead });
  mkdirSync(join(box.repo, 'web'), { recursive: true });
  writeFileSync(join(box.repo, 'web/map-item.txt'), 'accepted map fixture item\n');
  box.git(box.repo, 'add', 'web/map-item.txt');
  box.git(box.repo, 'commit', '-q', '-m', 'test(web): add mapped fixture item [G1]');
  const itemCommit = box.git(box.repo, 'rev-parse', 'HEAD');
  submitFixture(board, itemId, { agentId, commit: itemCommit, tree: box.git(box.repo, 'rev-parse', 'HEAD^{tree}') });
  store.verify(board, itemId, { agentId: 'coordinator', decision: 'ACCEPT', note: 'confirmed map fixture source',
    head: itemCommit, digest, policy: 'any' });
  t.after(() => store.closeBoard(board));

  const cache = join(box.repo, '.git', 'pullboard', 'code-map.json');
  const overview = box.run(box.repo, 'map');
  assert.equal(overview.code, 0, overview.out + overview.err);
  const firstGeneration = JSON.parse(readFileSync(cache, 'utf8')).generatedAt;
  assert.match(overview.out, /Pullboard code map \([a-f0-9]{12}\)/u);
  assert.match(overview.out, /Effects not covered by static patterns: not detected/u);
  const commandHelp = box.run(box.repo, 'help', 'map');
  assert.equal(commandHelp.code, 0, commandHelp.out + commandHelp.err);
  assert.match(commandHelp.out, /--for <item>/u);
  const card = box.run(box.repo, 'map', 'src/home.js');
  assert.equal(card.code, 0, card.out + card.err);
  assert.match(card.out, /renderHome\(\)/u);
  assert.match(card.out, /Render the fixture home page/u);
  assert.match(card.out, /tests with observed imports: test\/home\.test\.js/u);
  assert.match(card.out, /Effects the scan cannot see: not detected/u);
  assert.doesNotMatch(card.out, /fakeExport|fakeString|fakeTemplate|hidden\.js|ghost\.js/u);
  const functionCard = box.run(box.repo, 'map', 'renderHome');
  assert.equal(functionCard.code, 0, functionCard.out + functionCard.err);
  assert.match(functionCard.out, /## src\/home\.js#renderHome/u);
  const alias = box.run(box.repo, 'map', 'bin/start.js');
  assert.equal(alias.code, 0, alias.out + alias.err);
  assert.match(alias.out, /home\.js#renderHome/u, 'an import alias follows its local re-export');
  const slice = box.run(box.repo, 'map', '--for', String(itemId));
  assert.equal(slice.code, 0, slice.out + slice.err);
  assert.match(slice.out, /src\/home\.js/u);
  assert.match(slice.out, /renderHome/u);
  assert.match(slice.out, /test\/home\.test\.js/u);
  const firstMap = JSON.parse(readFileSync(cache, 'utf8'));
  assert.equal(firstMap.generatedAt, firstGeneration, 'overview, cards and slices reuse one exact source scan');
  assert.equal(firstMap.mainCommit, box.git(box.repo, 'rev-parse', 'main'));
  assert.equal(firstMap.sourceCommit, firstMap.mainCommit);
  assert.deepEqual(firstMap.modules.find(module => module.path === 'src/home.js').functions.map(fn => fn.name), ['renderHome']);

  writeFileSync(join(box.repo, 'src/landed.js'), 'export function landed() { return true; }\n');
  box.git(box.repo, 'add', 'src/landed.js');
  box.git(box.repo, 'commit', '-q', '-m', 'test(core): land another code map module');
  const landed = box.run(box.repo, 'merged', String(itemId), 'HEAD');
  assert.equal(landed.code, 0, landed.out + landed.err);
  const refreshed = JSON.parse(readFileSync(cache, 'utf8'));
  assert.equal(refreshed.mainCommit, box.git(box.repo, 'rev-parse', 'main'));
  assert.ok(refreshed.modules.some(module => module.path === 'src/landed.js'));
  assert.notEqual(refreshed.generatedAt, firstMap.generatedAt);
  assert.match(agentsBlock(), /pullboard map --for <item>/u);
});
