# File formats

This page describes the text files people edit and the SQLite board kept inside `.git`. The row parser is in `src/spec.js`; board declarations and migrations are in `src/board.js`; lifecycle guards are generated from `src/machine.js`.

## SPEC.md and DOCTRINE.md

Doctrine means the house rules for agentic development. New repos use `DOCTRINE.md`; existing `PRACTICE.md` files keep working. Rename a tracked legacy file with `git mv -- PRACTICE.md DOCTRINE.md`; for an untracked file, use `mv -- PRACTICE.md DOCTRINE.md`. Keeping both names is refused because they define the same repo doctrine. The configuration and API retain their `practice` field names; an explicitly configured custom path still works.

Both files use the shared row grammar in `src/spec.js`, whose version is `SPEC_GRAMMAR_VERSION`. Either file may declare the current version on its own line as `<!-- pullboard-grammar N -->`; without a marker, the file uses the current grammar. A marker inside a fenced code example is ignored. The parser accepts only the version it reads and refuses a mismatched or invalid marker with `A5_GRAMMAR_VERSION`; upgrade Pullboard or use a file written for its grammar. Pullboard does not rewrite these files during an upgrade.

A section begins with `## `; a row must be beneath a section and occupies one line:

```text
- ID [status[, tier]] requirement text | gate: <command> | serves: <ID, ID> | signers: <principal, principal>
```

The identifier expression, statuses and tiers below come from the parser:

<!-- id-pattern:start -->
| Identifier | Parser expression |
| --- | --- |
| `ID` | `^[A-Za-z]+\d+(?:\.\d+)*$` |
<!-- id-pattern:end -->

<!-- statuses:start -->
| Status | Meaning |
| --- | --- |
| `approved` | decided and in force |
| `draft` | proposed, not decided |
| `pending` | open question |
| `fact` | true today |
| `wont` | not building; the row stays permanent |
| `retired` | no longer in force; the row stays permanent |
<!-- statuses:end -->

<!-- tiers:start -->
| Tier | Meaning |
| --- | --- |
| `must` | An approved must row names a gate. Other statuses may omit it. |
| `aim` | An aim; no gate is required. |
<!-- tiers:end -->

After the requirement text, `gate:` names the check, `serves:` names comma-separated ids, and `signers:` names comma-separated SSH principals; each field may be omitted. Each signer is one unique principal with no spaces, commas or leading `#`; the list names the exact principals required for signed sign-offs. An approved row is met only when every listed principal has a verified SSH receipt for its current text; missing, stale or unverified receipts leave it unmet. A row may also carry `source:`, the reference a blueprint rule came from, written as its name, then its id and address when it has them (`| source: Example Framework OPS 8 https://example.com/ops-8`). The parsed row gains a `source` string only when the field is written, so a row without one parses exactly as before; an empty `source:` is an error. `spec show` prints the source and `spec --json` rows carry it. Other trailing keys are recorded as unknown and rejected by `spec check`. A malformed row-like line is an error, and rows inside fenced code blocks are examples rather than input. IDs are permanent: mark a cut row `wont` or `retired` instead of deleting it.

The row object returned by `parseSpec` has these fields:

### ID namespaces and collisions

A bare id names a row in `SPEC.md`. A doctrine row is cited as `doctrine:<id>` in item spec ids and commit headers, even when a row with the same bare id exists in `SPEC.md`. `spec check` compares the current rows in `SPEC.md` and `DOCTRINE.md` (or a legacy `PRACTICE.md`), and rows within either file. Collisions already present in the primary checkout's attached branch are reported as known warnings; adding a colliding row is an error that names both file paths and line numbers. A detached primary checkout cannot establish this baseline. A commit that cites a bare id shared with a doctrine row warns that the bare id resolves to `SPEC.md`; use the `doctrine:` prefix to cite the doctrine row.

`parseSpec` also returns `grammarVersion`, equal to `SPEC_GRAMMAR_VERSION` after the file's marker has been checked.

<!-- parser-fields:start -->
| Parsed field | Meaning |
| --- | --- |
| `id` | Stable row identifier. |
| `status` | One token from the status list. |
| `tier` | Optional second token: must or aim. |
| `text` | Requirement text before trailing fields. |
| `gate` | Check named by gate, or an empty string. |
| `serves` | Comma-separated ids named by serves, or an empty list. |
| `signers` | Comma-separated SSH principals named by signers, or an empty list. |
| `unknown` | Unrecognized trailing fields; spec check reports them. |
| `section` | Containing ## heading. |
| `line` | 1-based source line. |
<!-- parser-fields:end -->

### Blueprint rule sources

A blueprint is one JSON file (format 1, described at the top of `src/blueprints.js`). Its `kind` is `product`, `architecture`, `practice` or `beyond-code`; a file that says `infrastructure`, the old name, loads as `architecture`. A rule may carry `source: { name, id, url }`: `name` is required, `id` and `url` are optional, each is one line without `|`, and `url` is an `http` or `https` address. `pullboard blueprint add` and `init --blueprint` copy it onto the drafted row's `source:` field; the row's text stays the rule and its reason. Every rule of an architecture blueprint names its source, since it paraphrases a known-good reference: a rule without one refuses the blueprint with `BLUEPRINT_NO_SOURCE`, naming the blueprint and the rule, when it is loaded or saved.
## Proposed rulings and resume doctrine notes

The coordinator proposes a standing ruling with `pullboard spec draft "<rule>" --doctrine --source "chat, 2026-10-16"` (or a shout reference such as `"shout 42"`). A source is required. The draft lives in the configured doctrine file, with `Source: ...` in its text, and the returned id is qualified as `doctrine:DR1`. The person approves or declines that id through the existing `spec approve` or `spec decline` commands; the coordinator runs `spec apply`.

`resume --json` includes `doctrineNotes`, an array of newly seen approved repo rules, each with `id`, `text` and `gate`. Drafts and pending applications are excluded. Text resume prints the same rules. Each checkout records its own displayed rule text under its Git directory, so a second checkout receives its own notice. Repeated resumes return an empty array until an approved rule changes.

Resume and criterion freezing use the primary branch's committed doctrine together with the person's applied exact-row decisions. An older agent checkout can therefore read an approved ruling and detect that a frozen citation is stale without changing its branch or local doctrine file. Proposed or unapplied changes do not replace the in-force rule.

## Resume release notes

<!-- resume-release-notes:start -->
`pullboard resume --json` adds a `whatsNew` field to its version-1 envelope. `whatsNew` is `null` when nothing is new. After an upgrade it contains the released versions newer than this checkout last ran, newest first:

```json
{
  "whatsNew": {
    "releases": [
      {
        "version": "0.8.7",
        "headline": "A new session",
        "paragraph": "Release headline paragraph."
      }
    ],
    "omitted": 0,
    "notes": "CHANGELOG.md"
  }
}
```

Each `releases` entry has a version number, the release headline from its `###` heading in `CHANGELOG.md`, and that heading's paragraph. Added, Changed and Fixed lists are excluded. Only the newest three releases are included; `omitted` counts the earlier releases left out, and `notes` names the full release notes.

Both text and JSON resumes record the displayed version once per checkout. Later resumes at the same version have no extra text and a null `whatsNew` field. A checkout's first run records its version quietly. The record is `pullboard-checkout/resume-version` in the checkout's Git directory, outside the shared board; linked worktrees keep separate records. JSON resume includes the notes in its response when recording that version, so a JSON call does not consume notes without exposing them.
<!-- resume-release-notes:end -->

## SQLite board schema

The board file is in the repository's Git common directory at `.git/pullboard/board.sqlite`. File-backed connections use WAL mode, so `board.sqlite-wal` and `board.sqlite-shm` can sit beside it while connections are open. SQLite `PRAGMA user_version` records the board schema version; it also marks whether trigger repairs are reported in the event log. Schema objects are created from `src/board.js` when a board opens.

<!-- format-versions:start -->
| Format | Version | Version source | Upgrade rule |
| --- | --- | --- | --- |
| `CLI JSON envelope` | `1` | `JSON_SHAPES.version` in `src/json.js` | Keep optional fields additive within version 1; bump the envelope version for incompatible command/export shapes. |
| `row grammar` | `1` | `SPEC_GRAMMAR_VERSION` in `src/spec.js`; optional `<!-- pullboard-grammar N -->` line in either file (absence means the current grammar) | Both files share the version. A declared version must match; an incompatible grammar change requires a coordinated version bump and compatible files. No automatic conversion occurs. |
| `board schema` | `3` | `SCHEMA_VERSION` in `src/board.js`, persisted as `PRAGMA user_version` | On a write open of a board whose version is behind: create missing tables and indexes (version 3 adds the hot-path indexes), add missing columns in place with declared defaults, restore missing or changed triggers, and remove stale machine triggers without replacing rows. Read opens never migrate; a board at the current version whose shape differs is reported once on stderr and left as it is. |
| `event log` | `1` | `EVENT_LOG_VERSION` in `src/board.js`, persisted in `board_meta` as `event_log_version` | Older event-log versions upgrade in place; newer versions are refused with `EVENT_LOG_VERSION`. Preserve event rows when the board schema changes. |
| `move engine` | `85` | `ENGINE_VERSION` in `src/machine.js`, carried as `engine` in every sealed executable move | Bump when a move's meaning changes, independently of the event log and sealed envelope. A newer engine is refused with `ENGINE_VERSION`, naming both versions and asking you to upgrade Pullboard. |
<!-- format-versions:end -->

