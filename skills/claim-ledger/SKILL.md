---
name: claim-ledger
description: >
  Before opening a PR, enumerate every behavior it claims — stated, callers-
  unaffected, invariants-preserved — and tag each with the strongest evidence
  actually held: RAN, READ, or ASSUMED with a closed-set reason. Ship the
  ASSUMED residue in the PR description; log harness blockers durably. After
  review, reconcile each correctness comment against the ledger so misses
  are classified as harness / context / attention / lying-test with data,
  not vibes. Use when peers keep finding correctness bugs you didn't, when
  the test harness is too hard to run so you read instead, or in a monorepo
  where blast radius exceeds what one head holds.
allowed-tools: "Bash,Read,Grep,Glob,Agent,Write,mcp__mache__*"
argument-hint: "build [base-branch] | reconcile <PR number | owner/repo#N>"
---

<!-- Author: jamestexas — drafted by Claude (2026-09-02) from a diagnostic
conversation, NOT a reference run. Every calibration below is a hypothesis
until the first `reconcile` produces a tally; promote or delete on evidence,
and replace this note with real provenance when you do. -->

# claim-ledger — every PR claim, tagged with the evidence you actually hold

The spine, one question:

> **For each behavior this PR claims, what is the strongest evidence I hold
> that it is true — and would I publish that evidence class next to the claim?**

When you wrote code by hand, verification happened in your head while typing.
When an agent writes it, that step has no home: the agent produces, you read,
and the first real execution happens in a peer's head during review. That is
why they find bugs you didn't. This skill gives verification a home *before*
the PR opens, and — the part that matters more — tells you afterward **which
kind** of miss each review comment was.

`self-audit` asks "is this diff clean?" `test-fidelity` asks "do these tests
constrain the code?" This skill asks "what did I actually verify, and what
did I merely believe?" It does not replace either; it wraps them.

## Evidence classes

| Tag | Means | Requires |
|---|---|---|
| `RAN` | Executed against real code, observed the outcome | Command, exit code, output captured under `commands/` |
| `READ` | Traced without executing | `file:line` citations, or a fresh-context adversarial verdict on *this claim* |
| `ASSUMED` | Not verified | Reason from the closed set below + one line naming the blocker |
| `UNLISTED` | *(reconcile only)* A reviewer found a claim you never enumerated | — |

**ASSUMED reasons (closed set):**

- `harness` — could not execute: needs creds / a cluster / 40 minutes / is
  flaky. Name the exact blocker.
- `context` — do not know what a consumer or sibling package assumes. Name
  the consumer.
- `budget` — chose not to. Say so plainly.

## Iron rules

1. **Correlated evidence does not upgrade.** A test written in the same
   session as the code it tests shares that session's misunderstanding. It is
   `READ` until it passes `test-fidelity`'s spine question. Green is not
   `RAN`.
2. **Every claim carries exactly one tag.** Rows start as `ASSUMED` and are
   upgraded by evidence. An untagged claim is a lie of omission; the ledger is
   complete or it is not a ledger.
3. **Reasons are a closed set.** Free-text reasons do not aggregate, and
   aggregation across PRs is the entire point of `reconcile`.
4. **The residue ships.** The `ASSUMED` block goes into the PR description
   verbatim. Discomfort about publishing a row is the signal to go discharge
   it — never to delete it.
5. **`build` without `reconcile` is a checklist.** `reconcile` is what turns it
   into measurement. Skipping it is how you end up guessing "harness vs.
   skill" for another quarter.
6. **Durable directory, never session tmp.**
   `~/claim-ledgers/<org>-<repo>/<branch>/` with `ledger.md`, `residue.md`,
   `commands/`. Session scratch gets garbage-collected mid-run; that failure
   is already on the books in `counterfactual-audit`.

## Where claims come from — three sources, all mandatory

**1. Stated.** PR title, description draft, every commit message. Each verb
phrase is a claim ("retries on 5xx", "no behavior change for existing
callers"). Negative claims count double — "backward compatible" is the claim
most often assumed and least often run.

**2. Callers-unaffected.** Every changed exported symbol implies "existing
callers still behave." Enumerate callers with `mache` (`find_callers`,
`get_impact --max-depth 2`); fall back to `rg -w <Symbol>` with the
unqualified-call discipline from `counterfactual-audit` pass 2. Cluster by
consuming package: **one claim per consuming package**, not per call site.
This is where monorepo breadth becomes finite — a claim list, not a feeling.

**3. Invariants-preserved.** For every touched package read the nearest
`AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING.md`, or invariants doc. Each stated
invariant the diff could plausibly violate is a claim. **If a touched package
has no such file, record that as a row** — it is an `UNLISTED` finding
waiting to happen, and `reconcile` will tell you to write it.

