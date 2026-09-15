---
name: pr-review-kit
description: >
  Self-contained playbook for rigorous PR review: state inspection,
  design-intent hunting, verification rules (cite sources, walk commits,
  verify artifacts), agent dispatch, falsifiable-matrix output, GitHub
  posting only with explicit authorization. Generic, sequential phases.
allowed-tools: "Bash,Read,Glob,Grep,Edit,Write,Agent"
argument-hint: "[PR number, owner/repo#N, or nothing to ask]"
---


A complete, self-contained playbook for reviewing a pull request. Hand this directory to a fresh reader — human or Claude session — along with the target PR, and they have everything needed to do a rigorous review without prior context. This file is the spine: the phases and the four verification disciplines, which is all a fresh review needs. Two sidecars carry what only some reviews reach for — [ENGAGE.md](ENGAGE.md) for replying to existing reviewer comments, and [APPENDICES.md](APPENDICES.md) for situational reference — so a routine review does not pay to load them.

---

## How to use this document

**You are a new reader.** This kit does not assume:

- You know about other skills, agents, or memory entries in any parent repo.
- You know the project's design conventions.
- You know the PR author's review style.
- You have any prior session history.

It assumes only that you have:

- `gh` CLI authenticated to the relevant org.
- `git` with worktree support.
- File read/write access in the reader's home dir.
- (Optional) Specialty subagents available via the harness — generic instructions below cover dispatch when they exist.

**Two reading modes:**

- **Mode A — Doing a review yourself.** Read top-to-bottom; phases are sequential.
- **Mode B — Coordinating multiple reviews.** Skip to Phase 7 (output format) — the per-PR notes file shape is the durable artifact you'll keep.

---

## Phase 1 — Read the PR state cold

Before forming any opinion, build a complete picture of the PR's metadata, review history, and commit history. Run these in parallel:

```bash
OWNER=<github org>
REPO=<github repo>
N=<PR number>

# Core PR metadata (title, author, size, state, mergeable)
gh pr view $N --repo $OWNER/$REPO \
  --json number,title,author,state,additions,deletions,changedFiles,baseRefName,headRefName,createdAt,updatedAt,reviewDecision,mergeable,body

# File list with per-file delta size
gh pr view $N --repo $OWNER/$REPO --json files \
  --jq '.files[] | "\(.additions)+/\(.deletions)- \(.path)"'

# All review submissions (humans, AI bots)
gh api repos/$OWNER/$REPO/pulls/$N/reviews \
  --jq '[.[] | {user: .user.login, state, submitted_at, body_preview: (.body[0:200])}]'

# All inline comments — note the in_reply_to_id; resolved threads still appear
gh api repos/$OWNER/$REPO/pulls/$N/comments \
  --jq '[.[] | {id, path, line, user: .user.login, in_reply_to_id, created_at, body_preview: (.body[0:200])}]'

# Commit history, newest first
gh api 'repos/'$OWNER'/'$REPO'/pulls/'$N'/commits?per_page=100' --paginate \
  --jq 'sort_by(.commit.author.date) | reverse | .[] | "\(.sha[0:10]) \(.commit.author.date) \(.commit.message | split("\n")[0])"'

# If state is CLOSED but mergedAt is null, find why
gh api repos/$OWNER/$REPO/issues/$N/comments \
  --jq '.[-5:] | .[] | {user: .user.login, created_at, body_preview: (.body[0:300])}'
```

**Key thing to notice in this phase**: who has reviewed, what they said, and how the PR has evolved over time. PRs by authors who run their own AI-bot self-review often have many inline comments that look "open" but are pre-merge punch lists already addressed by later commits (see Phase 4).

### Staleness gate — does the PR still apply to base?

Always run this before reviewing the diff. A PR that renders a clean diff on GitHub may be unmergeable against current base if the surrounding code was refactored *under it*. For any PR more than a few days old, this is often *the* load-bearing finding — and no other phase surfaces it.

