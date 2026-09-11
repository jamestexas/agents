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
   Run it in a linked worktree and jj refuses with a hint that names the two
   ways out:
   ```
   Error: Cannot create a colocated jj repo inside a Git worktree.
   Hint: Run `jj git init` in the main Git repository instead, or use `jj workspace add` …
   ```
   If the target branch is checked out in a linked worktree, that's fine — you
   duplicate it here (Phase 2) and leave the worktree's branch as the backup.

3. **Author identity** (empty identity can't push):
   ```
   jj config set --user user.name  "<Name>"
   jj config set --user user.email "<email>"
   ```

4. **Snapshot noise — and why it is dangerous for agents.** jj refuses to
   snapshot files over ~1 MiB. The refusal is a **`Warning:`, not an error**: the
   command still **exits 0**, and the oversized file is silently left *untracked*
   and *out of the commit you just made*. An agent that trusts exit codes will
   report a clean commit that is missing a file.
   ```
   Warning: Refused to snapshot some files:
     big.bin: 8.0KiB (8192 bytes); the maximum size allowed is 1.0KiB (1024 bytes)
   ```
   So: **grep the output for `Refused to snapshot`** after any command that
   snapshots (`status`, `commit`, `split`, `diff` — any of them). Then fix the
   cause by ignoring the cruft (`*.test`, `*.log`, build-binary paths in
   `.git/info/exclude`) and/or raising the guard for this repo:
   ```
   jj config set --repo snapshot.max-new-file-size 60MiB
   ```

5. **Signing backend.** This is the load-bearing setup jj lacks by default.
   Field reference: [config → commit signing](https://docs.jj-vcs.dev/latest/config/#commit-signing).
   - **Keyless / gitsign** (sigstore x509): jj's X.509 backend is **`gpgsm`**,
     which is exactly what gitsign is (git wires it via `gpg.format=x509`,
     `gpg.x509.program=gitsign`). So:
     ```
     jj config set --user signing.backend "gpgsm"
     jj config set --user signing.backends.gpgsm.program "gitsign"
     ```
   - **Then pick a `signing.behavior`** — this is the choice that decides whether
     a stacked workflow is pleasant or miserable. Valid values are `drop`,
     `keep` (the default), `own`, `force`.
     - `own` signs every commit you author **on every rewrite**. jj *always*
       re-signs; it cannot detect that a commit is already signed by you
       ([jj#5786](https://github.com/jj-vcs/jj/issues/5786)). Splitting,
       describing, and rebasing a stack rewrites commits constantly, so `own`
       means one signing operation per rewrite per commit.
     - **For rewrite-heavy stacked work, prefer `drop` + sign-on-push:**
       ```
       jj config set --user signing.behavior "drop"
       jj config set --repo git.sign-on-push true
       ```
       Rewrites stay unsigned and cheap; every commit is signed in **one pass at
       push**, which is also the only moment the signature has to exist.
   - **SSH / GPG:** set `signing.backend` to `ssh`/`gpg` and the matching
     `signing.backends.<b>.program`, translating your existing git signing config.
   - **Expect "Unverified" on GitHub for gitsign commits.** Sigstore's root is
     not in GitHub's trust store, so the web UI badge is not the check that
     matters. Verify with `gitsign verify` (or `jj log`, Phase 4) instead of
     treating the badge as a failure.
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

Address commits by **change id**, not by description. `description("…")` matches
**exactly** (descriptions carry a trailing newline), so `description("feat: x")`
returns the empty set and every command built on it silently operates on nothing.
Use `description(substring:"feat: x")` if you must match text at all.

## Phase 3 — split by bucket (file-disjoint = non-interactive)

`jj split -r <rev> <paths...>` puts those paths in the first commit, the rest in
a child. Passing a fileset already suppresses the interactive diff editor, and
`-m` supplies the description non-interactively, so the whole split is one
command per bucket:
```
jj split -r <delegation-copy> <bucket-3a-files> -m "feat(x): dispatcher …"   # -> 3a ; remainder is the rest
jj split -r <remainder>       <bucket-3b-files> -m "feat(x): wiring …"        # -> 3b ; remainder -> 3c
jj describe -r <3c> -m "test(x): parity flip …"                              # the last remainder
```
**`-m` describes the *selected* side only.** The remainder keeps the original
commit's description verbatim, which is why the final remainder still needs an
explicit `jj describe`. Check descriptions after splitting, don't assume them.

> **Do not point `EDITOR` at a no-op (`/usr/bin/true`) to skip the description
> prompt.** A no-op editor "accepts" the prefilled text, so **both halves of the
> split silently end up with the same description** — and neither is wrong enough
> to notice. You get a stack whose PR titles are all the pre-split message. The
> fileset + `-m` form above is the fix.

If a bucket needs a *sub-file* split, use
[jj-hunk](https://docs.jj-vcs.dev/latest/community_tools/) — it does programmatic
hunk selection for split/commit/squash without opening a diff editor, and is on
jj's own community-tools list as the option for scripts and coding agents.
Otherwise `jj split -i -r <rev>` opens the interactive diff editor — hand that to
the human.

Set a bookmark per bucket (jj rewrites descendants on split, so use change ids,
which are stable):
```
jj bookmark set <feature>-1-<slug> -r <change>
… one per bucket …
```
Two bookmark behaviors matter here:
- **Bookmarks follow rewrites.** Describe or rebase the commit and the bookmark
  moves with the change id to the new commit id. Nothing to re-point.
- **Abandoning a commit DELETES its bookmark.** `jj abandon -r <change>` prints
  `Deleted bookmarks: <name>` and the bookmark is gone, not relocated to the
  parent. If you abandon a slice, re-create its bookmark deliberately.
Verify each bucket's contents: `jj diff -r <bookmark> --name-only`, and sanity-
check the split is lossless (sum of split slices == the original commit's diff).

### Off-stack buckets — `jj parallelize`

pr-buckets marks buckets that don't depend on the rest as **off-stack**. Those
shouldn't sit in the linear chain: an off-stack slice stacked on three unrelated
slices can't be reviewed or merged until they land. `jj parallelize` makes a
run of commits siblings on their common parent, so each becomes an independent
PR against the feature branch:
```
jj parallelize '<first-change>::<last-change>'
```

**Gotcha: only contiguous ranges work.** `parallelize` takes the `::` range form.
A sparse revset silently does nothing:
```
jj parallelize 'c1 | c3'     # -> "Nothing changed."  (c2 is not in the set, so c3 keeps its ancestry)
jj parallelize 'c1::c3'      # -> c1, c2, c3 all become siblings of the base
```
It reports `Nothing changed.` and exits 0 — no error to catch. If you need to
lift a non-adjacent commit out, `jj rebase -s <change> -d <base>` it directly
instead.

## Phase 4 — sign the whole stack in one op

With `git.sign-on-push = true` (Phase 0) this phase is **the push itself** — skip
to Phase 5 and verify afterward. Sign explicitly only when you need signatures
before pushing:
```
jj sign -r '<bottom-change>::'      # signs the range; default is the revsets.sign setting
```
Either way, sign **the whole range in one op**. Signing rewrites the commit, and
rewriting a mid-stack commit rebases every descendant into new commit ids — so a
one-commit signing pass leaves the bookmarks above it pointing at unsigned
commits. This is the argument for sign-on-push: push is the one moment the whole
stack is rewritten together anyway.

**Verify** — don't trust the config blindly. Signature columns are hidden by
default (`ui.show-cryptographic-signatures` is `false`), so ask for the field:
```
jj log -r <bookmark> -T 'if(signature, signature.status(), "NONE")'   # want: good
```
Keyless note: gitsign signs from cached OIDC creds if fresh (no prompt); if stale
it needs **one** interactive browser OIDC flow (device mode is unsupported) — that
flow is the human's.

## Phase 5 — feature branch + stacked PRs

See jj's own [GitHub workflow page](https://docs.jj-vcs.dev/latest/github/) for the
general push/fetch/review-comment mechanics; below is only the feature-branch
orchestration it doesn't cover.

1. **Create the feature branch** on the base (this is the single-merge target):
   ```
   jj git push --named <feature>=<base>       # creates, names, and tracks in one step
   ```
   `--named name=revision` is the one-step form: it creates the bookmark, pushes
   it, and sets it tracking the remote. Prefer it over
   `jj bookmark set` + `jj git push --bookmark`, which is two steps that can
   disagree. (There is no `--allow-new` flag in jj 0.45.1 — `--named` is how you
   push a bookmark the remote has never seen.)
2. **Push each bucket bookmark** and open its PR **targeting the feature branch**
   (not main), in dependency order:
   ```
   jj git push --named <feature>-1-<slug>=<change>      # first push of this slice
   jj git push --bookmark <feature>-1-<slug>            # subsequent updates
   gh pr create --base <feature> --head <feature>-1-<slug> --draft --title "…" --body "…(links prev slice)…"
   … 2 bases on 1, 3a on 2, … ; off-stack buckets base on <feature> directly …
   ```
   For a throwaway push where the name doesn't matter, `jj git push --change <rev>`
   auto-creates a bookmark named `push-<full-change-id>`. Convenient for a quick
   CI run; don't use it for review slices — reviewers need names that say what the
   slice is.
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
- **Trust a jj exit code as "it worked".** Snapshot refusals and no-op
  `parallelize` both warn and exit 0 (Phase 0.4, Phase 3). Read the output.

## Recovery
Every jj step is reversible: `jj op log` shows the operation trail and `jj undo`
reverts the last one. Note the command is top-level `jj undo` — **`jj op undo`
does not exist** (verified on 0.45.1; it errors with `unrecognized subcommand`).
The duplicated original branch is your belt-and-suspenders.

## What jj gives you vs what this skill adds
- **jj native:** `split`, `duplicate`, `bookmark`, `git push`, `sign`,
  `parallelize`, signing backends (gpg/gpgsm/ssh), automatic descendant rebase.
- **Not native (this skill):** the gpgsm→gitsign wiring, the feature-branch
  single-merge orchestration, PR creation (`gh`), and the bucket→bookmark mapping.

## Upstream references (read these instead of a copy)
Command flags and semantics change between releases; this skill deliberately does
not restate them.
- [config → commit signing](https://docs.jj-vcs.dev/latest/config/#commit-signing) — every signing key, backend, and behavior.
- [GitHub workflows](https://docs.jj-vcs.dev/latest/github/) — push/fetch, addressing review comments, colocated repos, `gh` setup.
- [community tools](https://docs.jj-vcs.dev/latest/community_tools/) — the sanctioned integration list.
- `jj help <cmd>` / `jj <cmd> --help` is the ground truth for the installed version.

Adjacent tools, if this skill's hand-rolled orchestration stops paying for itself:
- [jj-spr](https://github.com/jennings/jj-spr) — stacked PRs via shadow base branches, so each PR's diff is just its own slice. Different tradeoff from the feature-branch approach here.
- [LazyJJ](https://lazyjj.dev) — a jj *distribution* shipping a stacked workflow (stack-view/-top/-sync, PR integration) preconfigured. Not the same project as the `lazyjj` TUI on jj's community-tools list; the names collide.
