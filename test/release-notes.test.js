/** @pullboard-test-input source-tree */
/** GitHub release notes use exactly the tagged changelog section, never generated notes [O3]. */
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { runFixtureChild } from './fixture-child.js';

const workflow = readFileSync(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8');

/** Execute the actual workflow extraction against private input; no GitHub or npm command runs. */
function extract(t, script, changelog, tag = 'v1.2.3') {
  const root = mkdtempSync(join(tmpdir(), 'pullboard-release-notes-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, 'CHANGELOG.md'), changelog);
  const notes = join(root, 'release-notes.md');
  const result = runFixtureChild(process.execPath, ['--input-type=module', '-e', script], {
    cwd: root, encoding: 'utf8',
    env: { ...process.env, GITHUB_REF_NAME: tag, RUNNER_TEMP: root },
  });
  return { ...result, notes: existsSync(notes) ? readFileSync(notes, 'utf8') : null };
}

test('the release workflow publishes exactly the tagged changelog section [O3]', t => {
  const match = workflow.match(/node --input-type=module <<'NOTES'\n([\s\S]*?)\n {10}NOTES/u);
  assert.ok(match, 'the workflow extracts its notes from CHANGELOG before publishing');
  const script = match[1].replace(/^ {10}/gmu, '');
  const body = '\n### Added\n\n- Preserve **Markdown**, Unicode café, and trailing spaces.  \n\n';
  const changelog = '# Changelog\n\n## [Unreleased]\n\nNot this future version.\n\n## [1.2.3] - 2026-10-26\n' + body
    + '## [1.2.2] - 2026-10-25\n\nNot this older version.\n';
  const selected = extract(t, script, changelog);
  assert.equal(selected.status, 0, selected.stderr);
  assert.equal(selected.notes, body, 'only the selected section body is copied byte for byte');
  const last = extract(t, script, '# Changelog\n\n## [1.2.3]\n' + body);
  assert.equal(last.status, 0, last.stderr);
  assert.equal(last.notes, body, 'the final section does not need a following release heading');
  for (const invalid of [changelog.replace('[1.2.3]', '[1.2.30]'), changelog + '\n## [1.2.3]\nDuplicate\n',
    '# Changelog\n\n## [1.2.3]\n\n## [1.2.2]\nOlder\n']) {
    const refused = extract(t, script, invalid);
    assert.notEqual(refused.status, 0, 'missing, duplicate, or empty notes refuse before publication');
    assert.equal(refused.notes, null, 'a refusal never writes a notes file');
  }
  assert.match(workflow, /gh release create "\$GITHUB_REF_NAME"[^\n]*--verify-tag[^\n]*--notes-file "\$RUNNER_TEMP\/release-notes\.md"/u);
  assert.doesNotMatch(workflow, /--generate-notes|--notes-from-tag/u, 'generated or tag-message notes never replace the changelog');
  assert.ok(workflow.indexOf("<<'NOTES'") < workflow.indexOf('run: npm publish'), 'missing notes stop before npm publishing');
  assert.ok(workflow.indexOf('run: npm publish') < workflow.indexOf('gh release create'), 'the GitHub release follows successful package publication');
  assert.match(workflow, /publish:\n\s+permissions:\n\s+contents: write/u, 'only the publishing job gains release-write authority');
});
