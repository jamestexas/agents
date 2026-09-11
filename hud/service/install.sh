#!/usr/bin/env bash
#
# Install the HUD server as an optional launchd user agent (macOS).
#
# This is sugar. The canonical way to run the HUD is still:
#
#     node server.mjs
#
# Nothing in the server knows this script exists; it has no service awareness,
# no health endpoint added for launchd, no config coupling. Remove the agent
# with uninstall.sh and you are back to exactly the manual world.
#
# Every value comes from $HUD_ROOT/hud.toml ([serve] table), with the
# environment winning over the file:
#
#     HUD_ROOT   tree to serve          (default: ~/hud, as the server's own)
#     HUD_PORT   port                   (default: serve.port,  else 4870)
#     HUD_LABEL  launchd label          (default: serve.label, else local.hud)
#     HUD_HOST   address health-checked (default: serve.host,  else 127.0.0.1)
#
# Idempotent: re-running replaces a previously installed agent cleanly.

set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  printf 'install.sh: launchd is macOS-only; on this platform run `node server.mjs` directly.\n' >&2
  exit 1
fi

# Two independent locations, and this script is the only thing that knows both:
# the SERVER is wherever this file's repo sits, the TREE is wherever the content
# lives. Deriving one from the other is what broke when the machinery moved out
# of the tree, so neither is derived from the other now.
#
# `pwd -P`, not `pwd`: server.mjs only self-starts when argv[1] matches the URL
# node loaded it from, and node resolves symlinks while argv does not. Handing
# launchd a path through a symlinked root produces a process that exits 0
# immediately and flaps forever under KeepAlive.
service_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
machinery_dir="$(cd -- "${service_dir}/.." && pwd -P)"
server_js="${machinery_dir}/server.mjs"

default_root="${HOME}/hud"
HUD_ROOT="${HUD_ROOT:-$default_root}"
if [[ ! -d "$HUD_ROOT" ]]; then
  printf 'install.sh: HUD_ROOT %q is not a directory — point it at the content tree.\n' "$HUD_ROOT" >&2
  exit 1
fi
hud_root="$(cd -- "$HUD_ROOT" && pwd -P)"
template="${service_dir}/plist.template"

for required in "$server_js" "$template"; do
  if [[ ! -f "$required" ]]; then
    printf 'install.sh: missing %s\n' "$required" >&2
    exit 1
  fi
done

# ------------------------------------------------------------------ node

node_bin="$(command -v node || true)"
if [[ -z "$node_bin" ]]; then
  printf 'install.sh: no `node` on PATH — the HUD server needs it.\n' >&2
  exit 1
fi
# launchd resolves nothing, so store the real absolute path (a PATH hit may be
# a shim, e.g. a version manager, which launchd would never find again).
node_bin="$(cd -- "$(dirname -- "$node_bin")" && pwd)/$(basename -- "$node_bin")"

# ------------------------------------------------------------------ config

# `[serve]` keys only, read through the server's own loadConfig() so the TOML
# parser has exactly one implementation. The shell has no reader for this
# format, and hand-rolling one here would be a second parser to keep correct.
# A missing or malformed config yields empty and the defaults below apply.
#
# Arguments travel in the environment, not argv: server.mjs self-starts when
# argv[1] names it, so passing its path would leave this function trying to
# bind the port it was called to inspect.
cfg_get() {
  HUD_CFG_SERVER="$server_js" HUD_CFG_ROOT="$hud_root" HUD_CFG_KEY="$1" \
    node --input-type=module -e '
      import { pathToFileURL } from "node:url";
      const { loadConfig } = await import(pathToFileURL(process.env.HUD_CFG_SERVER).href);
      const cfg = loadConfig(process.env.HUD_CFG_ROOT);
      const serve = (cfg && typeof cfg.serve === "object" && cfg.serve) || {};
      const value = serve[process.env.HUD_CFG_KEY];
      process.stdout.write(value === undefined || value === null ? "" : String(value));
    '
}

port="${HUD_PORT:-$(cfg_get port)}"
port="${port:-4870}"
label="${HUD_LABEL:-$(cfg_get label)}"
label="${label:-local.hud}"
host="${HUD_HOST:-$(cfg_get host)}"
host="${host:-127.0.0.1}"
hostname_pretty="$(cfg_get hostname)"

if [[ ! "$port" =~ ^[0-9]+$ ]] || (( port < 1 || port > 65535 )); then
  printf 'install.sh: port %q is not a valid port number.\n' "$port" >&2
  exit 1
fi
# The label becomes both a launchd service name and a filename.
if [[ ! "$label" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]]; then
  printf 'install.sh: label %q must match [A-Za-z0-9][A-Za-z0-9._-]*\n' "$label" >&2
  exit 1
fi

domain="gui/$(id -u)"
target="${domain}/${label}"
plist="${HOME}/Library/LaunchAgents/${label}.plist"
# The log is machine-written data about this machine, so it lands in the
# content tree's gitignored .generated/, not beside the public machinery.
log_dir="${hud_root}/.generated"
log_file="${log_dir}/service.log"

# ------------------------------------------------------------------ port

# pid of the already-installed agent, if any — so a re-install does not mistake
# its own service for a squatter on the port.
service_pid() {
  launchctl print "$target" 2>/dev/null |
    awk '$1 == "pid" && $2 == "=" { print $3; exit }'
}

installed_pid="$(service_pid || true)"
holder_pid="$(lsof -nP -iTCP:"${port}" -sTCP:LISTEN -t 2>/dev/null | head -1 || true)"

