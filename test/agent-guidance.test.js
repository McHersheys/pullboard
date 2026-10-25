/** Installed guidance makes the board’s recorded checks and verdict the proof [I1,I3,V4]. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { HOOKS, HOOKS_DIR } from '../src/hooks.js';
import { ROLES } from '../src/skills.js';
import { createE2eHelpers } from './e2e-helpers.js';

const helpers = createE2eHelpers();
after(helpers.cleanup);

/** Inspect actual installed instructions so template text alone cannot stand in for delivery. */
function boardProofGuidance(text, surface) {
  assert.match(text, /the frozen check, the gate and the verifier[’']s verdict are the proof/iu,
    `${surface} names the board’s three proof decisions`);
  assert.match(text, /(?:do not|never) (?:keep|create) (?:private )?evidence folders, packets, manifests or custody rules/iu,
    `${surface} forbids an agent’s separate proof collection`);
  assert.match(text, /cite the board[’']s receipts/iu, `${surface} points to the board’s receipts`);
}

test('the guidance names the gate and the verdict as the proof and forbids private evidence folders [I1,I3,V4]', () => {
  const box = helpers.project();
  boardProofGuidance(readFileSync(join(box.repo, 'AGENTS.md'), 'utf8'), 'generated AGENTS');
  for (const [role, name] of Object.entries(ROLES)) {
    boardProofGuidance(readFileSync(join(box.repo, '.claude', 'skills', name, 'SKILL.md'), 'utf8'),
      `installed ${role} skill`);
    const prompt = box.run(box.repo, 'prompt', role);
    assert.equal(prompt.code, 0, prompt.err || prompt.out);
    boardProofGuidance(prompt.out, `${role} prompt`);
  }
  for (const hook of HOOKS) {
    boardProofGuidance(readFileSync(join(box.repo, HOOKS_DIR, hook), 'utf8'), `installed ${hook} hook`);
  }
});
