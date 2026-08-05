---
name: workflow-audit
description: >
  Mine the user's Claude Code chat corpus for self-optimization patterns —
  repeated corrections, tool thrash, dropped threads — into a ranked,
  PII-scrubbed report. Different from self-audit (PR code review). Dispatch
  as a sub-agent to keep context clean.
allowed-tools: "Bash,Read,Grep,Glob,Write"
argument-hint: "[output-path] [weeks=12]"
---

# workflow-audit — Mine the agent-chat corpus for optimization targets

Find 10–15 high-leverage interventions in HOW the user works with agents,
ranked by `(bucket_coverage × cost)`, output as a single PII-scrubbed
markdown report.

This skill is intended to be **dispatched as a sub-agent** so the caller's
context stays clean and the analysis is reproducible across machines.

## When to use

- User asks to "audit my chat history", "find optimization targets",
  "what am I correcting agents on repeatedly", or similar.
- User explicitly invokes `/workflow-audit`.
- Periodically (e.g. monthly) as a maintenance ritual on the user's CC setup.

## Arguments

`$ARGUMENTS` — optional, positional:
1. Output path. Default: `~/workflow-audit-<YYYYMMDD>.md`.
2. Weeks of corpus to scan. Default: `12`.

## Prerequisites

The agent must have:

1. **`mache` binary** for the chat-corpus ingest. If missing:
   ```bash
   git clone https://github.com/agentic-research/mache ~/.cache/workflow-audit/mache
   cd ~/.cache/workflow-audit/mache && task install
   ```

2. **`chat-embed` binary** from ley-line-open. If missing:
   ```bash
   git clone https://github.com/agentic-research/ley-line-open ~/.cache/workflow-audit/llo
   cd ~/.cache/workflow-audit/llo && cargo install --path rs/ll-open/chat-embed
   ```

3. **Python 3** with stdlib only (used for JSONL parsing + scoring).
   No third-party deps.

If any prereq install fails, **bail with a clear error**, do not fabricate
findings.

## Load-bearing rules

Three rules that MUST hold for the report to be trustworthy. If you find
yourself relaxing any of them, stop and report why instead of soldiering on.

### Rule 1 — Anti-temporal-bias

The user dispatches a lot of agents; recent weeks are dense and biased.

1. Bucket sessions by ISO week (`YYYY-Www`).
2. **Exclude the 2 most recent calendar weeks** from aggregation.
3. For each finding, compute `bucket_coverage = weeks_appearing / weeks_scanned`.
4. **Rank by `bucket_coverage × estimated_cost`**, NOT by raw count.
5. Drop any finding appearing in fewer than 3 distinct buckets.
6. If a single week contributes >40% of a finding's occurrences,
   either drop the finding or flag the concentration in the report.

### Rule 2 — PII scrub before anything leaves the process

This must run BEFORE any tokens reach the report, the user-facing transcript,
or any tool call's input. Including intermediate thinking and scratch buffers.

Build a deterministic substitution table, then apply it to ALL output. The
table itself **never** appears in the report.

| Real form | Placeholder |
|---|---|
| GitHub user names (mine + colleagues) | `USER_N` |
| Org names (`agentic-research`, employer, …) | `ORG_A`, `ORG_B`, … |
| Repo names | `REPO_N` |
| Branch names | `BRANCH_N` |
| `/Users/<me>/...` and `/home/<me>/...` | `$HOME/...` |
| Email addresses | `EMAIL_N` |
| Phone numbers | `PHONE_N` |
| Slack / Discord / Notion handles | `HANDLE_N` |
| Internal URLs, S3 buckets, DB connection strings | `INTERNAL_URL_N` |
| External-tracker ticket IDs (JIRA, Linear, etc.) | `TICKET_N` |
| Customer / project codenames | `PROJECT_X` |

Rules:
- **Deterministic.** Same input → same placeholder. Patterns must stay
  visible across sessions.
- **Pessimistic on name-shaped tokens.** If it looks like a proper noun
  and isn't a common English word, scrub. False positives are cheap;
  leaked PII is expensive.
- **Pass-through.** Bead IDs, commit SHAs, opaque tokens (UUIDs, hashes)
  pass through unchanged. They're traceable but not identifying.

### Rule 3 — Don't fabricate

- If the corpus is too small (<50 sessions in scope), return a stats-only
  report. Do not invent patterns.
- If a finding hits Rule 1's coverage threshold but the agent isn't sure
  what it means, surface it as a "needs human interpretation" finding.
