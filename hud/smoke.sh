#!/usr/bin/env bash
#
# Integration smoke gate for the HUD.
#
# Runs the REAL server against the REAL HUD tree with no stubs, no fixtures and
# no fake home: the tree is a real content tree, sessions come from the actual
# ~/.claude the config points at, and the dynamic sources are hit as
# configured. The unit tests in test/ are hermetic on purpose; this is the
# counterpart that refuses to be, so "all green" cannot mean "green against a
# world we invented".
#
# Every assert fails loud and exits non-zero. Exit 0 means all of them held.
#
# Dependencies: bash, curl, jq, node. Nothing installed, nothing vendored.
#
#   bash hud/smoke.sh
#   HUD_ROOT=~/somewhere-else bash hud/smoke.sh
#   HUD_SMOKE_PORT=5011 bash hud/smoke.sh
#
set -euo pipefail

# Machinery and content are two locations now: this script lives with the
# machinery in a shared repo, and the tree under test is somewhere else. So the
# tree can no longer be derived from this script's path — HUD_ROOT selects it,
# defaulting to the server's own `~/hud`. The gate still names its subject out
# loud in the preflight assert, which is what stops "green" from being green
# against an unexpected tree.
MACHINERY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HUD_DIR="$(cd "${HUD_ROOT:-$HOME/hud}" 2>/dev/null && pwd || echo "${HUD_ROOT:-$HOME/hud}")"
export HUD_ROOT="$HUD_DIR"
PORT="${HUD_SMOKE_PORT:-4899}"
BASE="http://127.0.0.1:${PORT}"
SERVER="$MACHINERY_DIR/server.mjs"
TEST_DIR="$MACHINERY_DIR/test"
MANIFEST="$HUD_DIR/.generated/migration-manifest.json"
LECTIO_PROBE="http://127.0.0.1:7533"

SMOKE_TMP="$(mktemp -d "${TMPDIR:-/tmp}/hud-smoke.XXXXXX")"
SERVER_LOG="$SMOKE_TMP/server.log"
SERVER_PID=""
PASS_N=0

# ------------------------------------------------------------- reporting

pass() {
  PASS_N=$((PASS_N + 1))
  printf 'PASS  [%02d] %s\n' "$PASS_N" "$1"
}

fail() {
  printf '\nFAIL  %s\n' "$1" >&2
  if [[ -s $SERVER_LOG ]]; then
    printf '\n--- server log (last 40 lines) ---\n' >&2
    tail -40 "$SERVER_LOG" >&2
  fi
  printf '\nSMOKE FAILED after %d passing assert(s)\n' "$PASS_N" >&2
  exit 1
}

# ------------------------------------------------------------- lifecycle

stop_server() {
  [[ -n $SERVER_PID ]] || return 0
  kill -0 "$SERVER_PID" 2>/dev/null || { SERVER_PID=""; return 0; }
  kill "$SERVER_PID" 2>/dev/null || true
  for _ in $(seq 1 50); do
    kill -0 "$SERVER_PID" 2>/dev/null || break
    sleep 0.1
  done
  kill -9 "$SERVER_PID" 2>/dev/null || true
  SERVER_PID=""
}

cleanup() {
  stop_server
  rm -rf "$SMOKE_TMP"
}
trap cleanup EXIT INT TERM

# True when something is listening on $PORT. lsof where available (darwin and
# most linux), otherwise a connect attempt.
port_busy() {
  if command -v lsof >/dev/null 2>&1; then
    lsof -ti "tcp:${PORT}" -sTCP:LISTEN >/dev/null 2>&1
  else
    curl -s -o /dev/null --max-time 2 "$BASE/" 2>/dev/null
  fi
}

# ------------------------------------------------------------- assert 00: preflight

for dep in curl jq node; do
  command -v "$dep" >/dev/null 2>&1 || fail "missing dependency: $dep"
