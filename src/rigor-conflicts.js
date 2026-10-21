/** Recent merge collisions are architectural advice, separate from proof-bound Rigor causes [D1]. */
import {
  conflictNote,
  shownPath,
} from './trunk-conflict.js';

const WINDOW_DAYS = 14;
const HOT_ITEMS = 2;

/** Read only the complete canonical machine-note syntax; this is not authenticated Git evidence. */
export function conflictNoteFiles(note) {
  if (typeof note !== 'string') return null;
  const match = /^conflicts with the trunk at ([a-f0-9]{12}) in ([\s\S]+); merge main and resubmit$/u.exec(note);
  if (!match) return null;
  const body = match[2];
  const token = /"(?:[^"\\]|\\.)*"|[\w./@+-]+/uy;
  const files = [];
  let offset = 0;
  while (offset < body.length) {
    token.lastIndex = offset;
    const found = token.exec(body);
    if (!found) return null;
    let file = found[0];
    if (file.startsWith('"')) {
      try { file = JSON.parse(file); }
      catch { return null; /* A malformed quoted path is not a canonical conflict note. */ }
    }
    if (!file || file.includes('\0') || files.includes(file) || shownPath(file) !== found[0]) return null;
    files.push(file);
    offset = token.lastIndex;
    if (offset === body.length) break;
    if (body.slice(offset, offset + 2) !== ', ' || offset + 2 === body.length) return null;
    offset += 2;
  }
  return files.length && conflictNote({ files, trunk: match[1] }) === note ? files : null;
}

/** Count each recent reopen or hold once per exact file, retaining inspectable event provenance. */
export function conflictReport(events, { now = new Date() } = {}) {
  const until = new Date(now).getTime();
  const since = until - WINDOW_DAYS * 86_400_000;
  const byFile = new Map();
  const unattributed = new Map();
  const seen = new Set();
  for (const event of events) {
    if (!['reopen', 'hold_item'].includes(event.event_kind) || !Number.isInteger(event.item_id) || event.item_id < 1) continue;
    const at = Date.parse(event.event_at);
    if (!Number.isFinite(at) || at < since || at > until || seen.has(event.event_id)) continue;
    seen.add(event.event_id);
    const detail = JSON.parse(event.event_detail);
    const evidence = { id: event.event_id, item: event.item_id, kind: event.event_kind, at: event.event_at };
    let files = null;
    if (event.event_kind === 'reopen' && Array.isArray(detail.conflict?.files)
      && detail.conflict.files.length && detail.conflict.files.every(file => typeof file === 'string' && file && !file.includes('\0'))
      && /^[a-f0-9]{40}$/u.test(detail.conflict.trunk)) files = [...new Set(detail.conflict.files)];
    if (event.event_kind === 'hold_item') {
      files = conflictNoteFiles(detail.reason);
      if (!files && /\bconflicts?\b/iu.test(detail.reason ?? '')) {
        if (!unattributed.has(event.item_id)) unattributed.set(event.item_id, []);
        unattributed.get(event.item_id).push(evidence);
      }
    }
    for (const file of files ?? []) {
      if (!byFile.has(file)) byFile.set(file, { file, reopens: 0, holds: 0, items: new Set(), events: [] });
      const entry = byFile.get(file);
      entry[event.event_kind === 'reopen' ? 'reopens' : 'holds'] += 1;
      entry.items.add(event.item_id);
      entry.events.push({ ...evidence, source: event.event_kind === 'reopen' ? 'typed-conflict' : 'machine-note-syntax' });
    }
  }
  const conflictFiles = [...byFile.values()].map(entry => ({ ...entry, items: [...entry.items].sort((a, b) => a - b),
    events: entry.events.sort((a, b) => a.id - b.id) })).sort((a, b) => b.items.length - a.items.length || a.file.localeCompare(b.file));
  return { conflictWindow: { days: WINDOW_DAYS, since: new Date(since).toISOString(), until: new Date(until).toISOString(), thresholdItems: HOT_ITEMS },
    conflictFiles, hotFiles: conflictFiles.filter(file => file.items.length >= HOT_ITEMS),
    unattributedHolds: [...unattributed].sort(([a], [b]) => a - b).map(([item, events]) => ({ item, events })) };
}

/** Render exact paths safely on one terminal or Markdown line without changing their stored identity. */
function displayFile(file) {
  return JSON.stringify(file).replaceAll('|', '\\u007c').replaceAll('\u2028', '\\u2028').replaceAll('\u2029', '\\u2029');
}

/** Name the cost and missing attribution without presenting a split suggestion as a proved rule. */
export function conflictLines(report) {
  const lines = report.hotFiles.map(file => `hot file ${displayFile(file.file)}: ${file.reopens} conflict reopens, ${file.holds} conflict holds in 14 days; items ${file.items.map(id => '#' + id).join(', ')}; propose a split with pullboard rigor --draft-splits (coordinator, person approval required)`);
  if (report.unattributedHolds.length) lines.push(`conflict holds without attributable files: ${report.unattributedHolds.map(entry => '#' + entry.item + ' (' + entry.events.length + ')').join(', ')}; no paths inferred from prose`);
  return lines;
}

/** A durable ordinary proposal names the file and exact contributing events; it is never rigor: proof. */
export function splitProposal(file) {
  return { text: `Consider splitting ${displayFile(file.file)} into independently owned modules (for example, one module per command). It caused ${file.reopens} conflict reopens and ${file.holds} conflict holds across items ${file.items.map(id => '#' + id).join(', ')} in 14 days; review the architecture before deciding.`,
    source: 'conflict-split:' + Buffer.from(JSON.stringify({ file: file.file, events: file.events.map(event => event.id) })).toString('base64url') };
}

/** Suppress a live same-file proposal or the same previously decided evidence, including board reservations. */
export function splitAlreadyProposed(rows, file) {
  const proposal = splitProposal(file);
  return rows.some(row => {
    const source = /(?:^|\s)Source: (conflict-split:([A-Za-z0-9_-]+))(?:\s|$)/u.exec(row.text ?? '');
    if (!source) return false;
    try {
      const previous = JSON.parse(Buffer.from(source[2], 'base64url').toString('utf8'));
      return previous.file === file.file && (row.status === 'draft' || source[1] === proposal.source);
    } catch { return false; /* Unrelated or malformed source text cannot suppress a proposal. */ }
  });
}
