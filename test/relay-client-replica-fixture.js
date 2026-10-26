/** Read and replay fixture replica state without changing its durable history [H16,V1,V17]. */
import { DatabaseSync } from 'node:sqlite';
import { unseal } from '../src/seal.js';
import { syncRelay } from '../src/relay.js';

/** Read local events directly so inspection itself cannot drain the durable retry queue. */
export function localEvents(file) {
  const db = new DatabaseSync(file, { readOnly: true });
  try { return JSON.parse(JSON.stringify(db.prepare('SELECT * FROM event ORDER BY event_id').all())); }
  finally { db.close(); }
}

/** Read replay receipts without changing either replica's event cursor. */
export function receipts(file) {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    return db.prepare("SELECT meta_value FROM board_meta WHERE meta_key LIKE 'relay_receipt_%'")
      .all().map(({ meta_value }) => JSON.parse(meta_value));
  } finally { db.close(); }
}

/** Decode only stable operation identity fields from captured fixture relay posts. */
export async function relayUploadSummary(uploads, key, boardId) {
  return Promise.all(uploads.map(async ({ sequence, sealed }) => {
    const plain = await unseal(key, Buffer.from(sealed, 'base64url'), { boardId, kind: 'move', sequence });
    const move = JSON.parse(new TextDecoder().decode(plain));
    return { sequence, operation: move.operation, moveId: move.id,
      item: Number.isSafeInteger(move.args?.[0]) ? move.args[0] : null };
  }));
}

/** Make a submitted commit locally verifiable by the other replica's real Git history. */
export function mergeCandidateForReview(root, env, sourceRoot, commit, gitAt) {
  gitAt(root, env, 'fetch', sourceRoot, commit);
  gitAt(root, env, 'merge', '--no-ff', '-m', 'test: make submitted commit available to verifier [G1]', 'FETCH_HEAD');
  gitAt(root, env, 'merge-base', '--is-ancestor', commit, 'HEAD');
}

/** Replay a fixture clone's real outbox through the production sync path without another CLI process. */
export async function syncReplica(root, env) {
  const keys = ['HOME', 'USERPROFILE', 'PULLBOARD_HOME', 'PULLBOARD_RELAY_TOKEN', 'PULLBOARD_RELAY_SENDER_BACKGROUND',
    'PULLBOARD_RELAY_CHECKPOINT_BACKGROUND', 'PULLBOARD_RELAY_CHECKPOINT_QUIET_MS', 'PATH', 'GIT_CONFIG_GLOBAL', 'GIT_CONFIG_NOSYSTEM'];
  const previous = new Map(keys.map(key => [key, process.env[key]]));
  for (const key of keys) {
    if (env[key] === undefined) delete process.env[key];
    else process.env[key] = env[key];
  }
  const diagnostics = [];
  try {
    const result = await syncRelay(root, { relayOutbox: () => true, err: line => diagnostics.push(line), say: () => {} });
    return { result, diagnostics };
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}
