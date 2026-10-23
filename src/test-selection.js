/** Count selected native cases independently of the caller's public reporter [C7,S13]. */
import {
  readFileSync,
  writeFileSync,
} from 'node:fs';

/** Read the same name-pattern spellings the ordinary runner accepts. */
export function testSelectionPatterns(args) {
  const patterns = [];
  for (let index = 0; index < args.length && args[index] !== '--'; index++) {
    if (!/^--test[-_]name[-_]pattern(?:=|$)/u.test(args[index])) continue;
    const value = args[index].includes('=') ? args[index].slice(args[index].indexOf('=') + 1) : args[++index];
    if (value !== undefined) patterns.push(value);
  }
  return patterns;
}

/** A successful Node process cannot turn missing native selection evidence into a green check. */
export function selectedTestResult(result, record, patterns, files) {
  if (result.status !== 0 || !patterns.length) return result;
  let cases = 0;
  try { cases = JSON.parse(readFileSync(record, 'utf8')).cases; }
  catch { /* A missing or malformed internal reporter result fails closed. */ }
  if (Number.isSafeInteger(cases) && cases > 0) return result;
  process.stderr.write(`run-tests: NO_TESTS_MATCHED: patterns ${JSON.stringify(patterns)} selected no proven test case in ${JSON.stringify(files)}\n`);
  return { ...result, status: 1 };
}

/** Only child-file summaries contain native case counts; the parent aggregate includes file wrappers. */
export default async function* recordSelectedTests(events) {
  let cases = 0;
  for await (const event of events) {
    if (event.type !== 'test:summary' || !event.data.file) continue;
    const count = event.data.counts?.tests;
    if (!Number.isSafeInteger(count) || count < 0 || !Number.isSafeInteger(cases + count)) throw new Error('native selected-test counts are unavailable');
    cases += count;
  }
  writeFileSync(process.env.PULLBOARD_TEST_SELECTION, JSON.stringify({ cases }), { mode: 0o600 });
}