- Every example snippet in the report must be a real (scrubbed) quote.
  No paraphrases.
- Contradictions between findings must be reported, not collapsed.

## Step 1 — Locate the corpus

The agent-chat corpus lives at:

```
~/.claude/projects/<sanitized-cwd>/
```

Each sub-directory is one project; each `*.jsonl` file is one session.
Skip projects matching `$WORKFLOW_AUDIT_SKIP_PATHS` (env var, glob list) —
this is how the user excludes work projects on the work machine.

```bash
ls -la ~/.claude/projects/ | head -20
```

## Step 2 — Ingest into a single sqlite db

Use mache to consolidate sessions into a queryable shape:

```bash
mache ingest claude-chats \
  --src ~/.claude/projects \
  --out ~/.cache/workflow-audit/chats.db \
  --since "$(date -v-${WEEKS}w +%Y-%m-%d)"   # macOS; Linux: --date "${WEEKS} weeks ago"
```

If `--since` isn't supported, ingest everything and filter at scoring time.

## Step 3 — Embed for semantic clustering

```bash
chat-embed index ~/.cache/workflow-audit/chats.db
chat-embed stats ~/.cache/workflow-audit/chats.db
```

Embeddings drive **Rule 1's pattern persistence detection**. Without them
you can only do exact-phrase matching, which under-counts paraphrased
recurrences (the user says "no" in 30 ways; the embedding model sees them
as one cluster).

If `chat-embed` fails or the user's machine can't run fastembed, fall back
to substring matching with explicit phrase lists. Note the degradation in
the report.

## Step 4 — Sample with anti-temporal-bias

```bash
# Walk the corpus chronologically, bucketing by ISO week.
# Exclude the 2 most recent weeks. Cap at $WEEKS buckets total.
python3 - <<'PY'
import json, glob, os, datetime, collections
import pathlib

BUCKETS = collections.defaultdict(list)
WEEKS = int(os.environ.get("WEEKS", 12))
SKIP = os.environ.get("WORKFLOW_AUDIT_SKIP_PATHS", "").split(":")

for path in glob.glob(os.path.expanduser("~/.claude/projects/*/*.jsonl")):
    if any(s and s in path for s in SKIP):
        continue
    with open(path) as f:
        for line in f:
            try:
                evt = json.loads(line)
            except Exception:
                continue
            ts = evt.get("timestamp") or evt.get("created_at")
            if not ts: continue
            d = datetime.datetime.fromisoformat(ts.rstrip("Z"))
            iso_year, iso_week, _ = d.isocalendar()
            BUCKETS[(iso_year, iso_week)].append((path, evt))

# Drop the 2 most recent buckets.
recent = sorted(BUCKETS.keys())[-2:]
for k in recent: BUCKETS.pop(k, None)

# Cap to the last $WEEKS buckets.
kept = sorted(BUCKETS.keys())[-WEEKS:]
for k in list(BUCKETS.keys()):
    if k not in kept: BUCKETS.pop(k)

print(f"buckets={len(BUCKETS)} events={sum(len(v) for v in BUCKETS.values())}")
PY
```

## Step 5 — Pattern detection

Eight pattern shapes the report ranks. Each is a separate pass over the
bucketed corpus. For every match: record `(bucket, session_id, snippet,
estimated_cost)`.

1. **Repeated user corrections.** User reply ≤30 tokens following an agent
   turn ≥500 tokens, matching one of: `no`, `wait`, `ugh`, `stop`, `ew`,
   `wrong`, `lying`, `you didn't`, `that's not`, `actually`.
2. **Tool-use thrash.** Sessions where ≥4 tool calls precede the first
   `Edit`/`Write`, OR where the same file is `Read` more than twice without
   intervening edits.