done
[[ -f $SERVER ]] || fail "no server at $SERVER"
[[ -d $TEST_DIR ]] || fail "no test dir at $TEST_DIR"
[[ -d $HUD_DIR ]] || fail "HUD_ROOT $HUD_DIR is not a directory — point it at the content tree"
[[ -f $HUD_DIR/hud.toml ]] || fail "no hud.toml in $HUD_DIR — that is not a HUD content tree"
port_busy && fail "port $PORT is already in use — refusing to smoke against a server this script did not start"
pass "preflight: curl/jq/node present, machinery at $MACHINERY_DIR, real tree at $HUD_DIR, port $PORT free"

# ------------------------------------------------------------- start the real server

HUD_PORT="$PORT" node "$SERVER" >"$SERVER_LOG" 2>&1 &
SERVER_PID=$!

ready=""
for _ in $(seq 1 80); do
  if curl -sf -o /dev/null --max-time 2 "$BASE/api/tree" 2>/dev/null; then
    ready=yes
    break
  fi
  kill -0 "$SERVER_PID" 2>/dev/null || fail "server exited during startup (pid $SERVER_PID)"
  sleep 0.25
done
[[ -n $ready ]] || fail "server never answered $BASE/api/tree within 20s"
pass "server up on $PORT (pid $SERVER_PID) serving HUD_ROOT=$HUD_ROOT"

# ------------------------------------------------------------- assert 01: /api/tree

curl -sf --max-time 10 -o "$SMOKE_TMP/tree.json" "$BASE/api/tree" ||
  fail "/api/tree did not return 2xx"
jq -e . "$SMOKE_TMP/tree.json" >/dev/null 2>&1 || fail "/api/tree body is not JSON"

n_sections=$(jq '.sections | length' "$SMOKE_TMP/tree.json")
n_entries=$(jq '[.sections[].entries[]] | length' "$SMOKE_TMP/tree.json")
n_playbooks=$(jq '[.sections[] | select(.name == "playbooks") | .entries[]] | length' "$SMOKE_TMP/tree.json")

[[ $n_sections -ge 4 ]] || fail "/api/tree has $n_sections sections, need >= 4"
[[ $n_entries -ge 10 ]] || fail "/api/tree has $n_entries total entries, need >= 10"
[[ $n_playbooks -ge 1 ]] || fail "/api/tree has $n_playbooks entries under playbooks, need >= 1"
pass "/api/tree: $n_sections sections, $n_entries entries, $n_playbooks under playbooks"

# ------------------------------------------------------------- assert 02: /api/md byte-match

# Pick the note dynamically. Preference is a path that /api/tree lists AND the
# migration manifest claims to have written, so this asserts against genuinely
# migrated content; the manifest is generated (gitignored), so a fresh tree
# falls back to any parsed note under projects/ or archive/.
jq -r '[.sections[].entries[] | select(.listed != true) | .path // empty | select(test("\\.md$"))] | .[]' \
  "$SMOKE_TMP/tree.json" | sort >"$SMOKE_TMP/tree-md.txt"
[[ -s $SMOKE_TMP/tree-md.txt ]] || fail "/api/tree listed no parsed markdown entries at all"

# Content parity. The entry-count floors above carry deliberate slack, so on
# their own they would let a note vanish and still call the tree healthy. This
# is the assert that turns "a note left the tree" into a failure, and it needs
# an oracle for what *should* be there:
#
#   git    — every committed note under a section dir must still be served.
#            Superset of the manifest and always current, so it is preferred.
#   manifest — the migration's own promised destinations. Fallback only: it is
#            a generated artifact (gitignored), so a fresh clone lacks it, and
#            it says nothing about notes authored after the migration.
#
# Root-level files (HUD.md, index.md, log.md), `_hud/` and anything under a
# `raw/` directory are excluded because the server does not serve them as
# parsed entries — see SKIP_NAMES and the raw/ listing rule in server.mjs.
EXPECTED=""
EXPECTED_SRC=""
if git -C "$HUD_DIR" rev-parse --git-dir >/dev/null 2>&1; then
  git -C "$HUD_DIR" ls-files -- '*.md' |
    grep '/' | grep -v '^_hud/' | grep -v '/raw/' | sort >"$SMOKE_TMP/expected.txt" || true
  if [[ -s $SMOKE_TMP/expected.txt ]]; then
    EXPECTED="$SMOKE_TMP/expected.txt"
    EXPECTED_SRC="git-tracked notes"
  fi
