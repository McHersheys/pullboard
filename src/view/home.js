/**
 * The first screen's rules card (#967): how many Spec rows are approved, and how many of those name a gate or none,
 * so a person reads whether the rules hold before the work queue. It counts the rows the board sends as they are;
 * whether a gate runs, passes or was contradicted is the server's to report, so nothing here guesses at it.
 *
 * @param {Array<{ status: string, gate?: string }>} spec - The board's Spec rows, as the server projects them.
 * @returns {string} The card's HTML.
 */
export function homeRules(spec) {
  const approved = (spec ?? []).filter((row) => row.status === 'approved');
  const gated = approved.filter((row) => String(row.gate ?? '').trim()).length;
  const counts = [['approved', 'Approved', approved.length], ['gated', 'Name a gate', gated], ['ungated', 'No gate', approved.length - gated]];
  return '<h2>Your rules</h2><dl class="home-counts">'
    + counts.map(([key, label, n]) => '<div data-home-count="' + key + '"><dt>' + label + '</dt><dd>' + n + '</dd></div>').join('')
    + '</dl><button class="link" data-go="tab:spec" type="button">Open the Spec</button>';
}
