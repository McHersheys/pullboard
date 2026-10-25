/** One immutable identity resolver is shared by every cross-board interface [E32,H16]. */
import { Refused } from './refused.js';

/** Refuse an ambiguous or untrusted reference before choosing any board. */
function invalid() { throw new Refused('BOARD_REFERENCE', 'use an immutable board ID or one exact qualified name from the authorized project inventory'); }

/** Validate an immutable board ID without treating a display name or local path as authority. */
export function boardReferenceId(value) {
  if (typeof value !== 'string' || !/^[0-9a-f]{32}$/u.test(value)) invalid();
  return value;
}

/** Preserve exact qualified-name bytes rather than silently renaming a signed board. */
function name(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(value)) invalid();
  return value;
}

/** Copy only the canonical public BoardRef fields. */
export function boardReference(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).some(key => !['boardId', 'organization', 'handle'].includes(key))) invalid();
  return { boardId: boardReferenceId(value.boardId), organization: name(value.organization), handle: name(value.handle) };
}

/** Resolve only against the caller's authorized inventory, refusing duplicate IDs or names. */
export function resolveBoardReference(inventory, requested) {
  if (!Array.isArray(inventory) || inventory.length > 10000) invalid();
  const rows = inventory.map(boardReference);
  const ids = new Set();
  const names = new Set();
  for (const row of rows) {
    const qualified = `${row.organization}/${row.handle}`;
    if (ids.has(row.boardId) || names.has(qualified)) invalid();
    ids.add(row.boardId); names.add(qualified);
  }
  let found;
  if (typeof requested === 'string') {
    found = /^[0-9a-f]{32}$/u.test(requested)
      ? rows.find(row => row.boardId === requested)
      : rows.find(row => `${row.organization}/${row.handle}` === requested);
  } else if (requested && typeof requested === 'object' && !Array.isArray(requested)) {
    if (Object.keys(requested).some(key => !['boardId', 'organization', 'handle'].includes(key))) invalid();
    found = rows.find(row => row.boardId === boardReferenceId(requested.boardId));
    if (found && (requested.organization !== undefined && requested.organization !== found.organization
      || requested.handle !== undefined && requested.handle !== found.handle)) invalid();
  }
  if (!found) invalid();
  return { ...found };
}

/** Bind a numeric item ID to its immutable owning board at every composition boundary. */
export function boardItemReference(inventory, reference, itemId) {
  if (!Number.isSafeInteger(itemId) || itemId < 1) invalid();
  return { boardId: resolveBoardReference(inventory, reference).boardId, itemId };
}
