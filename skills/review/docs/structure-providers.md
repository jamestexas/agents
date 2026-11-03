# Structural providers

A review spends most of its reading on one question: what does this change
touch, and what touches it? A structural provider answers that as data, once,
in phase 1, so the question and reader phases start from exact call paths
instead of reading whole files to find them.

A provider is an ordinary pack whose name starts with `structure-`. Its probe
prints one **review-structure/1** document on stdout. The skill ships
`structure-gopls`. A site pack (`$HUD_ROOT/review-packs.yaml` or the repo's
`.claude/review-packs.yaml`) adds others under its own `structure-<name>`,
such as a monorepo dependency-graph tool that sees callers in other modules,
or replaces the default by reusing its name.

## The document

```json
{
  "schema": "review-structure/1",
  "provider": "gopls",
  "tier": "type",
  "at": "<head sha or ref>",
  "symbols": [
    {
      "symbol": "(*Core).deleteItem",
      "def": { "file": "pkg/core/e.go", "line": 1982 },
      "callers": [ { "symbol": "CascadeDeleteItem", "file": "pkg/core/e.go", "line": 1976 } ],
      "callees": [ { "symbol": "recordOutcome", "file": "pkg/core/e.go", "line": 2075 } ],
      "cross_module_callers": [ { "symbol": "?", "file": "other/mod/x.go", "line": null } ]
    }
  ],
  "skipped": [ { "file": "pkg/big.go", "symbol": "f", "reason": "over the symbol cap" } ]
}
```

- **`symbols`**: one entry per changed function or method. A changed doc
  comment belongs to the function it documents.
- **`callers`**: the call site (file and line of the call). **`callees`**: the
  callee's definition. A ref outside the worktree carries `"external": true`.
- **`cross_module_callers`**: optional. For providers that can see past one
  module.
- **`tier`**: how exact the answer is. `type` means type-resolved, with exact
  lines. `token` means name-matched, possibly file-level, and `line` may be
  `null`. `module` means module-level reach only.
- **`skipped`**: whatever the provider could not answer, with a reason. A gap
  is listed, never silently dropped.

Paths are relative to the worktree. `scripts/structure-check.mjs` validates
documents; run it on a new provider's output before relying on it.

## Writing a provider

The probe gets the usual pack environment (`WORKTREE`, `MERGE_BASE`, `HEAD`,
`FILES`, `GO_PACKAGES`, `OUTDIR`, `SKILL_DIR`). Providers run in pack order,
generic before site, so a site provider can read
`$OUTDIR/probes/structure-gopls/paths.out` for the changed-symbol list and add
only what it knows. A provider that cannot run exits 127 with the reason on
stderr, and the probe is recorded UNAVAILABLE.

A tool with its own JSON output can be adapted with one `jq` filter in the
site pack. When the tool can emit review-structure/1 directly, the pack
becomes a single command.
