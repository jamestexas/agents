#!/usr/bin/env bash
#
# Remove the optional launchd user agent installed by install.sh.
#
# Leaves zero resident state: no running process, no launchd registration, no
# plist. The HUD tree, the config, and `node server.mjs` are untouched —
# that path never depended on the agent in the first place.
#
# The port to verify is read from the plist being removed, so what gets checked
# is what was actually installed, not what the config says today.
#
#     HUD_ROOT   content tree (default: ~/hud, as install.sh's)
#     HUD_LABEL  launchd label (default: [serve] label in hud.toml, else local.hud)
#     --purge-log  also delete $HUD_ROOT/.generated/service.log

set -euo pipefail

purge_log=""
for arg in "$@"; do
  case "$arg" in
    --purge-log) purge_log=yes ;;
    -h | --help)
      printf 'usage: uninstall.sh [--purge-log]\n'
      exit 0
      ;;
    *)
      printf 'uninstall.sh: unknown argument %q\n' "$arg" >&2
      exit 1
      ;;
  esac
done

if [[ "$(uname -s)" != "Darwin" ]]; then
  printf 'uninstall.sh: launchd is macOS-only; nothing to remove here.\n' >&2
  exit 1
fi

service_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
machinery_dir="$(cd -- "${service_dir}/.." && pwd -P)"
# Same two-location split as install.sh: the server is in this repo, the tree
# is elsewhere, and neither is derived from the other.
default_root="${HOME}/hud"
HUD_ROOT="${HUD_ROOT:-$default_root}"
# `pwd -P` matches install.sh, so the log path reported here is the one the
# installed plist actually wrote to. A tree that has already been moved away
# must not stop the agent from being removed, so this falls through rather
# than aborting.
hud_root="$(cd -- "$HUD_ROOT" 2>/dev/null && pwd -P || printf '%s' "$HUD_ROOT")"

label="${HUD_LABEL:-}"
if [[ -z "$label" ]]; then
  # Same posture as install.sh: the server's loadConfig() is the only parser
  # for hud.toml, and its path travels in the environment because server.mjs
  # self-starts when argv[1] names it. Failure falls through to the default
  # label rather than aborting — removal has to work on a broken tree, which
  # is the state most likely to send someone here.
  label="$(
    HUD_CFG_SERVER="${machinery_dir}/server.mjs" HUD_CFG_ROOT="$hud_root" \
      node --input-type=module -e '
        import { pathToFileURL } from "node:url";
        const { loadConfig } = await import(pathToFileURL(process.env.HUD_CFG_SERVER).href);
        const cfg = loadConfig(process.env.HUD_CFG_ROOT);
        const serve = (cfg && typeof cfg.serve === "object" && cfg.serve) || {};
        process.stdout.write(serve.label ? String(serve.label) : "");
      ' 2>/dev/null || true
  )"
fi
label="${label:-local.hud}"

domain="gui/$(id -u)"
target="${domain}/${label}"
plist="${HOME}/Library/LaunchAgents/${label}.plist"
log_file="${hud_root}/.generated/service.log"

port=""
if [[ -f "$plist" ]]; then
  port="$(
    /usr/libexec/PlistBuddy -c 'Print :EnvironmentVariables:HUD_PORT' "$plist" 2>/dev/null || true
  )"
fi

if ! launchctl print "$target" >/dev/null 2>&1 && [[ ! -f "$plist" ]]; then
  printf 'nothing to remove: %s is not loaded and %s does not exist\n' "$label" "$plist"
  exit 0
fi

if launchctl print "$target" >/dev/null 2>&1; then
  launchctl bootout "$target" 2>/dev/null || true
fi
rm -f -- "$plist"

# bootout is asynchronous; wait for launchd to actually forget the label.
for _ in $(seq 1 20); do
  launchctl print "$target" >/dev/null 2>&1 || break
  sleep 0.25
done

failed=""

if launchctl print "$target" >/dev/null 2>&1; then
  printf 'uninstall.sh: %s is still registered with launchd\n' "$target" >&2
  failed=yes
fi

if [[ -e "$plist" ]]; then
  printf 'uninstall.sh: %s still exists\n' "$plist" >&2
  failed=yes
fi

if [[ -n "$port" ]]; then
  released=""
  for _ in $(seq 1 20); do
    if [[ -z "$(lsof -nP -iTCP:"${port}" -sTCP:LISTEN -t 2>/dev/null | head -1 || true)" ]]; then
      released=yes
      break
    fi
    sleep 0.5
  done
  if [[ -z "$released" ]]; then
    holder_pid="$(lsof -nP -iTCP:"${port}" -sTCP:LISTEN -t 2>/dev/null | head -1 || true)"
    printf 'uninstall.sh: port %s still listening (pid %s) — not ours to kill:\n' \
      "$port" "${holder_pid:-unknown}" >&2
    ps -o pid=,command= -p "${holder_pid}" >&2 || true
    failed=yes
  fi
fi

if [[ -n "$purge_log" ]]; then
  rm -f -- "$log_file"
fi

if [[ -n "$failed" ]]; then
  exit 1
fi

printf 'hud service removed\n'
printf '  label %s (no longer known to launchd)\n' "$label"
printf '  plist %s (deleted)\n' "$plist"
if [[ -n "$port" ]]; then
  printf '  port  %s released\n' "$port"
fi
if [[ -n "$purge_log" ]]; then
  printf '  log   %s (deleted)\n' "$log_file"
elif [[ -f "$log_file" ]]; then
  printf '  log   %s kept (gitignored; --purge-log removes it)\n' "$log_file"
fi
printf '\nthe HUD still runs the canonical way:\n'
printf '  node %s\n' "${machinery_dir}/server.mjs"