**Size calibration.** A reviewable PR yields 5–20 claims. More than 20 → the
PR is too big; stop and run `work-scope`. Fewer than 5 on a 300+ line diff →
you are under-enumerating; go back to source 2.

---

## `build` — before the PR opens

### Step 0 — Resolve and set up

```bash
BASE="${1:-main}"
SHA=$(git rev-parse HEAD)
BRANCH=$(git rev-parse --abbrev-ref HEAD)
ORG_REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner | tr '/' '-')
LEDGER_DIR="$HOME/claim-ledgers/$ORG_REPO/$BRANCH"
mkdir -p "$LEDGER_DIR/commands"
git diff --stat "$BASE...HEAD"
git log --format='%h %s%n%b' "$BASE..HEAD"
```

### Step 1 — Enumerate

Write `ledger.md` with every row from all three sources, **all tagged
`ASSUMED`**, before discharging any of them. Enumerate first, discharge
second; interleaving means you fix the first row and never finish the list.

```markdown
| # | Claim | Source | Tag | Evidence / reason |
|---|---|---|---|---|
| 1 | Retries on 5xx up to 3× with backoff | stated | ASSUMED | — |
| 2 | pkg/ingest callers of `Fetch` unaffected (14 sites) | callers | ASSUMED | — |
| 3 | `AGENTS.md`: writers never hold the lock across a network call | invariant | ASSUMED | — |
| 4 | pkg/export has no invariants doc | invariant | ASSUMED | context: none exists |
```

### Step 2 — Discharge, highest blast radius first

Sort by caller count descending. For each row:

**Try `RAN`.** Is there a Taskfile target or test that exercises *this
claim*? Run it. Capture stdout/stderr and exit code to
`commands/<row>-<slug>.txt`. If the test was written this session, it stays
`READ` until `test-fidelity` says it constrains the code (rule 1).

If the harness blocks you — needs a cluster, needs creds, takes too long,
flakes — **write the blocker verbatim as the `harness` reason and move on.**
Do not fight the harness during `build`. An hour lost to a flaky integration
suite is an hour not spent on the other 14 rows. The gap log (step 4) is where
that hour gets repaid, as its own PR.

**Else `READ`.** Trace by hand and cite `file:line` for the path that makes
the claim true. Or dispatch a **fresh-context** subagent — never a fork, which
inherits the writer's assumptions — scoped to this one claim:

> Here is a diff and one claim about it: `<claim>`. Find the input, caller,
> or sequence under which the claim is false. Cite file:line. If you find
> nothing, say "holds" — do not manufacture concerns.

The reader is uncorrelated with the writer. That is its only value; a
"holds" from the same context that wrote the code is worth nothing.

**Else `ASSUMED` stays**, with its reason.

### Step 3 — Emit `residue.md`

This block goes into the PR description **verbatim**. Flat tone: it is a map
for the reviewer, not a confession.

```markdown
## Verification

RAN (n): #1 retry/backoff (`task test:pkg/client`), #2 …
READ (n): #3 lock invariant (traced `writer.go:88-114`; adversarial pass: holds)

### Not verified — reviewer attention here
- [harness] #5 export job end-to-end — blocked by: integration suite needs a live GCS bucket
- [context] #7 pkg/billing callers of `Amount` — unknown: whether billing rounds before or after
- [budget] #9 log line format — chose not to; cosmetic
```

### Step 4 — Log harness gaps durably

Every `harness`-reasoned row is appended to
`~/.claude/skills/claim-ledger/harness-gaps.jsonl` — outside any git repo:

```json
{"ts":"2026-09-02","repo":"org/repo","blocker":"integration suite needs a live GCS bucket","claim":"export job end-to-end"}
```

Three hits on the same blocker is a bead. That backlog *is* the platform
work; the fix is almost always `taskfile-ci-parity` on the top entry.

### Step 5 — Stop

