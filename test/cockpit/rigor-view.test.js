/** @pullboard-test-gui */
/** The view shows sentinel drafts for the person to approve, with their proof [A6,D1,N26]. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SPEC, machine, project, startView, openPage, boardOf } from './fixture.js';

/**
 * A sentinel-draft call as sentinelDraftNeeds shapes it, citing one repeated cause and the commits that prove its check.
 *
 * @param {object} fields - The watch name, its check and whether it cites evidence.
 * @returns {object} One call in the state's shape.
 */
function draft({ name, check, cited = true }) {
  return {
    kind: 'sentinel-draft', id: `sentinel:${name}`, ref: name,
    text: `Sentinel draft: ${name} runs ${check} hourly, reporting to coordinator`,
    what: `pullboard sentinel approve ${name}, or decline it with --reason`, target: `sentinel:${name}`,
    ...(cited ? { cause: 'row:G1', evidence: { key: 'row:G1', items: [{ id: 4, commits: [] }, { id: 7, commits: [] }], occurrences: 2,
      proof: { check, red: { commit: 'aaaaaaaaaaaa1111', exit: 1 }, green: { commit: 'bbbbbbbbbbbb2222', exit: 0 } } } } : {}),
  };
}

test('the view state carries a pending sentinel draft [A6,D1,N26]', async () => {
  const box = machine();
  const p = project(box, 'sentinel board', SPEC);
  box.run(p.repo, 'sentinel', 'propose', 'staging-site', '--check', 'true', '--every', 'hourly', '--owner', 'web');
  const view = await startView(box);
  try {
    const state = await boardOf(view, p.repo);
    assert.deepEqual(state.sentinelDrafts.map((call) => call.ref), ['staging-site'], 'the state carries the pending watch as one call');
    assert.equal(state.sentinelDrafts[0].kind, 'sentinel-draft');
    assert.ok(state.needs.some((call) => call.kind === 'sentinel-draft'), 'and Needs-you counts it');
  } finally {
    await view.stop();
  }
});

test('the view shows one sentinel draft with its proof, never as an approved sentinel [A6,D1,N26]', async () => {
  const box = machine();
  project(box, 'draft board', SPEC);
  const view = await startView(box);
  try {
    const page = await openPage(view);
    await page.run(`data.project.sentinelDrafts = ${JSON.stringify([draft({ name: 'rigor-row-g1', check: 'test -f up.txt' })])}; render();`);
    const html = page.show('needs');
    const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    assert.equal((html.match(/data-sentinel-draft=/g) || []).length, 1, 'one draft is one row');
    assert.match(text, /rigor-row-g1 Sentinel draft: rigor-row-g1 runs test -f up\.txt hourly, reporting to coordinator/, 'the row names the watch and its check');
    assert.match(text, /a sentinel draft awaiting your approval, not watching yet/, 'it is labelled a draft awaiting approval');
    assert.match(text, /Drafted from 2 repeats of row:G1 on #4, #7\./, 'it cites the repeat');
    assert.match(text, /Proof: test -f up\.txt, red commit aaaaaaaaaaaa exit 1, green commit bbbbbbbbbbbb exit 0\./, 'it shows the red and green proof');
    assert.doesNotMatch(text, /release|approved sentinel|is watching/i, 'it is neither a lane hold nor an approved sentinel');
    await page.run(`data.project.sentinelDrafts = ${JSON.stringify([draft({ name: 'x<b>y', check: 'true', cited: false })])}; render();`);
    const bare = page.show('needs');
    assert.match(bare, /Proposed by an agent with no repeat cited\./, 'a draft with no evidence says so');
    assert.ok(!bare.includes('<b>y'), 'the name is escaped');
    await page.run('data.project.sentinelDrafts = []; render();');
    assert.equal(page.show('needs').includes('data-sentinel-draft'), false, 'an approved or declined draft leaves Needs-you');
  } finally {
    await view.stop();
  }
});
