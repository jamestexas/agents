---
name: pr-review-kit
description: >
  Self-contained playbook for rigorous PR review. Use when starting a PR review
  and you want the full discipline: state inspection, design-intent hunting, four
  verification rules (cite primary sources, walk commits forward, investigate-not-
  ask, verify actual artifacts), agent dispatch, falsifiable-matrix output format,
  and GitHub posting only with explicit authorization. Generic — not tied to any
  specific repo, org, or PR author. Sequential phases; can be applied end-to-end
  or used as a reference for specific phases.
allowed-tools: "Bash,Read,Glob,Grep,Edit,Write,Agent"
argument-hint: "[PR number, owner/repo#N, or nothing to ask]"
---


A complete, self-contained playbook for reviewing a pull request. Hand this file to a fresh reader — human or Claude session — along with the target PR, and they have everything needed to do a rigorous review without prior context.

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

File location: `<notes-dir>/PR-N-<short-title>.md`. Pick a `<notes-dir>` outside the repo you're reviewing (so the notes don't get committed) and consistent across reviews (so future-you can grep your own past matrices). Example: `<notes-dir>/<scope-or-stack>-review/PR-12345-protocol-layer.md`.

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

After posting, verify it landed:

```bash
gh api repos/$OWNER/$REPO/pulls/$N/reviews \
  --jq '[.[] | select(.user.login == "<your-handle>")] | .[-1] | {id, state, submitted_at}'
```

---

## Appendix A — Identifying the author's review pattern

Spend two minutes reading a sample of the author's recent PRs to calibrate. Patterns worth detecting:

- **AI self-review pattern**: author posts inline comments via their own bot (often prefixed `🤖:` or labeled "AI panel"). Treat these as pre-merge punch lists, not blocking review. Apply Rule 2 (walk commits forward) ruthlessly.
- **Stacked-PR author**: every PR has a sibling. Read the stack root before reviewing any leaf. The leaf often makes sense only in the context of the root.
- **Design-doc-cited author**: author cites "TRD §X" / "spec §Y" in PR bodies. Find the doc before reviewing. See Phase 3.
- **Iterative-fix author**: author files a small PR, gets AI review, fixes within hours via follow-up commits. The PR's mid-iteration state is normal-state. Don't review the iteration — wait for stabilization, or do a delta review against the last review-stable commit.
- **Description-light author**: PR body is one sentence. Read the linked ticket; if no ticket, read the diff cold and infer intent. Rule 1 applies — label inferences explicitly.

---

## Appendix B — How to handle CLOSED-not-merged PRs

If `state=CLOSED` and `mergedAt=null`:

1. Read the last few issue comments — often the author posts *"Superseded by #M"* when closing.
2. If no supersede comment, check the cross-references in the timeline:
   ```bash
   gh api repos/$OWNER/$REPO/issues/$N/timeline \
     --jq '[.[] | select(.event == "cross-referenced")] | .[].source.issue.number'
   ```
3. The replacement PR may be by a different author (someone consolidated the work). Don't assume the original author files all follow-ups.
4. Update your notes: mark the old PR's notes file as "stale, superseded by #M" and either write a new notes file for #M or note the link.

---

## Appendix C — Memory and persistence (if your harness supports it)

If your harness has persistent memory across sessions (e.g., Claude Code's `~/.claude/projects/<project>/memory/` directory), save the following kinds of findings as the session unfolds:

- **Footguns / quirks** — non-obvious tool behavior (e.g., "this test framework freezes the clock," "this datastore uses MySQL InnoDB gap locks"). File pattern: `reference_<topic>.md`.
- **Workflow corrections from the user** — when the user explicitly says "stop doing X" or "always do Y." File pattern: `feedback_<rule>.md`.
- **Project context** — ongoing initiatives, ticket states, ownership. File pattern: `project_<name>.md`.

Reference these in future sessions to avoid re-discovering the same lessons.

---

## Appendix D — When to invoke the heavier review skills

This kit is the foundation. Two heavier patterns build on it:

- **Mache-driven structural review**: if your harness has a `mache` MCP server (or equivalent code-intelligence tool), use it to generate a spec-driven diagram + emergent diagram of the PR's structural changes. Compare them — the gap between intended and emergent architecture is often the load-bearing finding.
- **Multi-agent panel synthesis**: dispatch 3-4 specialty agents in parallel (Phase 5), then synthesize. Each agent should be told its working dir + HEAD SHA + that it should require primary-source citations. Synthesize their findings against the actual code (Phase 6) before relaying to the user.

These are optimizations on the base playbook, not replacements. Always do Phases 1-4 first; agent dispatch without baseline state-reading produces shallow findings.

---

## Glossary

- **Falsifiable claim**: a statement whose truth can be checked in 30 seconds by running a specific command or reading a specific file:line. *"Field X is at proto number 21"* is falsifiable. *"This design is elegant"* is not.
- **Cross-PR invariant**: a property that must hold across multiple PRs in a stack (e.g., "no symbol from package A is exported to package B"). Verifiable by `grep` across the affected files.
- **Supersedes**: a PR closed without merge whose work has been moved into a different PR — typically a different author, different architectural cut, or a consolidation of multiple smaller PRs into one.
- **Walk commits forward**: starting from a comment's timestamp, scan all subsequent commits to see if any of them addressed the issue the comment raised. Counterpart to "review thread state."
