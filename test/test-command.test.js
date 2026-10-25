/** Runner-bound commands bypass only local memory holds [C7]. */
import { test } from 'node:test';
import { assertRunnerMemoryAdmission } from './runner-memory-fixture.js';

test('a runner-bound test run passes a local memory hold [C7]', async () => {
  await assertRunnerMemoryAdmission();
});