`build` produces no fixes. Findings during discharge become new commits
*after* the ledger is complete (`self-audit`'s no-amend rule applies), and
the ledger row is re-tagged when they land.

---

## `reconcile` — after review, mandatory

### Step 1 — Fetch correctness comments

```bash
N=<pr>; OWNER=<org>; REPO=<repo>
gh api "repos/$OWNER/$REPO/pulls/$N/comments" \
  --jq '.[] | {path, line, user: .user.login, body}'
gh api "repos/$OWNER/$REPO/pulls/$N/reviews" \
  --jq '.[] | select(.body != "") | {user: .user.login, state, body}'
```

Keep comments about **behavior** — wrong output, missed case, race, broken
caller, violated invariant. Drop nits, style, naming, and bot output (list bot
logins in the extensions file). When a comment is ambiguous, ask the user
**one** question, not a battery.

### Step 2 — Map each comment to a ledger row, or `UNLISTED`

### Step 3 — Classify and act

| Landed on | What it means | Action |
|---|---|---|
| `RAN` | Your verification lied | Dispatch `test-fidelity` on that test. It is theatre until fixed. |
| `READ` | Reading missed it | Record diff size and whether a fresh-context pass ran on *that row*. This is the attention signal. |
| `ASSUMED` | The system worked — the reviewer looked where you pointed | No fault. Count it. If `harness`-reasoned, the gap-log entry gets a hit. |
| `UNLISTED` | You did not know it was a claim | **Write the invariant** into the nearest `AGENTS.md`/`CLAUDE.md` for that package — in this PR or a follow-up. This is the context loop closing. |

### Step 4 — Tally

Append one line per comment to `~/.claude/skills/claim-ledger/tally.jsonl`:

```json
{"ts":"2026-09-05","repo":"org/repo","pr":412,"landed":"UNLISTED","reason":null,"pkg":"pkg/billing"}
```

Then print the distribution over the last 10 PRs.

### Reading the tally

| Dominant class | Verdict | What to change |
|---|---|---|
| `ASSUMED[harness]` | Harness problem | The gap log is your backlog. `taskfile-ci-parity` on the top blocker, as its own PR. |
| `UNLISTED` | Context problem | Every reconcile writes one invariant down. Six months of this is the monorepo's missing AGENTS.md tree. |
| `READ` | Attention problem | Smaller diffs (`work-scope`), and the fresh-context reader on every row, not just the ones that felt risky. |
| `RAN` | Tests are lying | `test-fidelity` on every test-bearing PR before it opens. |

"Harness" is a valid verdict. So is "skill." So is "both, in this ratio."
The point is to stop guessing.

---

## Calibration

- **Zealotry** — a claim per hunk, a 60-row ledger nobody reads. Claims are
  *behaviors*, not lines. Cluster callers by package. Aim for 5–20.
- **Honesty theatre** — `ASSUMED[budget]` on everything. The ledger is true
  and useless. More than 50% `ASSUMED` → stop; discharge rows or shrink the
  PR. Do not open it.
- **Fighting the harness mid-build** — see step 2. Log the gap, move on.
- **Residue as apology** — hedging language in the residue invites the
  reviewer to skim it. Flat rows, one line each.
- **Reconciling only the bad PRs** — a PR with zero correctness comments is
  a data point too. Record it, or the tally is survivorship-biased.

## Common mistakes *(hypotheses — earn or delete after five reconciles)*

| Mistake | Expected consequence |
|---|---|
| Ledger in session tmp | Lost mid-run; `reconcile` has nothing to map against |
| Treating a same-session test as `RAN` | The row that the reviewer's bug lands on, every time |
| Skipping source 2 because "it's internal" | Monorepo consumers are exactly where `UNLISTED` comes from |
| Free-text `ASSUMED` reasons | Tally cannot aggregate; verdict stays a vibe |
| Deleting an uncomfortable residue row | You just shipped the bug with less reviewer attention on it |

## Project-specific extensions (optional)

If `~/.claude/skills/claim-ledger/extensions.md` exists, read it at the start
of `build` step 2 and `reconcile` step 1. It layers, per repo:

- The **two-minute harness subset** — the fastest Taskfile target that
  exercises each package, so `RAN` is reachable more often.
- Where invariant docs live if not at the conventional paths.
- Bot logins to drop from comment fetches.
- `OWNER`/`REPO` defaults for `gh`.

Absent the file, the procedure is generic and degrades gracefully.

## Why this exists separately

| Skill | Question | Surface |
|---|---|---|
| `self-audit` | Is this diff clean? | The diff |
| `test-fidelity` | Do the tests constrain the code? | The tests |
| `review-prep` | What is the blast radius? | The graph |
| `claim-ledger` | What did I verify vs. believe — and which kind of miss was that? | The claims, across PRs |

`review-prep` feeds source 2. `test-fidelity` gates rule 1. `self-audit` step
7 is one way to discharge a `READ`. `taskfile-ci-parity` is what the gap log
turns into. `work-scope` is where a 30-row ledger sends you.

## Cross-references

- **Evidence tagging lineage:** `counterfactual-audit` (OBSERVED / INFERRED /
  PROPOSED) — same discipline, pointed at a diff instead of an architecture.
- **Callers:** `mache-usage`, `review-prep` steps 6–8.
- **Judgment on `RAN`:** `test-fidelity`.
- **Fresh-context reader:** `self-audit` step 7 prompt, scoped per claim.
- **Where the gap log goes:** `taskfile-ci-parity`.