3. **Pre-action over-asking.** Agent turn ends with a `?`; next user turn
   ≤20 tokens contains the answer derivable from prior context (heuristic:
   the answer's keywords appear earlier in the same session).
4. **Post-action under-asking.** Tool calls matching `git push`,
   `git push --force`, `gh pr create`, `rm -rf`, `git reset --hard`,
   `gh pr merge` followed by user objection in the next 3 turns.
5. **Dropped threads.** Sessions ending without `git commit`, `gh pr ...`,
   or a final `Stop`/`success` marker AND lasting >10 turns.
6. **Restated constraints.** User instructions (≥3 tokens) appearing in
   `$N` sessions where `N ≥ 3` AND the agent demonstrably violated the
   instruction at least once in a session AFTER the first one. Semantic
   match via chat-embed query.
7. **Long-cycle recurrence.** Same semantic cluster (chat-embed query)
   appearing in ≥4 buckets separated by ≥2 weeks. Surface as "design debt
   the user keeps re-touching."
8. **Phrasing-shift markers.** Register shifts (`honest`, `lowkey`, `tbh`,
   `wait`, `ya feel`, `srsly`) followed within 3 turns by a correction.
   Map to what the agent had just done.

## Step 6 — Score and rank

```
cost_proxy = (tokens_wasted_in_correction_recovery
            + tokens_in_dropped_thread_dead_weight
            + 0.5 × user_turns_in_correction_burst)

bucket_coverage = unique_buckets_appearing / total_buckets_scanned

score = bucket_coverage × cost_proxy
```

Sort findings descending by score. Apply Rule 1 step 5 (drop coverage < 3
buckets). Apply Rule 1 step 6 (flag concentration > 40%). Take top 15.

## Step 7 — Scrub

Run the PII scrub pass over every snippet, finding title, intervention
text, and example. Build the mapping table on first encounter; reuse on
subsequent ones. Verify NO raw forms appear in the output before writing.

```python
# Pseudo:
def scrub(text, table):
    for real, placeholder in table.items():
        text = re.sub(re.escape(real), placeholder, text, flags=re.IGNORECASE)
    return text
```

## Step 8 — Write the report

Output to `$OUTPUT_PATH` (arg 1) using this exact skeleton:

```markdown
# Workflow audit — YYYY-MM-DD
# Buckets scanned: N weeks (recent 2 excluded)
# Sessions: N across M projects
# PII scrub: applied (mapping table not included)
# Corpus health: <one line>

## Top findings (ranked by bucket_coverage × cost)

### F1. <one-line title>
- **Pattern**: <2 sentences, scrubbed>
- **Bucket coverage**: x/N weeks  |  **Concentration**: passed | flagged
- **Estimated cost per occurrence**: <tokens or qualitative>
- **Example (scrubbed)**: > <real quote, scrubbed>
- **Intervention**: <one concrete line>
  - WHERE: `CLAUDE.md` | `~/.claude/settings.json` | new skill | new hook | dispatch pattern
  - WHAT (copy-paste):
    ```
    <fragment>
    ```

### F2. … (repeat through F10–F15)

## Findings dropped (low coverage; for transparency)
- F-D1. <one line>
- F-D2. …

## Corpus health stats
- Sessions / week (last 12 weeks, with the 2 recent included for context)
- Median tool calls / session
- Median user turns / session
- % sessions ending in a `git commit`
- % sessions ending in a user objection within 3 turns
- Top 5 most-edited files (across the corpus, scrubbed to REPO_N pattern)

## Ready-to-apply (3 hand-picked)
For each: WHERE, copy-paste fragment, expected effect, contradiction check
against existing `CLAUDE.md` / `~/.claude/CLAUDE.md` memory entries.

### A1. <title>
### A2. <title>
### A3. <title>

## Notes
- Contradictions surfaced (if any): <list>
- Findings flagged for human interpretation: <list>
- PII scrub: <count> unique forms mapped to placeholders. Mapping lives
  at `~/.cache/workflow-audit/scrub-table.json` and is NOT in this file.
```

## Step 9 — Hand-off

Print the absolute path of the report. Do NOT cat the file (it may be
large). Do NOT post the report to any external system — the user reviews
it locally first.

If invoked by a dispatcher agent, return:

```
report=<absolute path>
buckets=<N>
sessions=<N>
findings_top=<count>
findings_dropped=<count>
prereq_status=<ok|degraded|failed>
```

## Running on work machines

Two safeties:

1. **Skip work projects via env var**: `WORKFLOW_AUDIT_SKIP_PATHS` is a
   colon-separated glob list. Default empty; on work machines set to your
   work-project path patterns.
2. **Scrub-table local-only**: the scrub mapping never leaves the machine.
   If the user wants to compare audits across machines, they compare the
   *reports* (which are placeholder-only); the mappings stay home.

When the report finishes, leave a brief one-liner explaining what's in
`~/.cache/workflow-audit/` so the user knows what to delete vs keep.

## Why this skill exists separately from `self-audit`

| Skill | Surface | Trigger |
|---|---|---|
| `self-audit` | PR code | Before tagging a reviewer |
| `workflow-audit` | Chat corpus | Maintenance ritual, or when the user feels friction |

Don't confuse them. `self-audit` reviews what you wrote. `workflow-audit`
reviews how you wrote it.
