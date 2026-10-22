/** The pullboard queue command, in its own module so an item adding another command never edits these lines. */
import * as queueView from '../queue.js';
import {
  context,
  withBoard,
} from '../cli.js';

/** Run `pullboard queue` and return its exit code. */
export function run(io, { first, second, rest }) {
  return queueView.queueCommand(io, [first, second, ...rest], (work) => withBoard(context(io), work));
}
