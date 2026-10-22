/** The pullboard runner command, in its own module so an item adding another command never edits these lines. */
import {
  Refused,
} from '../refused.js';
import {
  addRunner,
} from '../settings.js';

/** Register machine-level SSH capacity without requiring a board identity or a runner account. */
export function runnerCommand(io, { first, second, rest, values }) {
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
