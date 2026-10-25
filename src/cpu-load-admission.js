/** CPU-load declarations are source metadata; discovery never executes test code [C7]. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadMachineSettings } from './settings.js';
import { cpuLoadOptionsIn } from './module-imports.js';

/** A selected file with a declared CPU-load option must be placed before any test body starts. */
export function testsNeedCpuRunner(root, files) {
  return cpuLoadOptionsIn(files.map(file => readFileSync(resolve(root, file), 'utf8'))).some(Boolean);
}

/** Report the explicit no-runner fallback while keeping registered CPU work off the coordinator. */
export function cpuRunnerRequired(root, files) {
  const declared = testsNeedCpuRunner(root, files);
  const registered = (loadMachineSettings().runners ?? []).length > 0;
  if (declared && !registered) process.stderr.write('CPU-load test uses the current admitted slot because no runners are registered\n');
  return declared && registered;
}
