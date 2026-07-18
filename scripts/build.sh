#!/usr/bin/env bash
# build.sh — lint frontmatter and regenerate README.md tables from filesystem.
#
# Subcommands:
#   lint     Validate frontmatter of every agent + skill against Anthropic +
#            Gemini specs (no unknown fields, valid color/model values, etc).
#   readme   Regenerate the auto-managed sections of README.md from filesystem.
#   all      lint + readme (default)
#
# Exit non-zero on lint failure. Used by pre-commit.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
AGENTS_DIR="$REPO_ROOT/agents"
SKILLS_DIR="$REPO_ROOT/skills"
README="$REPO_ROOT/README.md"

# --- Spec ---------------------------------------------------------------
# Anthropic Claude Code subagent frontmatter spec:
#   https://code.claude.com/docs/en/sub-agents#supported-frontmatter-fields
AGENT_ALLOWED_FIELDS="name description tools disallowedTools model effort color prompt permissionMode mcpServers hooks maxTurns skills initialPrompt memory background isolation"
AGENT_REQUIRED_FIELDS="name description"
AGENT_VALID_COLORS="red blue green yellow purple orange pink cyan magenta"   # magenta seen in repo, tolerate
AGENT_VALID_MODELS_PREFIX="sonnet opus haiku inherit claude-"

# Anthropic Claude Code skill frontmatter spec:
#   https://code.claude.com/docs/en/skills#frontmatter-reference
# Gemini CLI: rejects fields outside the spec — we lint to the strict union.
SKILL_ALLOWED_FIELDS="name description when_to_use argument-hint arguments disable-model-invocation user-invocable allowed-tools model effort context agent hooks paths shell"
SKILL_REQUIRED_FIELDS="description"   # name optional (directory name used if missing)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

extract_frontmatter() {
    awk '/^---$/{if(++c==2) exit; next} c==1' "$1"
}

field_value() {
    # field_value <file> <key>  -> value as a single line (newlines → spaces).
    # Handles block scalars (`>` folded, `|` literal) by going through Ruby's YAML.
    local file="$1" key="$2"
    extract_frontmatter "$file" | ruby -ryaml -e '
        begin
            d = YAML.safe_load(STDIN.read) || {}
            v = d[ARGV[0]]
            unless v.nil?
                v = v.to_s.strip.gsub(/\s+/, " ")
                print v
            end
        rescue
            exit 0
        end
    ' "$key"
}

field_keys() {
    extract_frontmatter "$1" | ruby -ryaml -e '
        begin
            d = YAML.safe_load(STDIN.read) || {}
            d.each_key { |k| puts k }
        rescue
            exit 0
        end
    '
}

# ---------------------------------------------------------------------------
# Lint
# ---------------------------------------------------------------------------

lint_one() {
    local file="$1" kind="$2"
    local allowed required name errors=0
    case "$kind" in
        agent) allowed="$AGENT_ALLOWED_FIELDS"; required="$AGENT_REQUIRED_FIELDS" ;;
        skill) allowed="$SKILL_ALLOWED_FIELDS"; required="$SKILL_REQUIRED_FIELDS" ;;
    esac
    name="$(basename "$file")"

    local fm
    fm="$(extract_frontmatter "$file")"
    if [ -z "$fm" ]; then
        echo "  ❌ $file: no frontmatter"
        return 1
    fi

    # YAML syntax
    if command -v ruby >/dev/null 2>&1; then
        if ! echo "$fm" | ruby -ryaml -e "YAML.safe_load(STDIN.read)" >/dev/null 2>&1; then
            echo "  ❌ $file: invalid YAML"
            return 1
        fi
    fi

    # Required fields
    for f in $required; do
        if ! field_keys "$file" | grep -qx "$f"; then
            echo "  ❌ $file: missing required field '$f'"
            errors=$((errors+1))
        fi
    done

    # Unknown fields (Gemini rejects these)
    while IFS= read -r key; do
        local ok=0
        for a in $allowed; do
            [ "$key" = "$a" ] && { ok=1; break; }
        done
        if [ $ok -eq 0 ]; then
            echo "  ❌ $file: unknown frontmatter field '$key' (not in $kind spec)"
            errors=$((errors+1))
        fi
    done < <(field_keys "$file")

    # Agent-specific value checks
    if [ "$kind" = "agent" ]; then
        local color model
        color="$(field_value "$file" color)"
        model="$(field_value "$file" model)"
        if [ -n "$color" ]; then
            local ok=0
            for c in $AGENT_VALID_COLORS; do [ "$color" = "$c" ] && { ok=1; break; }; done
            if [ $ok -eq 0 ]; then
                echo "  ❌ $file: invalid color '$color' (allowed: $AGENT_VALID_COLORS)"
                errors=$((errors+1))
            fi
        fi
        if [ -n "$model" ]; then
            local ok=0
            for p in $AGENT_VALID_MODELS_PREFIX; do
                case "$model" in "$p"*) ok=1; break ;; esac
            done
            if [ $ok -eq 0 ]; then
                echo "  ❌ $file: invalid model '$model'"
                errors=$((errors+1))
            fi
        fi
    fi

    # Agent MCP-dependency check: if the body invokes a known MCP server's
    # tools (rsry_*, mache_*, or the fully-qualified mcp__server__tool form)
    # but never documents the dependency, frontmatter drifts silently from
    # what the agent actually needs at runtime. Require a "MCP dependency:"
    # line as the documented, greppable declaration (see CLAUDE.md "Creating
    # new agents"). Scoped to known MCP server prefixes, not generic
    # snake_case calls, so worked-example code (e.g. a retired backend's
    # client.record_x() calls) doesn't false-positive.
    if [ "$kind" = "agent" ]; then
        if grep -qE '\b(rsry|mache)_[a-z_]+\(|mcp__[a-zA-Z0-9_]+__[a-zA-Z0-9_]+' "$file" \
            && ! grep -q 'MCP dependency:' "$file"; then
            echo "  ❌ $file: calls a known MCP server's tool but has no 'MCP dependency:' line"
            errors=$((errors+1))
        fi
    fi

    [ $errors -eq 0 ] || return 1
    return 0
}

