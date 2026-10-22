/** The pullboard done command, in its own module so an item adding another command never edits these lines. */
import {
  context,
  idArg,
} from '../cli.js';
import {
  submitHere,
} from './submit.js';

/** Run `pullboard done` and return its exit code. */
export async function run(io, { first, values }) {
  return submitHere(context(io), idArg(first), values.infra);
}
