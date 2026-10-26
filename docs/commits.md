# Commit messages

Format version 1, defined by [RFC 0005](rfcs/0005-commit-metadata.md). It applies from the release that ships the RFC. Existing history is not rewritten.

Pullboard generates the item and row metadata from the board. Give a work commit a typed header and, when needed, a short explanation; do not type the generated `Pullboard-` trailers yourself. Landing squashes the item's work commits and generates the trunk message from its final frozen requirements.

## Header and body

A landing header has this form:

```text
<type>(merge): <title> [<rows>]
```

The whole header is at most 72 characters. The title keeps priority. Rows fill the remaining space in spec order; if they do not all fit, the preview ends with `+N`, the number omitted. For example, `[A1,A2,+3]` previews two of five rows. Every row still appears in the trailer. An item with no rows has no brackets. The number of citations never prevents landing; do not remove requirements to shorten a header.

The body is optional: explain a non-obvious reason in at most three sentences. A commit outside an item, such as configuration or a chore, still has a typed header (`chore(config): ...`) and carries no Pullboard trailer. The hook accepts `type(scope): subject` or `type: subject`; only Git's own synchronization merges are exempt from the typed-header rule.

## Final trailer paragraph

Trailers are always the last paragraph, after a blank line. Their order is:

1. `Pullboard-Item: #<id>` — exactly one item per landing commit.
2. `Pullboard-Rows: <row>,<row>,...` — the complete final frozen set in spec order, comma-separated with no spaces. Omit this line when the item has no rows.
3. `Co-authored-by:` and `Signed-off-by:` — the conventional Git trailers for outside contributions, when applicable.

Nothing follows the trailers. Pullboard generates its trailers from the seat's claim and regenerates them at landing. It refuses metadata that names a different item, disagrees with the frozen rows, has a malformed row preview, or is followed by prose. A legitimate Git trailer belongs in the same final paragraph after the Pullboard lines.

```text
feat(merge): person-only moves are signed [E22]

Pullboard-Item: #408
Pullboard-Rows: E22
```

An item with no rows:

```text
test(merge): every agent test run goes through the runner pool

Pullboard-Item: #1219
```

An outside contribution can retain its attribution and sign-off:

```text
fix(merge): preserve the submitted receipt [V4]

Pullboard-Item: #1234
Pullboard-Rows: V4
Co-authored-by: Example Contributor <contributor@example.test>
Signed-off-by: Example Contributor <contributor@example.test>
```

The entire `Pullboard-` prefix is reserved for this format. Adding a new trailer requires an RFC. `Pullboard-Companion` is retired for new commits; work in another lane is a child item with its own `Pullboard-Item`. Readers continue to treat the historical companion trailer as an item reference.

## Read the history

Find an item's trunk commits without opening the board:

```sh
git log --grep='^Pullboard-Item: #1325$'
git log --format='%h %s %(trailers:key=Pullboard-Rows,valueonly)'
```

`pullboard why <file>` reads these trailers. History reads `Pullboard-Rows` first and falls back to bracketed header citations for older commits. A shortened header preview never replaces the complete row list.
