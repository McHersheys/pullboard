/** Project-local agent nudges never grant trust or replace another tool's hooks [I6]. */
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import {
  dirname,
  isAbsolute,
  join,
  relative,
} from 'node:path';

export const AGENT_HOOK_EVENTS = ['SessionStart', 'Stop'];
export const LEGACY_RESUME_HOOK =
  'm=$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null)/..; for p in node_modules/.bin/pullboard "$m/node_modules/.bin/pullboard"; do [ -x "$p" ] && exec "$p" resume; done; command -v pullboard >/dev/null && exec pullboard resume; true';
const SOURCES = [['Claude Code', '.claude/settings.json'], ['Codex', '.codex/hooks.json']];

/** Recognize only the exact command this installer owns. */
function owned(handler) {
  return handler?.type === 'command' && AGENT_HOOK_EVENTS.some(event => handler.command === `pullboard hook ${event}`);
}

/** Never follow project configuration through a symlink into a user's home. */
function regularProjectPath(root, name) {
  const file = join(root, name), parent = dirname(file);
  for (const path of [parent, file]) {
    let stat;
    try { stat = lstatSync(path); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    if (stat.isSymbolicLink()) return false;
    const inside = relative(realpathSync(root), realpathSync(path));
    if (inside === '..' || inside.startsWith('../') || isAbsolute(inside)) return false;
  }
  return !existsSync(file) || lstatSync(file).isFile();
}

/** Read an existing object without replacing malformed settings or hook arrays. */
function settingsAt(root, name) {
  if (!regularProjectPath(root, name)) throw new Error('configuration is not a regular project file');
  const value = existsSync(join(root, name)) ? JSON.parse(readFileSync(join(root, name), 'utf8')) : {};
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || value.hooks !== undefined && (!value.hooks || typeof value.hooks !== 'object' || Array.isArray(value.hooks))) throw new Error('configuration is not an object');
  for (const event of AGENT_HOOK_EVENTS) if (value.hooks?.[event] !== undefined
      && (!Array.isArray(value.hooks[event]) || value.hooks[event].some(group => !group || typeof group !== 'object' || !Array.isArray(group.hooks)))) throw new Error('hook groups are not arrays');
  return value;
}

/** Merge or remove only Pullboard's exact handlers, preserving unrelated settings and groups. */
export function configureAgentHooks(root, { remove = false, legacyResume = LEGACY_RESUME_HOOK, onWrite = () => {} } = {}) {
  return SOURCES.map(([vendor, name]) => {
    try {
      if (remove && !existsSync(join(root, name))) return `${vendor} agent hooks are not installed`;
      const value = settingsAt(root, name), before = JSON.stringify(value);
      value.hooks ??= {};
      for (const event of AGENT_HOOK_EVENTS) {
        const groups = value.hooks[event] ?? [];
        const kept = groups.flatMap(group => {
          const hooks = group.hooks.filter(handler => !owned(handler)
            && !(vendor === 'Claude Code' && legacyResume && event === 'SessionStart' && handler?.command === legacyResume));
          return hooks.length || Object.keys(group).some(key => key !== 'hooks') ? [{ ...group, hooks }] : [];
        });
        if (!remove) kept.push({ hooks: [{ type: 'command', command: `pullboard hook ${event}`, timeout: 5 }] });
        if (kept.length) value.hooks[event] = kept;
        else delete value.hooks[event];
      }
      if (!Object.keys(value.hooks).length) delete value.hooks;
      if (JSON.stringify(value) !== before) {
        mkdirSync(dirname(join(root, name)), { recursive: true });
        const temporary = join(root, name) + `.${process.pid}.tmp`;
        writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
        renameSync(temporary, join(root, name));
        onWrite(name);
      }
      return `${remove ? 'removed' : 'installed'} Pullboard's ${vendor} agent nudges in ${name}${vendor === 'Codex' && !remove ? '; review and trust them with /hooks' : ''}`;
    } catch {
      return `${vendor} agent hook warning: kept ${name} unchanged; repair its project-local JSON and run pullboard hooks`;
    }
  });
}

/** File presence is installation evidence, never proof that a vendor trusted a definition. */
export function agentHookStatus(root) {
  return SOURCES.map(([vendor, name]) => {
    let events = [];
    try {
      const value = settingsAt(root, name);
      events = AGENT_HOOK_EVENTS.filter(event => value.hooks?.[event]?.some(group => group.hooks.some(handler => owned(handler) && handler.command === `pullboard hook ${event}`)));
    } catch { /* Invalid configuration remains visibly inactive. */ }
    return { vendor, events, trust: vendor === 'Codex' ? 'unverified' : null };
  });
}
