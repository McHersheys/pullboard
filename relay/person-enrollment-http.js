/** Isolated transport for person-signed enrollment; legacy pairing routes keep their meaning [H15]. */
import { apiJson, readApiBody } from '../src/api-http.js';
import { Refused } from '../src/refused.js';
import { personEnrollmentBody } from '../src/person-enrollment.js';

/** Deliver only within the authenticated account and its currently authorized boards. */
export async function handlePersonEnrollment(req, res, { pathname, who, devices, authorizeBoard }) {
  const route = /^\/api\/v1\/devices\/person-enrollments\/([A-Za-z0-9_-]{43})$/u.exec(pathname);
  if (!route) return false;
  if (who.kind !== 'session') throw new Refused('HUMAN_REQUIRED', 'Use an authenticated person session for account enrollment.');
  const account = who.user.id;
  const nonce = route[1];
  if (req.method === 'POST') {
    const value = await readApiBody(req, { maxBytes: 8192 });
    const body = personEnrollmentBody(value);
    if (body.account !== account) throw new Refused('PERSON_ENROLL_ACCOUNT', 'Sign in to the challenge’s exact account.');
    if (body.nonce !== nonce) throw new Refused('PERSON_ENROLL_AUTH', 'Use the exact signed nonce in the enrollment address.');
    for (const board of body.grants) await authorizeBoard(req, board);
    apiJson(res, 200, devices.person.begin(account, value));
  } else if (req.method === 'GET') {
    const result = devices.person.read(account, nonce);
    for (const board of result.enrollment.grants) await authorizeBoard(req, board);
    apiJson(res, 200, result);
  } else if (req.method === 'PUT') {
    const body = await readApiBody(req, { maxBytes: 8192 });
    if (!body || Object.keys(body).sort().join(',') !== 'board,engine,wrapped' || !/^[0-9a-f]{32}$/u.test(body.board ?? '') ||
        !Number.isSafeInteger(body.engine) || body.engine < 1 || typeof body.wrapped !== 'string' ||
        !/^[A-Za-z0-9_-]{1,6000}$/u.test(body.wrapped) || Buffer.from(body.wrapped, 'base64url').toString('base64url') !== body.wrapped) {
      throw new Refused('DEVICE_WRAP', 'Send only a versioned opaque wrap and its exact board binding.');
    }
    await authorizeBoard(req, body.board);
    apiJson(res, 200, devices.person.complete(account, nonce, body));
  } else throw new Refused('NO_ENDPOINT', 'Use the documented person-enrollment action.');
  return true;
}
