/** The pullboard sentinels command, in its own module so an item adding another command never edits these lines. */
import {
  sentinelListCommand,
} from '../sentinel-command.js';
import {
  context,
  withBoard,
} from '../cli.js';

/** Run `pullboard sentinels` and return its exit code. */
export function run(io, { first }) {
  return sentinelListCommand(first, () => context(io), withBoard);
}
