/** Preserve a row's gate, signer list and other fields while changing only its decided status and text [S1,E22]. */
export function rowDecisionReplacement(source, decision, text) {
  const status = decision === 'approve' ? 'approved' : 'wont';
  return source.replace(/\[([a-z]+)(,\s*[a-z]+)?\]/u, (_, old, tier = '') => `[${status}${tier}]`)
    .replace(/(\]\s+)([^|]*)(?=\s*\||$)/u, (_, prefix, old) => `${prefix}${text}${old.match(/\s+$/u)?.[0] ?? ''}`);
}
