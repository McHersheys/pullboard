/** Main owns declaration upgrades; valid old stamps and manual drift remain distinct [M3,A5,A6,C7,H16]. */
import assert from 'node:assert/strict';
import { cpSync } from 'node:fs';
import { mkdirSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after } from 'node:test';
import { test } from 'node:test';
import * as store from '../src/board.js';
import { MACHINE } from '../src/machine.js';
import { storeTriggers } from '../src/machine.js';
import { SCHEMA_DIGEST } from '../src/board-schema-source.js';
import { SCHEMA_VERSION } from '../src/board-schema-source.js';
import { boardStanding } from '../src/board-migrate.js';
import { recordSchemaStamp } from '../src/board-migrate.js';
import { createE2eHelpers } from './e2e-helpers.js';
import { runFixtureChild } from './fixture-child.js';

const e2e = createE2eHelpers();
after(e2e.cleanup);

/** Install and stamp the real previous declaration in a private fixture, without changing its data version. */
function olderDeclaration(file) {
  const db = new DatabaseSync(file);
  try {
    const old = storeTriggers({ ...MACHINE, moves: MACHINE.moves.filter(move => move.verb !== 'submit-merge') })
      .find(trigger => trigger.name === 'machine_item_move');
    assert.ok(!old.sql.includes("'claimed>verified'"));
    db.exec(`DROP TRIGGER machine_item_move; ${old.sql}`);
    recordSchemaStamp(db, SCHEMA_DIGEST);
  } finally { db.close(); }
}

/** Read persistent shape and native evidence without invoking a writable opener. */
function observe(file) {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    return {
      standing: boardStanding(db, SCHEMA_DIGEST, SCHEMA_VERSION),
      version: db.prepare('PRAGMA user_version').get().user_version,
      stamp: db.prepare('PRAGMA application_id').get().application_id,
      schema: db.prepare("SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name").all(),
      identity: db.prepare("SELECT meta_value FROM board_meta WHERE meta_key='board_id'").get().meta_value,
      items: db.prepare('SELECT * FROM item ORDER BY item_id').all(),
      guards: db.prepare("SELECT event_detail FROM event WHERE event_kind='guards' ORDER BY event_id").all(),
    };
  } finally { db.close(); }
}

