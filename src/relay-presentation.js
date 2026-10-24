import { previewBarCoverage } from './bar-coverage.js';
import {
  barDigest,
  barReadiness,
} from './bar-readiness.js';
import { mainPolicy } from './trusted-policy.js';
/** Device-sealed presentation uses the same API state as the local view [A4,H5,H15]. */
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import * as store from './board.js';
import { exportBoard } from './exchange.js';
import {
  codeIsFromMain,
  repoInfo,
  withGitReadFacts,
} from './git.js';
import { Refused } from './refused.js';
import { loadConfig } from './config.js';
import { loadSpec } from './spec.js';
import { loadDoctrine } from './doctrine.js';
import { shownDecisionRows } from './row-decisions.js';
import { projectState } from './serve.js';
import { personNeeds } from './needs.js';
import { personBlockWords } from './blocks.js';
import {
  personRequestRecords,
  personRequestStatuses,
} from './relay-requests.js';
import {
  cachedVerdictStates,
  verdictProjector,
} from './verdict-freshness.js';
import { trunkRevisionReader } from './trunk-revision.js';

/** Capture spec, doctrine, config and board presentation without sending plaintext to a relay. */
export function relayPresentation(root, { board: providedBoard = null } = {}) {
  return withGitReadFacts(() => readRelayPresentation(root, providedBoard));
}

/** One presentation read, using the supplied staged board without sharing its derived cache. */
function readRelayPresentation(root, providedBoard) {
  const info = repoInfo(root);
  const board = providedBoard ?? store.openBoard(join(info.commonDir, 'pullboard', 'board.sqlite'), undefined, { isMain: codeIsFromMain() });
  try {
    const projected = projectState(root, { board });
    // The sealed page's Needs you carries the person's blocks, in plain words with no local path [C6].
    const blocks = personBlockWords(info.commonDir, (board.clock ?? store.systemClock).now());
    const state = { ...projected, blocks, needs: personNeeds({ ...projected, blocks }) };
    const freshness = providedBoard
      ? verdictProjector(root, board, { main: trunkRevisionReader(info)() }).state
      : cachedVerdictStates(root, board, info);
    const derived = new Map(store.listItems(board, { all: true }).map(item => [item.item_id, freshness(item)]));
    state.items = state.items.map(item => {
      const verdictState = derived.get(item.id);
      return verdictState ? { ...item, verdictState } : item;
    });
    // The passkey device reads whether person moves are signed and which terminal-started moves wait for it [E22].
    const requested = new Set(personRequestRecords(board).map((record) => record.id));
    const personProposals = store.personProposals(board).filter((proposal) => !requested.has(proposal.id));
    const config = loadConfig(root);
    const signed = store.personSigning(board).signed;
    const ids = signed ? [...loadSpec(root, config).rows.map(row => row.id), ...loadDoctrine(root, config).repo.rows.map(row => `doctrine:${row.id}`)] : [];
    const personRows = signed ? shownDecisionRows(root, config, ids) : [];
    let personBars = [];
    if (signed) {
      const entries = store.listItems(board, { all: true }).map(item => ({ item, status: barReadiness(board, item, { signature: false }) }));
      // A board with no committed policy yet still shows its bars, only without their coverage preview.
      let policy = null;
      try { policy = mainPolicy(root); } catch (error) { if (!(error instanceof Refused)) throw error; }
      const plans = policy ? previewBarCoverage(root, entries.map(({ item, status }) => ({ item, coverage: status.signed?.coverage })), policy) : [];
      personBars = entries.map(({ item, status }, index) => ({ id: item.item_id,
        before: { revision: status.revision?.revision ?? 0, digest: barDigest(item) }, ...(plans[index] ? { coverage: plans[index] } : {}) }));
    }
    return { version: 1, state: { ...store.projectItemThreads(board, state), personRequests: personRequestStatuses(board),
      personSigning: { signed }, personProposals, personRows, personBars }, config, shouts: store.allShouts(board) }; }
  finally { if (!providedBoard) store.closeBoard(board); }
}
/** Resolve one shout from the complete history carried only inside the sealed presentation. */
export function relayPresentationShout(root, id) {
  return presentationShout(relayPresentation(root), id);
}

/** Resolve one addressed shout from an already decoded snapshot without local repository access. */
export function presentationShout(presentation, id) {
  if (!Array.isArray(presentation?.shouts)) throw new Refused('SHOUT_NOT_AVAILABLE', 'this snapshot does not include addressed shout history; refresh it with a current CLI');
  const found = presentation.shouts.find((shout) => shout.shout_id === id);
  if (!found) throw new Refused('NO_SHOUT', `no shout #${id}`);
  const answer = found.shout_decision ? presentation.shouts.find((shout) => shout.shout_answers === id) ?? null : null;
  return { ...found, decision_state: found.shout_decision ? (answer ? 'answered' : 'open') : null, decision_answer: answer };
}

/** Notice presentation-only changes, including a spec or doctrine edit without a board move. */
export function presentationDigest(presentation) {
  return createHash('sha256').update(JSON.stringify(presentation)).digest('hex');
}

/** Capture importable native tables beside matching API presentation, retrying a concurrent local move. */
export function relaySnapshot(root, { board: providedBoard = null } = {}) {
  return withGitReadFacts(() => readRelaySnapshot(root, providedBoard));
}

/** Keep native tables and their device presentation at one observed board revision. */
function readRelaySnapshot(root, providedBoard) {
  const info = repoInfo(root);
  for (let attempt = 0; attempt < 3; attempt++) {
    const before = providedBoard ? null : relayPresentation(info.root);
    const board = providedBoard ?? store.openBoard(join(info.commonDir, 'pullboard', 'board.sqlite'), undefined, { isMain: codeIsFromMain() });
    let native;
    try { native = exportBoard(board); } finally { if (!providedBoard) store.closeBoard(board); }
    const presentation = relayPresentation(info.root, { board: providedBoard });
    const event = native.tables.event.at(-1)?.event_id ?? 0;
    if (event === (presentation.state.events[0]?.event_id ?? 0) &&
        (providedBoard || presentationDigest(before) === presentationDigest(presentation))) return { ...native, presentation };
  }
  throw new Refused('RELAY_SNAPSHOT_BUSY', 'the local board changed while its presentation was captured; retry the command to publish a consistent sealed checkpoint');
}
