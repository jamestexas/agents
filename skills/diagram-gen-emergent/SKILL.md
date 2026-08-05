---
name: diagram-gen-emergent
description: >
  Generate a bottom-up diagram of actual code coupling from cross-references —
  what the code does, not what was intended. Use for structural PR review; pair
  with diagram-gen-spec for intended-vs-actual drift.
allowed-tools: "Bash,Read,Grep,mcp__mache__*"
argument-hint: "<source-path-or-db> [--compact] [--exclude-tests] [--layout LR|TD]"
---

# diagram-gen-emergent — Community-Emergent Structural Diagram

Generate a bottom-up diagram from real code coupling. Shows structural reality.

## Arguments

`$ARGUMENTS` — `<source-path-or-db> [--compact] [--exclude-tests] [--layout LR|TD]`

Defaults: `--compact`, `--exclude-tests`, `--layout LR`

## What To Do

### Step 1: Parse arguments

```bash
SOURCE=""
COMPACT=true
EXCLUDE_TESTS=true
LAYOUT="LR"

for arg in $ARGUMENTS; do
  case "$arg" in
    --no-compact) COMPACT=false ;;
    --include-tests) EXCLUDE_TESTS=false ;;
    --layout) ;; # next arg is the value
    TD|LR|BT|RL) LAYOUT="$arg" ;;
    --layout=*) LAYOUT="${arg#--layout=}" ;;
    -*) ;; # unknown flag, ignore
    *) SOURCE="$arg" ;;
  esac
done

if [ -z "$SOURCE" ]; then
  echo "status: unavailable — no source path provided"
  exit 0
fi
```

### Step 2: Ensure server is running on port 7532

```bash
MACHE_BIN=$(which mache 2>/dev/null || echo "$HOME/go/bin/mache")
if [ ! -x "$MACHE_BIN" ]; then
  echo "status: unavailable — mache binary not found"
  exit 0
fi

# Check if server already running on 7532
RUNNING=$(curl -s --max-time 5 -X POST http://localhost:7532/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"check","version":"1"}}}' \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print('RUNNING' if 'result' in d and 'error' not in d else 'NOT_RUNNING')" 2>/dev/null || echo "NOT_RUNNING")

if [ "$RUNNING" = "NOT_RUNNING" ]; then
  $MACHE_BIN serve "$SOURCE" --http localhost:7532 &
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
      echo "status: unavailable"
      echo "reason: mache server could not start for $SOURCE"
      exit 0
    fi
  done
fi
```

Initialize session:
```bash
SESSION=$(curl -s -X POST http://localhost:7532/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"diagram-gen-emergent","version":"1"}}}' \
  -D - 2>/dev/null | grep -i "^mcp-session-id:" | tr -d '\r' | awk -F': ' '{print $2}' | tr -d ' ')
if [ -z "$SESSION" ]; then
  echo "status: unavailable — session initialization failed"
  exit 0
fi
```

### Step 3: Get diagram

```bash
DIAGRAM=$(curl -s -X POST http://localhost:7532/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "mcp-session-id: $SESSION" \
  -d "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/call\",\"params\":{\"name\":\"get_diagram\",\"arguments\":{\"compact\":$COMPACT,\"layout\":\"$LAYOUT\",\"exclude_tests\":$EXCLUDE_TESTS}}}" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['result']['content'][0]['text'])" 2>/dev/null)
```

If `$DIAGRAM` contains "No cross-references" or "not enough cross-references" or is empty:
```
status: unavailable
type: emergent
reason: no cross-references indexed — repo may lack shared symbols or needs re-ingestion with a Go schema
```
Stop here.

### Step 4: Get communities

```bash
COMMUNITIES=$(curl -s -X POST http://localhost:7532/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "mcp-session-id: $SESSION" \
  -d "{\"jsonrpc\":\"2.0\",\"id\":3,\"method\":\"tools/call\",\"params\":{\"name\":\"get_communities\",\"arguments\":{\"exclude_tests\":$EXCLUDE_TESTS}}}" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['result']['content'][0]['text'])" 2>/dev/null)
```

Parse the top 5 communities by member count from the JSON response and format as a markdown table.

### Step 5: Format and return

Output this structure exactly (downstream skills parse it):

```
status: available
type: emergent
label: Actual structure (emergent)

diagram:
```mermaid
<DIAGRAM truncated to 50 lines>
```

clusters (top 5):
| ID | Label | Members |
|----|-------|---------|
| C0 | <label> | <count> |
| C1 | <label> | <count> |
| C2 | <label> | <count> |
| C3 | <label> | <count> |
| C4 | <label> | <count> |
```

### Step 6: Note on server lifecycle

Do NOT stop the server — it runs on port 7532 and is reused by review-prep and subsequent calls. Only stop it if you started it and the caller is done (caller will signal this explicitly).
