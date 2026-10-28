# review

`/review <pr>` produces one note under your HUD and one evidence directory
beside it. Read the top of the note; open the `<details>` blocks when you
disagree with it.

**What a run leaves behind**

```
$HUD_ROOT/projects/<project>/notes/PR-N-<slug>.md   the artifact
$HUD_ROOT/projects/<project>/raw/PR-N/evidence/     every probe's output + manifest.json
$HUD_ROOT/projects/<project>/raw/PR-N/work/         ledger, claims, refutations, triage, findings
$HUD_ROOT/projects/<project>/raw/PR-N/state.json    phase, gates, verdict; what the HUD reviews panel shows
```

**Reading the artifact.** TL;DR, verdict, confirmed findings, job-level
impact are open. If the verdict surprises you, open *Decision ledger* and
find the row it turned on; the row names the file that settled it. *Evidence
manifest* lists UNAVAILABLE probes first: those are the things the review
could not check.

**Adding a site pack.** Copy `packs.site.example.yaml` to
`$HUD_ROOT/review-packs.yaml` (yours) or `<repo>/.claude/review-packs.yaml`
(the repo's). Each pack states the question it answers, the globs that
select it, the binaries it needs, and its probes. Set the env vars the
example names in your shell profile.

**Replaying.** The *Replay* block holds the exact evidence command and the
manifest hash. Re-run it; a different hash means the evidence moved.

**Tests.** `bash skills/review/test/run.sh`.
