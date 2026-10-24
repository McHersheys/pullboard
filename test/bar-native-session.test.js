/** Real private CLI sessions prove bar signing, freezing and takeover attribution [B4,V1,V2,H16]. */
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createE2eHelpers } from './e2e-helpers.js';
import * as store from '../src/board.js';
import { parentSessionDigest } from '../src/parent-session.js';

const fixtures=createE2eHelpers();
after(fixtures.cleanup);
/** Run only inside a private fixture; synthetic runtime identities never touch the user's board. */
function act(box, session, cwd, ...args) {
  box.env.CLAUDE_CODE_SESSION_ID=session;
  return box.run(cwd,...args);
}
/** Keep command diagnostics attached to every successful private move. */
function succeeds(result) { assert.equal(result.code,0,`${result.out}\n${result.err}`); return result; }
/** The unchanged witness is outside this item's Files list, so it needs no extra whole-file obligation. */
function setup() {
  const sandbox=fixtures.sandbox();delete sandbox.env.NODE_TEST_CONTEXT;
  sandbox.env.PULLBOARD_MODEL='Private fixture';
  const box=fixtures.project('true',sandbox);
  succeeds(act(box,'private-author-a',box.repo,'join','coordinator','--model','Private author'));
  mkdirSync(join(box.repo,'test'));
  writeFileSync(join(box.repo,'test','witness.test.mjs'), "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { existsSync } from 'node:fs';\ntest('named witness',()=>assert.ok(existsSync('web/ready.txt')));\n");
  box.git(box.repo,'add','test/witness.test.mjs');box.git(box.repo,'commit','-qm','test: private named witness');
  succeeds(act(box,'private-author-a',box.repo,'bar','ready','on'));
  return box;
}
/** Add a buildable bar with a genuine red named-case baseline at private main. */
function add(box,author) {
  const check='node --test --test-name-pattern "named witness" test/witness.test.mjs';
  const result=succeeds(act(box,author,box.repo,'add','web','Ready output','--criterion','web/ready.txt exists','--specs','G1','--route','mid','--check',check,'--wait',
    '--brief','Files: web/ready.txt\nTest: named witness asserts the output exists\nNamed test: named witness\nMeasurements: no quantitative bounds\nReviewer edges: absent output and restart','--json'));
  const item=JSON.parse(result.out).item;
  assert.equal(item.item_check_baseline.result,'red');
  assert.ok(item.item_check_baseline.testEvidence.failed.some(name=>name.includes('named witness')));
  return item.item_id;
}
/** Read a private board through its normal public API, never raw fixture writes. */
function readItem(box,id) {
  const board=store.openBoard(join(box.repo,'.git','pullboard','board.sqlite'));
  try{return store.getItem(board,id);}finally{store.closeBoard(board);}
}

test('[B4,V1,V2,H16] real native sessions sign and freeze one bar before normal submit and review',()=>{
  const box=setup();const id=add(box,'private-author-a');
  box.git(box.web,'merge','--ff-only','main');
  succeeds(act(box,'private-builder',box.web,'join','web','--model','Private builder'));
  const unsigned=act(box,'private-builder',box.web,'claim',String(id));
  assert.notEqual(unsigned.code,0);assert.match(unsigned.err,/BAR_NOT_READY/);
  const self=act(box,'private-author-a',box.repo,'bar','sign',String(id),'--note','can be built and graded alike');
  assert.notEqual(self.code,0);assert.match(self.err,/BAR_SELF_SIGN/);
  const reviewer=join(box.dir,'outside-review');box.git(box.repo,'worktree','add','-qb','api/outside',reviewer,'main');
  succeeds(act(box,'private-reviewer',reviewer,'join','api','--model','Private reviewer'));
  succeeds(act(box,'private-reviewer',reviewer,'bar','sign',String(id),'--note','Builder can meet this witness; two reviewers can grade absent and present output alike.'));
  succeeds(act(box,'private-builder',box.web,'claim',String(id)));
  const frozen=JSON.parse(readItem(box,id).item_frozen);
  assert.match(frozen.sourceCheck,/named witness/);assert.deepEqual(frozen.barCoverage.required,[]);
  mkdirSync(join(box.web,'web'),{recursive:true});writeFileSync(join(box.web,'web','ready.txt'),'ready');
  box.git(box.web,'add','web/ready.txt');box.git(box.web,'commit','-qm','feat(web): ready output [G1]');
  succeeds(act(box,'private-builder',box.web,'submit',String(id)));
  const head=box.git(box.web,'rev-parse','HEAD');box.git(reviewer,'switch','--detach',head);
  succeeds(act(box,'private-reviewer',reviewer,'verify',String(id),'accept','--note','The real named witness passes with ready output present.'));
  assert.equal(readItem(box,id).item_status,'verified');
});

test('[V1,H16] a supported coordinator takeover cannot let its honestly joined helper sign',()=>{
  const box=setup();
  succeeds(act(box,'private-author-b',box.repo,'takeover'));
  const id=add(box,'private-author-b');
  const helper=join(box.dir,'new-author-helper');box.git(box.repo,'worktree','add','-qb','api/helper',helper,'main');
  succeeds(act(box,'private-helper',helper,'join','api','--model','Private helper','--parent','private-author-b'));
  const self=act(box,'private-helper',helper,'bar','sign',String(id),'--note','I am a helper of this author, so this must be refused.');
  assert.notEqual(self.code,0);assert.match(self.err,/BAR_SELF_SIGN/);
  const board=store.openBoard(join(box.repo,'.git','pullboard','board.sqlite'));
  try {
    assert.equal(board.db.prepare('SELECT meta_value FROM board_meta WHERE meta_key=?').get('agent_session:coordinator').meta_value,parentSessionDigest('private-author-a'),'takeover did not rewrite historical seat identity');
  }finally{store.closeBoard(board);}
});