fi
if [[ -z $EXPECTED && -f $MANIFEST ]]; then
  jq -r '[.[] | select(.kind == "md") | .dest // empty] | .[]' "$MANIFEST" | sort >"$SMOKE_TMP/expected.txt"
  if [[ -s $SMOKE_TMP/expected.txt ]]; then
    EXPECTED="$SMOKE_TMP/expected.txt"
    EXPECTED_SRC="migration manifest"
  fi
fi
if [[ -n $EXPECTED ]]; then
  missing="$(comm -13 "$SMOKE_TMP/tree-md.txt" "$EXPECTED")"
  [[ -z $missing ]] ||
    fail "$EXPECTED_SRC name note(s) /api/tree no longer serves: $(printf '%s' "$missing" | tr '\n' ' ')"
  pass "content parity: all $(wc -l <"$EXPECTED" | tr -d ' ') expected note(s) ($EXPECTED_SRC) are still served by /api/tree"
else
  fail "no oracle for expected content: $HUD_DIR is not a git repo and there is no manifest at $MANIFEST"
fi

NOTE=""
NOTE_SRC=""
if [[ -f $MANIFEST ]]; then
  jq -r '[.[] | select(.kind == "md") | .dest // empty] | .[]' "$MANIFEST" | sort >"$SMOKE_TMP/migrated.txt"
  NOTE="$(comm -12 "$SMOKE_TMP/tree-md.txt" "$SMOKE_TMP/migrated.txt" | sed -n '1p')"
  [[ -n $NOTE ]] && NOTE_SRC="migration manifest ∩ /api/tree"
fi
if [[ -z $NOTE ]]; then
  NOTE="$(grep -E '^(projects|archive)/' "$SMOKE_TMP/tree-md.txt" | sed -n '1p' || true)"
  [[ -n $NOTE ]] && NOTE_SRC="/api/tree (projects|archive fallback)"
fi
if [[ -z $NOTE ]]; then
  NOTE="$(sed -n '1p' "$SMOKE_TMP/tree-md.txt")"
  NOTE_SRC="/api/tree (first parsed note)"
fi
[[ -n $NOTE ]] || fail "could not pick a real note from /api/tree"
[[ -f "$HUD_ROOT/$NOTE" ]] || fail "/api/tree advertised '$NOTE' but no such file on disk"

curl -sf --max-time 10 --get --data-urlencode "path=$NOTE" -o "$SMOKE_TMP/md.out" "$BASE/api/md" ||
  fail "/api/md?path=$NOTE did not return 2xx"
[[ -s $SMOKE_TMP/md.out ]] || fail "/api/md?path=$NOTE returned an empty body"
cmp -s "$SMOKE_TMP/md.out" "$HUD_ROOT/$NOTE" ||
  fail "/api/md?path=$NOTE bytes differ from $HUD_ROOT/$NOTE"
pass "/api/md: $(wc -c <"$SMOKE_TMP/md.out" | tr -d ' ') bytes for '$NOTE' byte-match on-disk file [picked via $NOTE_SRC]"

# ------------------------------------------------------------- assert 03: /api/dyn/board degrades, never 500

board_code="$(curl -s -o "$SMOKE_TMP/board.json" -w '%{http_code}' --max-time 20 "$BASE/api/dyn/board")"
[[ $board_code != "500" ]] || fail "/api/dyn/board returned 500 — a dead source must degrade, not crash"
[[ $board_code == "200" || $board_code == "503" ]] ||
  fail "/api/dyn/board returned $board_code, expected 200 (live/stale) or 503 (down)"
