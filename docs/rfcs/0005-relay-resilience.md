# RFC 0005: Relay provider failures and offline claim boundaries

- Status: draft; not a change to approved rows or permission to deploy
- Related: [issue #11](https://github.com/pullboard-dev/pullboard/issues/11)
- Rows: H3, H8, H10, H16; H21 remains draft

## Small first increment

Treat GitHub 403 responses with `x-ratelimit-remaining: 0` or an integer
`retry-after` as `GITHUB_UNAVAILABLE`, as for 429. Keep ordinary 401/403/404
refusals unchanged. Return HTTP 503 for this code on the sealed API, matching
the auth API. A failed current permission check still authorizes no remote
write and appends no event. It must not poison the read-permission cache.

This is error classification, not rate-limit prevention or an offline authority
implementation. It does not recognize every headerless secondary-limit response,
propagate a retry deadline, add backoff, or prove a hosted incident's cause.
A follow-up must honor provider reset/Retry-After and use bounded backoff without
turning an unavailable provider into an authorization success.

## Reuse the existing outbox

The current `relay.outbox: true` setting is opt-in and off by default. On an
accepted ordered baseline, transient failures can queue a move, seal its base
and identity before local application, and show it as pending. Replay restores
the base, catches up with the relay, then sends queued moves through the normal
credential, sequence and engine checks. Lost replies are reconciled by move ID
and receipt, not by inventing an ACK or executing the external effect again.
Conflicts can refuse a previously visible local move. See `docs/api.md`,
`docs/formats.md`, `src/relay-outbox.js` and `test/relay-outbox.test.js`.

A queued claim is **provisional**, not a globally won lease. A dependent worker
must not interpret exit 0 alone as exclusive authority to publish or perform an
irreversible external action. Default linked behavior remains H10's refusal.
Changing these promises needs an explicit resolution of H3/H10/H16 and draft
H21, including how existing callers distinguish queued and committed results.

## Offline contract before stronger claims

| Boundary | Required decision or evidence |
| --- | --- |
| Authority | Keep relay ordering with provisional local work, or explicitly opt into one locally authoritative sequencer. Do not claim both independent partitioned writers and global single-winner claims. |
| Fencing | A locally authoritative mode needs a durable board epoch/owner and enforcement at every write ingress, including phones and older clients. A local file lock alone cannot fence another machine. Transfer only after reconciliation; no timeout-based unfenced promotion. |
| Authorization | Bind board/repository immutable IDs, principal, actor, operation scope and authority epoch. No anonymous mutation, forged sender, new seat/token mint, person action or approver decision through an offline fallback. |
| Revocation | State when locally delegated authority expires and what an offline node can know. Recheck current token/access at relay admission. Explicit denial/revocation must not be treated as transport failure. Rejected local work remains visible as a rejection, not silently accepted or discarded. |
| Identity and correlation | Persist the original unique move ID, intent, causal base and dependent item bindings before returning local success. Retain the ID across retry/reseal, correlate the canonical result/refusal, and reject an ID reused for different content. |
| Ordering | Local queue order is not global relay order. Catch up before sequencing each replay; preserve sequence-associated seal/nonces and record conflicts, renumbering and dependent refusals. Never reserve imaginary global sequence slots while disconnected. |
| Durability | Exercise process exits at every queue/apply/restore/send/ACK/prune boundary. Existing write-then-rename code is not evidence of power-loss durability: an explicit no-loss promise needs file and directory sync or an equivalent transactional journal, plus recovery tests. |
| Backlog | Define byte/entry bounds and backpressure before accepting more work. Never evict an unacknowledged move to make room; expose pending age/count/bytes and retained failures without plaintext/credential telemetry. |
| Acknowledgment | Distinguish locally durable intent, provisional application, relay acceptance and engine result. Clear only against a matching durable receipt; reconcile an unknown outcome before resend or destructive cleanup. |
| Side effects | Replaying board intent must not rerun Git publication, checks, messages or other external effects whose earlier outcome is uncertain. Keep their own correlation/receipts and require an authoritative claim where needed. |

The first increment changes none of the outbox's storage, actor, seal, sequence,
revocation, deduplication or ACK code. It is not a certification of that code's
crash or power-loss guarantees.

## GitHub API is not Git synchronization

`createGitHubClient.access()` looks up the App installation, reuses its scoped
installation token, then reads repository metadata and the user's role. Writes
check afresh; reads have a bounded cache. This happens even if no Git objects
need synchronization. `git worktree add` uses local objects, but
`pullboard worktree` then registers a seat through the ordered board path.
Publication and runner-cache seeding have separate Git network operations.

A five-minute fetch/push debounce can reduce **Git transport** traffic, not these
permission requests. It must retain exact publication receipts and must not
reuse a stale role to authorize a write. Measure sanitized request counts/status,
rate-limit resource/reset and request IDs at the relay before attributing load;
a different client's current allowance cannot establish the hosted App's past
budget. Do not stress GitHub to reproduce an outage.

## Qualification still required

The draft patch adds these real-loopback regressions, not a mocked success path:

```sh
node --test test/relay-provider-outage.test.js
node --test --test-name-pattern='an opted-in outbox retains a move through a GitHub' test/relay-outbox.test.js
```

They cover header-evidenced primary/secondary limits and denial controls at
installation/metadata/permission endpoints; public-role fallback; fail-closed
HTTP 503 with no appended move; read-cache recovery versus genuine denial; and
stable queued identity followed by one replay after provider recovery.
**These tests have not been run for this draft.** There is no red/green result
or full gate claim. Run the tests against both unchanged main and the patch in
an admitted isolated environment before merge, then run the applicable existing
auth/revocation, lost-ACK, conflict, outbox and default-offline regressions.

Stronger offline claims additionally need two-partition conflicting-claim tests,
credential expiry/revocation during replay, exact crash cuts, disk-full and
backlog limits, and an independent consumer test that never starts irreversible
work from a provisional claim. Those are open gates, not tests this patch claims
to implement or pass. Self-hosting the MIT-licensed `relay/` service gives
operational control; its current GitHub App permission dependency remains.
