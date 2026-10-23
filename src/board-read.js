/** The read-only board open for commands that only read, kept beside cli.js's withBoard [C7]. */
import * as store from './board.js';
import { withBoard } from './cli.js';

/**
 * withBoard for a command that only reads: the board opens read-only, without the write lock or a
 * migration (#1047). A board that needs a migration, or work that writes after all (a first
 * coordinator registration), runs again through withBoard; SQLite refused the write, so nothing ran twice.
 *
 * @template T
 * @param {any} ctx
 * @param {(board: any) => T} work
 * @returns {T}
 */
export function withBoardRead(ctx, work) {
  const board = store.openCurrentBoardReadOnly(ctx.file, ctx.clock);
  if (!board) return withBoard(ctx, work);
  try { return withBoard(ctx, work, board); }
  catch (error) { if (store.writeRefused(error)) return withBoard(ctx, work); throw error; }
}
