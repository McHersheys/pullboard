/** Seats registered as history from before agent grants (#348), for replays of older engines [E21,H16]. */
import * as store from '../src/board.js';
import { AGENT_GRANT_ENGINE } from '../src/agent-grant-engine.js';

/**
 * Register each [lane, path] seat as an engine before AGENT_GRANT_ENGINE wrote it, and return the seat ids.
 * A seat a newer client registered rightly refuses old-engine moves, so a board that replays an older
 * client's moves must hold seats that client could have written.
 */
export function registerPreGrant(board, seats) {
  const recorded = Object.hasOwn(board, 'executionEngineVersion') ? board.executionEngineVersion : undefined;
  board.executionEngineVersion = AGENT_GRANT_ENGINE - 1;
  try { return seats.map(([lane, path]) => store.register(board, { lane, path })); } finally {
    if (recorded === undefined) delete board.executionEngineVersion; else board.executionEngineVersion = recorded;
  }
}
