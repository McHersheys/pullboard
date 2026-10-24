import { MILESTONE_SHIP_ENGINE } from './move-engine-constants.js';
export { MILESTONE_SHIP_ENGINE };
/**
 * The roadmap's milestones: ordered names, notes, targets and item references kept in one
 * board_meta value, and the moves that change them (N26). Only the coordinator changes them.
 *
 * An item counts toward a milestone only once it has landed on main: it is verified and its merge
 * commit is recorded. Shipping a milestone records main's commit and carries every unlanded item
 * into the next milestone, so the roadmap stays the one place that says what is planned.
 */
import { COORDINATOR } from './config.js';
import {
  ENGINE_VERSION,
  MILESTONE_RANK_ENGINE,
  WITHDRAW_MILESTONE_ENGINE,
} from './machine.js';
export { WITHDRAW_MILESTONE_ENGINE };
import { Refused } from './refused.js';
import {
  atomic,
  itemById,
  listItems,
  logEvent,
  milestones,
  PERSON,
} from './board.js';



/** The engine a move runs under: its recorded one during replay, else this client's. */
function engineOf(board) {
  return board.executionEngineVersion ?? ENGINE_VERSION;
}

/**
 * An item's roadmap state: landed once its merge onto main is recorded, accepted while verified
 * but not yet landed, and otherwise its board status.
 *
 * @param {string} status
 * @param {boolean} landed
 * @returns {string}
 */
export function roadmapState(status, landed) {
  if (status === 'verified' && landed) return 'landed';
  return status === 'verified' ? 'accepted' : status;
}

/** Order work for shipping: unfinished items first, then verified items, preserving each group. */
export function shippingOrder(entries) {
  const kept = entries.filter((item) => item.status !== 'withdrawn');
  const verified = kept.filter((item) => item.status === 'verified');
  return [...kept.filter((item) => item.status !== 'verified'), ...verified];
}

/** Return local milestones that list an item, in stored roadmap order including shipped milestones. */
export function milestonesListing(board, id) {
  return milestones(board).filter((milestone) => milestone.items.includes(id)).map((milestone) => milestone.name);
}

/** Return each milestone and its matching references, preserving milestone and item order. */
export function milestoneReferencesToRemove(board, references) {
  const wanted = new Set(references);
  return milestones(board).flatMap((milestone) => {
    const remove = milestone.items.filter((reference) => wanted.has(reference));
    return remove.length ? [{ name: milestone.name, remove }] : [];
  });
}

/**
 * Return milestones with each item's current status and state, a landed count, and the
 * milestone's target and shipment. `done` is the landed count: accepted work has not shipped yet.
 *
 * @param {any} board
 * @param {((reference: string) => any) | null} [resolveExternal]
 * @returns {any[]}
 */
export function roadmap(board, resolveExternal = null) {
  const items = new Map(listItems(board, { all: true }).map((item) => [item.item_id, item]));
  const at = board.clock.now().getTime();
  return milestones(board).map((milestone) => {
    const named = milestone.items.map((id) => {
      if (typeof id === 'number') {
        const item = items.get(id);
        return item
          ? { id, title: item.item_title, status: item.item_status, state: roadmapState(item.item_status, Boolean(item.item_merged_commit)) }
          : { id, title: `#${id}`, status: 'missing', state: 'missing' };
      }
      const external = resolveExternal?.(id) ?? { id, title: id, status: 'unavailable' };
      return { id: external.id, title: external.title, status: external.status, state: roadmapState(external.status, Boolean(external.landed)) };
    });
    const entries = shippingOrder(named);
    const landed = entries.filter((item) => item.state === 'landed').length;
    const target = milestone.target ?? null;
    return {
      name: milestone.name,
      note: milestone.note,
      target,
      pastTarget: !milestone.shipped && target !== null && Date.parse(target) <= at,
      shipped: milestone.shipped ?? null,
      items: entries,
      landed,
      done: landed,
      total: entries.length,
      withdrawn: named.length - entries.length,
    };
  });
}

/** Validate a coordinator identity before changing roadmap metadata. */
function requireCoordinator(agentId) {
  if (agentId !== COORDINATOR) throw new Refused('COORDINATOR_ONLY', 'only the coordinator changes milestones; ask your coordinator to update the roadmap');
}

