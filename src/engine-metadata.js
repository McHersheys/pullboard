/** Feature discovery and historical constants, without lifecycle declarations [C7,V4]. */
import {
  ENGINE_CANDIDATE,
  ENGINE_FILE,
  discovered,
} from './discovery.js';
import {
  readdirSync,
  readFileSync,
} from 'node:fs';

export { AUTO_ESCALATE_ENGINE } from './auto-escalate-engine.js';
export { ROW_DRAFT_ENGINE } from './row-draft-engine.js';
export { STRONG_REJECTION_NOTICE_ENGINE } from './strong-rejection-notice-engine.js';
export { SUBMITTED_CONFLICT_ENGINE } from './submitted-conflict-engine.js';
export { WITHDRAW_MILESTONE_ENGINE } from './withdraw-milestone-engine.js';

/**
 * Find every feature engine: each src/*-engine.js leaf declares exactly one `export const NAME_ENGINE = n;` line.
 * A feature that raises the engine adds its own new file and no line of any shared one, so two items adding
 * different engines never conflict [C7,V4]. The value is read as text because machine.js needs it synchronously.
 *
 * @param {URL} directory the folder holding the *-engine.js leaves
 * @returns {Record<string, number>} engine number by file name, in name order
 */
export function discoverEngines(directory = new URL('./', import.meta.url)) {
  const found = {};
  for (const file of discovered(readdirSync(directory), ENGINE_CANDIDATE, ENGINE_FILE, 'feature engine')) {
    const lines = readFileSync(new URL(file, directory), 'utf8').split('\n').filter((line) => /^export const /u.test(line));
    const match = lines.length === 1 ? /^export const [A-Z][A-Z0-9_]*_ENGINE = (\d+);$/u.exec(lines[0]) : null;
    if (!match) throw new Error(`${file} must declare exactly one line \`export const NAME_ENGINE = <number>;\` so ENGINE_VERSION can read it`);
    found[file.slice(0, -'-engine.js'.length)] = Number(match[1]);
  }
  return found;
}

export { REOPEN_FIRST_REFUSAL_ENGINE } from './reopen-first-refusal-engine.js';

/** Every feature engine by name, discovered from the *-engine.js files beside this one. */
export const ENGINE_REGISTRY = discoverEngines();

/** The highest engine number any feature declares. */
export const ENGINE_VERSION = Math.max(...Object.values(ENGINE_REGISTRY));

/**
 * The engine whose relay moves carry seat provenance and verifier standing (#579). It is its own
 * constant because engine slots are allotted per item: whoever lands second renumbers this line.
 */
export const VERIFIER_STANDING_ENGINE = 48;

/** The engine at which reject, reopen and person facts may carry cause keys [D1,H16]. */
export const CAUSE_ENGINE = 30;

/** First released engine binding the checked composition, review trunk and paths [E8,H16]. */
export const VERDICT_REVIEW_ENGINE = 33;

/** First engine carrying explicit milestone ranks in build and review selection [N2,B13,H16]. */
export const MILESTONE_RANK_ENGINE = 34;

