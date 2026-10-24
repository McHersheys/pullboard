/** A completed durable move must never be repeated because later command work refused [C6,N26]. */
import { Refused } from './refused.js';

/** Preserve the refusal code while distinguishing a partial recorded command from an unrecorded attempt. */
export function recordedMoveRefusal(io, error) {
  if (!io.recordedMove || !(error instanceof Refused)) return error;
  return new Refused(error.code,
    'a move from this command was already recorded; any pending relay work remains queued locally. Do not repeat the command',
    'run pullboard status to inspect the recorded work and pending relay sync; do not repeat the original command');
}