```bash
# Run git commands against the canonical remote (see Phase 2 on fork-vs-upstream).
git fetch <upstream-remote> pull/$N/head:pr-$N-review
MB=$(git merge-base pr-$N-review <upstream-remote>/<base>)
git rev-list --count $MB..<upstream-remote>/<base>   # how many commits behind base

# Drift on touched files — a changed signature means the patch will not apply.
for f in $(git diff --name-only $MB pr-$N-review); do
  diff -q <(git show <upstream-remote>/<base>:"$f" 2>/dev/null) <(git show pr-$N-review:"$f") >/dev/null || echo "diverged: $f"
done
```

A large commit count behind base plus signature/API drift on a touched function means **the fix idea may survive a rebase but the patch does not apply** — report it as a blocker distinct from code-quality findings; it is what a `mergeable: UNKNOWN` status usually reflects.

---

## Phase 2 — Clean working copy via worktree

For PRs over ~500 LOC or any structural change, create a git worktree at the PR's HEAD so you can read the actual code without disturbing your main working directory.

```bash
git fetch <upstream-remote> pull/$N/head:pr-$N-review
git worktree add <path-to-new-worktree> pr-$N-review
```

If `<upstream-remote>` is unclear: `git remote -v` and pick the one pointing at the canonical org/repo (often `upstream`, not `origin` if you work from a fork).

Clean up when done:

```bash
git worktree remove <path-to-new-worktree>
git branch -D pr-$N-review
```

---

## Phase 3 — Find the design intent

A PR is an encoding of a design decision. Without the design, you can only review syntax. Hunt for the design intent in this order:

1. **The PR body itself** — many authors embed design rationale, link the spec, or cite an RFC. Read it fully before assuming it's absent.
2. **Linked tickets** — Linear, GitHub Issues, Jira. The ticket description often contains acceptance criteria + scope decisions.
3. **In-tree design docs** — `docs/`, `design/`, `proposals/`, `rfcs/`. Search the repo (`find . -name '*.md' | xargs grep -l 'design\|TRD\|RFC'`).
4. **Out-of-tree design docs** — Notion, Confluence, Google Docs, Slack file attachments. **If the PR body cites "TRD §X" or "spec §Y" without a link, that doc is somewhere — ask the user.**
5. **Adjacent PRs** — same author's prior or sibling PRs in the same area. Look for a "design" or "stubs" PR in the stack.

**Stop here and ask the user if you can't find it.** Reviewing without design intent produces shallow critique. *"This code does X"* is verifiable; *"this code should do Y instead of X"* requires knowing what Y is per the design.

---

## Phase 4 — Verification disciplines (non-negotiable)

These four rules govern every claim you make about the PR. They're learned from prior review-session failures; each one corresponds to a specific class of error.

### Rule 1 — Cite primary sources, or label inferences

When you make a claim about an RFC, spec, library behavior, or vendor API:

- **Either** cite the source: URL + section + quoted text. *"RFC 7644 §3.5.2 says PATCH operations MUST be atomic per [link]."*
- **Or** label the inference: *"Inferred from library documentation, not verified against the RFC text."*

**Why this rule exists**: a prior session had an agent claim *"RFC 7644 doesn't specify operator precedence"* — based entirely on reading three library docstrings that called the precedence rule "convention." The RFC actually does specify it (with a MUST clause in prose below the ABNF). The agent had no access to read the RFC and presented an inference as fact. The next reviewer would have inherited that wrong claim.

**The generative half of Rule 1.** Labeling tells you what to do with a claim you already hold. This tells you how to earn one in the first place:

<!-- @include-begin _shared/external-behavior-verification.md -->
**Never assert third-party behavior from memory.** ORM tag semantics, which plan
the query planner will pick, which driver parameter actually takes effect, how a
proto field lands on the wire, what a language feature does at an edge — these
are the claims that feel most certain and are wrong most often, because what you
remember is the common case and the finding always lives in the uncommon one.

Three things before such a claim leaves your hands:

1. **Name the layer that actually controls the behavior.** The annotation, the
   driver, the connection string, the server-side default, and the dialect each
   get a vote, and only one of them decides. *"There is a `json:` tag on the
   field"* is not a mechanism; *"the encoder at `marshal.go:212` reads that tag
   and drops the zero value"* is. A type name, an annotation, or a nearby symbol
   is a place to look, not a cause.
