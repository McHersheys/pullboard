/** @pullboard-test-gui */
/** The view opens on whether the rules hold, then what needs the person; Items stay one click away [N26,U91]. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fetchPage, machine, openPage, project, startView, storage } from './fixture.js';

/** Two gated rows, one approved aim with no gate, and an open question for the person. */
const SPEC = `# Home spec

## G · Goals
- G1 [approved, must] The page renders. | gate: web test
- G2 [approved, must] The page says goodbye. | gate: web test
- G3 [approved, aim] The page reads well.
- G4 [pending, must] Should the page greet a visitor? | gate: review
`;

/** One count from the rules card, by its key. */
function count(html, key) {
  return Number(new RegExp(`data-home-count="${key}"><dt>[^<]+</dt><dd>(\\d+)</dd>`).exec(html)?.[1]);
}

test('the first screen shows the rules and their proof before the work queue [N26]', async () => {
  const box = machine();
  const alpha = project(box, 'alpha', SPEC);
  const view = await startView(box);
  try {
    const html = await (await fetchPage(view)).text();
    const before = (first, then) => html.includes(first) && html.indexOf(first) < html.indexOf(then);
    assert.ok(before('data-tab="home"', 'data-tab="items"'), 'Home is the first tab, Items the next');
    assert.ok(before('data-pane="home"', 'data-pane="items"'), 'the rules come before the work queue');

    // A new board opens on its rules: counted from the rows the board sends, then the calls waiting on the person.
    const fresh = await openPage(view, { store: storage() });
    assert.equal(fresh.run('view.tab'), 'home', 'a board with no items yet opens on Home');
    const rules = fresh.show('home-rules');
    assert.deepEqual(['approved', 'gated', 'ungated'].map((key) => count(rules, key)), [3, 2, 1], 'approved rows, those naming a gate, and those with none');
    assert.match(rules, /data-go="tab:spec"/, 'the rules card opens the Spec');
    assert.match(fresh.show('home-needs'), /Should the page greet a visitor\?[^]*?NEEDS YOU/, 'below the rules, what needs the person');
    assert.equal(fresh.element('home-calm').hidden, true, 'no calm line while something waits');

    // An existing board keeps opening on Items; one click switches, and that choice is kept.
    box.run(alpha.repo, 'add', 'web', 'Render the page', '--specs', 'G1');
    const store = storage();
    const working = await openPage(view, { store });
    assert.equal(working.run('view.tab'), 'items', 'a board with work opens on Items');
    await working.click({ tab: 'home' });
    assert.equal(working.run('view.tab'), 'home');
    assert.equal(store.getItem('pb.tab'), 'home', 'the choice is kept');
    assert.equal((await openPage(view, { store })).run('view.tab'), 'home', 'the next visit opens where the person left it');
    await working.click({ tab: 'items' });
    assert.equal((await openPage(view, { store })).run('view.tab'), 'items', 'Items is one click back, and kept too');
  } finally {
    await view.stop();
  }
});