lint_all() {
    local total=0 failed=0
    echo "Linting agents..."
    for f in "$AGENTS_DIR"/*.md; do
        [ -f "$f" ] || continue
        [ "$(basename "$f")" = "TODO.md" ] && continue
        total=$((total+1))
        if ! lint_one "$f" agent; then
            failed=$((failed+1))
        fi
    done
    echo "Linting skills..."
    for f in "$SKILLS_DIR"/*/SKILL.md; do
        [ -f "$f" ] || continue
        total=$((total+1))
        if ! lint_one "$f" skill; then
            failed=$((failed+1))
        fi
    done
    if [ $failed -gt 0 ]; then
        echo ""
        echo "❌ $failed/$total file(s) failed lint"
        return 1
    fi
    echo "✅ All $total file(s) passed lint"
}

# ---------------------------------------------------------------------------
# README generation
# ---------------------------------------------------------------------------

# Extract the first sentence of a description (best-effort, strips quotes
# and stops at first " <example>" or ". " boundary).
first_sentence() {
    local v="$1"
    v="${v#\"}"; v="${v%\"}"
    v="${v%%<example>*}"
    v="${v%%Examples:*}"
    v="${v%% Examples:*}"
    # Cut at first ". " (sentence boundary)
    case "$v" in
        *". "*) v="${v%%. *}." ;;
    esac
    # Squash whitespace
    v="$(printf '%s' "$v" | tr -s '[:space:]' ' ')"
    printf '%s' "${v# }"
}

gen_agents_table() {
    echo "| Agent | Model | Color | Purpose |"
    echo "|-------|-------|-------|---------|"
    for f in "$AGENTS_DIR"/*.md; do
        [ -f "$f" ] || continue
        [ "$(basename "$f")" = "TODO.md" ] && continue
        local name model color desc
        name="$(field_value "$f" name)"
        [ -z "$name" ] && continue
        model="$(field_value "$f" model)"
        color="$(field_value "$f" color)"
        desc="$(field_value "$f" description)"
        local purpose
        purpose="$(first_sentence "$desc")"
        # Escape pipes
        purpose="${purpose//|/\\|}"
        printf "| [\`%s\`](agents/%s) | %s | %s | %s |\n" \
            "$name" "$(basename "$f")" "${model:-inherit}" "${color:-—}" "$purpose"
    done
}

gen_skills_table() {
    echo "| Skill | Tool scope | Purpose |"
    echo "|-------|------------|---------|"
    for f in "$SKILLS_DIR"/*/SKILL.md; do
        [ -f "$f" ] || continue
        local name tools desc dir
        dir="$(basename "$(dirname "$f")")"
        name="$(field_value "$f" name)"
        [ -z "$name" ] && name="$dir"
        tools="$(field_value "$f" allowed-tools)"
        desc="$(field_value "$f" description)"
        local purpose tool_scope
        purpose="$(first_sentence "$desc")"
        purpose="${purpose//|/\\|}"
        if [ -z "$tools" ]; then
            tool_scope="inherits all"
        else
            tool_scope="scoped"
        fi
        printf "| [\`%s\`](skills/%s/SKILL.md) | %s | %s |\n" \
            "$name" "$dir" "$tool_scope" "$purpose"
    done
}