2. **Read that layer's official documentation** — WebFetch or WebSearch the
   vendor's own page, not a blog post recounting it — and cite the URL plus the
   section. If you could not reach it, say the claim is inferred, and from what.
3. **Run it when running it is cheap.** A five-line scratch program, one targeted
   test, an `EXPLAIN ANALYZE`, a throwaway container: each turns a remembered
   claim into a quoted output. Cite the output, not your memory of it.

This applies symmetrically. The same discipline that stops you shipping a wrong
finding is what lets you *confirm* the author's claim — *"the driver does coerce
this, see the vendor doc §4.2"* is worth as much as a defect, and it is the half
reviewers skip because being right feels like finding nothing.
<!-- @include-end _shared/external-behavior-verification.md -->

### Rule 2 — Walk commits forward; review-thread state ≠ code state

Before claiming "bug X is still open at HEAD" based on an inline comment showing as unresolved:

```bash
# Get the comment's created_at timestamp first
gh api repos/$OWNER/$REPO/pulls/$N/comments --jq '.[] | select(.id == <comment-id>) | .created_at'

# Scan commits AFTER that timestamp for matches against the cited file/issue label
gh api 'repos/'$OWNER'/'$REPO'/pulls/'$N'/commits?per_page=100' --paginate \
  --jq 'sort_by(.commit.author.date) | reverse | .[] | "\(.commit.author.date) \(.commit.message | split("\n")[0])"' \
  | head -30
```

If a 2026-05-21 commit says `fix(scope): address CI-1 ...` and the comment is from 2026-05-19 about CI-1, **the bug is closed in code even though the thread is open in GitHub**. Inline comments persist as discussion artifacts; they don't auto-resolve.

**Strongest verification**: read the actual current code at the cited file:line. Bug in code now → comment still valid. Bug not in code now → comment is historical.

### Rule 3 — Investigate, don't ask permission to look

If a question can be answered by reading a file, running `gh`, or grepping the repo: do it. Don't ask the user *"want me to pull X?"* or *"should I check Y?"* — that wastes turns and signals lack of agency.

The exception: actions with side effects (posting reviews, force-pushing, sending messages, deleting work). Confirm before those. Reading and investigation are not side effects.

Also: drop verbal tics like *"honest take,"* *"my honest read,"* *"honestly."* They add nothing. If a take needs hedging, hedge specifically — *"I haven't verified this against the code"* — not vaguely.

### Rule 4 — Verify actual artifacts, not summaries

When asked to investigate or validate something, check the actual state — code, logs, DB, the file on disk — first. Do not summarize the spec or PR description back to the user and call that investigation. The summary is what's claimed; the artifact is what's true.

---

## Phase 5 — Dispatch agents (when the harness has them)

For PRs with significant scope or structural risk, parallel specialty agents add value over solo review. Generic shapes (your harness may name them differently):

| Agent role | When to dispatch |
|---|---|
| **Fresh-eyes / Explore** | Read the PR code cold, isolated from the PR description, to predict where future maintainers will be confused. The isolation is load-bearing — agents that read the description rationalize the design instead of probing it. |
| **Formal / theoretical analysis** | For RFC compliance, ABNF correctness, formal algebraic invariants, build-vs-buy framing with falsifiable axes. |
| **Red-team / paradigm-assessor** | To challenge load-bearing design claims ("this is exhaustive by construction," "this round-trip invariant holds"). |
| **Surgical / code-quality** | For kata-style line-level review focused only on what's wrong, not comprehensive commentary. |
| **Production-readiness** | For PRs heading to prod paths — error handling, observability, scaling. |

**Prompt design rules for any agent**:

1. State the working directory and the exact HEAD SHA the agent should read from. Otherwise it'll read main and produce stale findings.
2. For agents claiming RFC/spec compliance: require URL + section + quoted text, or explicit "inferred from secondary sources" labeling.
3. For fresh-eyes agents: **exclude the PR description from the prompt**. Otherwise the agent anchors on the author's framing.
4. Tell the agent the user's intent (review-only / produce-fixes / write-tests) — agents not told this often default to writing code.