if [[ -n "$holder_pid" && "$holder_pid" != "$installed_pid" ]]; then
  printf 'install.sh: port %s is already held by pid %s:\n\n' "$port" "$holder_pid" >&2
  ps -o pid=,command= -p "$holder_pid" >&2 || true
  printf '\nRefusing to touch a process this script did not start. Stop it yourself,\n' >&2
  printf 'or pick another port (HUD_PORT=... or [serve] port in hud.toml).\n' >&2
  exit 1
fi

# ------------------------------------------------------------------ render

# launchd hands the process a bare environment; the panels shell out to `gh`
# and the digest CLI, so seed PATH from where those actually live.
path_parts=("$(dirname -- "$node_bin")")
for tool in gh lectio; do
  tool_path="$(command -v "$tool" 2>/dev/null || true)"
  if [[ -n "$tool_path" ]]; then
    path_parts+=("$(dirname -- "$tool_path")")
  fi
done
path_parts+=(/opt/homebrew/bin /usr/local/bin /usr/bin /bin /usr/sbin /sbin)
service_path="$(
  printf '%s\n' "${path_parts[@]}" |
    awk 'NF && !seen[$0]++' |
    paste -sd: -
)"

mkdir -p -- "$log_dir" "${HOME}/Library/LaunchAgents"

# Literal substitution in node rather than sed: paths are user-controlled and
# sed would reinterpret & and the delimiter inside them.
rendered="$(
  node -e '
    const fs = require("fs");
    const [template, ...pairs] = process.argv.slice(1);
    let out = fs.readFileSync(template, "utf8");
    for (let i = 0; i < pairs.length; i += 2) {
      out = out.split(`@@${pairs[i]}@@`).join(pairs[i + 1]);
    }
    const leftover = out.match(/@@[A-Z_]+@@/);
    if (leftover) {
      process.stderr.write(`unsubstituted token ${leftover[0]}\n`);
      process.exit(1);
    }
    process.stdout.write(out);
  ' \
    "$template" \
    LABEL "$label" \
    NODE "$node_bin" \
    SERVER "$server_js" \
    HUD_ROOT "$hud_root" \
    PORT "$port" \
    PATH "$service_path" \
    LOG "$log_file"
)"

# ------------------------------------------------------------------ load

# Idempotence: bootout an existing agent before replacing its plist, so the
# running process can never outlive the definition it was started from.
if [[ -n "$installed_pid" ]] || launchctl print "$target" >/dev/null 2>&1; then
  printf 'replacing existing agent %s\n' "$label"
  launchctl bootout "$target" 2>/dev/null || true
  for _ in $(seq 1 20); do
    launchctl print "$target" >/dev/null 2>&1 || break
    sleep 0.25
  done
fi

printf '%s\n' "$rendered" > "$plist"
launchctl bootstrap "$domain" "$plist"

# ------------------------------------------------------------------ verify

health_url="http://${host}:${port}/"
healthy=""
for _ in $(seq 1 40); do
  # -S omitted on purpose: a connection refused here is the expected state
  # while launchd is still starting the process, not something to report.
  if curl -fs -o /dev/null --max-time 2 "$health_url"; then
    healthy=yes
    break
  fi
  sleep 0.5
done

pid="$(service_pid || true)"

if [[ -z "$healthy" ]]; then
  printf '\ninstall.sh: agent loaded but %s did not answer within 20s.\n' "$health_url" >&2
  printf 'launchctl print %s:\n' "$target" >&2
  launchctl print "$target" >&2 || true
  printf '\nlast lines of %s:\n' "$log_file" >&2
  tail -20 -- "$log_file" >&2 || true
  exit 1
fi

printf '\nhud service installed\n'
printf '  label   %s\n' "$label"
printf '  pid     %s (launchd restarts it if it dies)\n' "${pid:-unknown}"
printf '  serving %s\n' "$health_url"
printf '  root    %s (content tree)\n' "$hud_root"
printf '  server  %s (machinery)\n' "$server_js"
printf '  plist   %s\n' "$plist"
printf '  log     %s\n' "$log_file"
printf '\nuninstall (removes the agent, leaves the tree untouched):\n'
# uninstall.sh re-resolves root and label from env + config, so anything
# overridden on this run has to travel with the printed command — otherwise it
# names a service that was never installed and reports success for removing it.
uninstall_prefix=""
# Resolved both sides: uninstall.sh applies `pwd -P` to its own default, so an
# unresolved ~/hud that happens to be a symlink would otherwise read as an
# override and print a HUD_ROOT= the user does not need.
default_root_real="$(cd -- "$default_root" 2>/dev/null && pwd -P || printf '%s' "$default_root")"
if [[ "$hud_root" != "$default_root_real" ]]; then
  uninstall_prefix+="HUD_ROOT=${hud_root} "
fi
config_label="$(cfg_get label)"
if [[ "$label" != "${config_label:-local.hud}" ]]; then
  uninstall_prefix+="HUD_LABEL=${label} "
fi
printf '  %sbash %s/uninstall.sh\n' "$uninstall_prefix" "$service_dir"

if [[ -n "$hostname_pretty" ]]; then
  printf '\nserve.hostname is set to %s. Two manual steps this script will not take:\n' "$hostname_pretty"
  printf '  1. add the loopback alias yourself (needs sudo, so it is yours to run):\n'
  printf '       printf "127.0.0.1\\t%s\\n" | sudo tee -a /etc/hosts\n' "$hostname_pretty"
  printf '     then browse http://%s:%s/\n' "$hostname_pretty" "$port"
  printf '  2. port 80 would drop the :%s, but binding it needs root, which this\n' "$port"
  printf '     agent deliberately does not have. Keep the port, or put a pf\n'
  printf '     redirect in front — the service itself stays unprivileged.\n'
fi
