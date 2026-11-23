#!/usr/bin/env bash
# git-fetch-retry.sh <repo-dir> <remote> <refspec>... — `git fetch -q`, retried
# only while another fetch holds the repo's ref lock.
#
# Several reviews can run against one clone at once, and concurrent fetches
# into the same repo race on its ref lock ("cannot lock ref ...: is at X but
# expected Y", or an existing *.lock file). The losing fetch did nothing wrong
# and succeeds once the other finishes. Any other failure (bad remote, no such
# ref, no network) is real and returns at once, with git's own error.
#
# Only the refspecs given are written: --refmap= turns off git's opportunistic
# update of the remote-tracking refs (refs/remotes/<remote>/*), and
# --no-write-fetch-head leaves .git/FETCH_HEAD alone. Both are shared by
# every fetch into the clone, so concurrent reviews would otherwise contend
# for them, and one review's fetch would move a ref another is reading.
set -uo pipefail
repo="$1" remote="$2"; shift 2
attempts="${GIT_FETCH_RETRY_ATTEMPTS:-5}"
err=""
for ((i = 1; i <= attempts; i++)); do
    if err="$(git -C "$repo" fetch -q --refmap= --no-write-fetch-head "$remote" "$@" 2>&1)"; then exit 0; fi
    case "$err" in
        *"cannot lock ref"* | *"Unable to create"*".lock"* | *"another git process"*)
            echo "git-fetch-retry: ref lock busy (attempt $i of $attempts)" >&2
            sleep "${GIT_FETCH_RETRY_SLEEP:-$((i * 2))}" ;;
        *) printf '%s\n' "$err" >&2; exit 1 ;;
    esac
done
printf '%s\n' "$err" >&2
exit 1
