#!/usr/bin/env bash
# Asserts the *container image* still renders, against a tree `hud init` makes
# here — not against your real one.
#
# Why this exists separately from the other two gates. `test/bootstrap.test.mjs`
# proves the onboarding path hermetically, but it runs `server.mjs` in-process:
# it cannot see the two things the image does differently, and those two are
# exactly where the container has broken before — `container-entry.mjs` imports
# the server instead of exec'ing it (so the `argv[1]` self-start guard stays
# false and there is one listener, not zero), and it binds `0.0.0.0` (so a
# published port is reachable at all). `smoke.sh` covers the real tree on the
# host. Neither covers the artifact you hand a peer.
#
# Skips loudly, never silently: if docker or the image is absent this exits 0
# with SKIP and says which, so "nothing ran" can never read as "everything
# passed". Only PASS lines are assertions.
#
#   bash hud/container-smoke.sh
#   HUD_IMAGE=hud:0.1.0-arm64 HUD_CTR_PORT=4899 bash hud/container-smoke.sh
#
# Build the image first — see docs/CONTAINER.md.

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
IMAGE="${HUD_IMAGE:-hud:0.1.0-arm64}"
PORT="${HUD_CTR_PORT:-4899}"

PASS_N=0
pass() {
    printf 'PASS  [%02d] %s\n' "$((++PASS_N))" "$1"
}
fail() {
    printf 'FAIL  %s\n' "$1" >&2
    exit 1
}
skip() {
    printf 'SKIP  %s\n' "$1"
    exit 0
}

CID=""
TREE_PARENT=""
cleanup() {
    [[ -n $CID ]] && docker stop "$CID" >/dev/null 2>&1
    [[ -n $TREE_PARENT ]] && rm -rf -- "$TREE_PARENT"
    return 0
}
trap cleanup EXIT

# ---------------------------------------------------------------- preflight
command -v docker >/dev/null 2>&1 || skip "docker not on PATH — container gate not run"
docker info >/dev/null 2>&1 || skip "docker daemon not answering — container gate not run"
docker image inspect "$IMAGE" >/dev/null 2>&1 ||
    skip "image '$IMAGE' not loaded — build it per docs/CONTAINER.md, or set HUD_IMAGE"
command -v curl >/dev/null 2>&1 || fail "no curl"
command -v cmp >/dev/null 2>&1 || fail "no cmp"
if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    fail "port $PORT is already in use — set HUD_CTR_PORT to a free one"
fi
pass "preflight: docker answering, image '$IMAGE' present, port $PORT free"

# ------------------------------------------------------- a tree init just made
TREE_PARENT="$(mktemp -d)"
TREE="$TREE_PARENT/hud"
bash "$HERE/hud" init --root "$TREE" --yes >/dev/null 2>&1 ||
    fail "'hud init' failed against a throwaway root — run it by hand to see why"
[[ -f $TREE/hud.toml ]] || fail "init left no hud.toml at $TREE"

# One note, so "values return" means more than an empty tree rendering.
NOTE="projects/example-project/CONTEXT.md"
mkdir -p -- "$(dirname -- "$TREE/$NOTE")"
cat >"$TREE/$NOTE" <<'MD'
---
title: Example project
date: 2026-01-01
status: active
tags: [alpha, beta]
---

# Example project

Body text with a trailing newline.
MD
pass "content: fresh tree scaffolded by 'hud init', one note written"

# ------------------------------------------------------------------- run it
CID="$(docker run -d --rm -p "$PORT:4870" \
    --mount type=bind,src="$TREE",dst=/hud,ro "$IMAGE" 2>/dev/null)" ||
    fail "docker run failed for $IMAGE"
[[ -n $CID ]] || fail "docker run returned no container id"

BASE="http://127.0.0.1:$PORT"
for _ in $(seq 1 40); do
    curl -fsS -o /dev/null "$BASE/" 2>/dev/null && break
    sleep 0.4
