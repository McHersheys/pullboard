/** Exact executor identity for gate receipts and landing policy [E27,E28]. */

/** Capture this process on the host that actually executes the command. */
export function executionEnvironment() {
  return { platform: process.platform, arch: process.arch, node: process.versions.node };
}

/** Validate bounded identity without substituting this host for an unknown old receipt. */
export function environmentProblem(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== 3 || !['platform', 'arch', 'node'].every(key => Object.hasOwn(value, key))) return 'needs platform, arch and node';
  if (!['platform', 'arch'].every(key => typeof value[key] === 'string' && /^[a-z0-9_]{1,32}$/u.test(value[key]))) return 'platform and arch are bounded system identifiers';
  if (typeof value.node !== 'string' || value.node.length > 80 || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u.test(value.node)) return 'node names one exact Node version';
  return '';
}

/** Require all three exact fields; unknown historical environments never match by inference. */
export function sameEnvironment(left, right) {
  return !environmentProblem(left) && !environmentProblem(right)
    && ['platform', 'arch', 'node'].every(key => left[key] === right[key]);
}

/** Name an executor when an old verdict differs from its landing host. */
export function environmentLabel(value) {
  return environmentProblem(value) ? 'an unknown environment' : `${value.platform}/${value.arch}, Node ${value.node}`;
}

/** Typed landing fields require the engine that understands their hold and executor semantics. */
export function carriesLandingEnvironment(batch) {
  return ['environment', 'environmentWarnings', 'testDefects'].some(key => Object.hasOwn(batch ?? {}, key))
    || batch?.state === 'test-defect' || Array.isArray(batch?.gateResults) && batch.gateResults.some(gate => Object.hasOwn(gate ?? {}, 'environment'));
}