jq -e . "$SMOKE_TMP/board.json" >/dev/null 2>&1 ||
  fail "/api/dyn/board returned $board_code with a non-JSON body"
jq -e '.source == "board"' "$SMOKE_TMP/board.json" >/dev/null 2>&1 ||
  fail "/api/dyn/board body does not name its source"

kill -0 "$SERVER_PID" 2>/dev/null || fail "server died serving /api/dyn/board"
curl -sf -o /dev/null --max-time 10 "$BASE/api/tree" ||
  fail "server stopped answering /api/tree after /api/dyn/board"
pass "/api/dyn/board: HTTP $board_code with JSON body, never 500; server still serving afterwards"

# ------------------------------------------------------------- assert 04: / serves HTML

curl -sf --max-time 10 -D "$SMOKE_TMP/index.head" -o "$SMOKE_TMP/index.html" "$BASE/" ||
  fail "/ did not return 2xx"
grep -qi '<html' "$SMOKE_TMP/index.html" || fail "/ body contains no <html — not an HTML document"
grep -qi '^content-type:.*text/html' "$SMOKE_TMP/index.head" ||
  fail "/ did not send a text/html content-type"
pass "/ serves HTML ($(wc -c <"$SMOKE_TMP/index.html" | tr -d ' ') bytes, text/html)"

# ------------------------------------------------------------- assert 05: /api/sessions over real ~/.claude

sessions_code="$(curl -s -o "$SMOKE_TMP/sessions.json" -w '%{http_code}' --max-time 30 "$BASE/api/sessions")"
[[ $sessions_code == "200" ]] ||
  fail "/api/sessions returned $sessions_code, expected 200 (body: $(head -c 300 "$SMOKE_TMP/sessions.json"))"
jq -e . "$SMOKE_TMP/sessions.json" >/dev/null 2>&1 || fail "/api/sessions body is not JSON"

s_root="$(jq -r '.root // ""' "$SMOKE_TMP/sessions.json")"
[[ -n $s_root ]] || fail "/api/sessions did not report the sessions root it read"
[[ -d $s_root ]] || fail "/api/sessions reported root '$s_root' which is not a directory"

s_count=$(jq '.count // 0' "$SMOKE_TMP/sessions.json")
s_groups=$(jq '.groups | length' "$SMOKE_TMP/sessions.json")
[[ $s_count -ge 1 ]] || fail "/api/sessions count is $s_count, need >= 1 real session from $s_root"
[[ $s_groups -ge 1 ]] || fail "/api/sessions returned $s_count session(s) in 0 groups"
jq -e '.groups | all((.project // "") != "" and (.projectSlug // "") != "" and (.sessions | length) >= 1)' \
  "$SMOKE_TMP/sessions.json" >/dev/null 2>&1 ||
  fail "/api/sessions has a group with no project label or no sessions — sessions must be grouped under a project"
pass "/api/sessions: HTTP 200, $s_count session(s) in $s_groups project group(s) from real $s_root"

# ------------------------------------------------------------- assert 06: sessions are watch-only

for verb in POST PUT PATCH DELETE; do
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 -X "$verb" "$BASE/api/sessions")"
  [[ $code == "405" ]] ||
    fail "$verb /api/sessions returned $code, expected 405 — sessions must be watch-only"
done
kill -0 "$SERVER_PID" 2>/dev/null || fail "server died handling a mutating verb on /api/sessions"
pass "/api/sessions is watch-only: POST/PUT/PATCH/DELETE all 405, server unharmed"

# ------------------------------------------------------------- assert 07: graceful when the lectio daemon is down

if curl -sf -o /dev/null --max-time 3 "$LECTIO_PROBE/" 2>/dev/null ||
  curl -s -o /dev/null --max-time 3 "$LECTIO_PROBE/" 2>/dev/null; then
  LECTIO_STATE="answering"
else
  LECTIO_STATE="unreachable"
fi

graft_top="$(jq -r '.graft // ""' "$SMOKE_TMP/sessions.json")"
case "$graft_top" in
  off | live | unavailable) ;;
  *) fail "/api/sessions .graft is '$graft_top', expected one of off|live|unavailable" ;;
