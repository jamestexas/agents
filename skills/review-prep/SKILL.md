---
name: review-prep
description: >
  Given a PR number or diff, synthesize spec-driven diagram, emergent diagram,
  and impact analysis into a structured insight: block for the reviewer.
  Shows what the PR proposes, what the code actually does, the gap between them,
  and blast radius of changed symbols. Output is local reviewer context — never
  posted to GitHub.
allowed-tools: "Bash,Read,Glob,Grep,mcp__mache__*"
argument-hint: "<pr-number-or-repo#N> [repo-path]"
---

# review-prep — Structural Pre-flight for PR Review

Produce the reviewer's local structural context before analysis agents run.
**This output is local only — never include it in a GitHub review.**

## Arguments

`$ARGUMENTS` — `<pr-number-or-repo#N> [repo-path]`

- First arg: PR number (e.g. `36910`) or `owner/repo#N` (e.g. `chainguard-dev/mono#36910`)
- Second arg (optional): local path to the repo checkout

## What To Do

### Step 1: Get changed files

```bash
# Parse PR ref
if echo "$PR_ARG" | grep -q '#'; then
  REPO=$(echo "$PR_ARG" | cut -d'#' -f1)
  PR_NUM=$(echo "$PR_ARG" | cut -d'#' -f2)
  CHANGED_FILES=$(gh pr diff "$PR_NUM" --repo "$REPO" --name-only 2>/dev/null)
else
  PR_NUM="$PR_ARG"
  CHANGED_FILES=$(gh pr diff "$PR_NUM" --name-only 2>/dev/null)
fi
```

If `$CHANGED_FILES` is empty, report:
```
status: unavailable
reason: could not fetch PR diff — check gh auth and PR number
```
Stop here.

### Step 2: Determine scope directory

Find the lowest common ancestor of changed `.go` files:
```bash
GO_FILES=$(echo "$CHANGED_FILES" | grep '\.go$')
if [ -z "$GO_FILES" ]; then
  echo "status: unavailable"
  echo "reason: no Go files changed in this PR — review-prep targets Go codebases"
  exit 0
fi
SCOPE_DIR=$(echo "$GO_FILES" | xargs -I{} dirname {} | sort -u | \
  python3 -c "
import sys
dirs = [d.strip() for d in sys.stdin.readlines()]
if not dirs: exit(1)
common = dirs[0]
for d in dirs[1:]:
    while not d.startswith(common):
        common = '/'.join(common.split('/')[:-1])
        if not common: common = '.'; break
print(common)
" 2>/dev/null || echo ".")

# If repo-path arg was provided, prefix scope
REPO_PATH="${2:-}"
if [ -n "$REPO_PATH" ]; then
  SCOPE="$REPO_PATH/$SCOPE_DIR"
else
  SCOPE="$SCOPE_DIR"
fi
```

### Step 3: Start emergent mache server (port 7532)

```bash
MACHE_BIN=$(which mache 2>/dev/null || echo "$HOME/go/bin/mache")
if [ ! -x "$MACHE_BIN" ]; then
  echo "status: unavailable — mache binary not found"
  exit 0
fi

RUNNING=$(curl -s --max-time 5 -X POST http://localhost:7532/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"check","version":"1"}}}' \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print('RUNNING' if 'result' in d and 'error' not in d else 'NOT_RUNNING')" 2>/dev/null || echo "NOT_RUNNING")

if [ "$RUNNING" = "NOT_RUNNING" ]; then
  $MACHE_BIN serve "$SCOPE" --http localhost:7532 &
  EMERGENT_PID=$!
  for i in $(seq 1 10); do
    sleep 1
    curl -s --max-time 2 -X POST http://localhost:7532/mcp \
      -H "Content-Type: application/json" \
      -H "Accept: application/json, text/event-stream" \
      -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"check","version":"1"}}}' \
      | python3 -c "import sys,json; d=json.load(sys.stdin); exit(0) if 'result' in d else exit(1)" 2>/dev/null && break
    if [ $i -eq 10 ]; then
      kill $EMERGENT_PID 2>/dev/null
      echo "status: unavailable — emergent server failed to start"
      exit 0
    fi
  done
fi

SESSION=$(curl -s -X POST http://localhost:7532/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"review-prep","version":"1"}}}' \
  -D - 2>/dev/null | grep -i "^mcp-session-id:" | tr -d '\r' | awk -F': ' '{print $2}' | tr -d ' ')
```

