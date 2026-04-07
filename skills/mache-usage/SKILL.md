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
curl -s --max-time 2 -X POST http://localhost:$PORT/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"check","version":"1"}}}' \
  | grep -q '"result"' && echo "RUNNING" || echo "NOT_RUNNING"
```

If `RUNNING`: skip to Step 4.

### Step 3: Start the server

```bash
mache serve "$SOURCE" --http "localhost:$PORT" &
sleep 3
```

mache auto-detects schema from the source (Go files → go-schema.json, .db → serve directly). Do NOT pass `--schema` unless the user explicitly requests a specific schema.

If `mache` is not in PATH:
```bash
which mache || ls ~/go/bin/mache || ls /usr/local/bin/mache
```
Use whichever path is found.

### Step 4: Initialize session and return info

```bash
SESSION=$(curl -s -X POST http://localhost:$PORT/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"mache-usage","version":"1"}}}' \
  -D - 2>/dev/null | grep -i "mcp-session" | tr -d '\r' | awk '{print $2}')
echo "port=$PORT session=$SESSION"
```

Report to caller:
```
status: available
port: <PORT>
session: <SESSION_ID>
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
