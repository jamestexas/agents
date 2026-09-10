---
name: jj-stack
description: >-
  Turn one dev branch into small, individually-reviewable stacked PRs that land
  on a feature branch (one final merge to main), using jujutsu (jj) colocated
  with git plus keyless commit signing. Use after pr-buckets decides the slice
  boundaries, or whenever a large or multi-PR ticket wants one branch you follow
  linearly, split into tiny PRs peers review. Captures the jj primitives
  (colocate, duplicate, split, bookmark, sign, push) and the parts jj does not
  give you by default — the signing-backend wiring and the feature-branch
  orchestration.
allowed-tools: "Read, Write, Edit, Grep, Glob, Bash(jj:*), Bash(git:*), Bash(gh:*), Bash(brew:*)"
argument-hint: <dev-branch> [--feature=<feature-branch>] [--base=main] [--sign=gitsign|ssh|gpg|none]
---

<!-- Author: jamestexas -->

# /jj-stack — split one branch into signed, stacked PRs on a feature branch

The workflow, and why it exists: agentic work wants **one branch** you (and the
agent) reason about linearly; reviewers want **small PRs**; the org wants **one
clean merge**. jj resolves the tension — you develop on one branch, `jj split`
it into tiny commits, push each as a small PR that targets a **feature branch**,
and the feature branch is a single squash/merge to `main`. A reviewer can review
each small PR into feature; the feature merge is the one that hits main.

jj gives the primitives (split, duplicate, bookmark, push, signing backends).
This skill supplies the two things it does **not**: keyless-signing wiring and
the feature-branch orchestration. Nothing here shells out from a script — it's a
procedure of `jj`/`git`/`gh` commands; the only file written is the jj/git config.

## Phase 0 — prerequisites (one-time per machine/repo)

1. **jj installed.** `command -v jj || brew install jj` (formula is `jj`).

2. **Colocate the repo.** jj **cannot** `git init --colocate` inside a git
   worktree — do it in the MAIN checkout:
   ```
   cd <main-repo> && jj git init --colocate     # non-destructive; git untouched; rm -rf .jj reverts
   ```
   If the target branch is checked out in a linked worktree, that's fine — you
   duplicate it here (Phase 2) and leave the worktree's branch as the backup.

