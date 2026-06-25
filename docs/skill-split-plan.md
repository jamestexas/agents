# Skill-split & generalization plan

> **Status:** Plan only — no moves executed. Drafted 2026-06-25.
> **Decision basis (from owner):** `mache`, `rosary`, `signet`, `cloister`, `notme`,
> `ley-line-open` are **public**; **`lectio` is private**. Tools should own the skills
> that wrap them. mache skills belong in the mache repo; lectio coupling should leave
> this repo entirely.

This repo (`jamestexas/agents`) stays the **curated aggregator** of tool-agnostic
agents/skills. Anything that *hard-requires* a private MCP tool, or is really a thin
wrapper around one tool, ships from that tool's own repo instead.

---

## 1. Destination repos

| Tag | Repo | Public? | Already ships Claude config? |
|-----|------|---------|------------------------------|
| `mache` | `agentic-research/mache` | yes | TBD — create `skills/` + `agents/` if absent |
| `rosary` | `agentic-research/rosary` | yes | **yes** — already ships a `rosary:` plugin (skills + agents) |
| `lectio` | lectio repo | **no (private)** | — destination for anything that must keep lectio coupling |
| `agents` | `jamestexas/agents` (here) | yes | yes — this repo |

---

## 2. Classification key

- **HARD** — declares `mcp__<tool>__*` in `allowed-tools` or is a wrapper around the
  tool; useless without it. → **relocate** to the tool repo.
- **SOFT** — mentions the tool as an optional signal / example / graceful enhancement.
  → **stays here**, reword to "if a `<tool>` MCP server is available" (the
  `pr-review-kit` pattern at `skills/pr-review-kit/SKILL.md:599` is the model).
- **PRIVATE-LEAK** — couples to `lectio` (private). → **must leave** this public repo:
  either move to the lectio repo or strip the lectio path and keep a public fallback.

---

## 3. Migration matrix — skills

