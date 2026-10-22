/** The pullboard hooks command, in its own module so an item adding another command never edits these lines. */
import {
  repoInfo,
} from '../git.js';
import {
  installHooks,
} from '../hooks.js';

/** Run `pullboard hooks` and return its exit code. */
export function run(io) {
  const notes = installHooks(repoInfo(io.cwd).root);
  io.result?.({ notes });
  notes.forEach((note) => io.say(note));
  return 0;
}
