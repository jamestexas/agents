#!/usr/bin/env bash
# pr-context.sh — gather the raw material a reviewer needs BEFORE forming any
# finding, as one structured JSON document.
#
# It answers the questions you should not be guessing at while reviewing: what
# does this PR CLAIM, what has already been SAID about it (and was that thread
# resolved or just buried), what did the BOTS flag, which TICKET is it supposed
# to satisfy, and which PAST PRs rhyme with it. It forms no findings and reaches
# no verdict — that judgment stays with the reviewer and the skill (see
# skills/pr-review/SKILL.md and the dimension sidecar skills/pr-review/DIMENSIONS.md).
#
# READ-ONLY BY CONSTRUCTION. Every call is a GET through `gh`, with one apparent
# exception that is not one in substance: GitHub's GraphQL endpoint is POST-only
# even for reads, and the review-thread query is the only source of
# resolved/unresolved state. That document is a `query`; gql() refuses to send
# anything containing the word `mutation`, so "we POST" can never quietly become
# "we write". There is no flag, branch, or env var that makes this script mutate
# anything.
#
# Ticket fetching is deliberately gh-only. GitHub issues are fetched in full;
# Linear-style KEY-N refs are reported as detected-but-not-fetched rather than
# bolting a second credential and a second audit surface onto a read-only tool.
#
# OUTPUT: one JSON object on stdout; progress and warnings on stderr. Every
# section is always present and always carries a status, so an empty section is
# never ambiguous:
#   ok           queried; returned at least one item
#   empty        queried; returned nothing — "we looked, there is nothing here"
#   unavailable  could not be queried; `reason` says why — "we did not look"
#   skipped      deliberately not queried (a flag turned it off)
# `items` is always an array. A failing API degrades ONE section to
# `unavailable`; it never aborts the run. Output can be large: bot review bodies
# are kept verbatim, because truncating context inside a context-gathering tool
# is the wrong default.
#
# Usage:
#   scripts/pr-context.sh --pr <owner/repo#N|N> [--repo owner/repo]
#       [--similar N] [--no-similar] [--help]
#
#   # Full context for a PR, saved for the review pass:
#   scripts/pr-context.sh --pr owner/repo#123 > /tmp/ctx.json
#
#   # Faster: skip the similar-PR probes (the slowest section):
#   scripts/pr-context.sh --pr 123 --repo owner/repo --no-similar
#
#   --pr          PR as `owner/repo#N`, or bare `N` with --repo / the cwd repo
#   --repo        owner/repo, when --pr is a bare number
#   --similar     how many similar PRs to return (default 5; 0 disables)
#   --no-similar  skip similar-PR discovery entirely
#   --help

set -euo pipefail

# Print the contiguous comment header after the shebang. Deriving the range from
# the file itself keeps --help correct when the header grows or shrinks; a fixed
# `sed -n '2,Np'` silently starts printing code the moment the header moves.
usage() {
    awk 'NR == 1 { next } /^#/ { sub(/^# ?/, ""); print; next } { exit }' "${BASH_SOURCE[0]}"
    exit "${1:-0}"
}

PR="" REPO="" SIMILAR=5
while [ $# -gt 0 ]; do
    case "$1" in
        --pr) PR="$2"; shift 2 ;;
        --repo) REPO="$2"; shift 2 ;;
        --similar) SIMILAR="$2"; shift 2 ;;
        --no-similar) SIMILAR=0; shift ;;
        --help|-h) usage 0 ;;
        *) echo "unknown arg: $1" >&2; usage 1 ;;
    esac
done

die()  { echo "pr-context: $*" >&2; exit 1; }
note() { echo "pr-context: $*" >&2; }

# First line of a message, clipped — enough to say why a section is unavailable
# without pasting an API's whole tantrum into the JSON. Pure bash so it cannot
# trip `pipefail` via a short-reading `head`.
brief() { local s="${1%%$'\n'*}"; printf '%s' "${s:0:200}"; }

command -v gh >/dev/null || die "gh not found"
command -v jq >/dev/null || die "jq not found"
[ -n "$PR" ] || die "--pr is required"
[[ "$SIMILAR" =~ ^[0-9]+$ ]] || die "--similar must be a number, got '$SIMILAR'"