/** Create a file-backed private board with ordinary native data and a valid legacy stamp. */
function legacyBoard(t) {
  const directory = mkdtempSync(join(tmpdir(), 'pullboard-stamped-declaration-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const file = join(directory, 'board.sqlite');
  const board = store.openBoard(file);
  try { store.addItem(board, { by: 'coordinator', lane: 'web', title: 'Keep this row' }); }
  finally { store.closeBoard(board); }
  olderDeclaration(file);
  return file;
}

test('main refreshes a valid stamped older transition once; reads and branch opens leave it alone [M3,A5,A6,C7]', t => {
  const file = legacyBoard(t);
  const before = observe(file);
  assert.equal(before.standing, 'current', 'the old declaration has its own valid installed-shape stamp');
  const readonly = store.openBoardReadOnly(file);
  readonly.close();
  const branch = store.openBoard(file, undefined, { isMain: false, onDiagnostic: () => {} });
  store.closeBoard(branch);
  assert.deepEqual(observe(file), before, 'neither read-only nor non-main code installs a declaration');

  const main = store.openBoard(file);
  store.closeBoard(main);
  const upgraded = observe(file);
  const installed = upgraded.schema.find(row => row.name === 'machine_item_move').sql;
  assert.equal(installed, storeTriggers().find(row => row.name === 'machine_item_move').sql);
  assert.ok(installed.includes("'claimed>verified'"));
  assert.equal(upgraded.standing, 'current', 'the new declaration and its shape stamp commit together');
  assert.equal(upgraded.version, before.version);
  assert.equal(upgraded.identity, before.identity);
  assert.deepEqual(upgraded.items, before.items);
  assert.deepEqual(upgraded.guards.map(row => JSON.parse(row.event_detail)),
    [{ missing: [], changed: ['machine_item_move'], stale: [] }]);
  const bytes = readFileSync(file);
  const again = store.openBoard(file);
  store.closeBoard(again);
  assert.deepEqual(observe(file), upgraded, 'an already-current declaration emits no repair event');
  assert.deepEqual(readFileSync(file), bytes, 'an already-current declaration makes no persistent write');
});

test('main leaves manually drifted triggers and their invalid stamp untouched [M3,A5,A6,C7]', t => {
  const file = legacyBoard(t);
  const changed = new DatabaseSync(file);
  try { changed.exec('DROP TRIGGER machine_fields_claimed'); }
  finally { changed.close(); }
  const before = observe(file);
  assert.equal(before.standing, 'drifted');
  const diagnostics = [];
  const board = store.openBoard(file, undefined, { onDiagnostic: text => diagnostics.push(text) });
  store.closeBoard(board);
  assert.deepEqual(observe(file), before, 'a missing hand-edited trigger must not be silently approved or restamped');
  assert.match(diagnostics.join('\n'), /different shape/u);
});

/** Require a real private public command to succeed with its original diagnostics. */
function succeeds(box, cwd, ...args) {
  const result = box.run(cwd, ...args);
  assert.equal(result.code, 0, `${args.join(' ')}\n${result.out}\n${result.err}`);
  return result;
}

/** Commit one real source change in the private Git fixture. */
function choice(box, cwd, value) {
  const result = e2e.commitFile(box, cwd, 'web/feature.js', `export const choice = '${value}';\n`, 'feat(web): fixture choice [G1]');
  assert.equal(result.status, 0, result.stderr);
  return box.git(cwd, 'rev-parse', 'HEAD');
}

test('a stamped pre-carry board upgrades on main open and completes a native merge-only submission [M3,V1,V4,H16]', () => {
  const box = e2e.project();
  choice(box, box.repo, 'base');
  box.git(box.web, 'merge', '-q', '--no-edit', 'main');
  const added = succeeds(box, box.repo, 'add', 'web', 'Carry after declaration upgrade', '--specs', 'G1',
    '--criterion', 'The unchanged acceptance survives a trunk-only merge', '--check', 'node --check web/feature.js', '--json');
  const id = JSON.parse(added.out).item.item_id;
  succeeds(box, box.web, 'claim', String(id));
  const accepted = choice(box, box.web, 'accepted');
  succeeds(box, box.web, 'submit', String(id));
  box.git(box.repo, 'switch', '-q', '--detach', accepted);
  try { succeeds(box, box.repo, 'verify', String(id), 'accept', '--as', 'coordinator', '--note', 'checked the accepted choice'); }
  finally { box.git(box.repo, 'switch', '-q', 'main'); }
  choice(box, box.repo, 'trunk');
  succeeds(box, box.repo, 'reopen', String(id), '--conflict', 'web/feature.js');
  succeeds(box, box.web, 'claim', String(id));
  assert.notEqual(box.tryGit(box.web, 'merge', '-q', '--no-edit', 'main').status, 0);
  const head = choice(box, box.web, 'resolved');
  const file = join(box.repo, '.git', 'pullboard', 'board.sqlite');
  olderDeclaration(file);
  const before = observe(file);
  succeeds(box, box.repo, 'status');
  assert.deepEqual(observe(file), before, 'a public main read still does not migrate declarations');
  // The ordinary E2E CLI runs this agent's unmerged source, which correctly cannot own another
  // repository's shared DDL. Copy the actual candidate into a genuine private main source checkout.
  const application = join(box.dir, 'main-application');
  mkdirSync(application);
  for (const name of ['bin', 'src', 'skills', 'package.json', 'CHANGELOG.md']) {
    cpSync(new URL(`../${name}`, import.meta.url), join(application, name), { recursive: true });
  }
  box.git(application, 'init', '-q', '-b', 'main');
  box.git(application, 'add', '-A');
  box.git(application, 'commit', '-q', '-m', 'chore: candidate main source');
  const opened = runFixtureChild(process.execPath, [join(application, 'bin/pullboard.js'), 'inbox', '--json'],
    { cwd: box.repo, env: box.env, encoding: 'utf8' });
  assert.equal(opened.status, 0, opened.stderr + opened.stdout);
  assert.ok(observe(file).schema.find(row => row.name === 'machine_item_move').sql.includes("'claimed>verified'"));
  succeeds(box, box.web, 'submit', String(id));
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const item = db.prepare('SELECT * FROM item WHERE item_id=?').get(id);
    assert.equal(item.item_status, 'verified');
    assert.equal(item.item_commit, head);
    assert.equal(db.prepare('SELECT count(*) AS n FROM verdict WHERE item_id=?').get(id).n, 1, 'carry retains the original reviewer verdict');
    assert.equal(db.prepare("SELECT count(*) AS n FROM event WHERE item_id=? AND event_kind='merge-only-accept'").get(id).n, 1);
  } finally { db.close(); }
});
