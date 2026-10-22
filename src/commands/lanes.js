/** The pullboard lanes command, in its own module so an item adding another command never edits these lines. */
import {
  COORDINATOR,
} from '../config.js';
import {
  context,
} from '../cli.js';

/** Run `pullboard lanes` and return its exit code. */
export function run(io) {
  const { config } = context(io);
  io.result?.({ lanes: config.lanes, shared: config.shared, coordinator: COORDINATOR });
  io.say(`${COORDINATOR.padEnd(14)} everything no lane owns; verifies, merges, may change any path`);
  for (const [name, lane] of Object.entries(config.lanes)) {
    const specs = lane.specs?.length ? `  [${lane.specs.join(', ')}]` : '';
    const starts = lane.starts ? `  starts: ${lane.starts}` : '';
    io.say(`${name.padEnd(14)} ${lane.owns.length ? lane.owns.join(' ') : '(owns no folders)'}${specs}${starts}`);
  }
  if (config.shared.length) io.say(`${'shared'.padEnd(14)} ${config.shared.join(' ')} (any lane)`);
  return 0;
}
