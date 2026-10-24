/** Readiness is a revision-bound peer judgement, with mechanical prerequisites [U113]. */
import { createHash } from 'node:crypto';
import { atomic, itemById, logEvent } from './board.js';
import { itemCheckBaseline } from './item-check-baseline.js';
import { agentParent } from './seats.js';
import { ENGINE_VERSION } from './machine.js';
import { BAR_READY_ENGINE } from './bar-ready-engine.js';
import { Refused } from './refused.js';

const FIELDS = ['item_title', 'item_criterion', 'item_check', 'item_brief', 'item_spec_ids', 'item_after', 'item_route'];
/** Read a deterministic value kept by ordered moves; the event history retains its provenance. */
function read(board, key) {
  const row = board.db.prepare('SELECT meta_value FROM board_meta WHERE meta_key=?').get(key);
  return row ? JSON.parse(row.meta_value) : null;
}
/** Write within the caller's atomic move. */
function save(board, key, value) {
  board.db.prepare('INSERT INTO board_meta(meta_key,meta_value) VALUES (?,?) ON CONFLICT(meta_key) DO UPDATE SET meta_value=excluded.meta_value').run(key, JSON.stringify(value));
}
/** A primary session's own recorded identity is known; a seat-name fallback is not. */
function parent(board, agent) {
  return agentParent(board, agent) ?? board.db.prepare('SELECT meta_value FROM board_meta WHERE meta_key=?').get(`agent_session:${agent}`)?.meta_value ?? null;
}
/** Bind the entire author-written bar, including coverage and measurement notes in the brief. */
export function barDigest(item) {
  return createHash('sha256').update(JSON.stringify(FIELDS.map(key => [key, item[key] ?? '']))).digest('hex');
}
/** Read the default-off board setting without consulting a replica's local configuration. */
export function barReadySetting(board) { return read(board, 'bar_ready_setting') ?? { enabled: false, since: 0 }; }
/** Make activation an ordered boundary; repeating on does not erase earlier obligations. */
export function setBarReady(board, { agentId, enabled }) {
  if (agentId !== 'coordinator') throw new Refused('COORDINATOR_ONLY', 'only the coordinator changes bar readiness; shout coordinator');
  if (typeof enabled !== 'boolean') throw new Refused('USAGE', 'pullboard bar ready on|off');
  return atomic(board, () => {
    const prior = barReadySetting(board);
    if (prior.enabled === enabled) return prior;
    logEvent(board, agentId, 'bar-ready', null, { enabled });
    const setting = { enabled, since: board.lastEvent.event_id };
    save(board, 'bar_ready_setting', setting);
    return setting;
  });
}
/** Snapshot authors on semantic edits, never retroactively upgrading an unknown historical parent. */
export function recordBarRevision(board, item, by, before = null) {
  if ((board.executionEngineVersion ?? ENGINE_VERSION) < BAR_READY_ENGINE || !barReadySetting(board).enabled) return;
  const previous = read(board, `bar_revision:${item.item_id}`);
  const changed = FIELDS.filter(key => !previous || !before || before[key] !== item[key]);
  if (!changed.length) return;
  const authors = { ...(previous?.authors ?? {}) };
  for (const field of FIELDS) {
    if (changed.includes(field)) authors[field] = { agent: by, parent: parent(board, by) };
    else if (!authors[field]) authors[field] = { agent: item.item_created_by, parent: parent(board, item.item_created_by) };
  }
  const revision = { digest: barDigest(item), authors };
  logEvent(board, by, 'bar-revision', item.item_id, revision);
  save(board, `bar_revision:${item.item_id}`, { ...revision, revision: board.lastEvent.event_id });
}
/** Parse explicit notes without pretending a regular expression can grade their adequacy. */
export function barNotes(brief) {
  const sections = {};
  let key = '';
  for (const line of String(brief).split(/\r?\n/u)) {
    const label = /^([a-z][a-z ]*):\s*(.*)$/iu.exec(line.trim());
    if (label) { key = label[1].toLowerCase(); sections[key] = label[2].trim(); }
    else if (key && line.trim()) sections[key] += `\n${line.trim()}`;
  }
  return sections;
}
/** An already-frozen bar predating activation needs no backfill until its words change. */
export function barReadinessRequired(board, item) {
  if ((board.executionEngineVersion ?? ENGINE_VERSION) < BAR_READY_ENGINE) return false;
  const setting = barReadySetting(board);
  if (!setting.enabled) return false;
  if (!item.item_frozen_digest) return true;
  const edited = read(board, `bar_revision:${item.item_id}`)?.revision ?? 0;
  const frozen = board.db.prepare("SELECT MAX(event_id) AS id FROM event WHERE item_id=? AND event_kind IN ('claim','refreeze')").get(item.item_id).id ?? 0;
  return Math.max(edited, frozen) > setting.since;
}
/** Mechanical omissions are aggregated, so the coordinator can repair the bar in one pass. */
export function barReadiness(board, item, { signature = true } = {}) {
  const revision = read(board, `bar_revision:${item.item_id}`);
  const notes = barNotes(item.item_brief);
  const baseline = itemCheckBaseline(board, item);
  const missing = [];
  if (!notes['named test']) missing.push('Named test: the case this check proves');
  if (!baseline || baseline.result !== 'red' || baseline.command !== item.item_check || !baseline.main) missing.push('a recorded red check baseline at main (an absent named case counts)');
  if (!notes.measurements) missing.push('Measurements: a method beside each quantitative bound, or an explicit statement that there are none');
  if (!notes['reviewer edges']) missing.push('Reviewer edges: cases a reviewer should try');
  if (!revision || revision.digest !== barDigest(item)) missing.push('a recorded current bar revision (edit the brief)');
  const signed = read(board, `bar_sign:${item.item_id}`);
  const baselineDigest = createHash('sha256').update(JSON.stringify(baseline)).digest('hex');
  if (signature && (!signed || signed.revision !== revision?.revision || signed.digest !== revision?.digest || signed.baselineDigest !== baselineDigest)) missing.push('sign-off by another parent session: pullboard bar sign '+item.item_id);
  return { revision, notes, baseline, baselineDigest, signed, missing };
}
/** The same board guard protects explicit claim, next, run, renew and submit. */
export function barReadyProblem(board, item) {
  if (!barReadinessRequired(board, item)) return null;
  const status = barReadiness(board, item);
  return status.missing.length ? new Refused('BAR_NOT_READY', `#${item.item_id}'s bar needs ${status.missing.join('; ')}; ask its author to edit the brief, then another session runs pullboard bar sign ${item.item_id}`) : null;
}
/** Record the peer's judgement against exact words, author identities and baseline observation. */
export function signBar(board, id, { agentId, revision, digest, note }) {
  return atomic(board, () => {
    const item = itemById(board, id);
    if (['verified','withdrawn'].includes(item.item_status)) throw new Refused('CLOSED', `#${id} is ${item.item_status}; sign an open bar`);
    const status = barReadiness(board, item, { signature: false });
    if (status.missing.length) throw new Refused('BAR_NOT_READY', `#${id} needs ${status.missing.join('; ')}; edit the brief or wait for its baseline before signing`);
    if (status.revision.revision !== revision || status.revision.digest !== digest) throw new Refused('BAR_SIGN_STALE', `#${id}'s bar changed; read it again before pullboard bar sign ${id}`);
    const signerParent = parent(board, agentId);
    const authors = Object.values(status.revision.authors);
    if (!signerParent || authors.some(author => !author.parent)) throw new Refused('BAR_PARENT_UNKNOWN', `#${id} needs known author and signer session identities; join from the real runtime session, then author a new bar revision`);
    if (authors.some(author => author.agent === agentId || author.parent === signerParent)) throw new Refused('BAR_SELF_SIGN', `#${id}'s author and its helpers cannot sign their own bar; ask another parent session`);
    if (typeof note !== 'string' || !note.trim()) throw new Refused('NOTE_REQUIRED', 'say whether a builder can meet this bar and two reviewers would grade it the same: --note "..."');
    const signed = { revision, digest, baselineDigest: status.baselineDigest, authorParents: authors, signerParent, note: note.trim() };
    logEvent(board, agentId, 'bar-sign', id, signed);
    save(board, `bar_sign:${id}`, { ...signed, by: agentId, event: board.lastEvent.event_id });
    return { id, ...signed };
  });
}
