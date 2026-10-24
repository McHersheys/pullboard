/** Current bar authorship survives native takeover without rewriting historical seats [V1,H16]. */
import { runtimeSessionIdentity, parentSessionDigest } from './parent-session.js';
import { Refused } from './refused.js';

/** Capture only this runtime's own session and discovered parent before sealing an ordered move. */
export function nativeBarActor(environment = process.env) {
  const identity = runtimeSessionIdentity(environment);
  return identity ? { session: parentSessionDigest(identity.session), parent: parentSessionDigest(identity.parent ?? identity.session) } : null;
}
/** Unknown provenance stays unknown; a replay never consults another process's runtime. */
export function normalizeBarActor(value) {
  if (value == null) return { session: null, parent: null };
  if (!/^[a-f0-9]{64}$/u.test(value.session) || !/^[a-f0-9]{64}$/u.test(value.parent)) {
    throw new Refused('BAR_PARENT_UNKNOWN', 'bar authorship needs the current native session and its parent; run this move from the real runtime session, without borrowing another seat');
  }
  return { session: value.session, parent: value.parent };
}
