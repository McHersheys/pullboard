/** Person-owned machine exclusions carry key-free native provenance [H5,H17,B26]. */
import { repoInfo } from './git.js';
import { readRelayMachine } from './relay-machine.js';
import { updateRelayMachine } from './relay-machine.js';
import { requirePersonChannel } from './person.js';

/** Read an exclusion without inferring a missing historical actor or timestamp. */
export function relayExclusion(root) {
  const project = repoInfo(root).root;
  const state = readRelayMachine();
  if (!state.excluded.includes(project)) return null;
  const detail = state.exclusionDetails?.[project];
  return { reason: detail?.reason ?? 'unknown historical exclusion', at: detail?.at ?? null,
    by: detail?.by ?? null, path: detail?.path ?? null, eventId: detail?.eventId ?? null,
    next: 'pullboard relay on' };
}

/** Successful local unlink remains available to agents; only a person can persist an opt-out. */
export function excludeRelayByPerson(root, io, { localRecords, store }) {
  let channel;
  try { channel = requirePersonChannel(io.personChannel); }
  catch (error) { if (error.code === 'B26_PERSON_CHANNEL') return false; throw error; }
  const project = repoInfo(root).root;
  // Record the intent first: a storage failure can leave a truthful request, never an unattributed exclusion.
  const receipt = localRecords(root, board => {
    store.logEvent(board, store.PERSON, 'relay_exclusion', null, { path: 'relayOff', reason: 'person relay off', channel, action: 'exclude' });
    return { by: board.lastEvent.event_by, at: board.lastEvent.event_at, eventId: board.lastEvent.event_id };
  });
  updateRelayMachine(state => {
    if (!state.excluded.includes(project)) state.excluded.push(project);
    state.exclusionDetails ??= {};
    state.exclusionDetails[project] = { reason: 'person relay off', path: 'relayOff',
      by: receipt.by, at: receipt.at, eventId: receipt.eventId };
  });
  return true;
}

/** Clear only this board's opt-out once a newly authorized link has actually finished. */
export function clearRelayExclusion(root) {
  const project = repoInfo(root).root;
  return updateRelayMachine(state => {
    const existed = state.excluded.includes(project);
    state.excluded = state.excluded.filter(entry => entry !== project);
    if (state.exclusionDetails) delete state.exclusionDetails[project];
    return existed;
  });
}

/** Explain a completed opt-in without hiding a separate fresh-board notice. */
export function reportClearedExclusion(result, io) {
  const notice = 'The exclusion was cleared; this board is linked again.';
  result.notice = [result.notice, notice].filter(Boolean).join(' ');
  io.err(notice);
}