---

## Phase 6 — Verify before relaying

Every agent claim that gets relayed to the user must be verified by you against the actual code or design doc. Agent confidence is not evidence.

Failure modes to expect:

- **Misidentified targets**: agent searches for "helpers" and finds the wrong helpers. *Example*: a discovery agent flagged a PR author as having lied about "inlining helpers" when the author had inlined a *different* set of helpers (toMap/toSlice) than the agent looked at (compareBool/compareString).
- **Stale framing**: agent reads inline comments as a punch list, doesn't walk commits forward to check fixes. Rule 2 catches this.
- **Phantom citations**: agent cites "RFC §X" without quoting; Rule 1 catches this.

When an agent says X, your reply should not be *"the agent found X."* It should be *"X is verified: file.go:42 has the cited code"* or *"the agent claimed X but file.go:42 shows Y — drop the claim."*

---

## Phase 7 — Output format: the falsifiable matrix

The durable artifact of a review is a per-PR notes file. Format below. Each row is structured so a future reader can independently verify the claim in 30 seconds — no judgment call required, just a check.

<!-- @include-begin _shared/review-artifact-destination.md -->
**Where the notes file goes.** Resolve the destination in this order, and state
which one you used when you hand the review over:

1. **`$HUD_ROOT/projects/<project>/notes/PR-N-<slug>.md`** when `HUD_ROOT`
   resolves — the env var if set, else `~/hud` if that directory exists. This is
   the default, and it is the HUD consolidation rule applied: a review artifact
   *is* a note, and notes live in exactly one tree — the one that is backed up,
   indexed, and searchable months later when you need the matrix again.
2. **`/tmp/<owner>-<repo>-review/PR-N-<slug>.md`** only when no HUD tree
   resolves. A scratch path is an honest "this is not being kept"; say so
   rather than letting the author assume it was filed somewhere.

Two destinations are wrong regardless of which branch you took. **Never a
browser's download directory** — it is unbacked-up, unindexed, and invisible to
every later search, so work content put there is work content lost. **Never
inside the repo under review**, which is how a private review note becomes a
commit. And never inside the agents/skills repo either: that repo holds the
review machinery, not the output of running it.
<!-- @include-end _shared/review-artifact-destination.md -->

Consistency across reviews is the point of having one destination rather than picking each time: future-you greps their own past matrices, and can only do that if they all landed in the same tree.

```markdown
# PR #N — [title] ([ticket-id])

| Field | Value |
|---|---|
| Author | [github handle] |
| Size | +X / -Y, Z files |
| State | OPEN / CLOSED / MERGED |
| Self-review | N AI bot passes, M open inline comments |
| Linked design doc | [path or URL] |
| Notes-author | [your handle] |

## What it does (one paragraph)

[Plain-language summary. Not the PR title, not the body — your own words after reading the code.]

## Design anchor

| Source | Section | What it requires |
|---|---|---|
| [Design doc] | §X | "[quoted requirement]" |
| [RFC] | §Y | "[quoted requirement]" |
| [Threat model] | R-N | "[quoted risk]" |

## Falsifiable matrix

Each row: claim, where to verify, current verdict, who verified.

| # | Claim | Evidence location | Verdict | Verified by |
|---|---|---|---|---|
| 1 | Field X exists at proto field number Y | `path/to/file.proto` line Z | ✅ verified | [your handle], [date] |
| 2 | Code at file:line implements design requirement A | `path/to/file.go:L42-L60` | ✅ matches design | [your handle], [date] |
| 3 | RFC §X.Y requires behavior B | [RFC URL] §X.Y para 3 | ✅ design exists | [your handle], [date] |
| 4 | PR description claims P, but code does Q | PR body §P; `file.go:L80` | ❌ mismatch | [your handle], [date] |
| 5 | Agent claimed C; code at L100 confirms | `file.go:L100` | ✅ agent right | [your handle], [date] |
| 6 | Agent claimed D; code at L120 contradicts | `file.go:L120` | ❌ agent wrong | [your handle], [date] |

**Verdict vocabulary** (use these exact strings, not opinion-shaped variants):

- `✅ verified` — claim is true; evidence read.
- `✅ matches design` — code matches design doc.
- `✅ design exists` — the design doc says what's claimed; code conformance is separate.
- `❌ mismatch` — code contradicts the claim or design.
- `⚠️ deferred` — claim is for code in a different PR / future ticket; not verifiable here.
- `⚠️ unverified` — couldn't verify in this session; verification commands attached below.

## Open gaps (deferred to other PRs)

- [Gap A]: [what it is] → [which future PR or ticket]
- [Gap B]: …

## Quick verification commands

```bash
[command 1 — explicit, runnable, produces evidence for matrix row N]
[command 2 — …]
```
```