3. **Author identity** (empty identity can't push):
   ```
   jj config set --user user.name  "<Name>"
   jj config set --user user.email "<email>"
   ```

4. **Snapshot noise.** jj refuses to snapshot files over ~1 MiB. A dirty working
   dir full of build artifacts/logs will spam "refused to snapshot". Fix by
   ignoring the cruft (`*.test`, `*.log`, build-binary paths in
   `.git/info/exclude`) and/or raising the guard for this repo:
   ```
   jj config set --repo snapshot.max-new-file-size 60MiB
   ```
   These warnings are non-fatal — jj still operates on committed history — but
   quiet them so real output is readable.

5. **Signing backend.** This is the load-bearing setup jj lacks by default.
   - **Keyless / gitsign** (sigstore x509): jj's X.509 backend is **`gpgsm`**,
     which is exactly what gitsign is (git wires it via `gpg.format=x509`,
     `gpg.x509.program=gitsign`). So:
     ```
     jj config set --user signing.backend "gpgsm"
     jj config set --user signing.backends.gpgsm.program "gitsign"
     jj config set --user signing.behavior "own"   # sign commits you author
     ```
   - **SSH / GPG:** set `signing.backend` to `ssh`/`gpg` and the matching
     `signing.backends.<b>.program`, translating your existing git signing config.
   - Verify it actually signs before trusting it (Phase 4).

## Phase 1 — take the buckets

Get the slice manifest from **pr-buckets** (or accept one). You need, per bucket:
the files it owns, its dependency (`base` or another bucket), and whether it's
off-stack (bases on the feature branch directly, e.g. a test-harness seam).

## Phase 2 — duplicate, so the original branch stays a backup

Read the stack's change ids: `jj log -r '<base>::<dev-branch>' -T 'change_id.shortest(6) ++ " " ++ description.first_line() ++ "\n"'`.

Duplicate the whole stack — copies get new change ids; the original branch (and
any worktree checkout of it) is untouched:
```
jj duplicate '<bottom-change>::<top-change>'
```
Work on the duplicates from here.

## Phase 3 — split by bucket (file-disjoint = non-interactive)

`jj split -r <rev> <paths...>` puts those paths in the first commit, the rest in
a child. When buckets are file-disjoint this needs no interactive hunk picking —
set a no-op editor so it doesn't block on the description prompt, then set real
descriptions:
```
EDITOR=true jj split -r <delegation-copy> <bucket-3a-files>   # -> 3a ; remainder is the rest
EDITOR=true jj split -r <remainder>        <bucket-3b-files>   # -> 3b ; remainder -> 3c
jj describe -r <3a> -m "feat(x): dispatcher …"
jj describe -r <3b> -m "feat(x): wiring …"
jj describe -r <3c> -m "test(x): parity flip …"
```
If a bucket needs a *sub-file* split, `jj split -i -r <rev>` opens the diff editor
(interactive — hand it to the human or use a scripted tool selection).

Set a bookmark per bucket (jj rewrites descendants on split, so use change ids,
which are stable):
```
jj bookmark set <feature>-1-<slug> -r <change>
… one per bucket …
```
Verify each bucket's contents: `jj diff -r <bookmark> --name-only`, and sanity-
check the split is lossless (sum of split slices == the original commit's diff).

## Phase 4 — sign the whole stack in one op

Sign bottom-up so every bookmark lands on a signed commit (signing a mid-stack
commit rebases its descendants → new commit ids):
```
jj sign -r '<bottom-change>::'      # signs the range
```
**Verify** before pushing — don't trust the config blindly:
```
jj log -r <bookmark> -T 'if(signature, signature.status(), "NONE")'   # want: good
```
Keyless note: gitsign signs from cached OIDC creds if fresh (no prompt); if stale
it needs **one** interactive browser OIDC flow (device mode is unsupported) — that
flow is the human's. jj signs at rewrite/push, so the sign is naturally batched.

## Phase 5 — feature branch + stacked PRs

1. **Create the feature branch** on the base (this is the single-merge target):
   ```
   jj bookmark set <feature> -r <base>        # or reuse an existing feature branch
   jj git push --bookmark <feature>           # push the (empty-vs-base) feature branch
   ```
2. **Push each bucket bookmark** and open its PR **targeting the feature branch**
   (not main), in dependency order:
   ```
   jj git push --bookmark <feature>-1-<slug>
   gh pr create --base <feature> --head <feature>-1-<slug> --draft --title "…" --body "…(links prev slice)…"
   … 2 bases on 1, 3a on 2, … ; off-stack buckets base on <feature> directly …
   ```
   Draft is the default — they're dependent slices; draft signals "review in
   order, don't merge yet." Each PR body links its parent slice for sequencing.
3. **Reviewers** review each small PR into the feature branch. When all are in,
   the **feature branch is the single merge to `main`** (squash or merge, per
   repo convention).

## Do NOT
- **Force-reset `main`.** If local `main` diverged (behind upstream + a local
  commit not upstream), a `gh repo sync --force` / hard reset discards that
  commit. Instead `git fetch` and `jj rebase` the stack onto the fresh base.
- **Try to move a tool out of its module because of `replace`.** Go's internal-
  package rule ignores `replace` — a helper importing `…/internal/…` must live
  inside that module. Relevant when a bucket is a dev tool that imports internals.
- **Sign a mid-stack commit and forget the descendants.** Sign the whole range in
  one op (Phase 4) so bookmarks don't end up on unsigned rebased copies.

## Recovery
Every jj step is reversible: `jj op log` shows the operation trail, `jj op undo`
reverts the last. The duplicated original branch is your belt-and-suspenders.

## What jj gives you vs what this skill adds
- **jj native:** `split`, `duplicate`, `bookmark`, `git push`, `sign`, signing
  backends (gpg/gpgsm/ssh), automatic descendant rebase.
- **Not native (this skill):** the gpgsm→gitsign wiring, the feature-branch
  single-merge orchestration, PR creation (`gh`), and the bucket→bookmark mapping.