| Skill | Dep | Class | Destination | Action |
|-------|-----|-------|-------------|--------|
| `mache-usage` | mache | HARD | **mache** | Move. It's literally the mache MCP server lifecycle manager. |
| `diagram-gen-spec` | mache | HARD | **mache** | Move. `allowed-tools: mcp__mache__*`. |
| `diagram-gen-emergent` | mache | HARD | **mache** | Move. `allowed-tools: mcp__mache__*`. |
| `review-prep` | mache | HARD | **mache** | Move. Composes the two diagram skills + impact. |
| `mache-explore` | mache | HARD | **mache** | Already deleted in worktree — finish the removal; lands in mache. |
| `pr-review` | mache | HARD (composite) | **decision** | Orchestrates `review-prep`/diagram skills. Either move the whole PR-review bundle to mache, or keep here and declare the mache skills as an external dependency. See §6. |
| `survey` | mache + beads | HARD | **decision** | Calls `mcp__mache__get_overview/list_directory` + writes beads. Natural fit: rosary (it's a beads-producing survey). |
| `feature-impl` | mache | HARD-ish | **decision** | Calls `mcp__mache__find_*`. Could stay with SOFT rewording, or move to mache. |
| `work-scope` | mache + linear | SOFT/HARD | stays (reword) | mache is enhancement; Linear is the real dep. Keep, make mache optional. |
| `pr-board` | **lectio** + beads | PRIVATE-LEAK | **lectio repo** | Move out. `allowed-tools: mcp__lectio__*` — built on a private tool. |
| `review-queue` | **lectio** + zen | PRIVATE-LEAK | **lectio repo** / split | Move out, or strip lectio "catch-up" path and keep the gh/zen fan-out here. |
| `explain-work` | mache + **lectio** | PRIVATE-LEAK | strip lectio | Newest skill. Make the lectio enrichment optional so it can stay public; mache part is SOFT. |
| `doc-triage` | beads + crumb | SOFT | stays (reword) | beads/crumb are output sinks; works without them. |
| `linear-escalation-triage` | beads + linear | SOFT | stays (reword) | One `rsry_bead_create` call; gate behind "if beads available". |
| `problem-decomposer` | beads (`rosary:note`) | SOFT | stays | Emits bead *specs*; `rosary:note` is one consumer. Keep, note it. |
| `prior-art-cartographer` | beads | SOFT | stays | Same — bead refs are optional cross-links. |
| `repo-topic-tagger` | — | SOFT | stays | Only mentions `agentic-research/mache` as an *example* target. No code dep. |
| `readme-restructure` | — | SOFT | stays | Uses mache README as a worked example, not a dep. |
| `repo-description-polish` | — | SOFT | stays | Example targets only. |
| `repo-homepage-set` | — | SOFT | stays | Example targets only. |
| `repo-social-preview` | — | SOFT | stays | Example targets only. |
| `workflow-audit` | mache binary | SOFT | stays | Already has a clone-and-build fallback (`SKILL.md:40-43`). |
| `taskfile-ci-parity` | — | SOFT | stays | mache only in a provenance comment. |
| `pr-review-kit` | mache | SOFT | stays | **Already** graceful ("or equivalent code-intelligence tool"). Reference pattern. |
| `break-glass`, `self-audit` | none | — | stays | Tool-agnostic. |

## 4. Migration matrix — agents

| Agent | Dep | Class | Destination | Action |
|-------|-----|-------|-------------|--------|
| `mache-explorer` | mache | HARD | **mache** | Move with the mache skills. |
| `platform-archaeologist` | crumb / nexus | HARD | **decision** | Couples to crumb + Nexus brokers; move to crumb repo or reword. |
| `adversarial-synthesis-lead` | rosary GOLDEN_RULES + cloister | path-fix | stays | cloister/rosary are public — keep the agent, just fix the `~/remotes/...` path (§5). |
| `bundle-isolation-tester` | rosary + cloister | path-fix | stays | Same. |
| `dos-resilience-auditor` | rosary + cloister | path-fix | stays | Same. |
| `enumeration-oracle-hunter` | rosary + cloister | path-fix | stays | Same. |
| `observability-gap-auditor`, `protocol-replay-adversary`, `trust-root-adversary`, `security-auditor` | cloister/interlace/signet | content | stays | Public projects — fine to keep; no path changes needed unless they cite `~/` paths. |
| `review-pattern-surfacer`, `repo-seo-curator` | beads (soft) | SOFT | stays | Reword bead refs as optional. |

---

## 5. Path-portability fixes (separate workstream — independent of the split)

This is the original "home paths" ask. Can be done **now**, regardless of the split.

| Location | Problem | Fix |
|----------|---------|-----|
| `docs/problems/substrate-idl.md` | ~40 absolute `/Users/jamesgardner/remotes/art/...` and `/Users/jamesgardner/github/jamestexas/...` paths | This is a **real-run artifact** of private decomposition work, not a reusable template (the template is `skills/problem-decomposer/examples/substrate-idl.md`). **Recommend: move this doc to the cloister repo** (where the work lives) or delete it from here. If kept, rewrite paths repo-relative (`cloister/tools/...`). |
| `docs/problems/README.md` | `~/remotes/art/cloister/docs/adr/` example | Reword to `<repo>/docs/adr/` or a repo URL. |
| `agents/{adversarial-synthesis-lead,bundle-isolation-tester,dos-resilience-auditor,enumeration-oracle-hunter}.md` | `~/remotes/art/rosary/agents/rules/GOLDEN_RULES.md` | rosary is public — replace with the GitHub raw URL (`github.com/agentic-research/rosary/.../GOLDEN_RULES.md`) or a `$ROSARY_HOME`-style note. |
| `skills/workflow-audit/SKILL.md:89` | already documents `$HOME/...` normalization | No change — it's the *correct* pattern; cite it as the house style. |
| Various skills | `~/remotes/art/mache`, `~/.cache/...` examples | Make example paths generic (`<path-to-repo>`) or env-rooted. |

**House rule to adopt:** no absolute `/Users/...` or `/home/...` paths in committed files;
use `$HOME`, `<repo>`-relative, or a repo URL. (Already encoded in `workflow-audit`'s
scrub table — promote it to `CLAUDE.md`.)

---

## 6. Mechanics & open decisions

**Composition risk (the one real cost of splitting).** `pr-review` orchestrates
`review-prep` + `diagram-gen-*`. If those move to mache and `pr-review` stays here, the
one-`install.sh` story breaks — installing this repo no longer gives you a working
`pr-review`. Three options:

1. **Bundle** — move the whole PR-review + mache cluster to the mache repo. Cleanest
   coupling, but the generic `pr-review-kit` (already graceful) should stay here.
2. **Cross-repo dep** — keep `pr-review` here, document "requires the mache plugin
   installed" in its frontmatter, fail loud if `mcp__mache__*` is absent.
3. **Soft-degrade** — `pr-review` runs without mache (skips the structural diagrams),
   matching what `pr-review-kit` already does.
   *Recommended* — preserves the single-install story and degrades gracefully.

**install.sh impact.** `scripts/install.sh` symlinks `skills/*` and `agents/*` into
`~/.claude/`. After moves, the relocated skills install from the *tool* repo's own
installer. Verify no skill name collides across repos (Claude Code namespaces plugin
skills as `plugin:skill`, so `rosary:survey` vs a local `survey` can coexist — but pick
one home to avoid confusion).

**Decisions needed before executing moves:**

1. `survey`, `feature-impl` — move to mache/rosary, or keep with soft-degrade? (Lean: `survey` → rosary, `feature-impl` → keep + soft.)
2. `pr-review` bundle strategy — option 1/2/3 above? (Lean: 3.)
3. `review-queue` — move whole to lectio repo, or split (keep gh/zen fan-out here, drop lectio catch-up)?
4. `docs/problems/substrate-idl.md` — relocate to cloister, delete, or keep with relative paths?
5. `platform-archaeologist` agent — move to crumb repo, or reword its crumb/Nexus coupling?

---

## 6a. Resolved decisions (2026-06-25)

Owner reviewed §6; decisions locked:

1. **`survey` / `feature-impl` → keep here, soft-degrade mache.** Principle: relocate
   only *wrappers* (mache-usage, diagram-gen-*); *workflow* skills that merely use a tool
   stay in the aggregator and degrade to grep/glob. (`survey` is coupled to both mache
   *and* beads — belongs to neither tool.)
2. **`pr-review` → stays, soft-degrade.** Scoped beyond mache; keeps single-install story.
3. **`review-queue` → split.** Keep the generalizable gh/zen per-PR fan-out + `pr-reviewer`
   dispatch here; demote lectio "catch-up" to optional enrichment (`if lectio available …`
   else `gh`). `pr-board` (lectio-first, `allowed-tools: mcp__lectio__*`) still **leaves**
   to the lectio repo.
4. **`docs/problems/substrate-idl.md` → delete.** Stale dated real-run artifact, 71
   absolute paths. The clean illustrative example `skills/problem-decomposer/examples/
   substrate-idl.md` (0 absolute paths) stays. Also: change the decomposer's default
   `--output-dir` (currently `docs/problems/`) or document "point it outside the repo for
   real runs" so this can't recur.
5. **`platform-archaeologist` → reword.** Drop crumb/Nexus coupling (crumb is retired);
   generalize to "persist findings to a memory store or markdown." Confirm the agent is
   still used — if not, deprecate instead of reword.

## 7. Recommended sequencing

1. **Path scrub (now, low-risk, no moves):** fix §5 paths in-place. Unblocks "generalizable" immediately.
2. **lectio extraction (priority — private-leak):** move `pr-board` + lectio half of `review-queue`/`explain-work` out before any public push.
3. **mache bundle:** create `skills/` + `agents/` in the mache repo; move the HARD-mache cluster; leave `pr-review` soft-degrading here.
4. **rosary/beads:** decide `survey`/`doc-triage`/decomposer homes (rosary already ships a plugin, so low friction).
5. **Reword SOFT deps** to the "if available" pattern; promote the no-absolute-paths rule into `CLAUDE.md`.
