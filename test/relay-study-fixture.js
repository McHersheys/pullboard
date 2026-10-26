/** Shared authenticated readers for the measured private relay study [H5,H17]. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { ENGINE_VERSION } from '../src/machine.js';
import { decodeBoardKey } from '../src/seal.js';
import { openPagedSnapshot } from '../src/relay-page-layout.js';

/** Compare every JSON field, retaining paths but never printing board contents or credentials. */
export function differences(left, right, path = '$', found = []) {
  if (Object.is(left, right)) return found;
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object'
      || Array.isArray(left) !== Array.isArray(right)) {
    found.push(path);
    return found;
  }
  for (const name of new Set([...Object.keys(left), ...Object.keys(right)])) {
    const next = path + '[' + JSON.stringify(name) + ']';
    if (!Object.hasOwn(left, name) || !Object.hasOwn(right, name)) found.push(next);
    else differences(left[name], right[name], next, found);
  }
  return found;
}

/** Read the actual private API2 root and ciphertext pages through the production decoder. */
export async function readRelay(box) {
  const state = JSON.parse(readFileSync(box.linkFile, 'utf8'));
  const headers = { authorization: 'Bearer ' + state.token, 'x-pullboard-engine': String(ENGINE_VERSION) };
  let requests = 0, receivedBytes = 0;
  /** Count actual HTTP response bytes before decoding their JSON, without logging secrets. */
  async function request(path) {
    const response = await fetch(box.origin + path, { headers });
    const bytes = Buffer.from(await response.arrayBuffer());
    requests++; receivedBytes += bytes.byteLength;
    assert.equal(response.status, 200, 'the private relay accepted its authenticated read');
    return JSON.parse(bytes.toString('utf8'));
  }
  const started = performance.now();
  const response = await request('/api/v2/boards/' + state.board + '/state');
  const saved = response.state;
  assert.equal(response.apiVersion, 2);
  assert.equal(saved.apiVersion, 2, 'measure the current paged protocol');
  const page = await openPagedSnapshot(saved.root, {
    key: decodeBoardKey(readFileSync(box.keyFile, 'utf8').trim()), boardId: state.board, sequence: saved.sequence,
    /** Follow only the server-pinned opaque page graph, exactly as the production reader does. */
    async get(id, parents) {
      const result = await request('/api/v2/boards/' + state.board + '/objects/' + id
        + '?pin=' + encodeURIComponent(saved.read.id) + '&via=' + parents.join(','));
      assert.equal(result.apiVersion, 2);
      assert.equal(result.page.id, id);
      return Buffer.from(result.page.sealed, 'base64url');
    },
  }, { maxEngine: ENGINE_VERSION });
  const document = await page.native();
  return { document, requests, receivedBytes, readMs: performance.now() - started };
}

