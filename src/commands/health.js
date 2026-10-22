/** The pullboard health command, in its own module so an item adding another command never edits these lines. */
import {
  boardHealth,
  healthLines,
} from '../health.js';
import {
  context,
} from '../cli.js';

/** Run `pullboard health` and return its exit code. */
export function run(io) {
  const ctx = context(io);
  const report = boardHealth(ctx.file, { root: ctx.info.root, config: ctx.config, now: ctx.clock.now() });
  io.result?.(report);
  for (const line of healthLines(report)) io.say(line);
  return report.stuck.length ? 1 : 0;
}