esac

# Per row, tier 2 is either the grafted object or the exact string
# "unavailable". Anything else — null, an error string, a leaked exception —
# means a daemon failure reached the panel as data.
jq -e '[.groups[].sessions[].graft] | length >= 1 and all((type == "object") or (. == "unavailable"))' \
  "$SMOKE_TMP/sessions.json" >/dev/null 2>&1 ||
  fail "/api/sessions has a row whose .graft is neither an object nor \"unavailable\": $(jq -c '[.groups[].sessions[].graft | if type == "object" then "object" else . end] | unique' "$SMOKE_TMP/sessions.json")"

# The daemon being down must show up as absent tier 2, never as a failed
# request: tier 1 still lists, and the panel says so honestly.
if [[ $LECTIO_STATE == unreachable ]]; then
  [[ $graft_top == "unavailable" ]] ||
    fail "lectio on :7533 is unreachable but .graft is '$graft_top' — expected 'unavailable'"
  jq -e '[.groups[].sessions[].graft] | all(. == "unavailable")' "$SMOKE_TMP/sessions.json" >/dev/null 2>&1 ||
    fail "lectio on :7533 is unreachable but some row claims a grafted object"
fi
pass "/api/sessions degrades gracefully: lectio :7533 $LECTIO_STATE, .graft='$graft_top', every row object-or-\"unavailable\", tier 1 intact ($s_count rows)"

# ------------------------------------------------------------- assert 08: nothing logged a request failure

if grep -q 'request failed' "$SERVER_LOG" 2>/dev/null; then
  fail "server logged a request failure during smoke: $(grep -m3 'request failed' "$SERVER_LOG")"
fi
pass "server log clean: no 'request failed' across $PASS_N probed asserts"

# ------------------------------------------------------------- assert 09: unit tests green

if node --test "$TEST_DIR" >"$SMOKE_TMP/tests.log" 2>&1; then
  :
else
  printf '\n--- node --test output (last 60 lines) ---\n' >&2
  tail -60 "$SMOKE_TMP/tests.log" >&2
  fail "node --test $TEST_DIR exited non-zero"
fi
# Exit 0 alone would also be true of a run that collected no tests, so read the
# tally back. Matches both reporters node has shipped: TAP's `# pass 45` and
# the spec reporter's `ℹ pass 45`.
t_pass="$(awk '/^[^ ]+ pass [0-9]+$/ { print $3; exit }' "$SMOKE_TMP/tests.log")"
t_fail="$(awk '/^[^ ]+ fail [0-9]+$/ { print $3; exit }' "$SMOKE_TMP/tests.log")"
[[ -n ${t_pass:-} && -n ${t_fail:-} ]] ||
  fail "could not read a pass/fail tally out of node --test output"
[[ $t_fail -eq 0 ]] || fail "node --test reported $t_fail failing test(s)"
[[ $t_pass -ge 1 ]] || fail "node --test reported $t_pass passing tests — a green run of nothing is not a green run"
pass "node --test $TEST_DIR: $t_pass passed, $t_fail failed"

# ------------------------------------------------------------- assert 10: no leftovers

started_pid="$SERVER_PID"
stop_server
for _ in $(seq 1 40); do
  port_busy || break
  sleep 0.1
done
port_busy && fail "port $PORT is still listening after shutdown — smoke leaked a server"
# Scoped to the pid this run started. A HUD the user is running on the default
# port is not this script's leak, so pgrep over the server path would be a
# false alarm rather than a finding.
kill -0 "$started_pid" 2>/dev/null &&
  fail "server pid $started_pid survived shutdown — smoke leaked a process"
pass "clean exit: port $PORT released, started pid $started_pid reaped"

printf '\nSMOKE PASSED — %d/%d asserts held against the real HUD at %s\n' "$PASS_N" "$PASS_N" "$HUD_ROOT"
exit 0