# Resolve owner/repo + number from --pr ("owner/repo#N" or "N" with --repo/default).
if [[ "$PR" == *"#"* ]]; then
    REPO="${PR%%#*}"; N="${PR##*#}"
else
    N="$PR"
fi
if [ -z "$REPO" ]; then
    REPO="$(gh repo view --json nameWithOwner --jq .nameWithOwner 2>/dev/null)" || die "cannot resolve repo; pass --repo or owner/repo#N"
fi
[[ "$N" =~ ^[0-9]+$ ]] || die "could not parse PR number from --pr '$PR'"
[[ "$REPO" == */* ]] || die "--repo must be owner/repo, got '$REPO'"
OWNER="${REPO%%/*}"; NAME="${REPO##*/}"

WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT

# Bot authorship. `__typename == "Bot"` and a `[bot]` login suffix are the
# reliable signals; the named list catches reviewers that post as ordinary Users
# (GitHub's own Copilot reviewer is one) and is expected to need occasional
# additions — a miss downgrades a bot finding to a human one, never drops it.
BOT_RE='\[bot\]$|^(coderabbitai|sourcery-ai|greptile|ellipsis-dev|deepsource|sonarcloud|sonarqubecloud|codecov|snyk-bot|dependabot|renovate|codiumai|qodo|cursor|devin-ai-integration|copilot-pull-request-reviewer|github-actions|codeclimate|semgrep|restyled)'

# ---------------------------------------------------------------------------
# Section plumbing — one shape for every section, so a consumer tests
# `.<section>.status` uniformly and never has to infer meaning from an empty list.
# ---------------------------------------------------------------------------

# arr <maybe-json> — coerce anything that isn't a JSON array into `[]`, so a
# half-failed jq upstream degrades a section instead of corrupting the document.
arr() {
    local v="${1:-}"
    if [ -n "$v" ] && jq -e 'type == "array"' >/dev/null 2>&1 <<<"$v"; then
        printf '%s' "$v"
    else
        printf '[]'
    fi
}

# section <status> <reason> <items-json>
section() {
    jq -n --arg status "$1" --arg reason "$2" --argjson items "$(arr "$3")" \
        '{status: $status,
          reason: (if $reason == "" then null else $reason end),
          count: ($items | length),
          items: $items}'
}

# found <items-json> [empty-reason] — `ok` when the query returned something,
# `empty` when it genuinely returned nothing.
found() {
    local items; items="$(arr "${1:-}")"
    if [ "$(jq 'length' <<<"$items")" -gt 0 ]; then
        section ok "" "$items"
    else
        section empty "${2:-}" "$items"
    fi
}

# gql <document> — send a GraphQL READ. The endpoint is POST-only even for
# queries, so this guard is what keeps the POST honest: a document mentioning
# `mutation` is a bug in this script and is refused rather than sent.
gql() {
    local doc="$1"
    case "$doc" in
        *mutation*) die "internal: refusing to send a GraphQL mutation — this script is read-only" ;;
    esac
    jq -n --arg q "$doc" --arg owner "$OWNER" --arg name "$NAME" --argjson number "$N" \
        '{query: $q, variables: {owner: $owner, name: $name, number: $number}}' \
        | gh api graphql --input -
}

# ---------------------------------------------------------------------------
# 1. PR metadata. Fatal if unreadable: every other section hangs off it, so
#    there is no partial context worth emitting.
# ---------------------------------------------------------------------------

note "reading $REPO#$N"
PR_FIELDS='number,title,author,state,isDraft,baseRefName,headRefName,createdAt,updatedAt,url,additions,deletions,changedFiles,files,labels,body,closingIssuesReferences,reviews,comments'
rc=0; meta="$(gh pr view "$N" --repo "$REPO" --json "$PR_FIELDS" 2>&1)" || rc=$?
[ "$rc" -eq 0 ] || die "cannot read $REPO#$N: $(brief "$meta")"

