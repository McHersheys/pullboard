/**
 * What every command shares and a read needs: the checkout's context, the board opened around one piece of work,
 * argument parsing and the one-line item format. It loads no gate, relay or landing module, so a read command that
 * imports only this pays for nothing it does not run [C7].
 */
import { existsSync } from 'node:fs';
import {
  isAbsolute,
  join,
  relative,
  resolve,
} from 'node:path';
import { displayAgentName } from './agent-names.js';
import * as store from './board.js';
import {
  CONFIG_FILE,
  loadConfig,
} from './config.js';
import { loadDoctrine } from './doctrine.js';
import {
  codeIsFromMain,
  differFromHead,
  headCommit,
  repoInfo,
  tryGit,
} from './git.js';
import { Refused } from './refused.js';
import { mainPolicy } from './trusted-policy.js';
import { MAIN_MERGE_LABEL } from './trunk-conflict.js';

/**
 * A positive whole number from an argument, or a refusal naming what was expected.
 *
 * @param {string | undefined} text
 * @param {string} what
 * @returns {number}
 */
export function idArg(text, what = 'an item id') {
  const id = Number(String(text ?? '').replace(/^#/, ''));
  if (!Number.isInteger(id) || id < 1) throw new Refused('USAGE', `expected ${what}, got "${text ?? ''}"`);
  return id;
}

/**
 * A comma list of spec ids from a flag.
 *
 * @param {string | undefined} text
 * @returns {string[]}
 */
export const idList = (text) => (text ?? '').split(',').map((id) => id.trim()).filter(Boolean);

/**
 * The start of a command an agent can paste anywhere: agent shells often start each command in the
 * main checkout, so every command pullboard suggests names its folder (I5).
 *
 * @param {string} root
 * @returns {string}
 */
export const shellWord = (text) => (/^[\w@%+=:,./-]+$/.test(text) ? text : `'${text.replaceAll("'", "'\\''")}'`);

/**
 * `cd <folder> &&`, the folder quoted for any POSIX shell: single quotes, so a space, a quote or a
 * dollar sign in the path reaches cd as written (I7).
 *
 * @param {string} root
 * @returns {string}
 */
export const cdTo = (root) => `cd ${shellWord(root)} &&`;

/**
 * Print an item's brief, indented under a heading, when it has one.
 *
 * @param {any} io
 * @param {string} brief
 */
export function sayBrief(io, brief) {
  if (!brief) return;
  io.say('brief:');
  brief.split('\n').forEach((line) => io.say(`  ${line}`.trimEnd()));
}

/**
 * Everything a command needs: the repo, its config, the board's file, and where output goes.
 *
 * @param {any} io
 * @returns {any}
 */
export function context(io) {
  const info = repoInfo(io.cwd);
  if (info.isMain) io.caller?.('coordinator', info.root);
  const config = configHere(info);
  const file = join(info.commonDir, 'pullboard', 'board.sqlite');
  // Where the running code came from costs Git processes, and only a board behind this code's schema needs it.
  let allowSchemaUpgrade;
  return { info, config, file, get allowSchemaUpgrade() { return allowSchemaUpgrade ??= codeIsFromMain(); },
    doctrine: loadDoctrine(info.root, config), io, clock: io.clock ?? store.systemClock };
}

/**
 * This checkout's config. Init is the fix only where pullboard never was (C4): a config deleted
 * from a checkout whose last commit has it is restored, and a linked worktree made from a commit
 * that lacks it, beside a main checkout that has one, is made again from there.
 *
 * @param {{ root: string, commonDir: string, isMain: boolean }} info
 * @returns {any}
 */
function configHere(info) {
  try {
    return loadConfig(info.root);
  } catch (error) {
    if (!(error instanceof Refused) || error.code !== 'NO_CONFIG') throw error;
    if (tryGit(info.root, ['cat-file', '-e', `HEAD:${CONFIG_FILE}`]).status === 0) {
      throw new Refused('NO_CONFIG', `${CONFIG_FILE} is deleted here, though this checkout's last commit has it: restore it: ${cdTo(info.root)} git checkout HEAD -- ${CONFIG_FILE}`);
    }
    const mainRoot = resolve(info.commonDir, '..');
    if (info.isMain || !existsSync(join(mainRoot, CONFIG_FILE))) throw error;
    let setup;
    try {
      setup = uncommittedSetup(mainRoot, loadConfig(mainRoot));
    } catch {
      // Keep the existing recovery for invalid or incomplete main-checkout configuration.
    }
    if (setup) {
      throw new Refused(
        'NO_CONFIG',
        `this worktree has no ${CONFIG_FILE}, and the main checkout has uncommitted Pullboard setup files: ${setup.files.join(', ')}. Commit them in the main checkout first: ${setup.stage}`,
      );
    }
    throw new Refused(
      'NO_CONFIG',
      `this worktree's commit has no ${CONFIG_FILE}, though the main checkout has one: make a new worktree from the main checkout, which says what to commit first: ${cdTo(mainRoot)} pullboard worktree <lane> --model "<model name>"`,
    );
  }
}

/**
 * Open the board, run `work`, and always close it.
 *
 * @template T
 * @param {any} ctx
 * @param {(board: any) => T} work
 * @param {any} [opened] an already-open board, as withBoardRead passes
 * @returns {T}
 */
export function withBoard(ctx, work, opened) {
  const board = opened ?? store.openBoard(ctx.file, ctx.clock, { isMain: ctx.allowSchemaUpgrade,
    /** Report each source mismatch once through this invocation's text or JSON diagnostics. */
    onDiagnostic(message) {
      ctx.io.schemaDiagnostics ??= new Set();
      const key = ctx.file + '\n' + message;
      if (ctx.io.schemaDiagnostics.has(key)) return;
      ctx.io.schemaDiagnostics.add(key);
      ctx.io.err(message);
    },
  });
  // Whether a proven flake stops blocking a landing is the coordinator's setting, read from accepted main on first use.
  let quarantine;
  board.quarantineEnabled = () => quarantine ??= mainPolicy(ctx.info.root).config.flakes?.quarantine === true;
  const firstEvent = board.emittedEvents?.length ?? 0;
  /** Forward committed events before releasing either synchronous or asynchronous work. */
  const finish = () => {
    for (const event of board.emittedEvents?.slice(firstEvent) ?? []) ctx.io.onEvent?.(event);
    store.closeBoard(board);
  };
  let result;
  try {
    // Reuse the already-open board to identify a registered seat, without another lock or migration.
    if (ctx.io.caller && !ctx.info.isMain && !ctx.io.callerKnown?.(ctx.info.root) && store.agentAt(board, ctx.info.root)) ctx.io.caller('seat', ctx.info.root);
    result = work(board);
  }
  catch (error) { finish(); throw error; }
  if (result && typeof result.then === 'function') return result.finally(finish);
  finish();
  return result;
}

/** How many characters of an earlier verdict's note show prints (N30). */
const NOTE_LINE = 120;

/**
 * A note's first line, cut to NOTE_LINE characters with … marking the cut. A line ends at any break
 * Unicode makes mandatory (UAX #14): LF, VT, FF, CR, CRLF, NEL, LS and PS. Characters are counted
 * as a reader sees them, so a cut never splits an emoji or an accented letter.
 *
 * @param {string} note
 * @returns {string}
 */
export function firstLineOf(note) {
  const line = note.split(/[\n\v\f\r\x85\u2028\u2029]/)[0];
  const characters = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(line)];
  return characters.length > NOTE_LINE ? `${characters.slice(0, NOTE_LINE).map((part) => part.segment).join('')}…` : line;
}

/**
 * One item on one line: id, status and holder, lane, title, spec ids.
 *
 * @param {any} item
 * @returns {string}
 */
export function itemLine(item, name = (id) => id, mainMerge = false) {
  const holder = item.item_status === 'claimed' ? ` ${name(item.item_owner)}` : '';
  const verifier = item.item_status === 'verified' ? ` by ${name(item.item_verified_by)}` : '';
  const specs = item.item_spec_ids ? `  [${item.item_spec_ids}]` : '';
  const parent = item.item_parent_id ? `  under #${item.item_parent_id}` : '';
  const after = item.item_after ? `  after ${item.item_after.split(',').map((id) => `#${id}`).join(',')}` : '';
  const rejected = item.item_status === 'open' && item.item_verdict === 'REJECT' ? ' (rejected)' : mainMerge ? ` (${MAIN_MERGE_LABEL})` : '';
  const light = item.item_route === 'strong' ? '' : `  ${item.item_route}`;
  const staleVerdict = item.item_verdict_state ? `  ${item.item_verdict_state.code}` : '';
  const hold = item.item_hold_reason ? `  held by ${name(item.item_hold_by)}: ${item.item_hold_reason}` : '';
  return `#${item.item_id}  ${item.item_status}${holder}${verifier}${rejected}  ${item.item_lane}  ${item.item_title}${specs}${parent}${after}${light}${hold}${staleVerdict}`;
}

/** Format a stable agent id for human-facing CLI output. */
export function agentDisplayName(agents, config, id) {
  if (!id) return '';
  const agent = agents.find((entry) => entry.agent_id === id);
  if (agent) return displayAgentName(agent, config.agents.names);
  if (id === 'person' || id === 'all' || Object.hasOwn(config.lanes, id)) return id;
  return displayAgentName({ agent_id: id }, config.agents.names);
}

/** Render only declared actor positions in a refusal, preserving user text and stable JSON ids. */
function agentRefusalText(message, code, name) {
  const patterns = {
    ALREADY_JOINED: /^(\[ALREADY_JOINED\] this worktree is )(\S+)( in )/,
    HELD: /^(\[HELD\] item #\d+ is held by )(\S+)( until )/,
    ITEM_HELD: /^(\[ITEM_HELD\] item #\d+ is held by )(\S+)(: )/,
    LANE_HELD: /^(\[LANE_HELD\] )(\S+)( holds the )/,
    REVIEW_HELD: /^(\[REVIEW_HELD\] )(\S+)( holds the )/,
    NOT_YOURS: /^(\[NOT_YOURS\] only the coordinator or )(\S+)(, who )/,
    NO_AGENT: /^(\[NO_AGENT\] no (?:registered )?agent )(\S+)(;|$)/,
    NOT_YOUR_CHECKOUT: /^(\[NOT_YOUR_CHECKOUT\] this checkout belongs to )(\S+)( in )/,
    FACT_JUDGEMENT: /^(\[FACT_JUDGEMENT\] only the item's live holder \()(\S+)(\))/,
    RELAY_PERSON_ONLY: /^(\[RELAY_PERSON_ONLY\] agent )(\S+)( cannot )/,
    SELF_SHOUT: /^(\[SELF_SHOUT\] a shout cannot be addressed to its sender )(\S+)(;)/,
    NO_READER: /^(\[NO_READER\] nobody reads ")(.*?)(":)/,
  };
  if (code === 'RELAY_SENDER_MISMATCH') {
    return message.replace(/^(\[RELAY_SENDER_MISMATCH\] agent )(\S+)( cannot act as )(.*?)(; send this operation)/,
      (_, before, sender, middle, actor, after) => `${before}${name(sender)}${middle}${actor === '(no declared agent)' ? actor : name(actor)}${after}`);
  }
  if (code === 'NOT_YOUR_DECISION') {
    return message.replace(/^(\[NOT_YOUR_DECISION\] shout #\d+ is addressed to )(\S+)(, not your \S+ lane \(agent )(\S+)(\))$/,
      (_, before, to, middle, caller, after) => `${before}${name(to)}${middle}${name(caller)}${after}`);
  }
  return patterns[code] ? message.replace(patterns[code], (_, before, id, after) => `${before}${name(id)}${after}`) : message;
}

/** Render the refusal body without its existing final footer; structured errors retain the message. */
export function displayedRefusal(io, error) {
  const message = io.guidance(error.message.replace(/\r?\nnext:[ \t]*[^\r\n]*\S[ \t]*(?:\r?\n)*$/u, ''));
  if (error.code === 'MODEL_REQUIRED') return message.replace(/; run pullboard .+$/u, '');
  if (!['ALREADY_JOINED', 'HELD', 'ITEM_HELD', 'LANE_HELD', 'REVIEW_HELD', 'NOT_YOURS', 'NOT_YOUR_DECISION', 'NO_AGENT', 'NOT_YOUR_CHECKOUT', 'FACT_JUDGEMENT', 'RELAY_PERSON_ONLY', 'RELAY_SENDER_MISMATCH', 'SELF_SHOUT', 'NO_READER'].includes(error.code)) return message;
  try {
    const ctx = context(io);
    const agents = withBoard(ctx, (board) => store.listAgents(board));
    return agentRefusalText(message, error.code, (id) => agentDisplayName(agents, ctx.config, id));
  } catch { return message; }
}

/**
 * The files a new worktree takes from the main checkout's last commit and works by: the config, the
 * spec, the practice file, the rules its opening lines name, and the hooks, when git looks for them
 * inside each worktree.
 *
 * @param {string} mainRoot
 * @param {any} config
 * @returns {string[]}
 */
export function setupFiles(mainRoot, config) {
  const hooks = tryGit(mainRoot, ['config', '--get', 'core.hooksPath']).stdout;
  const inEach = hooks && !isAbsolute(hooks) && !relative(mainRoot, resolve(mainRoot, hooks)).startsWith('..');
  return [CONFIG_FILE, config.spec, config.practice, 'AGENTS.md', ...(inEach ? [hooks] : [])].filter(Boolean);
}

/** Find setup files in the main checkout that a new worktree would not receive from HEAD. */
export function uncommittedSetup(mainRoot, config) {
  if (headCommit(mainRoot) === null) return null;
  const differ = differFromHead(mainRoot, setupFiles(mainRoot, config));
  if (!differ.length) return null;
  const words = differ.map(({ path }) => shellWord(path)).join(' ');
  const force = differ.some(({ ignored }) => ignored) ? ' -f' : '';
  return {
    files: differ.map(({ path }) => path), differ,
    stage: `${cdTo(mainRoot)} git add${force} -- ${words}`,
  };
}

/**
 * How long ago an ISO time was, or how long until it, in the board's clock: 45m, 3h, 2d.
 *
 * @param {any} ctx
 * @param {string} iso
 * @returns {string}
 */
export function span(ctx, iso) {
  const minutes = Math.round(Math.abs(ctx.clock.now().getTime() - Date.parse(iso)) / 60_000);
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 48 * 60) return `${Math.round(minutes / 60)}h`;
  return `${Math.round(minutes / 1440)}d`;
}
