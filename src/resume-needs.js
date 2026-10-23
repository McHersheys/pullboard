/** Resume's complete person obligations without adding optional projections to the status path [N19,N26]. */
import * as store from './board.js';
import { pendingFit } from './blueprint-fit.js';
import { projectFit } from './blueprint-fit.js';
import { repoInfo } from './git.js';
import { personNeedsSummary } from './needs-state.js';
import { personNeeds } from './needs.js';
import { undraftedRigor } from './rigor-notices.js';

/** Extend the indexed summary only for resume; retain exact row decisions, fit and coordinator Rigor. */
export function resumeNeeds(root, { board, config, includeRigorUndrafted = false }) {
  const summary = personNeedsSummary(root, { board, config });
  // Resume consumes obligations, not dashboard items. Fit still decorates every current spec row.
  const fitted = projectFit(pendingFit(repoInfo(root).commonDir), { ...summary, items: [] });
  return { ...fitted, needs: personNeeds(fitted), ...(includeRigorUndrafted
    ? { rigorUndrafted: undraftedRigor(store.events(board), summary, { person: store.PERSON }) } : {}) };
}