pr_json="$(jq --arg repo "$REPO" '{
    repo: $repo,
    number, title, url, state,
    draft: .isDraft,
    author: (.author.login // "unknown"),
    author_is_bot: (.author.is_bot // false),
    base: .baseRefName,
    head: .headRefName,
    created_at: .createdAt,
    updated_at: .updatedAt,
    additions, deletions,
    changed_files: .changedFiles,
    labels: [.labels[]?.name],
    files: [.files[]? | {path, additions, deletions, change: .changeType}]
}' <<<"$meta")"

TITLE="$(jq -r '.title // ""' <<<"$meta")"
AUTHOR="$(jq -r '.author.login // ""' <<<"$meta")"
HEAD_REF="$(jq -r '.headRefName // ""' <<<"$meta")"
jq -r '.body // ""' <<<"$meta" > "$WORK/body.raw"

# ---------------------------------------------------------------------------
# 2. Claims — the description's own assertions, verbatim and line-numbered so a
#    later step can quote one back and check it against the diff.
#
#    Fenced code and HTML comments are blanked out first (blanked, not deleted,
#    so line numbers still point at the real description). What survives is any
#    line that asserts something: a checklist item of any length, or a sentence
#    of four words or more. Headings, rules, bare images, raw HTML and table
#    rows are scaffolding, not claims.
# ---------------------------------------------------------------------------

awk '
    BEGIN { fence = 0; html = 0 }
    {
        s = $0; sub(/\r$/, "", s)
        if (html) { if (s ~ /-->/) html = 0; print ""; next }
        if (s ~ /<!--/ && s !~ /-->/) { html = 1; print ""; next }
        gsub(/<!--.*-->/, "", s)
        if (s ~ /^[[:space:]]*```/ || s ~ /^[[:space:]]*~~~/) { fence = !fence; print ""; next }
        if (fence) { print ""; next }
        print s
    }
' "$WORK/body.raw" > "$WORK/body.clean"

claims_items="$(awk '
    {
        line = $0
        s = line
        sub(/^[[:space:]]+/, "", s); sub(/[[:space:]]+$/, "", s)
        if (s == "") next
        if (s ~ /^#{1,6} /) next
        if (s ~ /^([-*_][[:space:]]*){3,}$/) next
        if (s ~ /^!\[/) next
        if (s ~ /^<[^>]*>$/) next
        if (s ~ /^\|/) next
        checklist = (s ~ /^[-*+][[:space:]]*\[[ xX]\]/)
        n = split(s, w, /[[:space:]]+/)
        if (!checklist && n < 4) next
        printf "%d\t%s\n", NR, line
    }
' "$WORK/body.clean" | jq -R -s '
    split("\n") | map(select(. != ""))
    | map((. / "\t") as $p | {line: ($p[0] | tonumber), text: ($p[1:] | join("\t"))})
')"

if [ ! -s "$WORK/body.raw" ] || ! grep -q '[^[:space:]]' "$WORK/body.raw"; then
    claims="$(section empty "PR description is empty" '[]')"
else
    claims="$(found "$claims_items" "description has no claim-shaped lines (only headings, code, or boilerplate)")"
fi

# ---------------------------------------------------------------------------
# 3. Reviews — submitted reviews AND PR-level comments, in one stream. Both are
#    "what has already been said", and dropping the comments would hide the
#    summary posts most review bots make. `kind` tells them apart; `is_bot`
#    flags authorship without removing anything from the stream.
# ---------------------------------------------------------------------------

reviews_items="$(jq --arg botre "$BOT_RE" '
    def login: (.author.login // "ghost");
    def isbot: (login | test($botre));
    [ (.reviews[]? | {kind: "review", author: login, is_bot: isbot,
                      state: (.state // "COMMENTED"), at: .submittedAt,
                      url: (.url // null), body: (.body // "")}),
      (.comments[]? | {kind: "comment", author: login, is_bot: isbot,
                       state: null, at: .createdAt,
                       url: (.url // null), body: (.body // "")}) ]
    | sort_by(.at // "")
' <<<"$meta")"
reviews="$(found "$reviews_items" "no reviews or comments have been posted on this PR")"

# ---------------------------------------------------------------------------
# 4. Inline review threads, with resolved/unresolved state. GraphQL is the only
#    place that state exists — REST review comments do not carry it.
# ---------------------------------------------------------------------------

# shellcheck disable=SC2016  # $owner/$name/$number are GraphQL variables, not shell ones
THREAD_Q='query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){reviewThreads(first:100){nodes{id isResolved isOutdated path line originalLine comments(first:50){nodes{author{login __typename} body createdAt url}}}}}}}'

rc=0; threads_raw="$(gql "$THREAD_Q" 2>&1)" || rc=$?
if [ "$rc" -ne 0 ]; then
    threads="$(section unavailable "review-thread query failed: $(brief "$threads_raw")" '[]')"
    note "review threads unavailable: $(brief "$threads_raw")"
else
    threads_items="$(jq --arg botre "$BOT_RE" '
        def login: (.author.login // "ghost");
        def isbot: ((.author.__typename // "") == "Bot") or (login | test($botre));
        [ .data.repository.pullRequest.reviewThreads.nodes[]? | {
            id,
            path: (.path // null),
            line: (.line // .originalLine),
            state: (if .isResolved then "resolved" else "unresolved" end),
            resolved: .isResolved,
            outdated: .isOutdated,
            participants: ([.comments.nodes[]? | login] | unique),
            is_bot: ([.comments.nodes[]? | isbot] | any),
            comments: [.comments.nodes[]? | {author: login, is_bot: isbot,
                                             at: .createdAt, url: (.url // null),
                                             body: (.body // "")}]
        } ]
    ' <<<"$threads_raw" 2>/dev/null || true)"
    threads="$(found "$threads_items" "no inline review threads on this PR")"
fi

# ---------------------------------------------------------------------------
# 5. Bot findings — a derived projection over sections 3 and 4, not a separate
#    fetch. Nothing is moved out of those sections to build it; a bot-authored
#    item appears in both, flagged, so neither view is lossy.
# ---------------------------------------------------------------------------

bot_items="$(jq -n --argjson r "$(arr "$reviews_items")" --argjson t "$(arr "${threads_items:-[]}")" '
    [ ($r[] | select(.is_bot) | {source: "review", author, kind, at, url, state, body}),
      ($t[] | select(.is_bot) | {source: "thread", author: (.participants | join(",")),
                                 kind: "inline", at: (.comments[0].at // null),
                                 url: (.comments[0].url // null),
                                 state: .state,
                                 path: .path, line: .line,
                                 body: ([.comments[] | .body] | join("\n---\n"))}) ]
    | sort_by(.at // "")
')"
bot_findings="$(found "$bot_items" "no bot-authored reviews, comments, or threads found")"

# ---------------------------------------------------------------------------
# 6. Linked tickets.
#
#    GitHub issues come from two places: the PR's declared closing references
#    (the authoritative link) and bare `#N` / `owner/repo#N` mentions in the
#    cleaned body. Each is fetched and mined for acceptance criteria.
#
#    Linear-style KEY-N refs are DETECTED and reported but not fetched — see the
#    header. The denylist below exists because `[A-Z]+-[0-9]+` also matches
#    UTF-8, SHA-256, CVE-2024, and — since branch names are matched
#    case-insensitively to catch Linear's own lowercase `user/eng-123-slug`
#    convention — ordinary branches like `fix/issue-14386`. The asymmetry is
#    deliberate: a real team key wrongly filtered out is still sitting in the
#    claims text where a reviewer will see it, whereas a section full of phantom
#    tickets is one nobody reads.
# ---------------------------------------------------------------------------

LINEAR_DENY='^(UTF|SHA|RFC|CVE|GHSA|ISO|IEC|AES|RSA|ECDSA|HTTP|HTTPS|HTTP2|IPV|IPV4|IPV6|IP|ADR|PR|ID|UID|UUID|API|SDK|JSON|YAML|TOML|XML|HTML|CSS|SQL|GPT|LLM|MD|X|X86|ARM|AMD|CI|CD|OSS|TLS|SSL|JWT|OIDC|SAML|PEP|RHEL|MACOS|GO|NODE|PY|V|SEMVER|BASE|UTC|GMT|ES|IE|COVID|WCAG|ARIA'\
'|ISSUE|ISSUES|GH|FIX|FIXES|FIXED|BUG|BUGS|FEAT|FEATURE|TASK|CHORE|WIP|DRAFT|REVERT|EPIC|TEST|TESTS|PART|STEP|PHASE|TOP|REF|REFS|TICKET|PATCH|HOTFIX|RELEASE|MILESTONE|NOTE|TODO|FIXME|ERROR|WARN|DEBUG|INFO|TRACE|SPEC|DOC|DOCS|README|CHANGELOG|LICENSE)$'

: > "$WORK/tickets.jsonl"

# --- GitHub issues -----------------------------------------------------------
: > "$WORK/gh_refs.tsv"   # owner/repo<TAB>number<TAB>source
jq -r --arg repo "$REPO" '
    .closingIssuesReferences[]? |
    ((.repository.owner.login + "/" + .repository.name) // $repo) + "\t" + (.number | tostring) + "\tclosing-reference"
' <<<"$meta" >> "$WORK/gh_refs.tsv" 2>/dev/null || true

grep -oE '(^|[^A-Za-z0-9_/-])([A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+)?#[0-9]+' "$WORK/body.clean" 2>/dev/null \
    | sed -E 's/^[^A-Za-z0-9_#-]*//' \
    | while IFS= read -r ref; do
        if [[ "$ref" == *"/"* ]]; then
            printf '%s\t%s\tbody-mention\n' "${ref%%#*}" "${ref##*#}"
        else
            printf '%s\t%s\tbody-mention\n' "$REPO" "${ref##*#}"
        fi
    done >> "$WORK/gh_refs.tsv" || true

if [ -s "$WORK/gh_refs.tsv" ]; then
    # Collapse duplicates, keeping every source that produced the ref.
    sort -u "$WORK/gh_refs.tsv" | awk -F'\t' '
        { key = $1 "\t" $2; src[key] = (key in src ? src[key] "," $3 : $3) }
        END { for (k in src) print k "\t" src[k] }
    ' > "$WORK/gh_refs.uniq"

    while IFS=$'\t' read -r irepo inum isrc; do
        [ -n "$inum" ] || continue
        rc=0; issue="$(gh api "repos/$irepo/issues/$inum" 2>&1)" || rc=$?
        if [ "$rc" -ne 0 ]; then
            jq -n --arg key "$irepo#$inum" --arg repo "$irepo" --argjson num "$inum" \
                  --arg src "$isrc" --arg why "$(brief "$issue")" '{
                kind: "github-issue", key: $key, repo: $repo, ref: $num,
                sources: ($src / ","), url: null, title: null, state: null,
                fetch: {status: "unavailable", reason: $why},
                acceptance_criteria: {status: "unavailable", source: null, text: null}
            }' >> "$WORK/tickets.jsonl"
            continue
        fi

        jq -r '.body // ""' <<<"$issue" > "$WORK/issue.md"
        # Acceptance criteria: a section under an Acceptance/Done-when heading
        # (or a bolded pseudo-heading), else the body's checklist items.
        ac_text="$(awk '
            {
                s = $0; sub(/\r$/, "", s)
                low = tolower(s)
                head = (s ~ /^#{1,6} /) || (s ~ /^\*\*[^*]+\*\*:?[[:space:]]*$/)
                if (head) {
                    if (low ~ /acceptance|definition of done|success criteria|done when|exit criteria/) { grab = 1; next }
                    grab = 0; next
                }
                if (grab && s ~ /[^[:space:]]/) print s
            }
        ' "$WORK/issue.md")"
        ac_src="heading"
        if [ -z "$ac_text" ]; then
            ac_text="$(grep -E '^[[:space:]]*[-*+][[:space:]]*\[[ xX]\]' "$WORK/issue.md" || true)"
            ac_src="checklist"
        fi
        ac_status=ok
        if [ -z "$ac_text" ]; then
            ac_status=empty; ac_src=""
        fi

        jq -n --arg key "$irepo#$inum" --arg repo "$irepo" --argjson num "$inum" \
              --arg src "$isrc" --argjson issue "$issue" \
              --arg acs "$ac_status" --arg acsrc "$ac_src" --arg act "$ac_text" '{
            kind: "github-issue", key: $key, repo: $repo, ref: $num,
            sources: ($src / ","),
            url: $issue.html_url, title: $issue.title, state: $issue.state,
            labels: [$issue.labels[]?.name],
            fetch: {status: "ok", reason: null},
            acceptance_criteria: {
                status: $acs,
                source: (if $acsrc == "" then null else $acsrc end),
                text: (if $act == "" then null else $act end)
            }
        }' >> "$WORK/tickets.jsonl"
    done < "$WORK/gh_refs.uniq"
fi

# --- Linear-style KEY-N ------------------------------------------------------
{
    grep -oE 'linear\.app/[^/[:space:]]+/issue/[A-Z][A-Z0-9]{0,9}-[0-9]+' "$WORK/body.clean" 2>/dev/null \
        | grep -oE '[A-Z][A-Z0-9]{0,9}-[0-9]+' | sed 's/$/\turl/' || true
    grep -oE '\b[A-Z][A-Z0-9]{1,9}-[0-9]+\b' "$WORK/body.clean" 2>/dev/null | sed 's/$/\tbody/' || true
    printf '%s\n' "$TITLE"  | grep -oE '\b[A-Z][A-Z0-9]{1,9}-[0-9]+\b' | sed 's/$/\ttitle/' || true
    printf '%s\n' "$HEAD_REF" | tr '[:lower:]' '[:upper:]' \
        | grep -oE '\b[A-Z][A-Z0-9]{1,9}-[0-9]+\b' | sed 's/$/\tbranch/' || true
} > "$WORK/linear.tsv" 2>/dev/null || true

if [ -s "$WORK/linear.tsv" ]; then
    sort -u "$WORK/linear.tsv" | awk -F'\t' -v deny="$LINEAR_DENY" '
        { split($1, p, "-"); if (p[1] ~ deny) next
          src[$1] = ($1 in src ? src[$1] "," $2 : $2) }
        END { for (k in src) print k "\t" src[k] }
    ' | while IFS=$'\t' read -r key srcs; do
        [ -n "$key" ] || continue
        jq -n --arg key "$key" --arg src "$srcs" '{
            kind: "linear", key: $key, repo: null, ref: null,
            sources: ($src / ","), url: null, title: null, state: null,
            fetch: {status: "unavailable",
                    reason: "detected but not fetched: pr-context.sh is gh-only by design, so it holds no Linear credential"},
            acceptance_criteria: {status: "unavailable", source: null,
                                  text: null}
        }' >> "$WORK/tickets.jsonl"
    done
fi

tickets_items="$(jq -s 'sort_by(.kind, (.key // ""))' "$WORK/tickets.jsonl" 2>/dev/null || true)"
linked_tickets="$(found "$tickets_items" \
    "no closing references, GitHub issue mentions, or Linear-style KEY-N refs in the title, description, or branch name")"

# ---------------------------------------------------------------------------
# 7. Similar PRs — three independent probes (same author, same files, title
#    keywords), merged and scored by how many probes surfaced the same PR.
#
#    Each probe reports its own status. A PR that "found nothing" and a probe
#    that "could not run" are different facts, and a reviewer deciding whether
#    this change has precedent needs to tell them apart.
# ---------------------------------------------------------------------------

: > "$WORK/cands.jsonl"
probes='{}'
add_probe() {  # add_probe <name> <status> <reason> <count> [extra-json]
    local extra="${5-}"
    [ -n "$extra" ] || extra='{}'
    probes="$(jq --arg n "$1" --arg s "$2" --arg r "$3" --argjson c "$4" --argjson x "$extra" \
        '.[$n] = ({status: $s, reason: (if $r == "" then null else $r end), candidates: $c} + $x)' \
        <<<"$probes")"
}

# Collect a jsonl probe result into the shared candidate pool; echo how many.
harvest() {  # harvest <jsonl-file>
    local n=0
    if [ -s "$1" ]; then
        cat "$1" >> "$WORK/cands.jsonl"
        n="$(wc -l < "$1" | tr -d ' ')"
    fi
    printf '%s' "$n"
}

if [ "$SIMILAR" -eq 0 ]; then
    similar="$(jq -n --argjson p '{}' '{status: "skipped",
        reason: "similar-PR discovery disabled (--no-similar or --similar 0)",
        count: 0, probes: $p, items: []}')"
else
    note "probing for similar PRs (author / files / title keywords)"

    # Probe A: same author.
    if [ -n "$AUTHOR" ]; then
        rc=0; out="$(gh pr list --repo "$REPO" --author "$AUTHOR" --state all \
            --limit "$((SIMILAR * 3))" --json number,title,url,state 2>&1)" || rc=$?
        if [ "$rc" -ne 0 ]; then
            add_probe same_author unavailable "gh pr list failed: $(brief "$out")" 0
        else
            jq -c --arg who "$AUTHOR" '.[]? | {number, title, url,
                state: (.state | ascii_downcase), probe: "same_author",
                detail: ("same author (" + $who + ")")}' <<<"$out" \
                > "$WORK/author_cands.jsonl" 2>/dev/null || true
            n_a="$(harvest "$WORK/author_cands.jsonl")"
            if [ "$n_a" -gt 0 ]; then add_probe same_author ok "" "$n_a"
            else add_probe same_author empty "" 0; fi
        fi
    else
        add_probe same_author unavailable "PR author could not be resolved" 0
    fi

    # Probe B: same files. Walk recent commits touching the PR's heaviest paths,
    # then ask which PR each commit arrived in — repo-convention independent, so
    # it works whether the repo squashes, merges, or rebases.
    hot_paths=()
    while IFS= read -r hp; do
        [ -n "$hp" ] && hot_paths+=("$hp")
    done < <(jq -r '
        [.files[]? | {path, weight: (.additions + .deletions)}]
        | sort_by(-.weight) | .[0:3] | .[].path
    ' <<<"$meta")
    if [ "${#hot_paths[@]}" -eq 0 ]; then
        add_probe same_files empty "PR touches no files" 0 \
            "$(jq -n '{paths: []}')"
    else
        : > "$WORK/shas"
        file_err=""
        for p in "${hot_paths[@]}"; do
            enc="$(jq -rn --arg p "$p" '$p | @uri')"
            rc=0; out="$(gh api "repos/$REPO/commits?path=$enc&per_page=3" --jq '.[].sha' 2>&1)" || rc=$?
            if [ "$rc" -ne 0 ]; then file_err="$(brief "$out")"; continue; fi
            printf '%s\n' "$out" | while IFS= read -r sha; do
                [ -n "$sha" ] && printf '%s\t%s\n' "$sha" "$p"
            done >> "$WORK/shas"
        done
        : > "$WORK/file_cands.jsonl"
        sort -u -k1,1 "$WORK/shas" 2>/dev/null | while IFS=$'\t' read -r sha p; do
            [ -n "$sha" ] || continue
            rc=0; out="$(gh api "repos/$REPO/commits/$sha/pulls" 2>&1)" || rc=$?
            [ "$rc" -eq 0 ] || continue
            jq -c --arg p "$p" '.[]? | {number, title, url: .html_url,
                state: (.state | ascii_downcase), probe: "same_files",
                detail: ("touches " + $p)}' <<<"$out" >> "$WORK/file_cands.jsonl" 2>/dev/null || true
        done
        n_f="$(harvest "$WORK/file_cands.jsonl")"
        paths_json="$(printf '%s\n' "${hot_paths[@]}" | jq -R -s 'split("\n") | map(select(. != ""))')"
        if [ -n "$file_err" ] && [ "$n_f" -eq 0 ]; then
            add_probe same_files unavailable "commit history unreadable: $file_err" 0 \
                "$(jq -n --argjson p "$paths_json" '{paths: $p}')"
        elif [ "$n_f" -gt 0 ]; then
            add_probe same_files ok "" "$n_f" "$(jq -n --argjson p "$paths_json" '{paths: $p}')"
        else
            add_probe same_files empty "" 0 "$(jq -n --argjson p "$paths_json" '{paths: $p}')"
        fi
    fi

    # Probe C: title keywords. One query per keyword — GitHub search ANDs terms
    # hard enough that a three-word query usually returns nothing, and querying
    # separately doubles as the relevance score.
    STOPWORDS='the and for with that this from into when then than make only also does will should would could been have test tests fix fixes feat chore docs refactor update updates adds remove removes support using use not are was were has had its your our all any new old more less allow allows handle avoid'
    kws=()
    while IFS= read -r kw; do
        [ -n "$kw" ] && kws+=("$kw")
    done < <(printf '%s' "$TITLE" \
        | tr '[:upper:]' '[:lower:]' \
        | sed -E 's/^[a-z]+(\([^)]*\))?!?:[[:space:]]*//' \
        | tr -cs 'a-z0-9' '\n' \
        | awk -v stop="$STOPWORDS" '
            BEGIN { n = split(stop, a, " "); for (i = 1; i <= n; i++) s[a[i]] = 1 }
            length($0) >= 4 && !($0 in s) && !seen[$0]++ && ++k <= 3')
    kws_json="$(printf '%s\n' "${kws[@]+"${kws[@]}"}" | jq -R -s 'split("\n") | map(select(. != ""))')"
    if [ "${#kws[@]}" -eq 0 ]; then
        add_probe title_keywords empty "title yielded no distinctive keywords" 0 \
            "$(jq -n --argjson k "$kws_json" '{keywords: $k}')"
    else
        : > "$WORK/kw_cands.jsonl"
        kw_err=""
        for kw in "${kws[@]}"; do
            rc=0; out="$(gh search prs --repo "$REPO" --match title "$kw" \
                --limit "$((SIMILAR * 2))" --json number,title,url,state 2>&1)" || rc=$?
            if [ "$rc" -ne 0 ]; then kw_err="$(brief "$out")"; continue; fi
            jq -c --arg kw "$kw" '.[]? | {number, title, url,
                state: (.state | ascii_downcase), probe: "title_keywords",
                detail: ("title keyword \"" + $kw + "\"")}' <<<"$out" \
                >> "$WORK/kw_cands.jsonl" 2>/dev/null || true
        done
        n_k="$(harvest "$WORK/kw_cands.jsonl")"
        if [ -n "$kw_err" ] && [ "$n_k" -eq 0 ]; then
            add_probe title_keywords unavailable "gh search prs failed: $kw_err" 0 \
                "$(jq -n --argjson k "$kws_json" '{keywords: $k}')"
        elif [ "$n_k" -gt 0 ]; then
            add_probe title_keywords ok "" "$n_k" "$(jq -n --argjson k "$kws_json" '{keywords: $k}')"
        else
            add_probe title_keywords empty "" 0 "$(jq -n --argjson k "$kws_json" '{keywords: $k}')"
        fi
    fi

    similar_items="$(jq -s --argjson self "$N" --argjson lim "$SIMILAR" '
        map(select(.number != $self))
        | group_by(.number)
        | map({number: .[0].number, title: .[0].title, url: .[0].url, state: .[0].state,
               probes: (map(.probe) | unique),
               relevance: (map(.detail) | unique | join("; "))})
        | sort_by([-(.probes | length), -.number])
        | .[0:$lim]
    ' "$WORK/cands.jsonl" 2>/dev/null || true)"
    similar_items="$(arr "$similar_items")"

    sim_status=ok; sim_reason=""
    if [ "$(jq 'length' <<<"$similar_items")" -eq 0 ]; then
        sim_status=empty
        sim_reason="no similar PRs found by any probe"
        if [ "$(jq '[.[] | select(.status == "unavailable")] | length' <<<"$probes")" -gt 0 ]; then
            sim_status=unavailable
            sim_reason="no similar PRs found, and at least one probe could not run — see .probes for which"
        fi
    fi
    similar="$(jq -n --arg s "$sim_status" --arg r "$sim_reason" \
                     --argjson p "$probes" --argjson items "$similar_items" \
        '{status: $s, reason: (if $r == "" then null else $r end),
          count: ($items | length), probes: $p, items: $items}')"
fi

# ---------------------------------------------------------------------------
# Emit.
# ---------------------------------------------------------------------------

jq -n \
    --arg generated_at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    --argjson pr "$pr_json" \
    --argjson claims "$claims" \
    --argjson reviews "$reviews" \
    --argjson threads "$threads" \
    --argjson bot_findings "$bot_findings" \
    --argjson linked_tickets "$linked_tickets" \
    --argjson similar_prs "$similar" \
    '{schema: "pr-context/v1",
      generated_at: $generated_at,
      read_only: true,
      pr: $pr,
      claims: $claims,
      reviews: $reviews,
      threads: $threads,
      bot_findings: $bot_findings,
      linked_tickets: $linked_tickets,
      similar_prs: $similar_prs}'

note "done: $REPO#$N"
