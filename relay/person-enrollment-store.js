/** Carry opaque person enrollment traffic without becoming its cryptographic trust root [H15]. */
import { Refused } from '../src/refused.js';
import { personEnrollmentBody } from '../src/person-enrollment.js';

/** Use the device store's private SQLite connection and durable revocation tombstones. */
export function createPersonEnrollmentStore({ database, now }) {
  /** Keep spent nonces permanently spent; expiry never makes an old request reusable. */
  function db() {
    const opened = database();
    opened.exec(`CREATE TABLE IF NOT EXISTS person_enrollment (
      account TEXT NOT NULL, nonce TEXT NOT NULL, device TEXT NOT NULL, expires INTEGER NOT NULL,
      payload TEXT NOT NULL, used INTEGER NOT NULL DEFAULT 0, wrapped TEXT,
      PRIMARY KEY(account,nonce));`);
    return opened;
  }
  /** Hide other accounts and reject revocation or an expired pending challenge. */
  function entry(account, nonce) {
    const row = db().prepare('SELECT * FROM person_enrollment WHERE account=? AND nonce=?').get(account, nonce);
    if (!row) throw new Refused('PERSON_ENROLL_MISSING', 'Use this account’s own person-authenticated enrollment.');
    if (db().prepare('SELECT revoked FROM device WHERE account=? AND id=?').get(account, row.device)?.revoked) {
      throw new Refused('PERSON_ENROLL_REVOKED', 'This device was revoked; authenticate a different device.');
    }
    if (!row.used && row.expires <= now()) throw new Refused('PERSON_ENROLL_EXPIRED', 'Create a fresh person-authenticated enrollment.');
    return row;
  }
  return {
    /** Store only a signed public challenge; the native client still verifies its pinned root. */
    begin(account, value) {
      const body = personEnrollmentBody(value);
      if (body.account !== account) throw new Refused('PERSON_ENROLL_ACCOUNT', 'Sign in to the challenge’s exact account.');
      if (typeof value.signature !== 'string' || !/^[A-Za-z0-9_-]{86}$/u.test(value.signature) ||
          Buffer.from(value.signature, 'base64url').toString('base64url') !== value.signature) {
        throw new Refused('PERSON_ENROLL_AUTH', 'Send a canonical person-root signature with the public challenge.');
      }
      const opened = db();
      if (opened.prepare('SELECT 1 FROM person_enrollment WHERE account=? AND nonce=?').get(account, body.nonce)) {
        throw new Refused('PERSON_ENROLL_REPLAY', 'Use a fresh one-time person challenge.');
      }
      if (body.expires <= now() || body.expires > now() + 600_000) throw new Refused('PERSON_ENROLL_EXPIRED', 'Create a fresh challenge valid for at most ten minutes.');
      if (opened.prepare('SELECT revoked FROM device WHERE account=? AND id=?').get(account, body.device)?.revoked) {
        throw new Refused('PERSON_ENROLL_REVOKED', 'This device was revoked; authenticate a different device.');
      }
      try {
        opened.prepare('INSERT INTO person_enrollment(account,nonce,device,expires,payload) VALUES(?,?,?,?,?)')
          .run(account, body.nonce, body.device, body.expires, JSON.stringify({ ...body, signature: value.signature }));
      } catch (error) {
        if (opened.prepare('SELECT 1 FROM person_enrollment WHERE account=? AND nonce=?').get(account, body.nonce)) {
          throw new Refused('PERSON_ENROLL_REPLAY', 'Use a fresh one-time person challenge.');
        }
        throw error;
      }
      return { recorded: true };
    },
    /** Return opaque bytes only; successful delivery never changes the signed request. */
    read(account, nonce) {
      const row = entry(account, nonce);
      return { enrollment: JSON.parse(row.payload), wraps: row.wrapped ? [JSON.parse(row.wrapped)] : [] };
    },
    /** Atomically spend the nonce and publish one opaque wrap without reviving a revoked device. */
    complete(account, nonce, value) {
      const opened = db();
      opened.exec('BEGIN IMMEDIATE');
      try {
        const row = entry(account, nonce);
        if (row.used) throw new Refused('PERSON_ENROLL_REPLAY', 'This challenge was already consumed; use its existing opaque result.');
        const request = JSON.parse(row.payload);
        if (!request.grants.includes(value.board)) throw new Refused('PERSON_ENROLL_AUTH', 'Wrap only a board named in the authenticated person challenge.');
        const wrapped = { board: value.board, engine: value.engine, wrapped: value.wrapped };
        opened.prepare('INSERT INTO device(account,id) VALUES(?,?) ON CONFLICT(account,id) DO NOTHING').run(account, row.device);
        opened.prepare('INSERT INTO wrapped_key(account,device,board,engine,wrapped) VALUES(?,?,?,?,?) ON CONFLICT(account,device,board) DO UPDATE SET engine=excluded.engine,wrapped=excluded.wrapped')
          .run(account, row.device, value.board, value.engine, value.wrapped);
        opened.prepare('UPDATE person_enrollment SET used=1,wrapped=? WHERE account=? AND nonce=?')
          .run(JSON.stringify(wrapped), account, nonce);
        opened.exec('COMMIT');
        return { recorded: true };
      } catch (error) { opened.exec('ROLLBACK'); throw error; }
    },
  };
}