done
curl -fsS -o /dev/null "$BASE/" 2>/dev/null || {
    printf -- '--- container logs ---\n' >&2
    docker logs "$CID" 2>&1 | tail -20 >&2
    fail "container never answered on $BASE after ~16s (read-only bind, or a loopback bind regression)"
}
pass "container up: ${CID:0:12} serving a read-only bind mount, reachable on a published port"

# --------------------------------------------------------------- it renders
SHELL_OUT="$TREE_PARENT/shell.html"
CODE="$(curl -sS -o "$SHELL_OUT" -w '%{http_code}' "$BASE/")"
[[ $CODE == 200 ]] || fail "/ answered $CODE"
BYTES="$(wc -c <"$SHELL_OUT" | tr -d ' ')"
[[ $BYTES -gt 1000 ]] || fail "/ served only $BYTES bytes — a stub, not the shell"
grep -q '<script' "$SHELL_OUT" || fail "/ served no <script> — nothing would ever render"
pass "/ serves the shell ($BYTES bytes, carries a script tag)"

# -------------------------------------------------------------- values return
TREE_JSON="$TREE_PARENT/tree.json"
CODE="$(curl -sS -o "$TREE_JSON" -w '%{http_code}' "$BASE/api/tree")"
[[ $CODE == 200 ]] || fail "/api/tree answered $CODE"
grep -q '"path": *"'"$NOTE"'"' "$TREE_JSON" ||
    fail "/api/tree never advertised the note at $NOTE"
grep -q '"title": *"Example project"' "$TREE_JSON" ||
    fail "/api/tree served the note but did not parse its frontmatter title"
pass "/api/tree returns the note with parsed frontmatter, through the bind mount"

MD_OUT="$TREE_PARENT/md.out"
CODE="$(curl -sS -o "$MD_OUT" -w '%{http_code}' "$BASE/api/md?path=$NOTE")"
[[ $CODE == 200 ]] || fail "/api/md answered $CODE for $NOTE"
cmp -s "$MD_OUT" "$TREE/$NOTE" ||
    fail "/api/md bytes differ from $TREE/$NOTE"
pass "/api/md is byte-identical to the file on disk ($(wc -c <"$MD_OUT" | tr -d ' ') bytes)"

# ------------------------------------------------- degrades, does not crash
for route in /api/dyn/board /api/dyn/digest /api/dyn/peers /api/sessions; do
    BODY="$TREE_PARENT/dyn.json"
    CODE="$(curl -sS -o "$BODY" -w '%{http_code}' "$BASE$route")"
    case "$CODE" in
        200 | 404 | 503) ;;
        *) fail "$route answered $CODE; expected one of 200, 404, 503 (never a 500)" ;;
    esac
    grep -q '"source"' "$BODY" || fail "$route answered $CODE with no source in the body"
done
pass "every dynamic route answers in its documented envelope, no 500s"

# --------------------------------------------------------------- watch-only
for method in POST PUT PATCH DELETE; do
    CODE="$(curl -sS -o /dev/null -w '%{http_code}' -X "$method" "$BASE/api/tree")"
    [[ $CODE == 405 ]] || fail "$method /api/tree answered $CODE, not 405"
done
pass "watch-only holds in the container: POST/PUT/PATCH/DELETE all 405"

# The bind is mounted `ro`, so this is belt-and-braces on top of the 405s:
# even a write that got past routing could not land.
[[ -f $TREE/$NOTE ]] || fail "the note vanished from the host tree"
CODE="$(curl -sS -o /dev/null -w '%{http_code}' "$BASE/api/tree")"
[[ $CODE == 200 ]] || fail "server stopped serving after the method probes"
pass "still serving after every degraded and refused path was exercised"

printf '\nCONTAINER SMOKE PASSED — %d/%d asserts held against %s\n' "$PASS_N" "$PASS_N" "$IMAGE"
