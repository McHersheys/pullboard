/** Callable evidence must not hide executable options in another binding [C7]. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { cpuLoadOptionsIn } from '../src/module-imports.js';

for (const [kind, statement] of [
  ['object binding', "{ const { callback } = opaque; test('pending', callback); }"],
  ['array binding', "{ const [callback] = opaque; test('pending', callback); }"],
  ['destructuring assignment', "({ callback } = opaque); test('pending', callback);"],
]) test(`a ${kind} cannot inherit another callback's callable evidence [C7]`, () => {
  const source = `import test from 'node:test'; function callback() {} ${statement}`;
  assert.equal(cpuLoadOptionsIn([source])[0], true,
    'an opaque options value remains conservative despite another function with the same spelling');
});

test('an unshadowed function callback has no CPU options [C7]', () => {
  assert.equal(cpuLoadOptionsIn(["import test from 'node:test'; function callback() {} test('ordinary', callback);"])[0], false);
  assert.equal(cpuLoadOptionsIn(["import test from 'node:test'; function callback() {} test('busy', { cpuLoad: true }, callback);"])[0], true,
    'proven callbacks cannot erase a genuine options argument');
});
