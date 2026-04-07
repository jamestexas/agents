---
name: diagram-gen-spec
description: >
  Generate a top-down structural diagram from a mache schema file.
  Shows intended architecture — what the PR proposes, not what the code does.
  Reviewer local context only, never posted to GitHub.
  Pair with diagram-gen-emergent to see spec vs reality drift.
allowed-tools: "Bash,Read,Glob,Grep,mcp__mache__*"
argument-hint: "<schema-path-or-pr-number> [source-path]"
---

# diagram-gen-spec — Spec-Driven Structural Diagram

Generate a top-down diagram from a mache schema. Shows what the author intended to build.
This is reviewer-local context only — never post this output to GitHub.

## Arguments

`$ARGUMENTS` — `<schema-path-or-pr-number> [source-path]`

- First argument: path to a mache schema JSON file, OR a PR number (to find the schema in the PR's changed files)
- Second argument (optional): source directory to serve against the schema

## What To Do

### Step 1: Find the schema

**If first argument looks like a PR number (all digits or owner/repo#N):**
```bash
# Look for schema files changed in the PR
gh pr diff $ARG --name-only 2>/dev/null | grep -E "(schema\.json|mache\.json|\.schema\.json)"
```

**If first argument is a file path:** use it directly.

**If no schema found from PR, look in the repo root:**
```bash
ls examples/*.json 2>/dev/null | head -5
ls *.json 2>/dev/null | grep -i schema | head -3
```

If no schema found anywhere, return:
```
status: unavailable
type: spec-driven
reason: no mache schema found in PR changed files or repo root
```
Stop here.

### Step 2: Determine source path

If a second argument was provided, use it as `SOURCE`.
Otherwise, if argument was a PR number, derive source from the repo:
```bash
gh pr view $ARG --json headRepository --jq '.headRepository.nameWithOwner' 2>/dev/null
```
Fall back to current working directory if detection fails.

### Step 3: Start mache with the schema on port 7534

```bash
MACHE_BIN=$(which mache 2>/dev/null || echo "$HOME/go/bin/mache")
if [ ! -x "$MACHE_BIN" ]; then
  echo "status: unavailable — mache binary not found"
  exit 0
fi

# Use port 7534 to avoid colliding with the emergent server on 7532
$MACHE_BIN serve "$SOURCE" --schema "$SCHEMA_PATH" --http localhost:7534 &
SPEC_PID=$!

for i in $(seq 1 10); do
  sleep 1
  curl -s --max-time 2 -X POST http://localhost:7534/mcp \
    -H "Content-Type: application/json" \
    -H "Accept: application/json, text/event-stream" \
    -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"check","version":"1"}}}' \
    | python3 -c "import sys,json; d=json.load(sys.stdin); exit(0) if 'result' in d else exit(1)" 2>/dev/null && break
  if [ $i -eq 10 ]; then
    kill $SPEC_PID 2>/dev/null
    echo "status: unavailable — mache serve with schema failed to start"
    exit 0
  fi
done
```

Initialize session:
```bash
SESSION=$(curl -s -X POST http://localhost:7534/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"diagram-gen-spec","version":"1"}}}' \
  -D - 2>/dev/null | grep -i "^mcp-session-id:" | tr -d '\r' | awk -F': ' '{print $2}' | tr -d ' ')
if [ -z "$SESSION" ]; then
  echo "status: unavailable — session initialization failed"
  exit 0
fi
```

### Step 4: Get architecture narrative

```bash
NARRATIVE=$(curl -s -X POST http://localhost:7534/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "mcp-session-id: $SESSION" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"get_architecture","arguments":{}}}' \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['result']['content'][0]['text'])" 2>/dev/null)
```

Truncate to 200 words if longer.

### Step 5: Get diagram

```bash
DIAGRAM=$(curl -s -X POST http://localhost:7534/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "mcp-session-id: $SESSION" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"get_diagram","arguments":{"compact":true,"layout":"LR","exclude_tests":true}}}' \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['result']['content'][0]['text'])" 2>/dev/null)
```

If `$DIAGRAM` contains "No cross-references" or is empty, set DIAGRAM_STATUS to "partial".
Otherwise set DIAGRAM_STATUS to "available".

### Step 6: Format and return

Output this structure exactly (downstream skills parse it):

```
status: available
type: spec-driven
label: Proposed structure (spec-driven)
schema: <SCHEMA_PATH>

narrative:
<NARRATIVE truncated to 200 words>

diagram:
```mermaid
<DIAGRAM truncated to 50 lines>
```
```

If DIAGRAM_STATUS is "partial":
```
status: partial
type: spec-driven
label: Proposed structure (spec-driven)
schema: <SCHEMA_PATH>
diagram: unavailable — schema defines structure but insufficient cross-references to cluster

narrative:
<NARRATIVE>
```
```

### Step 7: Stop the spec server

```bash
kill $SPEC_PID 2>/dev/null
```
