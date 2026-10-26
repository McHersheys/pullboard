/**
 * A brief's labelled sections (B10, B14): `Files:`, `Change:`, `Test:` and `Out of scope:`, each
 * followed by text on the same line or by lines below it, until the next label. Below the strong
 * route a brief must name its files and its test, because a lighter model works from the brief alone.
 */

const LABEL_RE = /^(files|change|test|out of scope)\s*:\s*(.*)$/i;
const REFERENCE_LABEL_RE = /^(files|change|test|out of scope|reference)\s*:\s*(.*)$/i;

/** Remove closed parenthetical notes while leaving an unmatched note visible to path checks.
 *
 * @param {string} text
 * @returns {string}
 */
function withoutParentheticalNotes(text) {
  let depth = 0;
  let noteStart = -1;
  let output = '';
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '(') {
      if (depth === 0) {
        noteStart = index;
        output += ' ';
      }
      depth += 1;
    } else if (character === ')' && depth > 0) {
      depth -= 1;
      if (depth === 0) {
        noteStart = -1;
        output += ' ';
      }
    } else if (depth === 0) output += character;
  }
  if (depth > 0) output += text.slice(noteStart);
  return output;
}

/**
 * The brief split into its labelled sections, each a list of non-empty lines without bullets.
 *
 * @param {string} brief
 * @param {{ references?: boolean }} [options] Preserve the old section grammar during historical replay.
 * @returns {Record<string, string[]>}
 */
export function briefSections(brief, { references = true } = {}) {
  /** @type {Record<string, string[]>} */
  const sections = {};
  let current = '';
  for (const raw of brief.split('\n')) {
    const line = raw.trim();
    const label = (references ? REFERENCE_LABEL_RE : LABEL_RE).exec(line);
    if (label) {
      current = label[1].toLowerCase();
      if (current === 'reference') {
        sections.reference ??= [];
        if (label[2].trim()) sections.reference.push(label[2].trim());
      } else sections[current] = label[2].trim() ? [label[2].trim()] : [];
    } else if (current && line) {
      sections[current].push(line.replace(/^[-*]\s+/, ''));
    }
  }
  return sections;
}

/**
 * The paths a brief's Files section names, without bullets, backticks or trailing notes.
 *
 * @param {string} brief
 * @param {{ references?: boolean }} [options] Use the same section grammar as the caller's replay engine.
 * @returns {string[]}
 */
export function briefFiles(brief, options) {
  return (briefSections(brief, options).files ?? [])
    .flatMap((entry) => withoutParentheticalNotes(entry).split(/[,\s]+/))
    .map((token) => token.replace(/^[(`'"]+|[)\]'".,;:!?]+$/g, ''))
    .filter((token) => !/^[\d.]+$/.test(token)
      && !/^[a-z]+:\/\//i.test(token)
      && (token.includes('/') || /\.[a-z0-9]+(?:\.[a-z0-9]+)*$/i.test(token)));
}
