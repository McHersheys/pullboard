/** The read-only board open for commands that only read, kept beside cli.js's withBoard [C7]. */
import * as store from './board.js';
import { withBoard } from './cli-context.js';
import { Refused } from './refused.js';

/**
 * withBoard for a command that only reads: the board opens read-only, without the write lock, and a
 * read never migrates it (#1047). A board this code has not migrated is read as it is; only the next
 * command that writes upgrades it. Branch code keeps withBoard's schema guard, which never migrates
 * a shared board either. Work that writes after all (a first coordinator registration) runs again
 * through withBoard on a current board; SQLite refused the write, so nothing ran twice.
 *
 * @template T
 * @param {any} ctx
 * @param {(board: any) => T} work
 * @returns {T}
 */
export function withBoardRead(ctx, work) {
  const board = store.openBoardForRead(ctx.file, ctx.clock);
  if (board && !board.current && !ctx.allowSchemaUpgrade) store.closeBoard(board);
  if (!board || (!board.current && !ctx.allowSchemaUpgrade)) return withBoard(ctx, work);
  try { return withBoard(ctx, work, board); }
  catch (error) {
    if (board.current && store.writeRefused(error)) return withBoard(ctx, work);
    if (!store.writeRefused(error) && !store.schemaMissing(error)) throw error;
    throw new Refused('BOARD_SCHEMA_BEHIND', 'this board was made by an older pullboard and a read never upgrades it');
  }
}
