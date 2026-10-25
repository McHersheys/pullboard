/** Health mutation extracted without changing its transaction or notice order [A6]. */
import { ENGINE_VERSION } from './machine.js';
import {
  itemById,
  listAgents,
} from './board-query.js';
import { logEvent } from './board-event-log.js';
import { Refused } from './refused.js';
import { normalizedHealthFindings } from './health-receipts.js';
import { healthFindingIdentity } from './health-receipts.js';
import { healthTargets } from './health-receipts.js';
import { deliverHealthNotices } from './health-receipts.js';
import { HEALTH_SENTINEL_ENGINE } from './health-receipts.js';
import { COORDINATOR } from './config.js';
import { PERSON } from './board-query.js';

/** Record one current health snapshot atomically, notifying each new or resolved episode once [A6]. */
export function applyHealthFindings(board, { agentId, observedRevision, findings }, { atomic, insertShout }) {
  return atomic(board, () => {
    if ((board.executionEngineVersion ?? ENGINE_VERSION) < HEALTH_SENTINEL_ENGINE) {
      throw new Refused('ENGINE_VERSION', `sentinel receipts require engine ${HEALTH_SENTINEL_ENGINE}; upgrade Pullboard before scanning`);
    }
    if (!board.db.prepare('SELECT 1 FROM agent WHERE agent_id = ?').get(agentId)) {
      throw new Refused('NOT_JOINED', 'join this board before recording a health scan: pullboard join <lane>');
    }
    const revision = board.db.prepare('SELECT COALESCE(MAX(event_id), 0) AS revision FROM event').get().revision;
    if (!Number.isSafeInteger(observedRevision) || observedRevision !== revision) {
      throw new Refused('HEALTH_SCAN_STALE', 'the board changed while health was scanning; run pullboard resume again');
    }
    const active = normalizedHealthFindings(findings);
    const last = board.db.prepare("SELECT event_detail FROM event WHERE event_kind = 'health-scan' ORDER BY event_id DESC LIMIT 1").get();
    const previous = last ? JSON.parse(last.event_detail).active : [];
    const before = new Map(previous.map(finding => [healthFindingIdentity(finding), finding]));
    const after = new Map(active.map(finding => [healthFindingIdentity(finding), finding]));
    const added = active.filter(finding => !before.has(healthFindingIdentity(finding)));
    const resolved = previous.filter(finding => !after.has(healthFindingIdentity(finding)));
    if (!added.length && !resolved.length) return { added: [], resolved: [] };
    const agents = listAgents(board);
    const lanes = [...new Set(agents.map(agent => agent.agent_lane))];
    const engine = board.executionEngineVersion ?? ENGINE_VERSION;
    /** Deliver through ordinary feed/inbox records without registering a synthetic worktree seat. */
    const log = (finding, cleared) => {
      const item = finding.item === null ? null : itemById(board, finding.item);
      logEvent(board, 'sentinel', cleared ? 'health-resolved' : 'health-failure', finding.item, {
        key: finding.key, cause: `refusal:${finding.cause}`, since: finding.since, subject: finding.subject,
        owner: finding.owner, commit: item?.item_commit ?? null, engine: HEALTH_SENTINEL_ENGINE,
      });
    };
    deliverHealthNotices({ resolved, added, engine, log, coordinator: COORDINATOR, shout: (to, text) => insertShout(board, { from: 'sentinel', to, text, lanes }),
      targets: finding => healthTargets(finding, { engine, coordinator: COORDINATOR, person: PERSON, lanes, agents }) });
    logEvent(board, agentId, 'health-scan', null, { active, engine: HEALTH_SENTINEL_ENGINE });
    return { added: added.map(finding => finding.key), resolved: resolved.map(finding => finding.key) };
  });
}