**Why this shape**: every row is a checkable claim, not opinion. A new reviewer can pick up the file, run the commands, and confirm the verdicts independently. Reviews built this way compound: each PR's notes are reusable input for the next PR's review.

---

## Phase 8 — Post to GitHub (only when explicitly authorized)

**Default posture: do not post.** Notes stay local until the user explicitly says "post X." This is non-negotiable; posting is the only side-effect category that affects shared state visibly to others.

When authorized:

```bash
# Body-only review (approve / comment / request-changes)
gh pr review $N --repo $OWNER/$REPO --approve -F /tmp/body.md
gh pr review $N --repo $OWNER/$REPO --comment -F /tmp/body.md
gh pr review $N --repo $OWNER/$REPO --request-changes -F /tmp/body.md

# Reply to a specific existing inline thread
gh api repos/$OWNER/$REPO/pulls/$N/comments -X POST \
  -f body="$(cat /tmp/reply.md)" -F in_reply_to=<comment-id>

# Atomic batch: overall body + multiple new inline comments in one submission
gh api repos/$OWNER/$REPO/pulls/$N/reviews -X POST --input /tmp/review.json
# review.json shape:
#   {commit_id, event: "COMMENT|APPROVE|REQUEST_CHANGES", body,
#    comments: [{path, line, body}]}
```

Do not hand-build that payload for an **applyable suggestion** — an inline comment whose body carries a ```suggestion fence the author commits with one click. `scripts/pr-suggest.sh` assembles it, and refuses (nonzero exit) when the anchor is unchanged context, which is the one mistake that ships a dead "Commit suggestion" button. It is dry-run by default. Whether a finding *should* be a suggestion at all is judgment, and stays in `skills/pr-suggestion`; the script only enforces the mechanics.

After posting, verify it landed:

```bash
gh api repos/$OWNER/$REPO/pulls/$N/reviews \
  --jq '[.[] | select(.user.login == "<your-handle>")] | .[-1] | {id, state, submitted_at}'
```

---

## Phase 9 — Engage mode: responding to existing reviewer comments

When the PR already carries inline reviewer comments — yours, or on a PR you're
collaborating on — drafting replies is a distinct workflow from fresh review, and
it lives in full in **[ENGAGE.md](ENGAGE.md)**: §9.0 the reply-tracking file (the
Code-addressed / Reply-posted two-state matrix), §9.1 comment triage, §9.2 the
discovery-agent prompt, §9.3 response templates, §9.4 the permalink hard-gate,
§9.5 present + authorize + post, §9.6 resolve threads + re-request review, §9.7
error handling. Same default-do-not-post posture as Phase 8.

---

## Appendices

Situational reference, moved out of the spine so a review that doesn't need it
doesn't pay for it. All five sections live in **[APPENDICES.md](APPENDICES.md)**:

- **Appendix A — identifying the author's review pattern.** AI-self-review, stacked-PR, design-doc-citing, iterative-fix and description-light authors, and what each changes about your read.
- **Appendix B — how to handle CLOSED-not-merged PRs.** Finding the PR that superseded this one.
- **Appendix C — memory and persistence.** What is worth saving across sessions when the harness has memory.
- **Appendix D — when to invoke the heavier review skills.** Structural (mache/modmap) review and multi-agent panel synthesis.
- **Glossary.** Falsifiable claim, cross-PR invariant, supersedes, walk commits forward.
