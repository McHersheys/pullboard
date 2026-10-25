/** A member's new device gets its board key from an online member device, vouched by an SSH key on GitHub [E17]. */
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import {
  homedir,
  tmpdir,
} from 'node:os';
import { join } from 'node:path';
import {
  createDeviceKeys,
  unwrapDeviceBoardKey,
  wrapDeviceBoardKey,
} from './relay-device-keys.js';
import { ENGINE_VERSION } from './machine.js';
import { Refused } from './refused.js';

const NAMESPACE = 'pullboard-device-key';
const TEN_MINUTES = 10 * 60_000;
const POLL_MS = 1000;

/** The exact bytes an SSH key signs: the statement, domain-separated from every other signature. */
export function statementBytes(statement) { return JSON.stringify([NAMESPACE, statement]); }

/** Run ssh-keygen in a private scratch folder, refusing plainly when OpenSSH is not installed. */
function sshKeygen(args, input) {
  const result = spawnSync('ssh-keygen', args, { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 30_000 });
  if (result.error?.code === 'ENOENT') throw new Refused('RELAY_SSH_KEYGEN', 'ssh-keygen is not installed; install OpenSSH, then run pullboard relay on again');
  return result;
}

/** Work with files in a fresh owner-only folder that is always removed. */
function scratch(work) {
  const folder = mkdtempSync(join(tmpdir(), 'pullboard-vouch-'));
  try { return work(folder); } finally { rmSync(folder, { recursive: true, force: true }); }
}

/** The SSH key that vouches for this device: PULLBOARD_SSH_KEY, or the usual key files under ~/.ssh. */
function signingKey(environment = process.env) {
  if (environment.PULLBOARD_SSH_KEY) return environment.PULLBOARD_SSH_KEY;
  const found = ['id_ed25519', 'id_ecdsa', 'id_rsa'].map(name => join(homedir(), '.ssh', name)).find(existsSync);
  if (!found) throw new Refused('RELAY_SSH_KEY', 'no SSH key here vouches for this device; add one to your GitHub account with ssh-keygen -t ed25519 and gh ssh-key add, or set PULLBOARD_SSH_KEY to its path');
  return found;
}

/**
 * Sign the statement with the person's SSH key. With an agent running, the public half lets ssh-agent sign for a key
 * with a passphrase; otherwise ssh-keygen reads the private key file itself.
 */
function sshSign(bytes) {
  const key = signingKey();
  return scratch(folder => {
    const file = join(folder, 'statement');
    writeFileSync(file, bytes, { mode: 0o600 });
    const tries = process.env.SSH_AUTH_SOCK && existsSync(key + '.pub') ? [key + '.pub', key] : [key];
    let failure = '';
    for (const signer of tries) {
      const result = sshKeygen(['-Y', 'sign', '-q', '-n', NAMESPACE, '-f', signer, file]);
      if (result.status === 0 && existsSync(file + '.sig')) return readFileSync(file + '.sig', 'utf8');
      failure = String(result.stderr ?? '').trim().split('\n')[0];
    }
    throw new Refused('RELAY_SSH_SIGN', `ssh-keygen could not sign with ${key}${failure ? ' (' + failure + ')' : ''}; load the key with ssh-add, or set PULLBOARD_SSH_KEY to a key on your GitHub account`);
  });
}

/** Whether one of the login's GitHub SSH keys made this signature over this exact statement. */
async function vouched(statement, signature, login, githubKeys) {
  const keys = await githubKeys(login);
  if (!keys.length) return false;
  return scratch(folder => {
    writeFileSync(join(folder, 'allowed'), keys.map(key => `${login} namespaces="${NAMESPACE}" ${key}`).join('\n') + '\n', { mode: 0o600 });
    writeFileSync(join(folder, 'statement.sig'), signature, { mode: 0o600 });
    return sshKeygen(['-Y', 'verify', '-f', join(folder, 'allowed'), '-I', login, '-n', NAMESPACE, '-s', join(folder, 'statement.sig')], statementBytes(statement)).status === 0;
  });
}

