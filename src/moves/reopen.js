import { RIGOR_AUTO_ENGINE } from '../rigor-auto-engine.js';
/** Routing metadata owned by reopen, discovered without a shared registry edit [C7,V4,H16]. */
import { itemById } from '../board-item-read.js';
import {
  CAUSE_ENGINE,
  REOPEN_FIRST_REFUSAL_ENGINE,
  SUBMITTED_CONFLICT_ENGINE,
} from '../engine-metadata.js';
import { LANDING_LEASE_ENGINE } from '../landing-lease-engine.js';
import { BOARD_SENTINEL_ENGINE } from '../sentinel-engine.js';
import {
  CONFLICT_ENGINE,
  carriesConflict,
} from '../trunk-conflict.js';

/** Preserve this operation's historical first-matching engine conditions [H16]. */
function minimumEngine(args, board, at) {
  if (typeof args[1]?.cause === 'string' && args[1].cause.startsWith('conflict:')) return RIGOR_AUTO_ENGINE;
  if (args[0]?.landingFence !== undefined) return LANDING_LEASE_ENGINE;
  if (args[1]?.reopenFirstRefusalMinutes !== undefined) return REOPEN_FIRST_REFUSAL_ENGINE;
  if (typeof args[1]?.cause === 'string' && args[1].cause.startsWith('sentinel:')) return BOARD_SENTINEL_ENGINE;
  if (carriesConflict('reopen', args)) return board && itemById(board, args[0])?.item_status === 'submitted' ? SUBMITTED_CONFLICT_ENGINE : CONFLICT_ENGINE;
  if (['cause', 'neverAgain', 'asPerson'].some(name => Boolean(args[1] && typeof args[1] === 'object' && Object.hasOwn(args[1], name) && args[1][name] !== undefined && args[1][name] !== null && args[1][name] !== false))) return CAUSE_ENGINE;
  return 8;
}

/** Read precisely the actor argument used by this operation [H2,H16]. */
function actor(move) { return move.args[1]?.agentId ?? null; }

export default Object.freeze({ operation: "reopen", order: 20, engine: 8,
  itemIdFirstArgument: true, minimumEngine, actor,
  nextSteps: Object.freeze({
  "ALREADY_MERGED": "file the follow-up as a new item: pullboard add <lane> \"<title>\"",
  "BAD_CAUSE": "name the cause as test:<file>::<title>, refusal:<CODE>, row:<id> or doctrine:<id>, or leave --cause out",
  "BAD_CONFIG": "fix pullboard.json as the message says, then commit it: git commit -m \"chore: fix pullboard config\" pullboard.json",
  "BAD_CONFLICT": "run pullboard reopen <id> --conflict <file> [--conflict <file>] from the main checkout",
  "CONFLICT_FILES": "name only the files Git reports as conflicting with the trunk: pullboard reopen <id> --conflict <file> [--conflict <file>]",
  "COORDINATOR_ONLY": "ask the coordinator to do it: pullboard shout coordinator \"<what you need>\"",
  "ENGINE_VERSION": "upgrade Pullboard: npm install -g pullboard@latest",
  "LANDING_FAILURE_REQUIRED": "reopen with --note \"<test file>: <test name>; merge commit <sha>\", or with --conflict <file> for each conflicting file when it only conflicts with the trunk",
  "MERGE_CHECK_FAILED": "use Git 2.38 or newer (git --version), then retry",
  "NOTE_REQUIRED": "add --note \"<what happened>\"",
  "NOT_ACCEPTED": "reopen a submission with --note \"why\"; --conflict is for accepted work",
  "NOT_CONFLICTING": "merge it; reopen only after a red landing, with --note \"<test file>: <test name>; merge commit <sha>\"",
  "NOT_JOINED": "join a lane from this worktree: pullboard join <lane> --model \"<model name>\" (see: pullboard lanes)",
  "NOT_SUBMITTED": "see its state with pullboard show <id>; verify only submitted items: pullboard next --verify",
  "NO_ITEM": "find the item id: pullboard list --all",
  "NO_TRUNK": "in the main checkout, switch to the repository’s trunk branch and run pullboard inbox",
  "SESSION_LEDGER": "make the agent-session ledger named in the message writable by this user, then run the command again"
}) });
