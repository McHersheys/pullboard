/**
 * Spec rows an agent drafts from a lane worktree (#878). SPEC.md is the coordinator's file, so a lane
 * cannot write it: the draft is recorded on the board instead, where it replays and travels over the
 * relay like any recorded move. Every reader that asks whether a cited id is live counts a board draft
 * as a draft row, so the lane cites the returned id at once and its worktree stays clean. The
 * coordinator's spec apply writes the drafts into SPEC.md, and the person approves them there as before.
 * A draft counts as applied once SPEC.md has its id, so applying needs no second move. Every other
 * writer reserves its new id here too, so no two proposals share an id.
 */
import {
  atomic,
  logEvent,
  PERSON,
} from './board.js';
import { Refused } from './refused.js';
import { spawnSync } from 'node:child_process';
import { loadDoctrine } from './doctrine.js';
import {
  loadSpec,
  parseSpec,
} from './spec.js';
import { cleanGitEnvironment } from './git.js';
import { trunkRef } from './trusted-policy-read.js';
import { rowDrafts } from './board-query.js';
export { rowDrafts } from './board-query.js';

/**
 * Reserve one new row's id on the board, and for a lane, record the drafted row itself. Every writer
 * reserves here, in one write transaction, before any file names the id: a lane's spec draft, the
 * main checkout's spec draft and doctrine rulings, Rigor and blueprints. Writers that planned the same
 * id at the same moment get distinct ids, because the board takes the planned id or the next number
 * after it that no draft holds. A reservation marked written is the writer's own to put in its file;
 * spec apply writes only the unwritten spec drafts, which come from lanes.
 *
 * @param {any} board
 * @param {{ agentId: string, row: { id: string, text: string, gate?: string, tier?: string, section?: string, target?: string }, written?: boolean }} move
 */
export function draftSpecRow(board, { agentId, row, written = false }) {
  if (!agentId || agentId === PERSON) throw new Refused('ROW_DRAFT', 'an agent drafts a row and the person approves it; run pullboard spec draft "<text>" from an agent seat');
  const needed = written ? ['text'] : ['text', 'gate', 'tier', 'section'];
  if (!row || !/^[A-Z][A-Z0-9]*\d+$/u.test(String(row.id)) || !['spec', 'doctrine', undefined].includes(row.target)
    || needed.some((key) => typeof row[key] !== 'string' || !row[key].trim() || /[\r\n|]/u.test(row[key]))) {
    throw new Refused('ROW_DRAFT', 'a drafted row needs its id and a one-line text, gate, tier and section; run pullboard spec draft "<text>"');
  }
  return atomic(board, () => {
    const current = rowDrafts(board);
    // The same writer asking again for the same definition, as a resumed blueprint add does, keeps the id
    // it reserved; a different gate, tier, section, target or writer is another proposal and gets its own id.
    const same = current.find((draft) => draft.id === row.id && draft.by === agentId && draft.written === Boolean(written)
      && ['text', 'gate', 'tier', 'section'].every((key) => (draft[key] ?? '') === (row[key] ?? '')) && draft.target === (row.target ?? 'spec'));
    if (same) return same;
    const [, prefix, number] = /^(.*?)(\d+)$/u.exec(row.id);
    let next = Number(number);
    while (current.some((draft) => draft.id === `${prefix}${next}`)) next += 1;
    logEvent(board, agentId, 'row_draft', null, { row, written: Boolean(written) });
    const entry = { id: `${prefix}${next}`, text: row.text, gate: row.gate ?? '', tier: row.tier ?? '', section: row.section ?? '', target: row.target ?? 'spec',
      written: Boolean(written), by: agentId, event: board.lastEvent.event_id, at: board.lastEvent.event_at };
    board.db.prepare('INSERT INTO board_meta(meta_key,meta_value) VALUES (?,?) ON CONFLICT(meta_key) DO UPDATE SET meta_value=excluded.meta_value')
      .run('row_drafts', JSON.stringify([...current, entry]));
    return entry;
  });
}

/**
 * Row ids the trunk holds that a lane's own files may lack: the primary checkout's working spec and
 * doctrine, which carry a coordinator's uncommitted draft, and the spec on the trunk branch, for a
 * primary checkout on another computer. A lane's new id skips them, so a lane draft and a coordinator
 * draft never share an id, whichever comes first.
 *
 * @param {string} root the lane worktree
 * @param {string | null} mainRoot the primary checkout on this computer, if any
 * @param {any} config
 */
export function trunkRowIds(root, mainRoot, config) {
  const ids = [];
  if (mainRoot) ids.push(...loadSpec(mainRoot, config).rows, ...loadDoctrine(mainRoot, config).repo.rows);
  const shown = spawnSync('git', ['show', `${trunkRef(root) ?? 'main'}:${config.spec}`], { cwd: root, env: cleanGitEnvironment(), encoding: 'utf8' });
  if (shown.status === 0) ids.push(...parseSpec(shown.stdout, { strictGrammarVersion: false }).rows);
  return ids.map((row) => row.id);
}

/** A lane's spec drafts: the reservations spec apply writes, unlike a writer's own reservation. */
function laneDrafts(drafts) {
  return drafts.filter((draft) => !draft.written && (draft.target ?? 'spec') === 'spec');
}

/** Board drafts from lanes that SPEC.md does not have yet, for spec apply to write. */
export function pendingRowDrafts(spec, drafts) {
  const present = new Set(spec.rows.map((row) => row.id));
  return laneDrafts(drafts).filter((draft) => !present.has(draft.id));
}

/**
 * Board drafts whose id SPEC.md holds as a draft row with other text: a proposal that lost its id to
 * another writer. spec apply names each one instead of treating it as written.
 */
export function clashingRowDrafts(spec, drafts) {
  return laneDrafts(drafts).filter((draft) => spec.rows.some((row) => row.id === draft.id && row.status === 'draft' && row.text !== draft.text));
}

/** A parsed spec with the board's pending drafts added as draft rows, for readers deciding whether an id is live. */
export function withRowDrafts(spec, drafts) {
  const pending = pendingRowDrafts(spec, drafts ?? []);
  if (!pending.length) return spec;
  return { ...spec, rows: [...spec.rows, ...pending.map((draft) => ({ id: draft.id, status: 'draft', tier: draft.tier, text: draft.text, gate: draft.gate, section: draft.section, line: 0, fields: [] }))] };
}
