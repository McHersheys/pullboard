/** The pullboard runner command, in its own module so an item adding another command never edits these lines. */
import {
  Refused,
} from '../refused.js';
import {
  addRunner,
  loadMachineSettings,
  removeRunner,
} from '../settings.js';
import { runnerResourceStatus } from '../resources.js';

/** List, add or remove machine-level SSH capacity without requiring a board identity or runner account. */
export function runnerCommand(io, { first, second, rest, values }) {
  if (first === 'list') {
    if (second || rest.length || Object.keys(values).some(key => key !== 'json')) throw new Refused('USAGE', 'pullboard runner list');
    // Registered capacity is what each runner enforces, whatever its own settings say (#1066).
    const runners = runnerResourceStatus(loadMachineSettings().runners ?? []);
    io.result?.({ runners });
    io.say(runners.length ? runners.map(runner => `${runner.host}: ${runner.slots} slots, ${runner.browser} browser, GUI ${runner.gui === true ? 'yes' : runner.gui === false ? 'no' : 'unknown'}${runner.draining ? ' (draining)' : ''}`).join('\n') : 'no runners registered');
    return 0;
  }
  if (first === 'remove') {
    if (!second || second.trim() !== second || rest.length || Object.keys(values).some(key => key !== 'json')) {
      throw new Refused('USAGE', 'pullboard runner remove <ssh-host>');
    }
    const runner = removeRunner(second);
    io.result?.({ runner });
    io.say(`${runner.draining ? 'draining' : 'removed'} runner ${runner.host}`);
    return 0;
  }
  if (first !== 'add' || !second || rest.length || !/^[1-9]\d*$/u.test(values.slots ?? '')
    || !/^(?:0|[1-9]\d*)$/u.test(values.browser ?? '')) {
    throw new Refused('USAGE', 'pullboard runner add <ssh-host> --slots <positive integer> --browser <integer from zero through slots>');
  }
  const runner = addRunner({ host: second, slots: Number(values.slots), browser: Number(values.browser),
    ...(values.node !== undefined ? { node: values.node } : {}), ...(values.root !== undefined ? { root: values.root } : {}) });
  io.result?.({ runner });
  io.say(`registered runner ${runner.host}: ${runner.slots} slots, ${runner.browser} browser`);
  return 0;
}

/** Run `pullboard runner` and return its exit code. */
export function run(io, args) {
  return runnerCommand(io, args);
}