Relay transport capability `apiVersion: 2` is independent of these versions and
of the unchanged `version: 1` HTTP envelope and seal envelope. API2 uses
`pullboard-paged-snapshot/1` inside encrypted directory pages, with a current-state
presentation below 900,000 bytes, full current fields, native tables and keyed
item/shout history references. Each sealed object is content-addressed by the
SHA-256 of its ciphertext; plaintext blocks are at most 262,144 bytes, ciphertext
at most 400,000 bytes and descriptor fanout at most 64. Devices validate bounds,
board/sequence binding, range counts, ancestry and the complete restored native
shape. The relay validates only the opaque graph. Its journal format 4 migrates
formats 2 and 3 in place and stores pages in the same SQLite backup as the
current root. Old API1 clients explicitly refuse an API2 head with upgrade
guidance. A private device-only page cache stores no board key or plaintext
record; its fingerprints and hashed session-notice receipts never cross HTTP.
See [the operator protocol](../relay/README.md#paged-snapshots-and-account-storage).


Pullboard 0.6.1 released engine 1. Engine 2 records a fresh explicit-build claim's skipped-review snapshot. Pullboard 0.8.1 released engine 3, including lane-sensitive graft refusals and authenticated relay senders. Engine 4 adds captured background-baseline completions through `completeCheckBaseline`; released engine-3 clients stop with `ENGINE_VERSION` before interpreting this new operation or advancing their replay cursor. Engine 5 requires a one-line reason when releasing a review and gives that reviewer a one-hour cooldown for the current submission. Each sealed move replays under its recorded engine version: engines 1 through 4 retain the original release event and review-reservation behavior. Engine 5 retains support for older moves, including engine-4 baseline completions. Pullboard 0.8.3 released engine 6, adding board-scoped machine credentials and permitting machine execution only for one exact, earlier authenticated phone request, including its payload digest. Engine 7 adds ordered item holds through `holdItem` and `releaseItemHold`; engine-6 clients stop with `ENGINE_VERSION` before interpreting either operation or advancing their replay cursor. Engine 8, shared by the 0.8.5 move changes, retains merged-item exception notes, selects the next review in roadmap order, and adds coordinator-only `reopen` for a submission returned without a verdict; engine-7 clients stop with `ENGINE_VERSION` before interpreting this new operation or advancing their replay cursor. Recorded engines 1 through 7 retain their original tier-first review selection. Engine 8 also adds durable refusal recovery for blocked relay positions; each explicit skip publishes the readable prefix even when another unsupported record follows. Engine 8 also permits coordinator criterion/check edits on a live claim as pending corrections; the holder cannot renew or submit until a refreeze adopts the correction while preserving the claim. Older request receipts retain their recorded engine semantics. Upgrade every linked device before using the new moves. Each release shares one engine bump across its changed moves. Engine 8 also retains declared model labels on registration and records each registered agent move's model snapshot; engines 1 through 7 retain their original registration and event details without these model fields. Pullboard 0.8.8 released engine 9, which allows resubmitting the same rejected commit after a corrected criterion is refrozen, but only when the rejection names a different frozen digest. Engine 8 retains its HEAD_NOT_NEW refusal and prior submit-event detail. Engine-9 submit events add `criterionDigest`, and engine-8 boards replay with the original refusal and event history.

Engine 10 adds coordinator-only reopening for an unmerged verified item after a red landing candidate. Its append-only `reopen` event names the superseded accept, failing test and landing merge commit; the original accept and verdict remain in history. Engines 8 and 9 retain their submitted-only `reopen` behavior: a verified-item reopen is refused without changing the replayed board. Only engine 10 may return a verified item to open, with a failing test and landing merge commit in the note. Dependency edits also require engine 10: an `editItem` move with `after`, including `after: []` to clear dependencies, cannot be replayed under an older engine. Ordinary edits without `after` retain their historical behavior. Older clients refuse an engine-10 move before changing their board or replay cursor; upgrade Pullboard before sending or applying dependency edits.

Engine 11 permits resubmitting the same commit after a coordinator no-verdict reopen only after the frozen bar is explicitly refrozen, or an edit clears the frozen bar and a new claim freezes it again. Reopening without a later bar change still refuses the same commit, and a rejection at the current frozen digest continues to require new work. This rule does not apply to a verified-item red-landing reopen. Engine 10 retains its earlier same-commit refusal for no-verdict reopens.

Engine 12 records declined person row decisions without replacing the exact source text: the row becomes `wont` and the reason stays in the decision record. Engine-11 decline receipts retain their original reason-as-row-text validation and replay outcome. Engine-11 clients refuse engine-12 moves before interpreting them; upgrade linked clients before recording new decline decisions.

Engine 19 makes a corrected bar record why the old one was wrong. Once an item has ever been claimed, an `editItem` that changes its criterion or check must carry `reason`, the text of what the old bar got wrong; without one it is refused with `BAR_REASON`, naming `--reason`. The edit event then records `reason` and `barCorrection: {fields, reject}`: `fields` lists `criterion` and/or `check`, and `reject` is `{verdict, by, reason, at}` when the item's newest verdict is a reject no earlier correction already explained, or `null`. That reject is counted as caused by the bar. The board derives `barCorrection` from its own rows; a move supplies only `reason`. An edit before any claim needs no reason and records one only if given. `pullboard stats` JSON adds `bars`, keyed by agent: `{corrections, barRejects, buildRejects}`. Corrections and the rejects they explain count to the agent who corrected the bar; any other reject counts as the build's, to the agent who added the item. An `editItem` move carrying `reason` requires engine 19, and older engines refuse it with `RELAY_MOVE` before changing their board or cursor. Moves recorded under engines 18 and earlier replay without the reason rule. Trunk skipped engine numbers 13 through 18. A later engine change takes the current trunk's next number, keeping every earlier recorded engine's replay unchanged.

Engine 33 binds a review to the immutable submitted commit, the exact checked composition, its reviewed trunk and sorted candidate paths. A stale, unmerged acceptance can be re-reviewed without rewriting the submission; landing uses its accepted checked composition. New review metadata and landing batches carrying `reviewedCommit` require engine 33, including later updates to those batches. Previously recorded outcomes replay before this state-dependent version check, and previously released engines retain their original review and landing behavior. Older clients refuse engine-33 moves before changing their board or replay cursor; upgrade linked clients before using checked-composition reviews. The coordinator assigned engine 33 to this change. Merge the actual trunk before landing.

Engine 20 lets a decision name the items it changes. An `appendFact`, `answerDecision` or `verify` move may carry `implies`, a list of existing item ids, and an `answerDecision` move may carry `supersedes`, the shout id of an earlier answer. Either makes the move an engine-20 move: an older engine refuses it with `RELAY_MOVE` before changing its board or cursor, and a board replaying an older engine refuses `implies` with `ENGINE_VERSION`. Engine 20 also tells implied items when a decision is superseded: by a fact's `supersedes`, by an answer's `supersedes`, or by the next verdict on the same item. Moves recorded under engines 19 and earlier replay without these notices. Engine numbers 13 to 18 are allocated to other changes; whichever lands later renumbers, keeping every earlier engine's replay unchanged.

Engine 24 adds the person's `acceptCheck`: an item's current check, named by its SHA-256 digest, accepted so a check already green on main no longer holds the item on a board whose `checks.provesNothing` is `"hold"`. Only the person may send it, from the terminal or the view; the relay refuses it from an agent or a machine. A move from an older engine is refused before it changes the board or replay cursor, and older clients refuse engine-24 moves before interpreting them. Engines 21 through 23 are allocated to other changes.

Engine 30 lets a reject and a reopen carry a cause key (`cause`: `test:<file>::<title>`, `refusal:<CODE>`, `row:<id>` or `doctrine:<id>`) and lets the person record a never-again fact with `cause` and `neverAgain: true`, for `pullboard rigor`. Only a move that carries one of these needs engine 30; engine-29 and older moves replay unchanged, and clients on an older engine refuse an engine-30 move with `RELAY_MOVE` before changing their board or cursor. Engine 20 is the implied-items engine above; engine numbers 21 through 29 are allocated to other changes.

Engine 48 records on each new seat the seat that created it (`createdBy`: an agent id, or `machine` for a join no seat made), lets a creator name the new seat (`id`), and applies verifier standing to relay-replayed verdicts, review reservations and offers on a linked board: the verifier's line of creating seats must reach the coordinator through seats enrolled by the relay, without the builder or a machine join. Replicas apply a register move by another seat only with the relay's receipt for its target, creator, position and digest. The relay stamps every record it stores with `policy: 48`; a stamped move below engine 48 is refused. Engine-12 and older moves, and unstamped records, replay as they did. On an unlinked board who may verify is unchanged.

Engine 38 records submission test selections and normalized landing evidence. A `submit` carrying `submissionProof` or a `recordLandingBatch` carrying `invariantEvidence` requires engine 38; earlier engines refuse these envelopes before applying them, and a missing or malformed proof is refused with `SUBMISSION_PROOF` on a modern submit before its item or events change. Moves recorded under engines 37 and earlier replay without inferred coverage. Recorded invariant evidence is append-only when a landing batch is adopted; adopting or finishing a batch already carrying that evidence requires engine 38, even when the incoming move omits the evidence field. Engine slots 25 through 37 are allocated to earlier train changes; preserve their semantics when composing this item.

Engine 45 gives a milestone a target and a shipment. An `editMilestone` move may carry `target`, an ISO date or date-time with an explicit zone (the CLI and `prepareEngineMove` turn a typed local time into UTC before the move is sealed, so every replica stores the same instant; a bare local time in an envelope is refused with `MILESTONE_TARGET`), or `none` to clear it. A `shipMilestone` move records the milestone as shipped at main's commit and moves every local item that has not landed and is not withdrawn into the next unshipped milestone, or `--next`, writing a `milestone_moved` event on each moved item; repo-qualified references stay in place and are listed as not moved across boards. A shipped milestone refuses new items with `MILESTONE_SHIPPED`. Either makes the move an engine-45 move, and an older engine refuses it with `RELAY_MOVE` before changing its board or cursor. The coordinator assigned engine 45 to this milestone feature; each other feature retains its separately allocated engine minimum. Engine 30 carries the cause-key behavior above; engine 33 retains the checked-review behavior described above.

Engine 50 automatically advances a rejected item one route after two REJECT verdicts on the current route. A release is not a rejection; a manual escalation or an actual route edit starts a new count. The existing escalation event records both rejection receipts. The strong route remains the ceiling. Moves below engine 50 retain their earlier behavior and do not automatically escalate. Upgrade linked boards before using automatic rejection escalation.

Engine 51 writes #649's withdraw-and-remove milestone behavior. A withdraw move is followed by one ordered `editMilestoneItems` removal for each local milestone that lists the item; previous withdraw records retain their original replay, and an older client refuses the new engine before applying any move. `WITHDRAW_MILESTONE_ENGINE` is 51; `MILESTONE_SHIP_ENGINE` remains 45, so milestone targets and shipment keep their engine-45 meaning. The roadmap projects remaining-to-ship work before verified items and omits withdrawn items from its list and total while reporting them separately.

Engine 42 adds ordered `recordHealthFindings` observations. A scan retains its board event revision, emits new and resolved sentinel notices once, and records `health-failure` receipts under their refusal cause keys. Rigor counts repeated health episodes without inventing a changed code commit. Older engines refuse this operation before replay; earlier move meanings and feature minima stay unchanged.

Engine 52 reopens an accepted item that conflicts with the trunk for a main merge. A `reopen` move may carry `conflict: {files, trunk}`: the files that conflict, and the full trunk commit they conflict with. The CLI takes one exact path per `--conflict <file>` flag and splits or trims nothing inside it, so a path with spaces or commas is named as Git reports it in `git merge-tree --write-tree --name-only -z`; `files` holds those exact paths, nonempty and without NUL. The CLI fills `trunk` from Git and refuses `NOT_CONFLICTING` when the accepted commit merges cleanly, or `CONFLICT_FILES` when a named file is not one Git reports as conflicting. The board refuses `NOT_ACCEPTED` unless the item is verified with an accept at its commit, and `BAD_CONFLICT` for a malformed conflict. A conflict needs no note and no landing failure; the event records `supersedes`, the accept it sets aside, `conflict`, and `cause: "refusal:MERGE_CONFLICT"`, never `landingFailure`, so rigor counts it as a merge conflict and never as a failing test. The item reads `needs main merge` until its next verdict, and the re-review checks the frozen check at the new head. A `reopen` move carrying `conflict` requires engine 52, and older engines refuse it with `RELAY_MOVE` before changing their board or cursor; a board replaying an older engine refuses it with `ENGINE_VERSION`. Moves recorded under engines 51 and earlier replay unchanged. The unlanded feature’s previous allocations were 36 and 47; it moved to 52 after the trunk reached engine 50 and milestone withdrawal was allocated engine 51, preserving every landed feature’s engine.

Engine 55 (`ROW_DRAFT_ENGINE`) adds `draftSpecRow`: an agent in a lane worktree records a drafted spec row on the board, since SPEC.md is the coordinator's file and a lane cannot write it. The move carries `row: {id, text, gate, tier, section, target}` and `written`. Every writer of a new row reserves its id with this move, in one write transaction, before any file names the id: a lane's spec draft, the main checkout's spec draft and doctrine rulings, Rigor and blueprints. The sender plans the id from its files; the board takes that id or the next number after it that no draft holds, so writers that planned the same id at the same moment get distinct ids, and the same row again keeps the id it reserved. `written: true` marks a writer that puts the row in its own file now; only unwritten spec drafts, which come from lanes, are written by spec apply. Until spec apply writes it, the commit-msg hook and `spec check` read a board draft as a draft row, so a lane cites the returned id at once and its worktree stays clean. The coordinator's `spec apply` writes each pending board draft into SPEC.md at its own id, and the person approves it there as before; a draft counts as applied once SPEC.md has its id. A move carrying `draftSpecRow` requires engine 55, and older engines refuse it before changing their board or cursor. Engine 54 is the strong-rejection notice above; engine 53 was reserved for unshipped board watches, now allocated engine 56 because engines 54 and 55 shipped first.

Engine 56 (`BOARD_SENTINEL_ENGINE`) adds board-owned watch proposals, exact person approve/decline decisions, ordered due-run claims and completed run receipts. Approval binds the entire execution definition; changing it creates a pending proposal. Replay records history without executing commands. Every non-cancelled red run records `sentinel:<name>` for Rigor; feed notices only mark failure and recovery transitions. Older engines refuse these operations and this new cause form before replay. Published engine-55 readers reject these moves by their newer engine number before interpreting an operation.

The board's committed `flakes.rerun` setting defaults off. Off retains released execution, including landing's whole-file diagnosis and first legacy `landing_flake`; the new ledger still records the original failure. On permits one exact-target diagnostic for a supported structured Node test at unchanged source, never green-by-retry. Built-in `node --test` is supported; a `bin/run-tests.js` script is recognized only when its committed bytes on candidate and pinned main match the bundled Native runner. Its filename alone does not establish selector support, and a probe that executes other targets remains unclassified. A pinned green main marks a possible regression, not a flake. Unknown selectors, source changes or unsupported remote execution evidence remain unclassified; no local substitute is run for a remote admission. A confirmed second sighting drafts an ordinary strong repair item, not an approved spec or doctrine row. A landed repair reads fixed until another sighting. Enabled landing consumes its captured pair without another legacy diagnosis or first-sighting legacy defect; saved typed relationships prevent remeasurement on adoption. Diagnostic-recording failures are reported while the original red and completed evidence remain retained. Older engines refuse the new operation and typed landing relationships before changing rows or the replay cursor; legacy `landing_flake` meaning and the schema/event-log versions are unchanged.

The board's committed `rigor.budget` setting is the number of lines of non-test code one change may add, net, before `pullboard rigor quality` names it under its size-budget rule; it defaults to 400, and `--budget` overrides it for one run.

Engine 60 (`SUBMITTED_CONFLICT_ENGINE`) lets a conflict reopen return a submitted head, not only an accepted one, and lets any joined seat record it. Before it offers a review, `pullboard next --verify` merges every submitted head onto the trunk in memory, as landing does; a head that conflicts goes back to its builder, open and unreviewed, with Git's conflicting files and the trunk commit, and its builder is told which files and that the one step back is to claim it, merge main and submit again. The reopen sets no accept aside and records no verdict; its next review is a whole one. A hand-written `--conflict` on a submission, which names no trunk commit, is still refused. Engines 57 to 59 are allocated to other changes; older engines refuse this move before replay.

Engine 61 (`NATIVE_FLAKE_ENGINE`) adds `recordFlakeObservation` and typed diagnostic relationships in landing-batch receipts. A registered reporting agent supplies a bounded observation: stable id, relative test file/name (or null when unknown), pinned head/tree/main, gate kind, classification, observation time, machine-load sample, diagnostic duration, command digest, and original/paired/main receipt references. A receipt contains its result, byte count, SHA-256 and optional profile digest; full raw output and profiles stay under the common Git directory's `pullboard/flake-evidence/<id>/`, outside board events. Those local artifacts are not automatically copied to another device by a board snapshot. A duplicate observation id returns the original receipt; different evidence under that id is refused. The original red remains authoritative.

Engine 62 (`HEALTH_CAP_ENGINE`; engine 61 is #887's) caps what one recorded health run shouts. A run sends at most ten notices one by one, resolved first; when it has more, one more notice to the coordinator says how many it held back, and every finding still records its own health event. An idle seat alone hears that it is idle. A recorded run at an older engine replays with its original notices.

Engine 63 (`RECURRING_JOB_ENGINE`) records recurring jobs. `declareJob` is the coordinator's or the person's: it stores a job's name, its cadence (`10m`, `2h`, `1d`, `hourly` or `daily`) and its owner, and a later declaration replaces the cadence and owner but keeps the run history. `recordJobRun` is any joined seat's and stores the job's name. Both events carry `engine: 63`. `pullboard health` reports a job with no run within one and a half cadences as `JOB_MISSED`, once per episode. An older engine refuses both moves with `ENGINE_VERSION`, and a replay at an older engine ignores their events.

Engine 64 (`LOCAL_LANDING_ENGINE`) lets a landing batch reach the state `trunk`: merged onto the local trunk after its quick guards (the static checks and submit invariants), with each item's merged receipt recorded before anything is pushed. Only a board whose `pullboard.json` sets `landing: { "publish": "separate" }` lands this way; `pullboard publish` then runs the whole suite on the exact trunk head and pushes only a green head. A batch recorded at an older engine still needs `pushed` before its receipts.

Engine 65 (`CI_FLAKE_ENGINE`) records flake observations imported from CI with `pullboard flakes import <folder>`. Such an observation has kind `ci`, a `ci` record (provider, run id, the failed attempt and its rerun attempt, job, runner and Node version) and a `load` of null, because a hosted runner reports no host load. A failed attempt whose rerun at the same commit passes the test is a flake; one whose TAP names no test by file stays unclassified. Observations of the other kinds replay as at engine 61.

Engine 66 (`REOPEN_FIRST_REFUSAL_ENGINE`) holds a reopened item for its builder. With `claim.reopenFirstRefusalMinutes` above zero, a reject, a landing failure or a trunk conflict records when the item came back, and for that many minutes only its builder may claim it; another seat's claim is refused with `REOPEN_HELD_FOR_BUILDER`. Older engines replay those moves without the window.

Engine 67 (`GATE_RUN_ENGINE`) records gate runs and the flake quarantine they prove. The gate writes a receipt for each real run of the accepted gate command on a clean, committed tree, under the common git directory at `pullboard/gate-receipts/<id>.json`: its id, kind (`gate`, `submit` or `land`), tree, head, accepted main, the command's SHA-256, its result, the committed file and name of each test that failed, the host load and the time. The writer is private to the gate and takes the result from the process it just ran; a run of any other command, or one whose checkout was dirty or moved, leaves no receipt. The coordinator's gate runs, from the main checkout and the landing, go on the board as `recordGateRun`; a seat's run keeps only its receipt. `recordGateRun` carries that receipt, and both a direct call and a sealed move are refused (`GATE_RUN_UNBOUND`) unless the store beside the board holds the same receipt byte for byte, so a run made up by hand is never recorded. A replayed move is applied as its origin checked it. When the coordinator's runs have found one tree both red and green for the same test, the board files one ordinary repair item for that test, with the runs as evidence, and records a `test-quarantine` event; a run any other seat recorded proves nothing. Quarantine itself is the coordinator's `flakes.quarantine` setting in pullboard.json, read from accepted main and off by default: with it off, runs and the repair item are still recorded, but nothing stops blocking a landing. With it on, a quarantined test still runs and reports, but a landing treats it as covered, like a waiver naming that file and test, as long as every run that proved it is a receipt on the landing machine and its repair item is not verified or withdrawn; it then blocks again, and only a newer red-and-green proof files a new item. A different red in the same run is never covered. An older engine refuses the move with `ENGINE_VERSION`.

The relay outbox (#922, opt in with `relay.outbox`) lives beside `relay.json` as `relay-outbox.sealed`, mode 0600, sealed with the board key under the `outbox` seal kind at sequence 0. Inside is gzip JSON `{version: 1, base, baseSequence, restored, moves}`: `base` is the native board image as the relay last ordered it, at `baseSequence`, and each move is `{move, intent, queuedAt, after}` with the prepared engine move and the relay sequence this machine had seen. `relay.json` keeps only a key-free `outbox` summary and the last twenty `outboxRefusals`. A replay restores `base` (keeping each seat's newer shout-read position), catches up, then sends each move at the next sequence; if the relay fails part way, the board is sealed again as the relay has now ordered it and the remaining moves are applied on top. The outbox adds no engine version: every move still replays through the relay's order.

Engine 69 (`REVIEW_SKIP_ENGINE`) lets `reserveNextReview` carry `skipIds`: the submitted items the reviewer's own agent session built, which `pullboard next --verify` never offers it. A move with a non-empty `skipIds` needs engine 69, so an older reader refuses it instead of reserving a different item; moves without `skipIds`, and every move recorded before engine 69, replay as before.

Engine 72 (`COORDINATOR_HOLD_ENGINE`) holds a linked board's coordinator at one main checkout at a time. Each linked main checkout sends its coordinator moves under its own root coordinator credential, whose lineage the relay authenticates. The board keeps the holding lineage in `board_meta` as `coordinator_holder`, with the holder's name, `computer` and the end of its relay machine id. The first coordinator move at engine 72 takes the hold; a later one from another lineage is refused with `COORDINATOR_HELD`, naming the holder. Registering seats and recording the coordinator's path stay open to every linked main checkout. `takeCoordinator`, sent by `pullboard takeover` in a linked main checkout, moves the hold to the sender and logs a `coordinator-takeover` event naming both holders. Moves recorded before engine 72, and every move on an unlinked board, replay as before.

Engine 73 (`PEOPLE_ENGINE`) names people and lets approvers alone act as the person. The relay stamps each stored record's sender with the GitHub login behind it, the engine the sender declared and, on a board that names approvers, `approver: true|false` for a person sender. Replaying a move made at engine 73 or later, every event it writes carries `person`, that login, beside `event_by`, the agent or seat. A move that carries out a recorded phone request carries the request sender's login instead, and a `relay_refused` event carries the login of the person who tried the move or request. `pullboard.json` may list `approvers`, GitHub logins, at most fifty; leaving it out keeps today's behaviour. On a board that names them, every replica refuses with `NOT_APPROVER` a person move (a row or sentinel decision, an answer, hold or fact as the person, a person request shout) or a phone request to answer, hold or decide rows whose sender is not an approver, and the relay refuses an unlink or snapshot replacement from anyone else. A record whose seal no key opens, from an engine no newer than the replica's, is set aside as `relay_refused` with code `RELAY_SEAL`, and replay goes on; one from a newer engine still asks for an upgrade.

Engine 74 (`LANDING_LEASE_ENGINE`) gives a trunk one landing at a time (#417). The `landingLeaseMove` operation takes, renews and releases the board's landing lease, carrying the holder's token, branch, pid, generation and guardian. `recordLandingBatch` and `finishLandingBatch` may carry a `landingFence` that names the lease they write under; a write whose fence is not the current holder's is refused. A second `pullboard land` names the holder and queues. Older engines refuse `landingLeaseMove` and any fenced landing write, and a landing lease move never falls back to a local preview or a queued relay move: it needs an acknowledged order.

Engine 80 refuses a review, a review reservation or a next --verify offer to any agent or session that ever claimed or submitted the item, not only its current owner (#1085). Older engines replay their recorded reviews under the owner-only guard they had.

Engine 85 (`LANDING_ENVIRONMENT_ENGINE`) records the actual executor's exact `{platform, arch, node}` on new machine-run verdicts and gate receipts. An explicit `null` means unknown; historical receipts without the field keep their original canonical bytes and replay semantics. Landing batches retain their executor and flag accepted verdicts from a different or unknown environment. Earlier engines refuse moves carrying these fields before applying them.

An optional `landing.environment` in `pullboard.json` requires all three exact fields. The matching machine must also opt into this board with `pullboard settings landing.pool on`; `off` removes its opt-in. Machine settings store the board IDs in `landing.pools`. A constrained landing runs on that matching, opted-in coordinator host; generic SSH runners are not members of a board's landing pool. Omitting the policy retains normal runner selection. A mismatch is refused before creating or gating a batch.

Engine 85 also adds `recordLandingTestDefect`. A red batch whose bisection finds no item culprit records a neutral repair item and a `landing-test-defect` event with its test path, content hash, red-tree blob, original trunk blob, failure names, batch ID and trunk branch. Its batch remains `test-defect`, and further landings on that trunk stop before another gate runs. A committed correction to the test on the trunk, or live existing waivers covering every recorded failure, releases the hold. Candidate-only changes and uncommitted edits do not release it. A waiver keeps the red tree and its waived failures explicit. Existing culprit and flake diagnosis retain their meanings; older engines cannot revise or finish a batch carrying these fields.

The CLI declares its engine in every relay request's `X-Pullboard-Engine` header.
A linked board requires at least engine 48 after issuing any agent token or machine credential, including
revoked or expired ones; before engine 48 these minimums were 3 and 6. The minimum survives reopening the auth database;
unlink removes the board and ends its lifetime. A missing declaration is legacy
engine 1. Board-content requests below their minimum, and malformed declarations,
receive `ENGINE_VERSION` with upgrade guidance before records are returned or
changed. The service checks again under its board lock and on live-stream polls.

Engine 3 checks each move or request against the relay's authenticated sender before replay. An agent token acts only as its named agent and cannot act as the person. Refused attribution attempts advance the sequence with a `relay_refusal_<sequence>` receipt and a `relay_refused` event naming the sender, attempted actor and refusal code. They change no item, shout or verdict and do not reserve the forged operation id. Snapshot restoration requires an authenticated person or board machine sender. A machine can register ordinary agents and ensure the coordinator; other person effects require an earlier authenticated phone intent with exact operation, arguments, target and digest. Every replica consumes its execution once, including row decisions waiting for repository application. Receipt shouts have fixed text; refusal details remain in the structured request result. The event log remains version 1.

A board without `event_log_version` is a legacy version-0 event log. Opening an older board writes the current marker without replacing its events. Opening a newer event log refuses with `EVENT_LOG_VERSION`, naming the stored and supported versions and asking you to upgrade Pullboard. `doctor` reports that version conflict read-only.

A native board export includes the marker in its `board_meta` rows. Import refuses a newer event-log version before changing the destination; an older export upgrades its marker in place. Static view exports put `eventLogVersion` beside the data in both `state.json` and `events.json`, separately from the API envelope's `version`.

Linked clients seal an executable operation and its deterministic inputs. The relay assigns its sequence and receipt timestamp without reading the operation. Each client runs the CLI's board engine at that timestamp. Successful results and engine refusals advance `board_meta.relay_applied_sequence` in the same transaction as the move's receipt, keyed by `relay_receipt_<operation-id>`; retries return the recorded outcome. An identical operation id and descriptor at a later relay position advances the prefix without another event and returns its first outcome. The same id with different contents is refused with `RELAY_MOVE`. `relay_engine_version` records the checkpoint's executable semantics. A future engine stops replay before either its rows or its cursor changes.

A sealed checkpoint keeps the native export tables importable and may carry the local API presentation beside them. Its public sequence equals `relay_applied_sequence`, so clients can restore a compacted prefix and continue after it. The older local-first mirror drains only its already-durable outbox, then publishes a checkpoint covering the acknowledged prefix without executing those events again. A divergent old outbox is refused with the relay and local sequences; re-link from that machine or join by pairing.

For ordered sealed relays, ordinary `pullboard relay` stops at an unsupported future move-engine or seal-envelope version. It leaves the blocked sequence and native board unchanged so an upgraded client can replay it. A person in the main checkout may explicitly run `pullboard relay recover --skip N` for the exact blocked next sequence. Recovery refuses a record this version can replay; it records a deterministic refusal for only the selected unsupported or malformed record, replays the readable tail up to the next unsupported record, then publishes an authenticated checkpoint. A later unsupported record cannot undo the selected refusal; it needs its own explicit recovery choice. It never automatically skips a future version. Agent shells cannot use this command.

If another person device has already published a different checkpoint for the same pending recovery, a retry adopts it only when its authenticated sender, supported engine, board identity, covered sequence, and durable refusal receipt for the selected blocker all validate. A concurrent local write prevents adoption; the CLI preserves it and reports that the local export and remote checkpoint need person-led reconciliation. Exporting alone does not clear the saved recovery, and this prototype has no command to merge or discard that conflict.

Recovery stages the replacement before publication and saves the exact sealed checkpoint candidate locally. A known publication failure leaves the native board untouched and keeps that candidate for retry; a lost acknowledgement retries the same ciphertext. Before restoring an acknowledged checkpoint, Pullboard compares semantic native state with the saved digest inside SQLite's write transaction. The local `agent_last_shout_id` inbox read cursor is metadata rather than a semantic write: the check ignores only that field, and recovery preserves the greater valid cursor for each agent present on both boards. Every other native row and field remains guarded; a concurrent semantic write is preserved and recovery refuses with `RELAY_LOCAL_CHANGED`. Ordinary relay sync also refuses while a recovery checkpoint is pending.

Machine relay setup lives outside repositories in `$PULLBOARD_HOME/relay-machine/state.json` (default `~/.pullboard/relay-machine/state.json`), format `v: 2`. The directory is mode 700; state and the SQLite serialization lock are mode 600. State retains the auto-link setting, account and relay origin, stable machine id, excluded project roots, device roster, one pending ten-minute enrollment, pending remote revocations and non-person board-link proposals. Person sessions never persist on the Mac: old machine sessions, Git-directory sessions and retired per-board session files are scrubbed before use. Each linked board keeps a `pm_` credential bound to that board and machine; it can mint `pa_` agent credentials only for that board. `pa_` credentials cannot mint credentials. Explicit `relay on --all` always signs in afresh and preserves the paired phone key. Each roster entry contains `deviceId`, public P-256 JWK, SHA-256 fingerprint, label, creation timestamp, account and relay origin. No device private key is stored on the Mac. The phone retains its non-extractable ECDH P-256 private CryptoKey in IndexedDB database `pullboard-relay-device-v1`, store `keys`, key `device`.

Enrollment HMAC-SHA256 uses an HKDF-SHA256 key derived from the QR-only 32-byte secret, locator-byte salt and UTF-8 JSON info `["pullboard-device-auth",1,account,locator]`. The authenticated enrollment is UTF-8 JSON `["pullboard-device-enroll",1,account,locator,deviceId,{kty,crv,x,y},label,createdAt]`. The Mac consumes its local secret atomically after checking the MAC; relay-supplied public keys are never used as wrapping recipients.

Device wraps are `{v:1,board,device,engine,ephemeral,nonce,ciphertext}`. `ephemeral` is a fresh public P-256 JWK; `nonce` is 12 bytes and `ciphertext` is the 32-byte board key plus its 16-byte AES-GCM tag, both canonical base64url. ECDH yields HKDF-SHA256 input, the raw 65-byte ephemeral public point is salt, and UTF-8 JSON `["pullboard-wrap-v1",board,device]` is info. AES-256-GCM AAD is UTF-8 JSON `["pullboard-device-wrap",1,board,device,engine]`. The relay's private `devices.sqlite` stores only account/device identifiers, opaque wraps, expiring public enrollment transports and durable revocation tombstones. Unlink removes board grants; a device revocation atomically deletes all its grants and blocks stale uploads.

Phone approval contexts contain exactly `id,account,publisher,board,device,action,target,machine,command,expires`. New-board link requests have one visible ten-minute proposal and may retain a private reply JWK because their reply grants only board-scoped machine power. Native revocation reply keys are non-extractable and RAM-only. One phone tap returns a `pg_` grant, limited to two minutes and bound to the entire immutable context; the relay retains only its hash and consumes it atomically before executing the exact action. Agent shells refuse native person actions before network access. `relay off` always removes the local link without a tap, including offline and in agent shells; the remote copy remains until a separate explicit phone deletion approval.

Approval intents and replies use separate ECDH/HKDF-SHA256/AES-256-GCM domains. HKDF salt is UTF-8 JSON of the ephemeral public P-256 JWK; info is UTF-8 JSON `["pullboard-phone-approval-v1",direction,context]`. AES-GCM AAD is UTF-8 JSON `["pullboard-phone-approval",1,direction,context]`. The publishing board key authenticates the sealed intent with HMAC-SHA256 over UTF-8 JSON `["pullboard-phone-intent-v1",envelope]` before the phone displays an approval. Opaque encrypted replies never expose a native grant to durable storage. Journal format 3 permits machine sender attribution, upgrading format-2 CHECK constraints atomically while preserving history, snapshots and sequence heads.

The in-place upgrade behavior is exercised by `exerciseUpgrade` in `docs/formats.test.js`:

<!-- upgrade-rules:start -->
| Older board condition | Behavior when opened |
| --- | --- |
| Missing declared tables or indexes | Create them with `CREATE ... IF NOT EXISTS`. |
| Missing declared columns | Add each with `ALTER TABLE ... ADD COLUMN` and its declared default. |
| Missing or changed declared triggers | Install the declared trigger definitions. |
| Undeclared `machine_` triggers | Drop them as stale. |
| A board that previously had guard triggers | Append a `guards` event listing missing, changed and stale trigger names. |
| An older schema version | Set `PRAGMA user_version` to the current `SCHEMA_VERSION` after installation. |
| Existing rows and event history | Keep them in the same board file; guard repair may append its `guards` event. |
<!-- upgrade-rules:end -->

An older board that has not yet recorded its guard marker receives the current triggers and marker quietly. `openBoard` does not replace the board file or existing rows.

The following live SQLite declarations include nullability, defaults, primary and unique keys, and foreign keys:

<!-- board-columns:start -->
| Table | Column | Type | Rules |
| --- | --- | --- | --- |
| `agent` | `agent_id` | `TEXT` | `PRIMARY KEY` |
| `agent` | `agent_lane` | `TEXT` | `NOT NULL` |
| `agent` | `agent_path` | `TEXT` | `NOT NULL`; `UNIQUE` |
| `agent` | `agent_last_shout_id` | `INTEGER` | `NOT NULL`; `DEFAULT 0` |
| `agent` | `agent_route` | `TEXT` | `NOT NULL`; `DEFAULT 'strong'` |
| `agent` | `agent_family` | `TEXT` | `nullable` |
| `agent` | `agent_created_at` | `TEXT` | `NOT NULL` |
| `board_meta` | `meta_key` | `TEXT` | `PRIMARY KEY` |
| `board_meta` | `meta_value` | `TEXT` | `NOT NULL` |
| `event` | `event_id` | `INTEGER` | `PRIMARY KEY` |
| `event` | `event_at` | `TEXT` | `NOT NULL` |
| `event` | `event_by` | `TEXT` | `NOT NULL` |
| `event` | `event_kind` | `TEXT` | `NOT NULL` |
| `event` | `item_id` | `INTEGER` | `nullable` |
| `event` | `event_detail` | `TEXT` | `NOT NULL`; `DEFAULT '{}'` |
| `hold` | `hold_lane` | `TEXT` | `PRIMARY KEY` |
| `hold` | `hold_reason` | `TEXT` | `NOT NULL` |
| `hold` | `hold_by` | `TEXT` | `NOT NULL` |
| `hold` | `hold_at` | `TEXT` | `NOT NULL` |
| `item` | `item_id` | `INTEGER` | `PRIMARY KEY` |
| `item` | `item_parent_id` | `INTEGER` | `nullable`; `REFERENCES item(item_id)` |
| `item` | `item_lane` | `TEXT` | `NOT NULL` |
| `item` | `item_title` | `TEXT` | `NOT NULL` |
| `item` | `item_criterion` | `TEXT` | `NOT NULL`; `DEFAULT ''` |
| `item` | `item_spec_ids` | `TEXT` | `NOT NULL`; `DEFAULT ''` |
| `item` | `item_after` | `TEXT` | `NOT NULL`; `DEFAULT ''` |
| `item` | `item_brief` | `TEXT` | `NOT NULL`; `DEFAULT ''` |
| `item` | `item_route` | `TEXT` | `NOT NULL`; `DEFAULT 'strong'` |
| `item` | `item_check` | `TEXT` | `NOT NULL`; `DEFAULT ''` |
| `item` | `item_status` | `TEXT` | `NOT NULL`; `DEFAULT 'open'` |
| `item` | `item_owner` | `TEXT` | `nullable` |
| `item` | `item_lease_until` | `TEXT` | `nullable` |
| `item` | `item_frozen` | `TEXT` | `nullable` |
| `item` | `item_frozen_digest` | `TEXT` | `nullable` |
| `item` | `item_built_by` | `TEXT` | `nullable` |
| `item` | `item_builder_family` | `TEXT` | `nullable` |
| `item` | `item_commit` | `TEXT` | `nullable` |
| `item` | `item_tree` | `TEXT` | `nullable` |
| `item` | `item_verdict` | `TEXT` | `nullable` |
| `item` | `item_verified_by` | `TEXT` | `nullable` |
| `item` | `item_merged_commit` | `TEXT` | `nullable` |
| `item` | `item_withdrawn_reason` | `TEXT` | `nullable` |
| `item` | `item_hold_reason` | `TEXT` | `nullable` |
| `item` | `item_hold_by` | `TEXT` | `nullable` |
| `item` | `item_hold_at` | `TEXT` | `nullable` |
| `item` | `item_created_by` | `TEXT` | `NOT NULL` |
| `item` | `item_created_at` | `TEXT` | `NOT NULL` |
| `item` | `item_updated_at` | `TEXT` | `NOT NULL` |
| `item` | `item_claim_head` | `TEXT` | `nullable` |
| `item` | `item_files` | `TEXT` | `NOT NULL`; `DEFAULT ''` |
| `item` | `item_review_by` | `TEXT` | `nullable` |
| `item` | `item_review_until` | `TEXT` | `nullable` |
| `shout` | `shout_id` | `INTEGER` | `PRIMARY KEY` |
| `shout` | `shout_from` | `TEXT` | `NOT NULL` |
| `shout` | `shout_to` | `TEXT` | `NOT NULL` |
| `shout` | `shout_text` | `TEXT` | `NOT NULL` |
| `shout` | `shout_at` | `TEXT` | `NOT NULL` |
| `shout` | `shout_decision` | `INTEGER` | `NOT NULL`; `DEFAULT 0` |
| `shout` | `shout_answers` | `INTEGER` | `nullable` |
| `shout` | `shout_evidence_kind` | `TEXT` | `nullable` |
| `shout` | `shout_evidence_outcome` | `TEXT` | `nullable` |
| `shout` | `shout_evidence_item` | `INTEGER` | `nullable` |
| `shout` | `shout_evidence_commit` | `TEXT` | `nullable` |
| `shout` | `shout_request` | `INTEGER` | `NOT NULL`; `DEFAULT 0` |
| `shout` | `shout_request_outcome` | `TEXT` | `NOT NULL`; `DEFAULT ''` |
| `verdict` | `verdict_id` | `INTEGER` | `PRIMARY KEY` |
| `verdict` | `item_id` | `INTEGER` | `NOT NULL`; `REFERENCES item(item_id)` |
| `verdict` | `verdict_by` | `TEXT` | `NOT NULL` |
| `verdict` | `verdict_verifier_family` | `TEXT` | `nullable` |
| `verdict` | `verdict_decision` | `TEXT` | `NOT NULL` |
| `verdict` | `verdict_reason` | `TEXT` | `NOT NULL` |
| `verdict` | `verdict_note` | `TEXT` | `NOT NULL`; `DEFAULT ''` |
| `verdict` | `verdict_commit` | `TEXT` | `NOT NULL` |
| `verdict` | `verdict_digest` | `TEXT` | `NOT NULL` |
| `verdict` | `verdict_head` | `TEXT` | `NOT NULL` |
| `verdict` | `verdict_at` | `TEXT` | `NOT NULL` |
<!-- board-columns:end -->

<!-- board-indexes:start -->
| Index | Table | Columns | Unique |
| --- | --- | --- | --- |
| `event_by_at` | `event` | `event_by`, `event_at` | no |
| `event_item_id_event_id` | `event` | `item_id`, `event_id` | no |
| `event_kind_id` | `event` | `event_kind`, `event_id` | no |
| `item_lane_status` | `item` | `item_lane`, `item_status` | no |
| `shout_answers` | `shout` | `shout_answers` | no |
| `shout_evidence_item` | `shout` | `shout_evidence_item` | no |
| `shout_from_at` | `shout` | `shout_from`, `shout_at` | no |
| `shout_open_decision` | `shout` | `shout_decision`, `shout_to` | no |
| `shout_open_request` | `shout` | `shout_request` | no |
| `verdict_item_id_verdict_id` | `verdict` | `item_id`, `verdict_id` | no |
<!-- board-indexes:end -->

`src/machine.js` declares the lifecycle and retained records. `src/board.js` installs these persistent triggers in the board file:

<!-- board-triggers:start -->
| Trigger | Table |
| --- | --- |
| `machine_event_delete` | `event` |
| `machine_event_update` | `event` |
| `machine_fields_claimed` | `item` |
| `machine_fields_submitted` | `item` |
| `machine_fields_verified` | `item` |
| `machine_fields_withdrawn` | `item` |
| `machine_item_delete` | `item` |
| `machine_item_move` | `item` |
| `machine_item_start` | `item` |
| `machine_item_state` | `item` |
| `machine_proof_verified` | `item` |
| `machine_verdict_delete` | `verdict` |
| `machine_verdict_update` | `verdict` |
<!-- board-triggers:end -->

`machine_item_start`, `machine_item_state` and `machine_item_move` guard lifecycle states and moves. `machine_fields_*` requires each state's fields; `machine_proof_*` requires its proof. `machine_item_delete` keeps item rows, while `machine_verdict_*` and `machine_event_*` make those records append-only.

Each connection also has a temporary `moving(token INTEGER)` table and `status_through_moves` trigger. The trigger allows status changes only while `moveItem` holds the token; these objects are not stored in the board file.

<!-- temp-columns:start -->
| Table | Column | Type | Rules |
| --- | --- | --- | --- |
| `moving` | `token` | `INTEGER` | `nullable` |
<!-- temp-columns:end -->

<!-- temp-triggers:start -->
| Trigger | Table |
| --- | --- |
| `status_through_moves` | `item` |
<!-- temp-triggers:end -->

## Event log

The `event` table is a SQLite schema object governed by `SCHEMA_VERSION`; its append-only record format has the independent `EVENT_LOG_VERSION`. Each event has an increasing integer id, an ISO timestamp, the actor, the event kind, an optional item id, and a JSON object in `event_detail`. Board moves append their event inside the same immediate transaction as the move. Events are append-only; board triggers reject updates and deletes. The actor column is the acting agent id, except guard-repair events, which use `board`. Under engine 8 and later, each event by a registered agent also carries a `model` string snapshot in `event_detail`; legacy agents without a declaration use `unknown`. Declared models live under `agent_model:<agent id>` in `board_meta`, without changing the agent table or stable ids. Rejoining with another model appends a `model` event whose common snapshot holds the new declaration. This common snapshot is separate from the per-kind payload fields listed below. The following rows name the emitted kinds and the union of their operation-specific detail keys; CLI accept events additionally carry the frozen-check result described below:

<!-- events:start -->
| Kind | Actor | Detail fields |
| --- | --- | --- |
| `join` | joining agent | `lane`, `route` |
| `family` | agent | `family` |
| `model` | agent | — |
| `moved` | coordinator | `path` |
| `add` | item creator | `lane`, `specIds`, `after`, `route` |
| `edit` | editor | `brief`, `route`, `criterion`, `check`, `unfrozen`, optional `after`, optional `pendingRefreeze`, engine-19 `reason`, `barCorrection` |
| `escalate` | builder | `from`, `to`, `note`, `attempt` |
| `attempt` | reporting agent | `n`, `seconds`, `result` |
| `fact` | author | `id`, `kind`, `text`, `ref`, `supersedes`, engine-20 `implies`, `decision`, `supersededBy`, engine-30 `cause`, `neverAgain`, `channel` |
| `claim` | builder | `leaseUntil`, `digest` |
| `renew` | builder | `leaseUntil`, `digest` |
| `release` | builder | — |
| `submit` | builder | `commit`, `tree`, `policyCommit`, engine-9 `criterionDigest`, engine-38 `submissionProof` |
| `reserve` | reviewer | `until` |
| `accept` | reviewer | `reason`, `commit`, engine-20 `implies`, engine-33 `review`, engine-68 `note` |
| `reject` | reviewer | `reason`, `commit`, engine-20 `implies`, engine-33 `review` |
| `reopen` | coordinator | `commit`, `note`, `judgment`, engine-10 `supersedes`, `landingFailure`, engine-30 `cause`, engine-52 `conflict` |
| `merged` | coordinator | `commit` |
| `landing_batch` | coordinator | `batch` |
| `landing-review-moved` | coordinator | `code`, `batch`, `verdict`, `checked`, `landed` |
| `landing_waiver` | person | `waiver` |
| `landing_flake` | coordinator | `flake` |
| `main-moved` | coordinator | `batch`, `items`, `sha` |
| `withdraw` | coordinator | `reason` |
| `refreeze` | coordinator, or live holder adopting a pending correction | `before`, `after`, optional `retainedClaim` |
| `hold` | coordinator | `lane`, `reason` |
| `unhold` | coordinator | `lane` |
| `hold_item` | coordinator | `reason` |
| `unhold_item` | coordinator | `reason` |
| `guards` | board | `missing`, `changed`, `stale` |
| `rigor-notice` | rigor | `cause`, `items`, `occurrences`, `neverAgain`, `engine` |
| `shout` | sender | `shout`, `to`, `decision`, `request`, `answers` |
| `flake-observation` | reporting agent | `engine`, `observation` |
| `flake-repair` | reporting agent | `engine`, `key`, `item` |
| `health-scan` | observing agent | `active`, `engine` |
| `health-failure` | sentinel | `key`, `cause`, `since`, `subject`, `owner`, `commit`, `engine` |
| `health-resolved` | sentinel | `key`, `cause`, `since`, `subject`, `owner`, `commit`, `engine` |
| `sentinel-proposal` | proposing agent | `row`, `digest`, `engine` |
| `sentinel-decision` | person | `name`, `digest`, `decision`, `reason`, `channel`, `engine` |
| `sentinel-start` | running agent | `name`, `digest`, `run`, `until`, `engine` |
| `sentinel-run` | running agent | `name`, `digest`, `run`, `result`, `engine` |
| `sentinel-failure` | sentinel | `name`, `digest`, `run`, `cause`, `engine` |
| `pass` | coordinator | `shout`, `to`, `decision`, `request`, `answers` |
| `answer` | answerer | `shout`, `to`, `decision`, `request`, `answers`, `outcome`, `channel`, engine-20 `implies`, `supersedes` |
| `row_decision` | person | `record`, `channel` |
| `row_draft` | builder | engine-55 `row`, `written` |
| `flake-observation` | reporting agent | engine-59 `engine`, `observation` |
| `flake-repair` | reporting agent | engine-59 `engine`, `key`, `item` |
| `row_apply` | coordinator | `events` |
<!-- events:end -->

A CLI `accept` event includes `check: "none"` when no frozen item check ran or `check: "green"` when it passed. Older accept events and records without this field read as `unknown`; the result stays in event detail and does not change the board schema or event-log version.

An engine-10 `reopen` of a verified item adds `supersedes` with the earlier accept event id and `landingFailure` with `{batch, tests: [{file, name}], mergeCommit}`. For a recorded red batch, `batch` is its id and the tests and merge commit come from that batch. For a hand-run landing, `batch` is `null`; the coordinator's note supplies a test path and name plus merge commit, which are recorded without checking that commit against the repository. The accept event and verdict row remain append-only, and merged items cannot be reopened. Engine-8 and engine-9 `reopen` events keep their original `{commit, note, judgment}` detail and submitted-only behavior.

Item facts use the existing append-only `event` table and event-log version 1. A `fact` event's actor and timestamp stamp its author and time; its detail carries a stable string `id`, typed `kind`, exact `text`, optional `ref` binding or `null`, and superseded fact id or `null`. Allowed kinds are `capture`, `measurement`, `note`, `diff`, `decision`, `rejection`, `supersession` and `root-cause`. Judgement kinds and any correction using `supersedes` require the item's live holder or the coordinator. A correction must refer to a fact on the same item; it adds a new event and preserves every earlier fact.

A binding is `{path, start, end, commit}`: a relative repository path, a positive ascending inclusive line range and a full 40-character hexadecimal commit id. It identifies code without storing source or requiring Git on a replica. Fact ids are generated UUIDs locally. A sealed `appendFact` operation uses its executable move id as its fact id, so replicas keep corrections bound to the same fact even when local event sequence ids differ. Native export/import retains these event rows without a separate fact table or schema upgrade.

The derived `thread` in CLI `show` JSON and API v1 item state is an array in ascending event order. Move entries are `{type: "move", eventId, kind, by, at, detail}`. Fact entries are `{type: "fact", id, eventId, kind, text, by, at, ref, supersedes}`. `eventId` is the board's numeric event sequence; `id` is the stable fact identity used by corrections. `by` and `at` come from the immutable event author and UTC timestamp. `detail` retains a move's original structured payload. Nullable `ref` and `supersedes` preserve omitted fields as `null`. Superseded facts remain in the array beside their corrections. Engine-18 facts add three optional fields, present only when set: `implies`, `decision` and `supersededBy`.

A decision that names the items it changes writes one `fact` event of kind `note` on each named item; the decision's own `fact`, `accept`, `reject` or `answer` event records the requested ids as `implies`, and an answer event records the answer it supersedes as `supersedes`. The implied fact's `decision` cites the decision as `{source, id, item, by, line}`. `source` is `answer`, `verdict` or `fact`. `id` is the answer's shout id, the verdict id, or the fact id. `item` is the item the verdict or fact belongs to, and `null` for an answer. `by` is who decided, and `line` is the decision's first nonempty line; a verdict's line is `accept CRITERION_MET: <note>` or `reject <REASON>: <note>`. The fact's text reads `implied by <decision> by <who>: <line>`. When the decision is superseded, each item it implied gets a second `note` fact with the same `decision` and a `supersededBy` citation of the new decision; its text reads `<old decision> by <who> is superseded by <new decision> by <who>: <line>`. Each fact's author is the decider who caused it: for an implied fact, the old decision's decider; for a supersession notice, the new one's. The citation is built from the board's own record of the decision (the answer's sender, the verdict's reviewer, the fact's author), never from the move's arguments, so only the person's own answer yields a `by: "person"` citation. Only the person supersedes the person's answer. Implied-fact ids are `<seed>-i<item>` and supersession-notice ids are `<seed>-s<item>`. The seed is the decision's fact id for a fact, and for an answer or verdict it is the sealed move id, or a fresh UUID for a local move. Every replica therefore writes the same ids. `pullboard why <id>` reads these facts and lists the decisions that imply an item, newest first. `pullboard resume` shows each implied fact on an item the agent holds once per checkout, recording the shown fact ids in `.git/pullboard-checkout/decisions-seen.json` (or the worktree's own git directory) as `{version: 1, seen: [<fact id>...]}`.

Engine version 3 adds the sealed `appendFact` operation. It is the single engine increment reserved for the release after 0.7.0; other changes in that release reuse version 3. Older supported operations remain replayable; an older client refuses a version-3 move before applying it. The sealed envelope, CLI/API envelope, schema and event-log layout versions are unchanged.

New CLI claims include a `policy` object (`version: 1`, `commit`, `verify: { policy, family }`) in the frozen criterion. It pins the coordinator checkout’s committed configuration on its attached main branch and captures that commit’s verification and family rules. Relay verification uses those shared frozen values, ignoring policy values supplied by the sealed move; missing or invalid captured values produce `NO_POLICY` with an explicit refreeze step. An ordinary criterion recheck preserves legacy frozen bytes and their digest. An explicit refreeze captures the pinned commit’s verification rules and establishes a new digest. A temporary detached review checkout refuses new policy-dependent claims or project gates with `NO_POLICY`; the coordinator returns to its main branch. Existing frozen submissions remain verifiable. Legacy claims use their recorded claim-base commit. A CLI `submit` records the pre-merge coordinator HEAD as optional `policyCommit`; historical doctor and acceptance checks use this snapshot when allowing unchanged foreign files brought in from MAIN. Verified dependencies may also contribute unchanged files in their own lanes before a MAIN merge; foreign deletion or replacement is not authorized by an unrelated dependency’s tree. The complete candidate diff against both claim base and frozen MAIN is checked with rename detection disabled, preserving deleted paths and whitespace in names. Frozen item checks run against the exact submitted commit in an isolated checkout when accepting and auditing; repairing a reviewer’s checkout cannot make a red submission green.

Person answer events additionally record their `channel`, either `terminal` or `view`, including the forwarded answer to the original asker. Agent answers omit that field.

Person row decisions use one `row_decision` event per row. Its `record` holds `kind` (`spec` or `doctrine`), file, id, exact source and replacement lines, target text, decision, reason and identity. SSH approvals additionally hold the canonical signature and trust anchors. The current index is additive `board_meta` key `row_decisions`; each entry includes its event id, timestamp and applied state. Coordinator `row_apply` events name the exact decision event ids applied locally. Replica replay changes board metadata only and never writes checkout files.

An approval of proposed new wording uses that same record: `source` is the existing exact line and `replacement` carries the approved target text. Pre-commit compares the staged target against the person decision or a verified staged signed receipt. No second approval format or event kind is needed.

Migration preserves event rows and adds only schema objects that are missing.

## Submit test selection

`pullboard.json` may set `affectedTests` to a command prefix that runs selected test files. When it is absent, `submit` runs the configured `gate` in full. When present and the import graph can safely select a subset, Pullboard appends the selected file paths to this prefix; an uncertain selection still runs the full gate. For example, this repository opts in with `"affectedTests": "node bin/run-tests.js"`. Projects using another test framework can leave the setting out and keep their configured gate, such as `npm test`.

`pullboard.json` may set `worktrees` to `"inside"` or `"beside"`. Fresh `pullboard init` writes `"inside"`, placing new agent worktrees under `.claude/worktrees/<lane>-N`; it also adds `.claude/worktrees/` to `.gitignore` and prints guidance for dot-scanner ignore rules. An omitted setting defaults to `"beside"` to preserve existing sibling paths (`../<repo>-<lane>-N`). `pullboard resume` and `pullboard help worktree` show the active location from the primary checkout's config.

A project with `"submitGate": "landing"` can also set `"submitInvariants": ["test/guard.test.js"]` to run a small set of project guard files on every submit, even when uncertain selection defers the full suite. The list defaults to empty and requires the project's explicit `affectedTests` runner; no framework or test files are added by default. Submit reads the list and its runner from accepted main, so a candidate cannot remove or replace its required files. Named affected tests and invariants run once per file, with their paths and results in the receipt. Missing invariant files refuse the submit, and subset passes never stamp the full gate. The coordinator still runs the configured full suite at landing.

With `"submitGate": "landing"`, `"submitDeferAbove": N` (a whole number, 1 or more; absent by default) moves an affected selection of more than N test files from submit to landing. Such a submit runs its frozen check, the static checks and `submitInvariants` only, records the selection as `submissionProof.deferredFiles`, and notes `<count> affected test files deferred to the landing gate` on the submission, where `show` prints it. A full-gate landing already runs every file. A landing with `"landing": { "publish": "separate" }` runs the recorded files on the merged tree before anything lands; a red sends back each item whose own deferred files failed, and nothing in that batch lands.

<!-- pass-rule:start -->
The `pass` event is emitted by `passDecision` only for the coordinator; another agent receives `COORDINATOR_ONLY`. Its event actor is the coordinator. The person receives the passed decision, while the event table records who performed the pass.
<!-- pass-rule:end -->

## Static view export

`pullboard view --export DIR` writes a read-only site from the same API v1 documents used by the live view. The page fetches these files without a session key and reads the events file to replay the snapshot. The export contains no server, credentials or writable board actions.

<!-- snapshot-files:start -->
| File below `DIR` | Contents and reader |
| --- | --- |
| `index.html` | Snapshot page; reads the JSON files below and drives event replay. |
| `view.css` | Stylesheet linked by `index.html`. |
| `api/v1/boards.json` | API v1 board listing; the page selects the board to show. |
| `api/v1/boards/<board-id>/state.json` | API v1 state for that board; the page uses it as the final snapshot. |
| `api/v1/boards/<board-id>/events.json` | API v1 event list; the page replays it from the selected board state. |
<!-- snapshot-files:end -->

The schema, trigger and parser tables are checked against live `openBoard(':memory:')` and `parseSpec` results. The static export is generated and its files, API v1 shapes and page readers are checked by `docs/formats.test.js`.

### Landing records

Engine 8 adds `recordLandingBatch`, `recordLandingWaiver`, `recordLandingFlake` and `finishLandingBatch`. Older engines stop before applying these operations. Their append-only events need no schema migration. A batch snapshot has version 1, identity, base and tip commits, trunk branch, landing worktree, items with their first-containing merge commits, state, owner, log path and revision. Additional owner-lease and environment fields can be added without changing version 1. A revision refuses stale updates. Successful push precedes the atomic merged receipts and single `main-moved` event. An engine-12 landing finish ordered after an engine-33 checked re-review still records the tree the older client actually pushed. If that legacy batch did not check the newer reviewed head, it also appends `landing-review-moved` with `code: "LAND_ITEM_MOVED"` and the exact verdict, checked head and landed merge. The newer review reads stale until its checked composition reaches the known trunk; the earlier landing receipt and verdicts remain immutable. Recovery creates a separate correction item rather than reopening or re-reviewing the already-landed original. Historical finishes ordered before the newer review retain their original receipts.

A person waiver records its identity, named test, expiry, reason and person channel. A distinct landing proof records the exact batch tree and each failing test with its covering waiver identity. Pre-push checks every waiver against the current time; this proof never writes an ordinary green-gate stamp. Flake records retain a test path, source digest, failing names and one defect item, so a repeated observation does not create another defect.

Engine 34 adds the agent/coordinator `orderMilestoneItems` move, carrying a milestone name and its ordered subset of item ids. Earlier engines refuse it before changing the board or replay cursor. Ranked item ids stay with their milestone in its `order` metadata; old entries without it keep their prior queue order. Recorded next/reserve moves below engine 34 retain their original ordering even when later metadata contains ranks. The stable minimum is `MILESTONE_RANK_ENGINE` (34); engine slots 25 through 33 belong to their separately allocated train items.

Engine 43 (`RIGOR_NOTICE_ENGINE`) posts one coordinator shout and one typed `rigor-notice` receipt when a reject, reopen or person never-again fact makes a cause repeat. Both are part of that move’s transaction. Recorded engines through 42 retain their original event streams. A person’s exact row-decision receipt for a typed Rigor source silences that repeat until a new item repeats it; later commits on an already known item do not override the decline.

A proved Rigor draft carries `source: rigor:<percent-encoded JSON>` with `version: 1`, its `key`, `evidence` (`items`, `occurrences`, `neverAgain`) and `proof` (`check`, `red`, `green`). The proof contains actual full commits, executed exit statuses and problem counts. The existing spec and doctrine row grammar reads this field; prose mentioning Rigor is not a typed source. The person uses ordinary Approve or Decline, and the coordinator applies the approved row without a new build item.

Engine 54 replaces the automatic strong-to-strong ceiling escalation with one coordinator notice per rejection pair, naming the builder and both rejection receipts. Ordinary rejection still reopens and clears the owner and lease. Light and mid routes keep engine-50 automatic escalation. Engines 50 through 53 retain their original ceiling escalation when replayed.

## Approval provenance

A row approved after the board’s compatibility baseline is reported as `agent-approved` until its exact source is backed by a person decision or a verified signed row-decision receipt. The initial approved set is recorded during `init`, before the setup commit. An older board records its existing approved rows on its first ordered command with this version; earlier reads report the baseline as pending and flag nothing. The snapshot is a compatibility boundary, not evidence of historical person approval. Git blame supplies the row's commit and author, labelled “Git author, seat unknown”; it never establishes person approval. `pullboard spec approve <id>` confirms the row and `spec decline <id> --reason "why"` declines it through the existing person channel. File application remains a coordinator step.

`pullboard.json` accepts the existing `"spec": "SPEC.md"` form, or `"spec": {"file": "SPEC.md", "agentApproval": "flag"}`. `flag` is the default and keeps work moving; `allow` suppresses the outstanding approval call; explicit `refuse` prevents a new frozen citation of an unconfirmed row with `AGENT_APPROVAL_REQUIRED`.

Engine 68 retains the existing validated verifier note in new acceptance-event detail. Earlier engines retain their original receipt shape; later person confirmations project current approval state beside that immutable history. No new row status or approval authority is inferred from a Git author or an unsigned receipt.

The engine-68 `recordSpecApprovalBaseline` move carries `{agentId, baseline: {version: 1, file, anchor, rows: [{id, text, source}]}}`. `anchor` is the current commit or `null` before the first commit; exact source rows also cover uncommitted initial requirements. Only the authenticated coordinator may establish the snapshot; a person uses the main checkout’s coordinator path. Lane commands never seed or replace it. The first snapshot is indexed under `board_meta.spec_approval_baseline` with a `spec_approval_baseline` event. Replay writes metadata only, never checkout files. Sender attribution is authenticated normally, older engines refuse the new move, and later bootstrap attempts cannot replace or expand the original snapshot. No local sidecar establishes shared approval authority. The metadata snapshot must agree with its single original coordinator event; a partial restore with either half missing or changed is invalid. A malformed stored marker remains in place with an invalid-baseline diagnostic; it is not treated as an absent migration baseline or reseeded by later commands. Board imports remain trusted recovery operations; agreement of these records is a consistency check, not cryptographic authentication of an imported history.

Engine 93 adds item-addressed shouts. A shout move's optional `item` names an existing item; its event belongs to that item and includes the message text. Its canonical `shout_to` is `item:<id>`, read by the item's current builder and reviewer and the coordinator. Inbox, resume and seat watch use the same audience; an explicit seat or lane destination with `--item` still uses the item's audience. An item decision is answerable by its current participants or coordinator; replies stay in its thread and audience. The coordinator can still pass it to the person through the existing decision flow. Only the coordinator and person can broadcast `all`; recorded older-engine broadcasts retain their meaning. Main-checkout watch remains the person's board-wide observer. A joined seat's default watch filters shouts to its own address, lane, items and `all`, while ordinary lifecycle events remain visible.
