/**
 * Publishing the relay checkpoint (#1014): read and seal the board, save the exact sealed record, upload it, and
 * record the reply. Inside a command all of it runs under the relay lock, as before; the background publisher reads
 * and seals before the lock and uploads outside it, so moves never wait on either.
 */
import {
  clearUploadPauseNotices,
  permanentUploadRefusal,
  uploadPauseType,
  uploadRetryReady,
} from './relay-upload-pause.js';
import {
  presentationDigest,
  relaySnapshot,
} from './relay-presentation.js';
import { locked } from './relay-lock.js';
import { Refused } from './refused.js';

/**
 * Build the checkpoint publisher over relay.js's own link and transport helpers, which it cannot import without a cycle.
 *
 * @param {{ request: Function, saveLink: Function, loadLink: Function, linkFile: Function, readBoardKey: Function,
 *   sealedRecord: Function, reportCheckpointRefusal: Function, safePauseCode: Function, safePauseMessage: Function }} relay
 * @returns {{ publishCheckpoint: Function, publishLatestCheckpoint: Function }}
 */
export function checkpointPublisher({ request, saveLink, loadLink, linkFile, readBoardKey, sealedRecord, reportCheckpointRefusal, safePauseCode, safePauseMessage }) {
  /**
   * Read and seal this board's checkpoint: the expensive part of publishing, which needs no relay lock.
   *
   * @param {string} root
   * @param {any} state - The relay link, for the board's identity and key.
   * @returns {Promise<{ sequence: number, digest: string, sealed: string }>}
   */
  async function prepareCheckpoint(root, state) {
    const document = relaySnapshot(root);
    const sequence = Number(document.tables.board_meta.find((row) => row.meta_key === 'relay_applied_sequence')?.meta_value ?? 0);
    return { sequence, digest: presentationDigest(document.presentation),
      sealed: await sealedRecord(readBoardKey(state.board), document, state, 'snapshot', sequence) };
  }

  /**
   * Persist the exact checkpoint before uploading, so a lost reply retries identical ciphertext. `prepared`, sealed
   * outside the lock by the background publisher, stands in for reading the board again; an older one never replaces
   * a newer saved checkpoint.
   */
  async function publishCheckpoint(root, file, state, io, prepared = null) {
    const staged = await stageCheckpoint(root, file, state, io, prepared);
    if (!staged) return;
    const sent = state.checkpoint;
    let outcome;
    try { outcome = { reply: await request(state, '/api/v1/boards/' + state.board + '/state', { method: 'PUT', body: sent }, io) }; }
    catch (error) { outcome = { error }; }
    recordCheckpointUpload(file, state, io, staged, sent, outcome);
  }

  /**
   * Decide what checkpoint to send and save its exact sealed record first; null when nothing is to be sent (no machine
   * credential, an upload pause not yet over, or a definitive rejection of this same image).
   */
  async function stageCheckpoint(root, file, state, io, prepared) {
    if (!state.token?.startsWith('pm_') || process.env.PULLBOARD_RELAY_TOKEN) return null;
    const resumed = Boolean(state.checkpointRefusal);
    if (state.checkpointRefusal && uploadPauseType(state.checkpointRefusal)) {
      if (!await uploadRetryReady(state, state.checkpointRefusal, path => request(state, path, {}, io))) {
        saveLink(file, state); reportCheckpointRefusal(state, io); return null;
      }
      delete state.checkpointRefusal;
      saveLink(file, state);
    } else {
      const fresh = prepared && !(state.checkpoint?.sequence > prepared.sequence) ? prepared : await prepareCheckpoint(root, state);
      if (!state.checkpoint || state.checkpoint.sequence !== fresh.sequence || state.checkpointPresentationDigest !== fresh.digest) {
        delete state.checkpointRefusal;
        state.checkpointPresentationDigest = fresh.digest;
        state.checkpoint = { sequence: fresh.sequence, sealed: fresh.sealed };
        saveLink(file, state);
      }
      // A definitive rejection retries only a fresh image after the board changes.
      if (state.checkpointRefusal) { reportCheckpointRefusal(state, io); return null; }
    }
    return { resumed };
  }

  /**
   * Record how the upload of `sent` ended. A newer checkpoint saved meanwhile is left for the next upload, so an older
   * acknowledgement never marks it sent.
   */
  function recordCheckpointUpload(file, state, io, staged, sent, { reply, error }) {
    if (error) {
      if (!(error instanceof Refused) || !permanentUploadRefusal(error)) throw error;
      if (state.checkpoint?.sealed === sent.sealed) {
        state.checkpointRefusal = { code: safePauseCode(error), message: safePauseMessage(error), status: error.httpStatus };
        saveLink(file, state);
        reportCheckpointRefusal(state, io);
      }
      return;
    }
    if (reply.state?.sequence !== sent.sequence || reply.state.sealed !== sent.sealed) throw new Refused('RELAY_RESPONSE', 'the relay did not acknowledge this checkpoint; retry the configured relay');
    if (state.checkpoint?.sealed === sent.sealed) {
      state.presentationDigest = state.checkpointPresentationDigest;
      delete state.checkpoint;
      delete state.checkpointPresentationDigest;
    }
    saveLink(file, state);
    if (staged.resumed) clearUploadPauseNotices(state);
  }

  /**
   * Publish this board's checkpoint once: the background publisher's one step (#1014). The board is read and sealed
   * before the relay lock, the lock is held only to save the sealed record and later to record the reply, and the
   * upload itself holds no lock. A board whose link is gone or being removed publishes nothing.
   *
   * @param {string} root
   * @param {{ err: (line: string) => void, say: (line: string) => void }} io
   * @returns {Promise<boolean>} Whether a linked board was published.
   */
  async function publishLatestCheckpoint(root, io) {
    const file = linkFile(root);
    const linked = loadLink(file);
    if (!linked || linked.unlinking) return false;
    // Reading and sealing a large board takes about a second; it happens before the lock, so moves never wait on it.
    const prepared = await prepareCheckpoint(root, linked);
    const staged = await locked(file, async () => {
      const state = loadLink(file);
      if (!state || state.unlinking || state.board !== linked.board) return null;
      const result = await stageCheckpoint(root, file, state, io, prepared);
      return result && { ...result, sent: state.checkpoint, copy: structuredClone(state) };
    }, io);
    if (!staged) return false;
    // The upload holds no lock, so a move during it returns at once and the next checkpoint covers it. It runs on a
    // copy of the link: the copy saves nothing, and what the upload learns is carried back under the lock below.
    let outcome;
    try { outcome = { reply: await request(staged.copy, '/api/v1/boards/' + staged.copy.board + '/state', { method: 'PUT', body: staged.sent }, io) }; }
    catch (error) { outcome = { error }; }
    await locked(file, async () => {
      const state = loadLink(file);
      if (!state || state.board !== linked.board) return;
      if (staged.copy.snapshotApiVersion !== undefined) state.snapshotApiVersion = staged.copy.snapshotApiVersion;
      if (staged.copy.storage !== undefined) state.storage = staged.copy.storage;
      recordCheckpointUpload(file, state, io, staged, staged.sent, outcome);
    }, io);
    return true;
  }

  return { publishCheckpoint, publishLatestCheckpoint };
}
