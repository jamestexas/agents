---
name: pr-suggestion
description: >
  Post a GitHub review comment as an applyable "suggested change" — a
  ```suggestion block the author commits with one click — and, first, decide
  whether a finding should be a suggestion at all. `gh` has no native support
  for inline comments or suggestions, so this drives the REST reviews API
  directly. Use when a finding is a small, literal edit to a line the PR already
  changed. It is deliberately the WRONG tool for structural, additive, or
  unchanged-context findings; the decision rule below tells them apart so you
  never post an unappliable "Commit suggestion" button.
allowed-tools: "Read, Grep, Write, Bash(gh:*), Bash(jq:*), Bash(awk:*)"
argument-hint: "[owner/repo#N + the finding and the file:line it edits]"
user-invocable: true
---

# pr-suggestion — turn a review finding into a one-click applyable change

The spine, one question:

> **Is this finding a literal replacement of a line the PR already changed?**
> If yes, post it as a `suggestion` so the author applies it with one click. If
> no, post a described comment — a suggestion here would be broken or wrong.

**Posting gate (repo-wide rule, same as pr-review-kit):** nothing in this skill
is posted to GitHub without explicit human authorization. Prepare the payloads,
show what will be posted and where, and call the API only on an explicit go.

A suggestion is a gift when it fits and a trap when it doesn't. A wrong or
unappliable suggestion is *worse* than a clear description: the author clicks
"Commit suggestion," gets a broken commit or a no-op, and learns to distrust
your review. Match the tool to the finding.

## The suggestability decision rule (run this before writing anything)

A finding is suggestable only if **all three** hold:

1. **In-diff** — the line(s) you'd replace are on the **RIGHT side of the diff**
   (added/changed in the PR head). Unchanged *context* lines cannot host a
   suggestion at all — the API rejects them.
2. **Contiguous** — the fix is one continuous line range, not edits scattered
   across the file. A suggestion replaces exactly the anchored range.
3. **Literal replacement** — you can write the full new text for that range. A
   suggestion is a verbatim swap, not a diff or an instruction.

| Finding shape | Suggestable? | Why |
|---|---|---|
| Wrong constant / operator / off-by-one on a changed line | ✅ yes | literal edit, in-diff, contiguous |
| Missing `nil`/error check right after an added line | ✅ (append trick) | replace the added line with itself + the new line |
| Rename a field the PR introduced | ✅ if contiguous | literal, in-diff |
| Change happens in code the PR **didn't touch** | ❌ no | not in the diff — nothing to anchor |
| Architectural swap spanning multiple regions | ❌ no | not contiguous |
| Add a whole new function/test out of band | ❌ (usually) | addition, not replacement — describe or hand a patch |

If it fails the rule: post a normal described comment (or hand a `git apply`
patch for larger structural/additive fixes). Do not force a suggestion.

## Why `gh` can't, and what to use instead

`gh pr review` only sets a **top-level** body (`--body`/`--comment`) — no inline
comments, no suggestions. Inline comments (suggestions included) go through the
REST API:

- **New review with suggestions:** `POST /repos/{owner}/{repo}/pulls/{N}/reviews`
  with a `comments[]` array; each comment's `body` contains the fence.
- **Turn an existing inline comment into a suggestion:**
  `PATCH /repos/{owner}/{repo}/pulls/comments/{comment_id}` with a new `body`.

A suggestion is just an inline comment whose body is:

````
```suggestion
<the full replacement text for the anchored line(s)>
```
````

## Procedure

### 1. Find the anchor (the RIGHT-side line number in the diff)
The `line` must be a changed line in the head commit. Discover it from the diff
rather than guessing — line numbers drift:

```bash
gh pr diff <N> --repo <owner/repo> --patch | awk '
  /^diff --git/ { f=$3; sub(/^a\//,"",f) }
  /^@@/ { match($0,/\+[0-9]+/); rl=substr($0,RSTART+1,RLENGTH-1)+0; next }
  /^\+/ && !/^\+\+\+/ { print f":"rl": "substr($0,2); rl++; next }
  /^ / { rl++ }'    # context lines advance the RIGHT counter but are NOT anchorable
```
Only lines printed with a `+` by this walk are addable/changed and therefore
anchorable. If your target isn't in the list, it's unchanged context → not
suggestable (see the rule).

### 2. Build the payload with `jq` (never hand-escape)
The fence content has backticks, quotes, and newlines — assemble with `jq
--rawfile` so escaping is correct. Write each comment body to a file first.

Single-line suggestion (replaces one line):
```bash
jq -n --rawfile s1 body1.md --rawfile summary summary.md '
{ event:"COMMENT", body:$summary, comments:[
  { path:"path/to/file.go", line:42, side:"RIGHT", body:$s1 }
]}' > payload.json
gh api repos/<owner>/<repo>/pulls/<N>/reviews --input payload.json
```

A comment body that IS a suggestion (`body1.md`):
````
Off-by-one: the cap is inclusive, so this should be `<=`.
```suggestion
	if requested <= maxPageSize {
```
````

Multi-line suggestion (replaces a range) — add `start_line`:
```json
{ "path":"f.go", "start_line":40, "line":42, "start_side":"RIGHT", "side":"RIGHT", "body":"...fence..." }
```
The fence must contain the full replacement for lines 40–42 inclusive.

Addition-append trick (a suggestion can only replace, so to *add* a line, anchor
to a real changed line and include it plus the new content):
````
```suggestion
	existingAddedLine := foo()
	if existingAddedLine == nil { return errX }   // the line you're adding
```
````

### 3. Choose the review event
- `COMMENT` — deliver suggestions without approving (default when unsure; never
  infer approval).
- `APPROVE` / `REQUEST_CHANGES` — only when the human said so.
Suggestions attach to any event, including a later `PATCH` onto an existing
review comment.

### 4. Verify it landed
```bash
gh api repos/<owner>/<repo>/pulls/<N>/comments \
  --jq '.[] | select(.user.login=="<me>") | "\(.path):\(.line)  \(.body[:60])"'
```
Confirm the comment shows the ```suggestion fence and sits on the intended line.

## Gotchas

- **Unchanged context is unanchorable.** The single most common mistake: the
  ideal fix lives in code the PR didn't touch. You cannot suggest there. Anchor
  the *comment* to the nearest changed line that carries the same intent and
  describe the fix, or hand a patch.
- **Stale head.** A suggestion is bound to a commit; if the PR head moves, the
  suggestion (and any approval) may be dismissed. Post against the current head.
- **Exact bytes matter for the surrounding code, not the fence.** The fence is a
  replacement, so its indentation must match the file's (tabs vs spaces). Copy
  the leading whitespace from the target line.
- **`side` defaults to RIGHT**; only set `LEFT` to comment on a deleted line
  (you cannot *suggest* on a deleted line — there's nothing to replace).
- **Don't batch unrelated suggestions into one giant review** if the author is
  iterating round-by-round; small, per-line suggestions are easier to accept or
  reject individually.

## Cross-references
- **Upstream:** `structural-pr-review` / `pr-review-kit` produce the findings;
  this skill is the posting mechanic their gated Phase-8 step can call for the
  findings that pass the suggestability rule.
- **Sibling:** for structural/additive findings that fail the rule, hand a
  verified `git apply` patch instead (build + test it first), or leave a
  described comment.
