/**
 * Test-only preload (#408): lets the CLI under test read its person authority from a loopback fixture relay, which
 * has no TLS. Only bin/run-tests.js adds it, to each test file's NODE_OPTIONS; it is never in the published package,
 * and without it the CLI reads a first pin only from the built-in relay origin over TLS.
 */
globalThis[Symbol.for('pullboard.personAuthorityFixtureOrigin')] = (origin) => /^http:\/\/(?:127\.0\.0\.1|localhost|\[::1\]):\d{1,5}$/u.test(origin);
