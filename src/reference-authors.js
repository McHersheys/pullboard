/** Bind explicit GitHub acknowledgements to source authors without executing referenced content [C7]. */
import { handledReferences } from './reference-lines.js';
import { githubPullClient } from './pr-github.js';
import { Refused } from './refused.js';

/** Recognize only a fixed GitHub issue or PR route; arbitrary references never become fetch URLs. */
function githubReference(target) {
  const match = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/(issues|pull)\/([1-9]\d*)\/?(?:[?#].*)?$/u.exec(target);
  if (!match || [match[1], match[2]].some(part => ['.', '..'].includes(part)) || !Number.isSafeInteger(Number(match[4]))) return null;
  return { repository: `${match[1]}/${match[2]}`, kind: match[3], number: Number(match[4]) };
}

/** Fetch only handled issue/PR authors and carry their checked identity in the same ordered move. */
export function referenceAuthors(root, brief) {
  return handledReferences(brief).flatMap(reference => {
    const source = githubReference(reference.target);
    if (!source) return [];
    const client = githubPullClient(root, source.repository);
    const data = source.kind === 'issues' ? client.readIssue(source.number) : client.read(source.number);
    const author = data?.user?.login;
    if (typeof author !== 'string' || author.toLowerCase() !== reference.handle.toLowerCase()) {
      throw new Refused('REFERENCE_AUTHOR', `${reference.target} was authored by ${author ? `@${author}` : 'an unknown author'}, not @${reference.handle}; use the source author or remove the handle.`);
    }
    return [{ target: reference.target, author }];
  });
}

/** Replay the coordinator's author attestation deterministically, without making network requests. */
export function validateReferenceAuthors(brief, authors = []) {
  const required = handledReferences(brief).filter(reference => githubReference(reference.target));
  if (!Array.isArray(authors) || authors.length !== required.length || required.some((reference, index) =>
    authors[index]?.target !== reference.target || typeof authors[index]?.author !== 'string'
      || authors[index].author.toLowerCase() !== reference.handle.toLowerCase())) {
    throw new Refused('REFERENCE_AUTHOR', 'handled GitHub references need matching source author attestations; use pullboard add or edit to read the issue or PR author, or remove the handle.');
  }
}
