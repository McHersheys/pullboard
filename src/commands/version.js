/** The pullboard version command, in its own module so an item adding another command never edits these lines. */
import { VERSION } from '../cli.js';

/** Run `pullboard version` (or any command with --version) and return its exit code. */
export function run(io) {
  io.result?.({ release: VERSION });
  io.say(VERSION);
  return 0;
}
