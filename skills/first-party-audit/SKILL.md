---
name: first-party-audit
description: Before writing glue, a wrapper, or a "small helper", audit whether the capability already exists first-party — in the binary, the codebase, or the platform — and whether existing glue bypasses a better first-party implementation. Use when adding shell/Taskfile/CI glue, when a helper feels trivially writable, or when the same logic seems to exist twice. Produces an inventory with receipts, not vibes.
allowed-tools: Read Glob Grep Bash
argument-hint: <capability-description> [--scope=PATH] [--glue=Taskfile.yml|.github/workflows|scripts/]
---

<!-- Author: jamestexas — drafted from the 2026-08 mache lifecycle sessions (claude-opus-5) -->

# /first-party-audit — does this already exist, and is the glue worse than the code?

The failure this prevents, measured in one week on one repo: **eight
independent re-implementations**, each written by an agent with full code
search available — a generated-column probe written three times, a version
parser twice, an env-var override twice, a log-capture helper twice, and a
`PinnedVersion()` accessor added in the same session that used the existing
constant **in the same function being edited**. Plus the inverse defect:
Taskfile glue (`cp` over a live binary) that reimplemented an existing Go
installer LESS correctly than the code it bypassed — the Go code's own comment
warned against exactly what the glue did.

The root cause is never missing tooling. It is writing before interrogating.

## Procedure

Run BEFORE writing the helper, not after. Each step ends in a receipt (a
file:line or command output pasted into your working notes); a step without a
receipt was not performed.

1. **Name the capability in one sentence**, implementation-free. "Detect
   whether a SQLite column is generated", not "add ColumnIsGenerated".

2. **Interrogate the binary first.** `<tool> --help`, subcommand help, hidden
   commands. The capability may already ship. (A support answer once said
   `launchctl kickstart` because nobody checked that the binary's own `daemon`
   surface was the place it belonged.)

3. **Search the codebase for the MECHANISM, not your intended name.** Grep for
   the distinctive constant, syscall, SQL pragma, or error string the
   implementation must contain — `pragma_table_xinfo`, `SIGTERM`, `Setpgid`,
   the exact env var. Names differ; mechanisms collide. Then search test files
   separately: test helpers are where the third copy usually hides.

4. **Check the callers of what you find.** An existing implementation with the
   wrong visibility (unexported, wrong package) is an EXPORT, not a rewrite.
   An existing one with zero callers is a deletion candidate, not a pattern.

5. **Audit the glue against the first-party code.** For each Taskfile/CI/shell
   step that shadows a binary capability: does the glue do it the same way? If
   the code does an atomic rename and the glue does `cp`, the glue is not
   duplicative — it is WORSE, and delegating (`task install` → `mache
   install`) deletes the divergence.

6. **Interrogate the platform before reimplementing it.** Supervisors,
   kernels, and stdlibs have opinions: launchd pins code identity at
   bootstrap; SIGTERM semantics interact with KeepAlive; `pragma_table_info`
   omits generated columns. Read the existing unit/plist/config as first-party
   code TOO — a missing `ExitTimeOut` is the platform's 20s default silently
   SIGKILLing your cleanup.

7. **Verdict, one of four**: USE (call the existing thing) / EXPORT (widen
   visibility, delete nothing) / DELEGATE (glue calls first-party) / WRITE
   (genuinely absent — say where it will live and why that package, since a
   49k-line catch-all package is where step 3 goes to die).

## Output

A short table: capability | where it exists (file:line or "absent") | callers |
verdict | receipt. If the verdict is WRITE, the table is the evidence that the
search happened.

## Red flags that mean STOP and run this skill

- "I'll just add a small helper" in a package you did not survey
- A Taskfile/CI step about to shell out to do what the binary does
- Writing a probe/parser/env-var whose NAME you invented in the last hour
- A test helper that feels generic (capture-log, fake-daemon, temp-HOME)
- Any second implementation "for now"
