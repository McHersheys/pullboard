/** Machine-local configuration for a dedicated, ordinarily linked canary seat [H5,H17]. */
import { isAbsolute } from 'node:path';
import { Refused } from './refused.js';

/** Validate only execution settings; credentials remain in the existing board link and device key store. */
export function relayCanaryConfig(value) {
  if (value === undefined || value === null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || typeof value.enabled !== 'boolean' || typeof value.root !== 'string' || !isAbsolute(value.root)
    || typeof value.agentId !== 'string' || !value.agentId || /\s/u.test(value.agentId)
    || Object.keys(value).some(key => !['enabled', 'root', 'agentId', 'deadlineMs'].includes(key))) {
    throw new Refused('RELAY_CANARY_CONFIG', 'configure a dedicated linked seat with pullboard relay canary on; credentials are never command arguments');
  }
  const deadlineMs = value.deadlineMs ?? 5000;
  if (!Number.isSafeInteger(deadlineMs) || deadlineMs < 100 || deadlineMs > 25000) {
    throw new Refused('RELAY_CANARY_CONFIG', 'set the canary timeout between 100 and 25000 milliseconds, below its one-minute cadence');
  }
  return { enabled: value.enabled, root: value.root, agentId: value.agentId, deadlineMs };
}
