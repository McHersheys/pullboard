/** Lossless wire-only review paths. Older engines stop before replay, never misread coverage. */
import { unassignedEngine } from './engine-next.js';
export const COMPACT_VERDICT_REVIEW_ENGINE = unassignedEngine();
