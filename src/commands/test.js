/** The pullboard test command, in its own module so an item adding another command never edits these lines. */
import { runTestFiles } from '../test-run.js';
import {
  context,
  gateWaitReporter,
  resourceAgent,
} from '../cli.js';

/** Run `pullboard test <files>` and return its exit code: 0 when every named file passes. */
export async function run(io, { first, second, rest }) {
  const ctx = context(io);
  const files = [first, second, ...rest].filter((file) => file !== undefined && file !== '');
  const result = await runTestFiles(ctx.info.root, ctx.config, files, { agent: resourceAgent(ctx) ?? `pid-${process.pid}`, onWait: gateWaitReporter(io) });
  io.result?.(result);
  if (!io.result && result.output) io.say(result.output.trimEnd());
  io.err(`pullboard test: ${result.green ? 'green' : 'red'} on ${result.runner} in ${result.seconds}s`);
  for (const entry of result.known) {
    io.err(entry.result === 'red'
      ? `known main failure: ${entry.file} fails on main ${String(result.main).slice(0, 12)} too`
      : `new failure: ${entry.file} passes on main ${String(result.main).slice(0, 12)}`);
  }
  return result.green ? 0 : 1;
}
