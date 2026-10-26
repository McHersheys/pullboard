import { PRIVATE_REHOME_ENGINE } from '../private-rehome-engine.js';

/** Preserve the ordered source move ID in its arguments for idempotent destination application. */
function minimumEngine(args) { return PRIVATE_REHOME_ENGINE; }
/** Read the actor from the re-home options [H2,H16]. */
function actor(move) { return move.args[1]?.agentId ?? null; }

export default Object.freeze({ operation: 'rehomeItem', order: 10001, engine: PRIVATE_REHOME_ENGINE,
  itemIdFirstArgument: true, minimumEngine, actor,
  nextSteps: Object.freeze({
    ITEM_MOVED: 'use the recorded destination reference shown in the refusal; do not move the old ID again',
    REHOME_PENDING: 'retry the same move ID and destination to finish delivery; do not allocate another destination ID',
    REHOME_FORMAT: 'restore the exact source move record and retry it with an authorized destination handle',
    REHOME_LINKS: 'move each parent or wait item to this destination first, then retry the same source MOVEID',
    REHOME_SAME_BOARD: 'choose a different local board',
    REHOME_STATE: 'open or verified items can move; keep other items on their current board',
  }) });