/** Wait between polls without keeping a finished command alive. */
function pause(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

/**
 * Ask the repository's board for its key from this new device: sign a fresh device key with the person's SSH key, then
 * wait until a member device hands the key over, wrapped to that device key alone. `link` carries the relay url and
 * the person's own sign-in token; `send` is the relay transport.
 *
 * @returns {Promise<Uint8Array>} the board key
 */
export async function requestBoardKey(link, login, send, io) {
  const keys = await createDeviceKeys();
  const statement = { v: 1, board: link.board, repository: link.repository, device: keys.deviceId, publicKey: keys.publicKey,
    login, engine: ENGINE_VERSION, expires: Date.now() + TEN_MINUTES - 30_000 };
  const path = '/api/v1/boards/' + link.board + '/key-requests';
  const posted = await send(link, path, { method: 'POST', body: { statement, signature: sshSign(statementBytes(statement)) } }, io);
  let said = false;
  while (Date.now() < statement.expires) {
    const answer = await send(link, path + '/' + posted.id, {}, io);
    if (answer.state === 'delivered') {
      return unwrapDeviceBoardKey(keys.privateKey, JSON.parse(Buffer.from(answer.wrapped, 'base64url').toString('utf8')),
        { board: link.board, device: keys.deviceId, engine: ENGINE_VERSION });
    }
    if (answer.state === 'refused') throw new Refused(answer.refused.code, answer.refused.message.replace(/^\[[A-Z0-9_]+\] /u, ''));
    if (!said) {
      said = true;
      // A live wait line, like the sign-in prompt: it reaches the terminal even when the result is JSON.
      (io.stderr ?? process.stderr).write(`pullboard: no member device is online to hand over the key for board ${link.board.slice(0, 8)}; waiting. Any pullboard command on a linked computer of this repository hands it over. Ctrl-C stops; run pullboard relay on again later.\n`);
    }
    await pause(POLL_MS);
  }
  throw new Refused('RELAY_KEY_WAIT_EXPIRED', 'no member device handed over the board key within ten minutes; run pullboard relay on again while a linked computer of this repository is online');
}

/**
 * On a member device, answer every waiting key request for this board: wrap the key to a device key that one of the
 * person's GitHub SSH keys signed, and refuse the rest by name. GitHub being unreachable leaves a request waiting.
 * `send` is the relay transport and `githubKeys` reads a login's public SSH keys from GitHub.
 */
export async function handOverBoardKeys(state, key, { send, githubKeys }, io) {
  const path = '/api/v1/boards/' + state.board + '/key-requests';
  const { requests } = await send(state, path, {}, io);
  for (const entry of Array.isArray(requests) ? requests : []) {
    const statement = entry.statement;
    let body;
    try {
      if (statement?.board !== state.board || statement.repository !== state.repository || statement.login !== entry.login || !(statement.expires > Date.now())) {
        throw new Refused('RELAY_KEY_VOUCH', 'the key request names another board, repository or person; run pullboard relay on again in the clone');
      }
      if (!await vouched(statement, entry.signature, entry.login, githubKeys)) {
        throw new Refused('RELAY_KEY_VOUCH', `no SSH key on ${entry.login}'s GitHub account signed this device key; add the key that signed it to GitHub with gh ssh-key add, then run pullboard relay on again`);
      }
      const wrapped = await wrapDeviceBoardKey(key, statement.publicKey, { board: state.board, device: statement.device, engine: statement.engine });
      body = { wrapped: Buffer.from(JSON.stringify(wrapped)).toString('base64url') };
    } catch (error) {
      if (!(error instanceof Refused)) throw error;
      if (error.code === 'GITHUB_UNAVAILABLE') { io.err('pullboard: ' + error.message); continue; }
      body = { refused: { code: error.code, message: error.message } };
    }
    await send(state, path + '/' + entry.id, { method: 'PUT', body }, io);
    io.err(body.wrapped ? `pullboard: handed this board's key to a new device of ${entry.login}` : `pullboard: refused a new device of ${entry.login}: ${body.refused.message}`);
  }
}
