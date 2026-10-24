/** Read the existing shared board projection with current unapplied person decisions [N26,A9]. */
import { join } from 'node:path';
import * as store from './board.js';
import { repoInfo } from './git.js';
import { projectRowDecisions } from './row-decisions.js';
import {
  pendingFit,
  projectFit,
} from './blueprint-fit.js';
import { projectState } from './serve.js';
import { loadConfig } from './config.js';
import { loadSpec } from './spec.js';
import { loadDoctrine } from './doctrine.js';
import {
  rigorDraftNeeds,
  undraftedRigor,
} from './rigor-notices.js';
import { personNeeds } from './needs.js';
import { recentBlocks } from './needs-summary.js';
export { personNeedsSummary, recentBlocks } from './needs-summary.js';
import {
  projectSpecApprovals,
  specApprovalState,
} from './spec-approval.js';
import {
  sentinelDraftNeeds,
  sentinels,
} from './sentinels.js';

/** Borrow an existing connection or open a read-only one; retain exact row-decision matching. */
export function personNeedsState(root, { board: providedBoard = null, includeRigorUndrafted = false } = {}) {
  const info = repoInfo(root);
  // A held item is judged against the board's clock (#974), so the read-only board carries the CLI's clock.
  const board = providedBoard ?? { db: store.openBoardReadOnly(join(info.commonDir, 'pullboard', 'board.sqlite')), clock: store.systemClock };
  try {
    const decisions = store.rowDecisions(board);
    const config = loadConfig(root);
    const state = projectSpecApprovals(projectFit(pendingFit(info.commonDir), projectRowDecisions(decisions, projectState(root, { board }))), specApprovalState(root, { board, config }));
    const rows = projectRowDecisions(decisions, { root, spec: loadSpec(root, config).rows, practice: loadDoctrine(root, config).rows });
    const rigorDrafts = rigorDraftNeeds(rows);
    const projected = { ...state, rigorDrafts, sentinelDrafts: sentinelDraftNeeds(sentinels(board)), blocks: recentBlocks(info.commonDir, board), ...(includeRigorUndrafted
      ? { rigorUndrafted: undraftedRigor(store.events(board), rows, { person: store.PERSON }) } : {}) };
    return { ...projected, needs: personNeeds(projected) };
  } finally {
    if (!providedBoard) store.closeBoard(board);
  }
}
