import { recordedMoveRefusal } from './recorded-move.js';
/**
 * The relay and baseline work around a command: link a new project, sync the relay, deliver finished baselines and
 * run the person's waiting requests. The command line loads it only when one of them could act [C7].
 */
import { retryCheckBaselines } from './check-baseline-worker.js';
import { relayOutboxSetting } from './cli.js';
import { displayedRefusal } from './cli-context.js';
import { Refused } from './refused.js';
import { syncRelay } from './relay.js';
import { executePersonRequests } from './relay-request-execution.js';
import { autoLinkProject } from './relay-setup.js';
import { gitSyncLinked } from './local-state.js';
import {
  context,
  withBoard,
} from './cli-context.js';

/** Codes a checkout with no board refuses with, which the sync around a command keeps quiet. */
const QUIET = ['NOT_A_REPO', 'NO_REPO', 'NO_CONFIG', 'CORE_BARE'];

/** Report a refusal from the work around a command without stopping the command. */
async function reportQuietly(io, error) {
  error = recordedMoveRefusal(io, error);
  if (!(error instanceof Refused)) throw error;
  if (!QUIET.includes(error.code)) {
    await io.prepareRefusal?.();
    io.err(`pullboard: ${displayedRefusal(io, error)}\nnext: ${io.refusalDocument(error).error.next}`);
  }
}

/** A network refusal preserves offline reads; linked mutation dispatch requires an acknowledgement. */
export async function retrySync(io) {
  try {
    if (io.relayCommand?.cliOperation !== 'sync' && gitSyncLinked(io.cwd)) {
      const ctx = context(io);
      await withBoard(ctx, board => import('./sync.js').then(sync => sync.syncGitBoard(io.cwd, board, io)));
    }
    io.relayOutbox ??= () => relayOutboxSetting(io.cwd);
    await syncRelay(io.cwd, io);
    await retryCheckBaselines(io.cwd, io);
  }
  catch (error) { await reportQuietly(io, error); }
}

/** Before a command: link this project when the machine links new ones, sync, then run the person's waiting requests. */
export async function syncBefore(io, main) {
  try { if (io.relayCommand?.cliOperation !== 'sync' && !gitSyncLinked(io.cwd)) await autoLinkProject(io.cwd, io); } catch (error) { if (!(error instanceof Refused)) throw error; }
  await retrySync(io);
  try { await executePersonRequests(io.cwd, io, main); }
  catch (error) { await reportQuietly(io, error); }
}
