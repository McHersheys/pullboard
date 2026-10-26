/** @pullboard-test-input source-tree */
/** @pullboard-test-gui */
/** Agent-approved rows remain readable and actionable in the person view [B26,N26,S1,P6]. */
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { machine, project, startView, boardOf, chromeExecutable, openSnapshotChrome, closeSnapshotChrome } from './fixture.js';

test('agent approvals show full rows and styled actions at narrow width and resolve from Spec detail [B26,N26,S1,P6]', { timeout: 120_000 }, async () => { // budget: real Git/API/browser setup and two person decisions; no performance claim.
  const box = machine();
  box.env.GIT_AUTHOR_NAME = 'Agent <review> & team';
  const spec = '# Approval review\n\n## G · Goals\n- G1 [approved, must] Show the complete first requirement, including its final words. | gate: first browser gate\n- G2 [approved, must] Show the complete second requirement before declining it. | gate: second browser gate\n';
  const alpha = project(box, 'approval-review', spec, {}, { agentApproved: true });
  const view = await startView(box);
  let chrome;
  try {
    const before = await boardOf(view, alpha.repo);
    assert.deepEqual(before.needs.filter(row => row.kind === 'agent-approved').map(row => row.id), ['G1', 'G2']);
    const executable = chromeExecutable();
    assert.ok(executable, 'real Chrome is required for person actions and narrow layout');
    chrome = await openSnapshotChrome(executable, view.link.href, join(box.dir, 'approval-review-chrome'));
    await chrome.send('Emulation.setDeviceMetricsOverride', { width: 375, height: 900, deviceScaleFactor: 1, mobile: false });
    await chrome.waitFor('innerWidth === 375 && document.querySelectorAll("#needs [data-agent-approved]").length === 2');
    for (const row of before.spec) {
      const shown = JSON.parse(await chrome.stable(`JSON.stringify((() => {
        const row = document.querySelector('#needs [data-agent-approved="${row.id}"]');
        const buttons = [...row.querySelectorAll('[data-row-decision]')];
        const boxes = buttons.map(button => button.getBoundingClientRect());
        const commit = row.querySelector('code');
        return { text: row.textContent, commit: commit.textContent, full: commit.title,
          labels: buttons.map(button => button.textContent),
          styled: buttons.every(button => button.classList.contains(button.dataset.rowDecision === 'approve' ? 'approve-row' : 'decline-row')),
          targets: boxes.every(box => box.height >= 44),
          beside: boxes[0].top === boxes[1].top && boxes[0].right <= boxes[1].left,
          overflow: document.documentElement.scrollWidth > innerWidth };
      })())`));
      assert.ok(shown.text.includes(row.text), 'Needs-you includes the entire actual row text');
      assert.ok(shown.text.includes(row.gate), 'Needs-you includes the actual gate');
      assert.ok(shown.text.includes('Agent <review> & team'), 'plain attribution preserves escaped Git author text');
      assert.doesNotMatch(shown.text, /Git author, seat unknown/u);
      assert.equal(shown.commit, row.agentApproval.commit.slice(0, 12));
      assert.equal(shown.full, row.agentApproval.commit, 'the full commit remains available on hover');
      assert.deepEqual(shown.labels, ['Confirm', 'Decline']);
      assert.equal(shown.styled, true);
      assert.equal(shown.targets, true);
      assert.equal(shown.beside, true, 'both styled buttons remain side by side on a phone');
      assert.equal(shown.overflow, false);
    }
    await chrome.click("document.querySelector('[data-tab=spec]')");
    await chrome.click('document.querySelector(\'#spec-chips [data-rows="spec:all"]\')');
    await chrome.click('document.querySelector(\'#spec-list [data-row="spec:G1"]\')');
    await chrome.waitFor('document.querySelector("#spec-detail h2 span")?.textContent === "G1"');
    assert.equal(await chrome.stable('document.querySelector("#spec-detail [data-row-decision=approve]")?.textContent'), 'Confirm');
    await chrome.click('document.querySelector("#spec-detail [data-row-decision=approve]")');
    await chrome.waitFor('!data.project.spec.find(row => row.id === "G1").agentApproval');
    const confirmed = await boardOf(view, alpha.repo);
    assert.equal(confirmed.spec.find(row => row.id === 'G1').agentApproval, null, 'the actual person confirmation is recorded');
    assert.equal(confirmed.needs.some(row => row.kind === 'agent-approved' && row.id === 'G1'), false);
    await chrome.click('document.querySelector(\'#spec-list [data-row="spec:G2"]\')');
    await chrome.waitFor('document.querySelector("#spec-detail h2 span")?.textContent === "G2"');
    await chrome.click('document.querySelector("#spec-detail [data-row-decision=decline]")');
    await chrome.click('document.querySelector("#spec-decline-reason")');
    await chrome.send('Input.insertText', { text: 'The second requirement needs revision.' });
    await chrome.click('document.querySelector("#spec-decline-submit")');
    await chrome.waitFor('data.project.spec.find(row => row.id === "G2").decision?.decision === "decline"');
    const declined = await boardOf(view, alpha.repo);
    assert.equal(declined.spec.find(row => row.id === 'G2').decision.reason, 'The second requirement needs revision.');
    assert.equal(declined.needs.some(row => row.kind === 'agent-approved' && row.id === 'G2'), false);
  } finally {
    try { if (chrome) await closeSnapshotChrome(chrome); }
    finally { await view.stop(); }
  }
});
