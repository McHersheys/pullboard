/** Durable test defects hold a trunk when bisection identifies no item culprit [E29]. */
import {
  addItem,
  atomic,
  logEvent,
} from './board.js';
import { COORDINATOR } from './config.js';
import { ENGINE_VERSION } from './machine.js';
import { LANDING_ENVIRONMENT_ENGINE } from './landing-environment-engine.js';
import { Refused } from './refused.js';

/** Read the latest defect for each trunk and test, without rewriting its prior evidence. */
export function landingTestDefects(board) {
  const defects = new Map();
  for (const row of board.db.prepare("SELECT event_detail FROM event WHERE event_kind = 'landing-test-defect' ORDER BY event_id").all()) {
    const { defect } = JSON.parse(row.event_detail);
    defects.set(`${defect.branch}\0${defect.test}`, defect);
  }
  return [...defects.values()];
}

/** File a neutral repair item: an interaction is not proof that a named item or test is flaky. */
export function recordLandingTestDefect(board, { agentId, test, hash, blob, trunkBlob, names, lane, batchId, branch }) {
  if (agentId !== COORDINATOR) throw new Refused('COORDINATOR_ONLY', 'only the coordinator files a landing test defect');
  if ((board.executionEngineVersion ?? ENGINE_VERSION) < LANDING_ENVIRONMENT_ENGINE) throw new Refused('ENGINE_VERSION', `landing test defects require engine ${LANDING_ENVIRONMENT_ENGINE}`);
  if (typeof test !== 'string' || test.length > 4096 || /[\r\n\0]/u.test(test) || test.startsWith('/') || test.includes('\\') || test.split('/').some(part => !part || part === '.' || part === '..')
    || !/^[a-f0-9]{64}$/u.test(hash ?? '') || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(blob ?? '')
    || trunkBlob !== null && !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(trunkBlob ?? '')
    || !Array.isArray(names) || !names.length || names.length > 500 || names.some(name => typeof name !== 'string' || !name || name.length > 8192 || /[\r\n\0]/u.test(name))
    || typeof batchId !== 'string' || !/^[a-f0-9-]{36}$/u.test(batchId) || typeof branch !== 'string' || !branch || branch.length > 1024 || /[\r\n\0]/u.test(branch)) {
    throw new Refused('LAND_TEST_DEFECT', 'a landing test defect needs its exact test, source identity, failures, batch and trunk');
  }
  return atomic(board, () => {
    const previous = landingTestDefects(board).find(defect => defect.branch === branch && defect.test === test && defect.hash === hash);
    if (previous?.batchId === batchId && names.every(name => previous.names.includes(name))) return previous;
    const item = previous?.item ?? addItem(board, { by: agentId, lane, title: `Landing test defect: ${test}`,
      criterion: `${test} passes with the combined accepted work; the landing failed without an item culprit: ${names.join('; ')}`, route: 'strong' });
    const defect = { test, hash, blob, trunkBlob, names: [...new Set([...(previous?.names ?? []), ...names])], item, batchId, branch };
    logEvent(board, agentId, 'landing-test-defect', item, { engine: LANDING_ENVIRONMENT_ENGINE, defect });
    return defect;
  });
}
