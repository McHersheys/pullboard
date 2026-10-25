# Coordinator hand-off

Start in the repository's main checkout. The coordinator's hand-off is its
`pullboard resume` card. `pullboard handoff` is the separate replacement flow
for an agent worktree; it is not the coordinator command.

```sh
pullboard resume
pullboard resume --diagnostics
pullboard resume --json
pullboard resume --diagnostics --json
```

The ordinary card names the checkout and the next action. Diagnostics add the
current Git integration checks; JSON retains the complete sections when text
shows only the first three entries. Read the card before copying a previous
session's plan: recorded acceptance and present merge readiness are different
facts.

## Decisions and questions

`open decision` names a question still waiting for the coordinator, its asker
and its age. `recent decision` shows an answered question and who answered it.
Read both before answering, so a replacement neither drops an open question nor
answers one twice. `waiting on the person` names an unresolved person decision;
other `needs the person` lines describe actions that require that person.

Use `pullboard inbox` to read the messages. Answer a decision by its actual id
with `pullboard answer <id> "<answer>"`; reading resume itself does not answer it.

## Accepted work and integration

Diagnostics print `verified, not merged` in three groups: `merges cleanly`,
`conflicts`, and `claimed for integration`. The integration entry names the
agent and the recorded commit. A plain message saying "integrating" is not an
integration receipt. The JSON `verifiedNotMerged` groups retain all entries.

A stale acceptance is called out separately. The ordinary card reports accepted
receipts awaiting landing checks; it does not promise that every accepted head
can land now. Use the guarded `pullboard land` flow for landing, and resolve a
reported conflict or stale review before treating the item as integrated.

## In-flight batches and pushes

A nonterminal batch appears as `landing <id>:` with its state, `owner <session>`,
exact tip, log path and `pullboard land --adopt` as the next step. Read the log
and verify that recorded tip before adopting an interrupted batch. The JSON
`landingBatches` entries retain the batch's items and full recorded state,
including a push already recorded as pushed. An unrecorded background process
is not made safe merely by writing its command into a chat.

## Durable files

Resume names the real checkout (`at <path>`), and each active batch names its
log. Board state lives in `<common-git-dir>/pullboard/board.sqlite`; a normal
batch keeps its worktree and logs under
`<common-git-dir>/pullboard/landings/<id>/`, with its log at
`landings/<id>/logs/batch.log`. In a worktree, use the common Git directory rather
than assuming that `.git` is a directory.

Keep hand-maintained runbooks, monitor commands, machine pitfalls and outside
workspaces in a durable location, then record their actual paths and ownership
as board facts. Resume does not invent a universal home for those files or
recover a session-private scratchpad. Before leaving, record which processes
are still running, where their logs are, and what the replacement must restart.
Keep credentials out of those notes.

## Pass the coordinator role

The incoming session reads resume in the intended main checkout, then runs:

```sh
pullboard takeover
pullboard resume --diagnostics
```

Use the incoming agent's own session. A person's ordinary terminal cannot take
over on an agent's behalf.

On a linked board, takeover takes the coordinator hold for this main checkout
as an ordered board move. A previously holding main checkout is then refused
coordinator moves until it takes the role again. In an unlinked checkout,
takeover records the current session's checkout takeover; it is not a transfer
between linked machines. Pair a replacement machine and make its board key
reachable before expecting it to coordinate a linked board.

After takeover, check open questions, accepted work, batch ownership and durable
files again. Adopt or restart only the work those records identify, and tell
the person that the replacement is coordinating. Pullboard does not transfer
private chat context: record the remaining rationale, taste, outside files and
unfinished decisions on the board before the outgoing session ends.
