---
name: taskfile-ci-parity
description: >
  Wire repo validation so local == CI by construction - every check is a
  Taskfile target, and CI + git hooks INVOKE those targets rather than
  re-implementing the commands. Use when adding a test/lint/format/validation
  gate, when CI and local disagree, when a pre-commit/pre-push hook duplicates
  a command, or when asked to make validation 1:1 with CI, add a Taskfile
  target, or stop CI failing first. Covers includes-vs-composition, the
  non-mutating task ci gate, and the pre-push hook pattern.
allowed-tools: "Read,Glob,Grep,Edit,Write,Bash(task *),Bash(task:*),Bash(pre-commit *),Bash(git *),Bash(gh *),Bash(grep *),Bash(ls *)"
argument-hint: "<check-name> [--audit] [--repo <path>]"
---

<!-- Author: jamestexas — drafted by claude-opus-4-8 (2026-06-22). Reference impl: agentic-research/mache PR #429. Provenance: mache memory feedback_validation_taskfile_ci_gate. -->

# /taskfile-ci-parity — Single-source validation across Taskfile, CI, and git hooks

## The principle (one sentence)

**Validation logic lives in Taskfile targets; CI workflows and git hooks INVOKE those targets — they never re-implement the underlying command.** When that holds, "passes locally" and "passes CI" cannot disagree, because they run the same definition. The job of this skill is to make that true and keep it true.

## The three layers (and the anti-pattern each one drifts into)

| Layer | Should do | Drifts into (the smell) |
|---|---|---|
| **Taskfile** | own every command (`task test`, `task lint`, `task fmt:check`) | a one-off command that exists nowhere as a target |
| **CI workflow** | `run: task <target>` | inlining `go test …` / `gofumpt -l …` / `npm run …` directly in the YAML |
| **git hooks** | invoke `task <target>` | `.pre-commit-config.yaml` `entry:` re-implementing the same flags |

If CI says `run: go test -race ./...` and the Taskfile says `task test: go test -race ./...`, you have **two copies of the same command** that will drift the first time someone tweaks one. Collapse to one: CI runs `task test`.

## How to make Taskfiles modular (DRY) — composition vs includes

These solve **different** problems. Pick by scope:

- **Composition** (within one Taskfile, same repo) — one target calls others. This is the default dedup tool.
  ```yaml
  tasks:
    ci:                       # the single-source gate
      cmds:
        - task: fmt:check     # serial; non-mutating verify, not `fmt` (-w)
        - task: vet
        - task: lint
        - task: test          # heavy tests run here; sub-gates compose in
        - task: validate
  ```
  Use `cmds: - task: X` for **serial** steps, `deps: [X, Y]` for **parallel** (deps must not depend on each other). Parameterize with `internal: true` + `vars:` to avoid copy-pasted near-identical tasks:
  ```yaml
    _build-image: { internal: true, cmds: ["docker build -t {{.IMG}} ."] }
    build-prod:   { cmds: [{ task: _build-image, vars: { IMG: prod } }] }
  ```

- **Includes** (across files / across repos) — split a big Taskfile or **share a gate between repos**:
  ```yaml
  includes:
    common: ../shared/Taskfile.common.yml   # tasks namespaced as `common:*`
  tasks:
    ci: { cmds: [{ task: common:lint }, { task: test }] }
  ```
  Reach for includes when the **same gate should exist in many repos** (e.g. hoist a `Taskfile.ci.yml` into a shared location and `includes:` it everywhere) — that's the cross-repo version of single-sourcing. Within one repo, prefer composition.

## Two gate variants — know which you're wiring

- **`task check`** — the *dev* gate. May MUTATE (`fmt` with `-w`, `lint --fix`). Convenient locally; do NOT run in CI (CI must not rewrite the tree).
- **`task ci`** — the *merge* gate. NON-mutating: `fmt:check` (diff-and-fail, never write), no `--fix`. A dirty/unformatted tree must FAIL, not be silently fixed. This is the one CI and the pre-push hook run.

Keeping both, with `ci` non-mutating, is the load-bearing distinction. A mutating gate in CI hides the failure it should report.

## The git-hook layer — catch CI failures before CI

Goal: a push that CI would reject fails **locally first**. Use **pre-push**, not pre-commit, for the full gate — running the whole `-race` suite on every commit is too slow; you push far less often. Keep pre-commit fast (format/lint per-file), put the 1:1 gate on pre-push.

With the **pre-commit framework** (`.pre-commit-config.yaml`), add a local hook on the `pre-push` stage that invokes the task — never re-implement it:
```yaml
  - repo: local
    hooks:
      - id: task-ci
        name: task ci (1:1 with CI — full gate before push)
        entry: task ci
        language: system
        pass_filenames: false
        always_run: true
        stages: [pre-push]
```
One-time install of the pre-push stage: `pre-commit install --hook-type pre-push`. (Suggest the user run it via `! pre-commit install --hook-type pre-push` so output lands in-session.) If git-lfs already owns `.git/hooks/pre-push`, the pre-commit framework chains correctly once installed; verify with a dry `git push --dry-run`.

## Procedure

1. **Audit for drift.** `grep -n "run:" .github/workflows/*.yml` and read `.pre-commit-config.yaml` `entry:` lines. Any command not expressed as `task <target>` is a dedup target. Note them.
2. **Make every check a target.** For each drifted command, ensure a Taskfile target owns it; if missing, add one (smallest sensible unit, e.g. `fmt:check`, `parity`, `gen:server-json:check`).
3. **Compose the gate.** Add/confirm `task ci` composing the non-mutating targets. Keep `check` as the mutating dev convenience.
4. **Point CI at it.** Replace inline `run:` commands with `run: task <target>`. Parallel CI jobs each calling a task is fine — the *commands* aren't duplicated, only the orchestration. (Pin the task version: `go install github.com/go-task/task/v3/cmd/task@vX`.)
5. **Point hooks at it.** pre-commit `entry:` → `task <fast-target>`; add the pre-push `task ci` hook above.
6. **Verify.** `task --list-all | grep -E 'ci|check|<new>'` (targets parse), run the new target, and confirm `task ci` and the CI workflow reference the same target names.
7. **Record provenance.** Note in the target's comment that it's the single source ("CI and the pre-push hook invoke THIS — never re-implement"). Link the ADR/memory if the repo has one.

## Red flags (stop and dedup)

- A command appears in both a workflow `run:` and a Taskfile `cmds:` → CI should call the task.
- `.pre-commit-config.yaml` `entry:` spells out flags that a `task` target already owns → call the task.
- CI runs a *mutating* formatter (`-w`, `--fix`) → switch to the `:check` variant; CI must report, not fix.
- "It passed locally but CI failed on formatting/lint" → the local path and CI path are different commands. Converge them.
- A new test/check added as a loose `go test -run …` you run by hand → it isn't a gate until it's a target wired into `ci` (and thus CI + pre-push).

## Definition of done

A check is *done* when: (1) it's a Taskfile target, (2) `task ci` includes it (so CI and the pre-push hook both run it), and (3) no workflow or hook re-implements its command. Until then it's a script someone has to remember to run.
