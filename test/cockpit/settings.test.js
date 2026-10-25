/** @pullboard-test-gui */
/** Settings are projected by the real local API, never read or changed by the page [O5,O6,N26]. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { machine, project, startView, openPage, fetchLive, boardId } from './fixture.js';

/** Escape the expected literal API text, independently of the page's renderer. */
function text(value) {
  const display = value !== null && typeof value === 'object' ? JSON.stringify(value) : String(value);
  return display.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

test('the Settings page lists every setting by scope from the settings API and edits nothing [O5,O6,N26]', async () => {
  const box = machine();
  const alpha = project(box, 'alpha', undefined, { name: '<img src=x onerror="document.body.textContent=\'settings-owned\'">', lease: '47m', health: { sentinel: false }, claim: { reopenFirstRefusalMinutes: 0 } });
  project(box, 'beta', undefined, { lease: '53m' });
  box.env.PULLBOARD_RELAY_KEY = 'settings-page-private-fixture-key';
  const view = await startView(box);
  try {
    const page = await openPage(view);
    const id = await boardId(view, alpha.repo);
    const url = new URL('/api/v1/settings', view.base);
        url.searchParams.set('board', id);
    const reply = await fetchLive(url, { headers: { 'x-pullboard-key': view.key } });
    assert.equal(reply.status, 200);
    const inventory = await reply.json();
    const before = box.run(alpha.repo, 'export', '--json');
    const config = readFileSync(join(alpha.repo, 'pullboard.json'), 'utf8');
    assert.match(page.html, /data-tab="settings"[^>]*>Settings</u, 'Settings is reachable from the board navigation');
    await page.click({ root: alpha.repo });
    await page.click({ tab: 'settings' });
    for (const scope of ['machine', 'repo', 'board']) {
      await page.click({ settingsScope: scope });
      const shown = page.show('settings-content');
      const rows = inventory.settings.filter(row => row.scope === scope);
      assert.ok(rows.length > 0, `real API has ${scope} settings`);
      assert.equal((shown.match(/data-setting-key=/gu) || []).length, rows.length, 'every API setting appears once in its scope');
      for (const row of rows) {
        assert.ok(shown.includes(`data-setting-key="${row.key}"`), `${scope}: ${row.key}`);
        assert.ok(shown.includes(text(row.source)), `source: ${row.key}`);
        const start = shown.indexOf(`data-setting-key="${row.key}"`);
        const rendered = shown.slice(start, shown.indexOf('</tr>', start));
        assert.ok(rendered.includes('<td>' + text(row.value) + '</td><td>' + text(row.default) + '</td>'), `literal current value and default: ${row.key}`);
      }
      assert.match(shown, /Value/u);
      assert.match(shown, /Default/u);
      assert.match(shown, /Source/u);
      assert.doesNotMatch(shown, /<(?:input|select|textarea|form)\b/u, 'settings have no editor');
      assert.doesNotMatch(shown, /settings-page-private-fixture-key/u);
      if (scope === 'repo') {
        assert.match(shown, /47m/u);
        assert.match(shown, />false</u, 'false remains visible');
        assert.match(shown, />0</u, 'zero remains visible');
        assert.match(shown, /&lt;img/u, 'hostile setting text is escaped');
        assert.doesNotMatch(shown, /<img\b|<script\b/u, 'API strings never become executable markup');
      }
      if (scope === 'board') assert.match(shown, />set</u);
    }
    assert.ok(page.requests.some(request => request.path.startsWith('/api/v1/settings?board=')), 'page reads the settings API');
    assert.ok(page.requests.every(request => request.method === 'GET'), 'navigation records no moves or setting writes');
    assert.equal(readFileSync(join(alpha.repo, 'pullboard.json'), 'utf8'), config);
    assert.equal(box.run(alpha.repo, 'export', '--json'), before, 'settings navigation changes no board data');
  } finally { await view.stop(); }
});
