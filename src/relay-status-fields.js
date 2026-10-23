/** Transport-free local relay status fields shared with offline read commands [C7,H16]. */
/** Expose only the actionable recovery choice; checkpoint ciphertext and local digests stay private. */
export function recoverySummary(state) {
  const skip = Number.isSafeInteger(state?.recovery?.skip) ? state.recovery.skip : 0;
  return { pending: skip > 0, skip, next: skip > 0 ? `pullboard relay recover --skip ${skip}` : '' };
}

/** Preserve the unlinked status document, including a deleted-copy notice when present. */
export function unlinkedRelayStatus(deleted = null) {
  return { linked: false, board: deleted?.board ?? '', url: deleted?.url ?? '', link: '', sequence: 0, behind: 0, recovery: recoverySummary(null),
    ...(deleted ? { deleted: true, notice: 'The relay copy was deleted; your local board is complete. Keep working locally, or run pullboard relay on to link it again.' } : {}) };
}
