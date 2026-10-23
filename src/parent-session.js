/** Stable parent identities recorded at join, from an explicit declaration or this runtime's own session metadata [V1,B3]. */
import { closeSync, openSync, readSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Refused } from './refused.js';

/** Accept an opaque identity, never a path, whitespace, credential or arbitrary session metadata. */
export function parentIdentity(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value)) {
    throw new Refused('BAD_PARENT', 'a parent session is a stable id of at most 128 letters, numbers, dots, colons, underscores or hyphens; join again with --parent <session-id>');
  }
  return value;
}

/** Read only the bounded first record; conversation history and other sessions' contents are never opened. */
function ownSessionMetadata(file, session) {
  let descriptor;
  try {
    descriptor = openSync(file, 'r');
    const buffer = Buffer.alloc(256 * 1024);
    const count = readSync(descriptor, buffer, 0, buffer.length, 0);
    const text = buffer.subarray(0, count).toString('utf8');
    const end = text.indexOf('\n');
    if (end < 0) return null;
    const record = JSON.parse(text.slice(0, end));
    if (record.type !== 'session_meta' || ![record.payload?.id, record.payload?.session_id].includes(session)) return null;
    return record.payload;
  } catch { return null; }
  finally { if (descriptor !== undefined) closeSync(descriptor); }
}

/** Discover only the invoking Codex session's metadata file, matching its runtime id before reading it. */
export function runtimeSessionIdentity(environment = process.env, home = homedir()) {
  const session = environment.CODEX_THREAD_ID || environment.CODEX_SESSION_ID;
  if (!session || !/^[A-Za-z0-9-]+$/u.test(session)) return null;
  const sessions = join(environment.CODEX_HOME || join(home, '.codex'), 'sessions');
  let entries;
  try { entries = readdirSync(sessions, { recursive: true, withFileTypes: true }); }
  catch { return null; }
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(`-${session}.jsonl`)) continue;
    const metadata = ownSessionMetadata(join(entry.parentPath, entry.name), session);
    if (!metadata) continue;
    try { return { session: parentIdentity(session), parent: metadata.parent_thread_id ? parentIdentity(metadata.parent_thread_id) : null }; }
    catch { /* An invalid runtime record cannot declare another identity. */ }
  }
  return null;
}

/** Read this runtime's parent, keeping a primary session's missing parent visible as unknown. */
export function runtimeParentSession(environment = process.env, home = homedir()) {
  return runtimeSessionIdentity(environment, home)?.parent ?? null;
}

/** An explicit declaration and the runtime record use exactly the same canonical identity. */
export function joinParentSession(declared, environment = process.env) {
  return declared === undefined ? runtimeParentSession(environment) : parentIdentity(declared);
}
