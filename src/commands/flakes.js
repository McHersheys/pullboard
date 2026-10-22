/** The pullboard flakes command, in its own module so an item adding another command never edits these lines. */
import * as nativeFlakes from '../native-flake-cli.js';
import {
  context,
  ordered,
  resourceAgent,
  withBoard,
} from '../cli.js';

/** Run `pullboard flakes` and return its exit code. */
export function run(io, { first, second, rest }) {
  return nativeFlakes.command(context(io), { first, second, rest }, withBoard, { ordered, resourceAgent });
}
