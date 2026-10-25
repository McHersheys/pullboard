/** Present recorded check observations without loading a shell runner [C7,V2]. */
/**
 * A check that would prove the work (#917): one that runs the item's new test file. The file is the one the
 * criterion or brief names, or one named after the item; the runner is the item's own Node test runner when it uses
 * one, and node --test otherwise, so an agent that set `npm test` gets a command it can paste.
 *
 * @param {{ item_title?: string, item_check?: string|null, item_criterion?: string|null, item_brief?: string|null }} item
 * @returns {string}
 */
export function provingCheck(item) {
  const named = /\b(test\/[\w./-]+\.test\.[cm]?js)\b/u.exec(`${item.item_criterion ?? ''}\n${item.item_brief ?? ''}`)?.[1];
  const slug = String(item.item_title ?? '').toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-+|-+$/gu, '').slice(0, 48) || 'the-work';
  const runner = /^node\s+bin\/run-tests\.js\b/u.test(item.item_check ?? '') ? 'node bin/run-tests.js' : 'node --test';
  return `${runner} ${named ?? `test/${slug}.test.js`}`;
}

/** Print a recorded observation, including the warning every reviewer must see before work. */
export function sayCheckBaseline(io, item) {
  const base = item.item_check_baseline;
  if (!base) return;
  if (base.result === 'pending') {
    io.say(`check baseline running in the background at main ${base.main}: ${base.command}`);
    return;
  }
  if (base.result === 'unavailable') {
    io.say(`check baseline unavailable: ${base.reason}`);
    return;
  }
  io.say(`check baseline ${base.result} at main ${base.main}${base.reason ? ` (${base.reason})` : ''}: ${base.command}`);
  if (base.result === 'green') {
    io.say(`warning: [CRITERION_PROVES_NOTHING] this check already passes on main; use a check that fails before the work and passes after it, such as one that runs the new test: pullboard edit ${item.item_id} --check "${provingCheck(item)}"`);
  }
}
