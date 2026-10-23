/** Read-only Settings page markup and embedded API-only browser behavior [O5,O6,N26]. */

/** Render the Settings pane; its only controls navigate scopes or refresh a GET. */
export function settingsMarkup() {
  return '<section data-pane="settings" class="card-panel" id="settings-pane" aria-label="Settings" hidden><h2>Settings</h2><p>Read-only settings from this computer. Change settings through the supported commands.</p><button type="button" data-settings-open>All local boards</button><div id="settings-content" aria-live="polite"></div></section>';
}

/** Embed the scoped settings reader beside the existing page API and escaped-text renderer. */
function settingsReaderScript() {
  return `
const settingsPages = new Map();
let settingsScope = 'machine';
let settingsAllBoards = false;
/** Preserve false, zero, empty strings and null distinctly in a setting cell. */
function settingText(value) {
  return value === null ? 'null' : typeof value === 'object' ? JSON.stringify(value) : String(value);
}
/** Draw only escaped API values, including refusal messages, without editing controls. */
function drawSettings(entry) {
  const labels = { machine: 'This machine', repo: 'This repo', board: 'This board' };
  const scopes = Object.entries(labels).map(([scope, label]) => '<button type="button" role="tab" data-settings-scope="' + scope + '" aria-selected="' + (scope === settingsScope) + '">' + label + '</button>').join('');
  const rows = (entry.rows || []).filter(row => row.scope === settingsScope);
  const cells = rows.map(row => '<tr data-setting-key="' + esc(row.key) + '"><th scope="row">' + esc(row.key) + (row.root ? '<br><small>' + esc(row.root) + '</small>' : '') + '</th><td>' + esc(row.secret ? (row.value === 'set' ? 'set' : 'not set') : settingText(row.value)) + '</td><td>' + esc(row.secret ? 'not set' : settingText(row.default)) + '</td><td>' + esc(row.source) + (row.origin ? ' (' + esc(row.origin) + ')' : '') + '</td></tr>').join('');
  $('settings-content').innerHTML = '<p>' + esc(entry.context || 'This computer') + '</p><div role="tablist" aria-label="Settings scope">' + scopes + '</div><button type="button" data-settings-refresh>Refresh settings</button>'
    + (entry.error ? '<p role="alert">' + esc(entry.error) + '</p>' : entry.loading ? '<p role="status">Loading settings…</p>' : '<div class="settings-table"><table><thead><tr><th>Setting</th><th>Value</th><th>Default</th><th>Source</th></tr></thead><tbody>' + cells + '</tbody></table></div>' + (!rows.length ? '<p>No settings in this scope.</p>' : ''));
}
/** Read only the selected local board; neither relay nor snapshot implies machine access. */
async function showSettings(force = false) {
  if (view.tab !== 'settings' || !data) return;
  const root = view.root;
  const allBoards = settingsAllBoards;
  const board = !settingsAllBoards && data.projects.find(entry => entry.root === root && entry.ok);
  const source = board && boardSources.get(board.id);
  const hasLocal = hosted.local ? Boolean(localSession && localConfirmed) : transportModule === null;
  if (snapshot || !hasLocal || (board && source?.kind !== 'local')) {
    drawSettings({ error: 'Settings are available from this computer’s local view. Relay views and snapshots do not include machine settings.' });
    return;
  }
  const key = localReadBase + ':' + (board?.id || 'machine');
  let entry = settingsPages.get(key);
  if (entry && !force) { drawSettings(entry); return; }
  entry = { loading: true, context: board ? 'Settings for ' + board.root : 'This computer and all authorized local repos and boards' };
  settingsPages.set(key, entry);
  drawSettings(entry);
  try {
    const reply = await jsonRequest('/api/v1/settings' + (board ? '?board=' + encodeURIComponent(board.id) : ''), undefined, localReadBase, localReadHeaders);
    if (!Array.isArray(reply.settings)) throw new Error('The settings API returned no inventory.');
    entry.rows = reply.settings;
  } catch (error) { entry.error = String(error.message || error); }
  entry.loading = false;
  if (view.root === root && settingsAllBoards === allBoards && view.tab === 'settings' && settingsPages.get(key) === entry) drawSettings(entry);
}
`;
}

/** Embed navigation-only controls after the API reader, without adding a write path. */
export function settingsPageScript() {
  return settingsReaderScript() + `
/** Settings controls only change the selected scope or issue another read. */
document.addEventListener('click', event => {
  if (event.target.closest('[data-tab]') || event.target.closest('[data-root]')) settingsAllBoards = false;
  if (event.target.closest('[data-settings-open]')) {
    settingsAllBoards = true;
    openTab('settings');
    render();
  }
  const scope = event.target.closest('[data-settings-scope]');
  if (scope && ['machine', 'repo', 'board'].includes(scope.dataset.settingsScope)) {
    settingsScope = scope.dataset.settingsScope;
    void showSettings();
  }
  if (event.target.closest('[data-settings-refresh]')) void showSettings(true);
});
`;
}