### Step 4: Get emergent diagram

Follow the `diagram-gen-emergent` pattern: call `get_diagram` (compact=true, layout=LR, exclude_tests=true) and `get_communities` on the running server. Store results as `EMERGENT_OUTPUT`.

If get_diagram returns "No cross-references", set `EMERGENT_STATUS=unavailable`.

### Step 5: Find spec-driven diagram (if schema exists)

Look for a mache schema in the PR's changed files:
```bash
SCHEMA=$(echo "$CHANGED_FILES" | grep -E "(schema\.json|mache\.json|\.schema\.json)" | head -1)
if [ -n "$SCHEMA" ] && [ -n "$REPO_PATH" ]; then
  SCHEMA_PATH="$REPO_PATH/$SCHEMA"
fi
```

If schema found: follow the `diagram-gen-spec` pattern — start a server on port 7534 with `--schema "$SCHEMA_PATH"`, call `get_architecture` and `get_diagram`, store as `SPEC_OUTPUT`. Stop that server when done.

If no schema found: set `SPEC_OUTPUT="schema not found in PR changed files or repo root"`.

### Step 6: Get high-fan-in symbols via get_architecture

```bash
ARCH=$(curl -s -X POST http://localhost:7532/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "mcp-session-id: $SESSION" \
  -d '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"get_architecture","arguments":{}}}' \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['result']['content'][0]['text'])" 2>/dev/null)
```

Extract the `most_referenced` symbol list from the architecture output.

### Step 7: Identify changed symbols and select top candidates for impact

```bash
CHANGED_SYMS=$(gh pr diff "$PR_NUM" ${REPO:+--repo "$REPO"} | \
  grep '^+' | grep -E '^\+(func |type |var |const )' | \
  sed 's/^+//' | awk '{print $2}' | sed 's/(.*$//' | head -20)
```

Cross-reference with `most_referenced` from get_architecture. Select the top 3-5 symbols that appear in `most_referenced`, or the top 3-5 by frequency in the diff if none match.

### Step 8: Call get_impact on selected symbols (max 5)

For each selected symbol (loop, not parallel):
```bash
IMPACT=$(curl -s -X POST http://localhost:7532/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "mcp-session-id: $SESSION" \
  -d "{\"jsonrpc\":\"2.0\",\"id\":5,\"method\":\"tools/call\",\"params\":{\"name\":\"get_impact\",\"arguments\":{\"symbol\":\"$SYM\",\"max_depth\":2}}}" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['result']['content'][0]['text'])" 2>/dev/null)
```

Collect caller counts. Flag any symbol with >20 unique callers as high blast radius.
Deduplicate: if two symbols share >50% of their callers, note it and merge their blast radius counts.

### Step 9: Write drift analysis

If both spec and emergent are available: compare their cluster labels and edge patterns. Write 1-3 sentences.
- Example: "The schema proposes clean layering but the emergent diagram shows dense coupling between persistence and service layers — 6 cross-cluster edges where the spec shows 0."

If spec unavailable: `drift: N/A — no schema found in PR`

### Step 10: Write insights (max 8)

Think as a senior engineer. Pick the observations that matter most — do not enumerate mechanically:

Examples of good insights:
- "`kind` moves from a sparsely-used cluster into the most central cluster — increases blast radius of future kind-related changes"
- "OrgSettings would be largely depopulated after this change — worth reconsidering whether the table/cluster is still needed"
- "3 symbols have >20 callers — behavioral correctness agent should trace these paths first"

### Step 11: Emit structured output

```
## Structural Pre-flight

status: available

### Spec-driven (proposed)
<SPEC_OUTPUT or "schema not found in PR changed files or repo root">

### Emergent (actual)
<EMERGENT_OUTPUT or "unavailable — <reason>">

### Drift
<drift analysis or "N/A — no schema found">

### Impact
high_blast_radius:
  - symbol: <name>, callers: <N>, clusters: [C0, C3]
changed_clusters: [<list of cluster IDs containing changed symbols>]

### Insights
  - "<observation>"
  - "<observation>"
```

Total output: under 400 words plus the two Mermaid blocks.

If both diagrams unavailable:
```
## Structural Pre-flight
status: unavailable
reason: mache could not index this repo — proceeding without structural context is safe
```
