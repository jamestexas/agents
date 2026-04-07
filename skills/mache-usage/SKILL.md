---
name: mache-usage
description: >
  Start or locate a running mache MCP server for a source path or .db file.
  Builds a .db from source if needed. Base skill used by diagram-gen-spec,
  diagram-gen-emergent, and review-prep. Returns port and session ID.
allowed-tools: "Bash,Read,Glob,Grep,mcp__mache__*"
argument-hint: "<source-path-or-db> [port]"
---

# mache-usage — MCP Server Lifecycle

Ensure a mache MCP server is running for a given source and return the session info.

## Arguments

`$ARGUMENTS` — `<source-path-or-db> [port]`

- `source`: path to a directory of source files or a pre-built `.db` file
- `port`: optional, default `7532`

## What To Do

### Step 1: Parse arguments

```bash
SOURCE="<first argument>"
PORT="${2:-7532}"
```

### Step 2: Check for existing server

```bash
curl -s --max-time 5 -X POST http://localhost:$PORT/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"check","version":"1"}}}' \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print('RUNNING' if 'result' in d and 'error' not in d else 'NOT_RUNNING')" 2>/dev/null || echo "NOT_RUNNING"
```

If `RUNNING`: skip to Step 4.

### Step 3: Start the server

```bash
MACHE_BIN=$(which mache 2>/dev/null || echo "$HOME/go/bin/mache")
if [ ! -x "$MACHE_BIN" ]; then
  echo "status: unavailable — mache binary not found in PATH or ~/go/bin/"
  exit 0
fi
```

mache auto-detects schema from the source (Go files → go-schema.json, .db → serve directly). Do NOT pass `--schema` unless the user explicitly requests a specific schema.

```bash
$MACHE_BIN serve "$SOURCE" --http "localhost:$PORT" &
MACHE_PID=$!
for i in $(seq 1 10); do
  sleep 1
  curl -s --max-time 2 -X POST http://localhost:$PORT/mcp \
    -H "Content-Type: application/json" \
    -H "Accept: application/json, text/event-stream" \
    -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"check","version":"1"}}}' \
    | python3 -c "import sys,json; d=json.load(sys.stdin); exit(0) if 'result' in d else exit(1)" 2>/dev/null && echo "Server ready" && break
  if [ $i -eq 10 ]; then
    kill $MACHE_PID 2>/dev/null
    echo "status: unavailable — mache serve failed to start after 10 seconds"
    exit 0
  fi
done
```

### Step 4: Initialize session and return info

```bash
SESSION=$(curl -s -X POST http://localhost:$PORT/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"mache-usage","version":"1"}}}' \
  -D - 2>/dev/null | grep -i "^mcp-session-id:" | tr -d '\r' | awk -F': ' '{print $2}' | tr -d ' ')
if [ -z "$SESSION" ]; then
  echo "status: unavailable — session initialization failed"
  exit 0
fi
echo "status: available"
echo "port: $PORT"
echo "session: $SESSION"
```

### Step 5: Graceful degradation

If the server fails to start after 10 seconds:
```bash
pkill -f "mache serve.*$PORT" 2>/dev/null
```
Report: `status: unavailable — mache serve failed to start`

Do NOT throw an error that blocks the caller. Return the status string and let the caller decide.

## Helper: Call an MCP tool

Once you have port + session, call any mache tool:

```bash
mcp_call() {
  local PORT=$1 SESSION=$2 TOOL=$3 ARGS=$4
  curl -s -X POST http://localhost:$PORT/mcp \
    -H "Content-Type: application/json" \
    -H "Accept: application/json, text/event-stream" \
    -H "mcp-session-id: $SESSION" \
    -d "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/call\",\"params\":{\"name\":\"$TOOL\",\"arguments\":$ARGS}}" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['result']['content'][0]['text'])" 2>/dev/null
}
```

Usage: `mcp_call $PORT $SESSION get_overview '{}'`