# Replace the content between BEGIN/END markers in README.md.
# Pass the new content via a file (awk -v can't take newlines).
replace_section() {
    local marker="$1" content_file="$2" tmp
    tmp="$(mktemp)"
    awk -v marker="$marker" -v content_file="$content_file" '
        BEGIN {
            while ((getline line < content_file) > 0) {
                content = (content == "" ? line : content "\n" line)
            }
            close(content_file)
        }
        $0 ~ "^<!-- BEGIN: " marker " -->$" { print; print content; in_section=1; next }
        $0 ~ "^<!-- END: " marker " -->$"   { in_section=0; print; next }
        !in_section { print }
    ' "$README" > "$tmp"
    mv "$tmp" "$README"
}

gen_readme() {
    if ! grep -q "<!-- BEGIN: AGENTS -->" "$README"; then
        echo "❌ README.md is missing <!-- BEGIN: AGENTS --> / <!-- END: AGENTS --> markers."
        echo "   Add them where the agent table should live, then re-run."
        return 1
    fi
    local agents_tmp skills_tmp
    agents_tmp="$(mktemp)"; skills_tmp="$(mktemp)"
    gen_agents_table > "$agents_tmp"
    gen_skills_table > "$skills_tmp"
    replace_section AGENTS "$agents_tmp"
    replace_section SKILLS "$skills_tmp"
    rm -f "$agents_tmp" "$skills_tmp"
    echo "✅ Regenerated AGENTS and SKILLS sections of README.md"
}

# ---------------------------------------------------------------------------
# @include expansion
# ---------------------------------------------------------------------------
#
# Source files can pull shared content from `_shared/<name>.md` like so:
#
#     <!-- @include-begin _shared/foo.md -->
#     [previous content, ignored when expanding]
#     <!-- @include-end _shared/foo.md -->
#
# `build.sh expand` rewrites the content between the markers to match the
# referenced source file. `build.sh check-includes` errors instead (used by CI).
# The directive is a literal HTML comment, so untouched files still render and
# parse correctly — Claude Code and Gemini just see the expanded body.

expand_file() {
    # expand_file <path> <mode>   mode = "write" | "check"
    local file="$1" mode="$2"
    local repo_root="$REPO_ROOT"
    local tmp drift=0
    tmp="$(mktemp)"
    awk -v root="$repo_root" -v mode="$mode" '
        function read_file(p,    line, out) {
            out = ""
            while ((getline line < p) > 0) {
                out = (out == "" ? line : out "\n" line)
            }
            close(p)
            return out
        }
        # Track fenced code blocks so directives inside examples are ignored.
        /^```/ {
            in_fence = !in_fence
            print
            next
        }
        in_fence { print; next }

        # Directive must be flush-left and the entire line:
        #   <!-- @include-begin <path> -->
        /^<!-- @include-begin .* -->$/ {
            inc = $0
            sub(/^<!-- @include-begin +/, "", inc)
            sub(/ +-->$/, "", inc)
            print
            replacement = read_file(root "/" inc)
            print replacement
            in_block = 1
            next
        }
        /^<!-- @include-end .* -->$/ {
            in_block = 0
            print
            next
        }
        !in_block { print }
    ' "$file" > "$tmp"

    if ! cmp -s "$file" "$tmp"; then
        drift=1
        if [ "$mode" = "write" ]; then
            mv "$tmp" "$file"
            echo "  ↻ expanded includes in $file"
        else
            echo "  ❌ $file: @include block out of date (run 'scripts/build.sh expand')"
            diff -u "$file" "$tmp" | sed 's/^/    /' | head -20
            rm -f "$tmp"
        fi
    else
        rm -f "$tmp"
    fi
    return $drift
}

run_include_pass() {
    local mode="$1" drifted=0
    for f in "$AGENTS_DIR"/*.md "$SKILLS_DIR"/*/SKILL.md; do
        [ -f "$f" ] || continue
        grep -q '<!-- @include-begin ' "$f" 2>/dev/null || continue
        if ! expand_file "$f" "$mode"; then
            drifted=1
        fi
    done
    return $drifted
}

# ---------------------------------------------------------------------------
# README drift check (CI-friendly: does running `readme` produce changes?)
# ---------------------------------------------------------------------------

check_readme_drift() {
    local before after tmp
    before="$(sha1sum "$README" | cut -d' ' -f1)"
    gen_readme >/dev/null
    after="$(sha1sum "$README" | cut -d' ' -f1)"
    if [ "$before" != "$after" ]; then
        echo "❌ README.md is out of sync with frontmatter."
        echo "   Run 'scripts/build.sh readme' and commit the result."
        return 1
    fi
    echo "✅ README.md is in sync with frontmatter"
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

cmd="${1:-all}"
case "$cmd" in
    lint)           lint_all ;;
    readme)         gen_readme ;;
    expand)         run_include_pass write ;;
    check-includes) run_include_pass check ;;
    check)          # CI entry point: assert everything is in order.
                    lint_all \
                      && run_include_pass check \
                      && check_readme_drift ;;
    all)            lint_all && run_include_pass write && gen_readme ;;
    *)              echo "Usage: $0 {lint|readme|expand|check-includes|check|all}"; exit 2 ;;
esac