/** Parse an ordered list of local item ids and repo-qualified ids. */
function normalizeMilestoneItems(items) {
  if (!Array.isArray(items)) throw new Refused('MILESTONE_ITEMS', 'milestone items need comma-separated item ids; use pullboard milestone add --items 1,2');
  const result = items.map((value) => {
    if (Number.isSafeInteger(value) && value > 0) return value;
    if (typeof value === 'string') {
      const text = value.trim();
      if (/^[1-9]\d*$/.test(text) && Number.isSafeInteger(Number(text))) return Number(text);
      if (/^[^#,\s][^#,]*#[1-9]\d*$/.test(text)) return text;
    }
    throw new Refused('MILESTONE_ITEMS', `invalid item id ${String(value)}; use a positive id or repo#id`);
  });
  if (new Set(result.map((value) => JSON.stringify(value))).size !== result.length) {
    throw new Refused('MILESTONE_ITEMS', 'a milestone cannot list the same item twice; remove duplicate ids and retry');
  }
  return result;
}

/** Refuse local item ids that do not exist while leaving repo-qualified ids for board lookup. */
function validateLocalMilestoneItems(board, items) {
  for (const id of items) if (typeof id === 'number') itemById(board, id);
}

/** Validate a milestone name and note before storing them. */
function normalizeMilestoneText(name, note = null) {
  if (typeof name !== 'string' || !name.trim()) throw new Refused('MILESTONE_NAME', 'a milestone needs a name; use pullboard milestone add <name>');
  if (typeof note !== 'string' && note !== null) throw new Refused('MILESTONE_NOTE', 'a milestone note needs text; use --note <text>');
  return { name: name.trim(), note: note?.trim() || null };
}

/**
 * The instant a target the coordinator typed names, read in this machine's time zone, as UTC ISO
 * text, or `none` unchanged. The move is prepared with this value, so the ordered envelope never
 * carries a local time that another replica would read in its own zone.
 *
 * @param {unknown} target
 * @returns {unknown}
 */
export function canonicalMilestoneTarget(target) {
  if (target === 'none' || typeof target !== 'string' || !/\d/.test(target)) return target;
  const at = Date.parse(target.trim());
  return Number.isFinite(at) ? new Date(at).toISOString() : target;
}

/**
 * A target as ISO text, or null for `none`, which clears it. Applying a move accepts only a date or
 * a date and time with an explicit zone, so every replica reads the same instant: a bare local
 * time would mean a different moment on a machine in another zone.
 *
 * @param {unknown} target
 * @returns {string | null}
 */
function normalizeMilestoneTarget(target) {
  if (target === 'none') return null;
  const text = typeof target === 'string' ? target.trim() : '';
  const zoned = /^\d{4}-\d{2}-\d{2}$/.test(text) || /T.*(?:Z|[+-]\d{2}:?\d{2})$/i.test(text);
  const at = zoned ? Date.parse(text) : NaN;
  if (!Number.isFinite(at)) throw new Refused('MILESTONE_TARGET', 'a target needs a date, or a date and time with its zone, like 2026-10-20T18:00Z; use --target <date and time>, or --target none to clear it');
  return new Date(at).toISOString();
}

/** Save the whole milestone list in one board_meta value. */
function saveMilestones(board, entries) {
  board.db.prepare('INSERT INTO board_meta (meta_key, meta_value) VALUES (?, ?) ON CONFLICT(meta_key) DO UPDATE SET meta_value = excluded.meta_value')
    .run('milestones', JSON.stringify(entries));
}

/** The refusal for adding work to a milestone that already shipped. */
function shippedRefusal(entry) {
  return new Refused('MILESTONE_SHIPPED', `milestone ${entry.name} shipped at ${entry.shipped.commit}; add the item to the next milestone instead`);
}

/** Add an ordered milestone without changing any referenced board items. */
export function addMilestone(board, { agentId, name, note = null, items = [] }) {
  requireCoordinator(agentId);
  const text = normalizeMilestoneText(name, note);
  const normalized = normalizeMilestoneItems(items);
  validateLocalMilestoneItems(board, normalized);
  return atomic(board, () => {
    const entries = milestones(board);
    if (entries.some((entry) => entry.name === text.name)) throw new Refused('MILESTONE_EXISTS', `milestone ${text.name} already exists; edit it or choose another name`);
    saveMilestones(board, [...entries, { ...text, items: normalized }]);
    logEvent(board, agentId, 'milestone_add', null, { name: text.name, items: normalized });
    return text.name;
  });
}

/**
 * Add or remove item references while preserving the remaining order. Shipment is receiver state,
 * so a shipped milestone takes no new items even from older clients; removing one is still allowed.
 */
export function editMilestoneItems(board, name, { agentId, add = [], remove = [] }) {
  requireCoordinator(agentId);
  const additions = normalizeMilestoneItems(add);
  const removals = normalizeMilestoneItems(remove);
  validateLocalMilestoneItems(board, additions);
  if (additions.length && removals.length) throw new Refused('MILESTONE_ITEMS', 'add or remove milestone items in separate commands');
  if (!additions.length && !removals.length) throw new Refused('MILESTONE_ITEMS', 'name ids with --add or --remove');
  return atomic(board, () => {
    const entries = milestones(board);
    const index = entries.findIndex((entry) => entry.name === name);
    if (index < 0) throw new Refused('NO_MILESTONE', `no milestone named ${name}; list them with pullboard roadmap`);
    const current = entries[index];
    if (additions.length && current.shipped) throw shippedRefusal(current);
    const nextItems = additions.length
      ? [...current.items, ...additions]
      : current.items.filter((id) => !removals.some((removeId) => JSON.stringify(removeId) === JSON.stringify(id)));
    if (additions.length && new Set(nextItems.map((value) => JSON.stringify(value))).size !== nextItems.length) {
      throw new Refused('MILESTONE_ITEMS', 'a milestone cannot list the same item twice; remove duplicate ids and retry');
    }
    if (removals.some((id) => current.items.every((present) => JSON.stringify(id) !== JSON.stringify(present)))) {
      throw new Refused('MILESTONE_ITEMS', 'one or more ids are not in this milestone; read pullboard roadmap and retry');
    }
    entries[index] = { ...current, items: nextItems,
      ...((board.executionEngineVersion ?? ENGINE_VERSION) >= MILESTONE_RANK_ENGINE && current.order
        ? { order: current.order.filter(id => nextItems.includes(id)) } : {}) };
    saveMilestones(board, entries);
    logEvent(board, agentId, 'milestone_items', null, { name, add: additions, remove: removals });
    return nextItems;
  });
}

/** Replace this milestone's explicit ranks; omitted items retain the ordinary queue order [N2,B13]. */
export function orderMilestoneItems(board, name, { agentId, items }) {
  if ((board.executionEngineVersion ?? ENGINE_VERSION) < MILESTONE_RANK_ENGINE) throw new Refused('ENGINE_VERSION', 'milestone order requires engine 34; upgrade Pullboard before ranking work');
  if (agentId !== COORDINATOR && (agentId === PERSON || !board.db.prepare('SELECT 1 FROM agent WHERE agent_id = ?').get(agentId))) {
    throw new Refused('NO_AGENT', 'milestone order is an agent or coordinator move; join an agent worktree or ask the coordinator');
  }
  const order = normalizeMilestoneItems(items);
  if (!order.length) throw new Refused('MILESTONE_ITEMS', 'name the ranked item ids: pullboard milestone order <name> 1,2');
  return atomic(board, () => {
    const entries = milestones(board);
    const index = entries.findIndex(entry => entry.name === name);
    if (index < 0) throw new Refused('NO_MILESTONE', `no milestone named ${name}; list them with pullboard roadmap`);
    if (order.some(id => !entries[index].items.includes(id))) throw new Refused('MILESTONE_ITEMS', 'rank only items in this milestone; read pullboard roadmap and retry');
    entries[index] = { ...entries[index], order };
    saveMilestones(board, entries);
    logEvent(board, agentId, 'milestone_order', null, { name, items: order });
    return order;
  });
}

/** Move a milestone before another while retaining all item and note data. */
export function moveMilestone(board, name, { agentId, before }) {
  requireCoordinator(agentId);
  return atomic(board, () => {
    const entries = milestones(board);
    const index = entries.findIndex((entry) => entry.name === name);
    const target = entries.findIndex((entry) => entry.name === before);
    if (index < 0 || target < 0) throw new Refused('NO_MILESTONE', `name both milestones in pullboard milestone move ${name} --before <other>`);
    if (name === before) throw new Refused('MILESTONE_ORDER', 'choose a different milestone to move before');
    const [entry] = entries.splice(index, 1);
    entries.splice(entries.findIndex((value) => value.name === before), 0, entry);
    saveMilestones(board, entries);
    logEvent(board, agentId, 'milestone_move', null, { name, before });
    return entries;
  });
}

/**
 * Rename a milestone, update its note, or set its target without touching its items. A target is
 * an engine-45 meaning, so an older engine's edit replays exactly as it did.
 */
export function editMilestone(board, name, { agentId, newName, note, target }) {
  requireCoordinator(agentId);
  const engine = engineOf(board);
  if (target !== undefined && engine < MILESTONE_SHIP_ENGINE) {
    throw new Refused('ENGINE_VERSION', `a milestone target requires engine ${MILESTONE_SHIP_ENGINE}; this board uses engine ${engine}; upgrade Pullboard before using --target`);
  }
  if (newName === undefined && note === undefined && target === undefined) {
    throw new Refused('MILESTONE_EDIT', engine < MILESTONE_SHIP_ENGINE ? 'supply --name or --note to edit a milestone' : 'supply --name, --note or --target to edit a milestone');
  }
  const targetValue = target === undefined ? undefined : normalizeMilestoneTarget(target);
  return atomic(board, () => {
    const entries = milestones(board);
    const index = entries.findIndex((entry) => entry.name === name);
    if (index < 0) throw new Refused('NO_MILESTONE', `no milestone named ${name}; list them with pullboard roadmap`);
    const renamed = newName === undefined ? name : normalizeMilestoneText(newName).name;
    if (renamed !== name && entries.some((entry) => entry.name === renamed)) throw new Refused('MILESTONE_EXISTS', `milestone ${renamed} already exists; choose another name`);
    entries[index] = { ...entries[index], name: renamed, ...(note === undefined ? {} : { note: normalizeMilestoneText(renamed, note).note }) };
    if (targetValue !== undefined) entries[index].target = targetValue;
    saveMilestones(board, entries);
    logEvent(board, agentId, 'milestone_edit', null, { before: name, after: renamed, noteChanged: note !== undefined,
      ...(targetValue === undefined ? {} : { target: targetValue }) });
    return entries[index];
  });
}

/** Remove one milestone only; its referenced work items remain on their boards. */
export function removeMilestone(board, name, { agentId }) {
  requireCoordinator(agentId);
  return atomic(board, () => {
    const entries = milestones(board);
    const remaining = entries.filter((entry) => entry.name !== name);
    if (remaining.length === entries.length) throw new Refused('NO_MILESTONE', `no milestone named ${name}; list them with pullboard roadmap`);
    saveMilestones(board, remaining);
    logEvent(board, agentId, 'milestone_remove', null, { name });
    return name;
  });
}

/**
 * Ship a milestone: record main's commit on it, keep the items that landed, and move every other
 * local item into the next milestone (the first unshipped one after it, or `next`), recording the
 * move on each item's thread. A withdrawn item stays, since it will never land; a repo#id
 * reference stays too, since its board, not this one, says whether it landed.
 *
 * @param {any} board
 * @param {string} name
 * @param {{ agentId: string, commit: string | null, next?: string }} options
 * @returns {{ milestone: any, into: string | null, moved: number[], notMoved: string[] }}
 */
export function shipMilestone(board, name, { agentId, commit, next }) {
  requireCoordinator(agentId);
  if (typeof commit !== 'string' || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(commit)) {
    throw new Refused('MILESTONE_COMMIT', "shipping records main's commit and main has none here; commit to main, then ship from the main checkout");
  }
  return atomic(board, () => {
    const entries = milestones(board);
    const index = entries.findIndex((entry) => entry.name === name);
    if (index < 0) throw new Refused('NO_MILESTONE', `no milestone named ${name}; list them with pullboard roadmap`);
    const current = entries[index];
    if (current.shipped) throw shippedRefusal(current);
    const items = new Map(listItems(board, { all: true }).map((item) => [item.item_id, item]));
    const notMoved = current.items.filter((id) => typeof id === 'string');
    const stays = (id) => {
      const item = typeof id === 'number' ? items.get(id) : null;
      return !item || item.item_status === 'withdrawn' || roadmapState(item.item_status, Boolean(item.item_merged_commit)) === 'landed';
    };
    const moved = current.items.filter((id) => !stays(id));
    let into = null;
    if (next !== undefined) {
      into = entries.findIndex((entry) => entry.name === next);
      if (into < 0) throw new Refused('NO_MILESTONE', `no milestone named ${next}; list them with pullboard roadmap`);
      if (into === index) throw new Refused('MILESTONE_ORDER', 'choose a different milestone for --next than the one shipping');
      if (entries[into].shipped) throw shippedRefusal(entries[into]);
    } else if (moved.length) {
      into = entries.findIndex((entry, position) => position > index && !entry.shipped);
      if (into < 0) throw new Refused('NO_NEXT_MILESTONE', `no unshipped milestone follows ${name} to take its unlanded items; add one with pullboard milestone add, or name one with --next`);
    }
    const intoName = into === null ? null : entries[into].name;
    const at = board.clock.now().toISOString();
    if (into !== null) entries[into] = { ...entries[into], items: [...entries[into].items, ...moved.filter((id) => !entries[into].items.includes(id))] };
    entries[index] = { ...current, items: current.items.filter(stays), shipped: { commit, at, by: agentId } };
    saveMilestones(board, entries);
    logEvent(board, agentId, 'milestone_ship', null, { name, commit, into: intoName, moved, notMoved });
    for (const id of moved) {
      logEvent(board, agentId, 'milestone_moved', id, { from: name, to: intoName, commit,
        note: `moved from ${name} to ${intoName}: ${name} shipped at ${commit.slice(0, 12)} before this item landed` });
    }
    return { milestone: entries[index], into: intoName, moved, notMoved };
  });
}
