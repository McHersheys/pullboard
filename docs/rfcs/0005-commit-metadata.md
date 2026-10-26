# RFC 0005: Commit messages carry their item and rows

- Status: draft, for the person's review (not proposed yet)
- Proposed: 26 October 2026

## Summary

Every commit Pullboard lands on the trunk names the item it lands and the spec rows that item serves, in a fixed, generated form. Pullboard writes these lines and checks them; agents never type them. Anyone with only the repository can go from a line of code to the commit, the item and the requirement behind it.

## Motivation

- **Commits outlive the board.** The board is a local database; git history is permanent, public and cloned everywhere. The reason for a change should travel with it.
- **Today it depends on habit, and habits fade.** In the last 400 commits on main, 40 of 45 `feat` commits named their item, but 16 of 112 `fix` and 5 of 102 `test` commits did.
- **The header can't hold every row.** An item citing many rows cannot land: the ids fill the 72-character header and landing refuses with `LAND_HEADER`, advising the author to cut citations (GitHub issue #10).
- **A workaround became a format.** `Pullboard-Companion` was added for coordinator patches in another lane. Child items (#1221) replace that need.

## The format

A landing commit:

```
<type>(merge): <title> [<rows>]

<optional why: one to three sentences, only when it isn't obvious>

Pullboard-Item: #<id>
Pullboard-Rows: <row>,<row>,...
Co-authored-by: <name> <email>
Signed-off-by: <name> <email>
```

1. **Header.** The item's type, scope `merge`, a concise title, then the rows in brackets. At most 72 characters. The title keeps priority; the rows fill what is left. When they don't all fit, the header shows the first rows that fit and `+N` for the rest: `[A1,A2,A3,A4,A5,A6,+30]`. An item with no rows has no brackets.
2. **Body.** Optional, and only for a non-obvious why (standard doctrine PB9).
3. **Trailers, always the last paragraph, in this order:**
   - `Pullboard-Item: #<id>`: the one item this commit lands. One item per commit.
   - `Pullboard-Rows: ...`: every row the item cites at landing, its final frozen set, in spec order, comma-separated, no spaces. Omitted when the item cites none.
   - `Co-authored-by:` and `Signed-off-by:` (git conventions), for outside contributions.

Examples:

```
feat(merge): person-only moves are signed [E22]

Pullboard-Item: #408
Pullboard-Rows: E22
```

```
docs(merge): update the handbook [A1,A2,A3,A4,A5,A6,+30]

Pullboard-Item: #1326
Pullboard-Rows: A1,A2,A3,...,A36
```

```
test(merge): every test run an agent starts goes through the runner pool

Pullboard-Item: #1219
```

A commit not tied to an item (configuration, chores) carries no Pullboard trailer and still has a typed header: `chore(config): ...`.

## Deterministic, never typed

- **One shared function** builds the header and trailers from board state, and one parses them. Landing, the commit hook and history all use them.
- **Landing writes them.** Work commits on an item branch are squashed at landing, so the trunk commit is always generated.
- **The commit hook writes `Pullboard-Item`** from the seat's claim on any commit made under a claim, replacing anything an agent typed.
- **The commit hook refuses** trailers that disagree with the board (a different item than the claim, rows other than the frozen set, a malformed preview, text after the trailers) and any header without a `type(scope):` or `type:` prefix, except git's own sync merges.
- **A batch checks every landing message before its first merge.**
- **Landing never refuses because of how many rows an item cites,** and no refusal advises removing citations.
- **The `Pullboard-` trailer prefix is reserved** for this format. New trailers come only through an RFC.

## Reading it

- `git log --grep="Pullboard-Item: #1325"`: every trunk commit for an item.
- `git log --format='%h %s %(trailers:key=Pullboard-Rows,valueonly)'`: rows per landing.
- `pullboard why <file>` reads trailers, so it works from git history alone.
- History reads `Pullboard-Rows` first; for older commits, the header brackets.

## What changes

- A short `docs/commits.md` documents the format above, versioned (not the long `docs/formats.md`).
- The standard doctrine's PB9 gains one sentence: the trailers are generated, and text never follows them.
  Amended 26 Oct 2026, approved by the person: the extended row broke the 20-word row limit, so PB9 now reads "Headers: type(scope): subject [ids], ≤72 characters. Body only for a non-obvious why, three sentences at most. Generated trailers come last."
- `Pullboard-Companion` is retired: a change another lane needs is a child item (#1221) with its own `Pullboard-Item`. Existing commits keep it; readers treat it as `Pullboard-Item`.
- Applies from the release that ships it. History is not rewritten.

## Open questions

- None known. GitHub's "squash and merge" can rewrite messages; the pull-request bridge must write these trailers itself.