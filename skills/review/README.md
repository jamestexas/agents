# review

`/review <pr>` produces one note under your HUD and one evidence directory
beside it. Read the top of the note; open the `<details>` blocks when you
disagree with it.

**What a run leaves behind**

```
$HUD_ROOT/projects/<project>/prs/PR-N/review.md          the artifact
$HUD_ROOT/projects/<project>/prs/PR-N/raw/evidence/      every probe's output + manifest.json
$HUD_ROOT/projects/<project>/prs/PR-N/raw/work/          ledger, claims, refutations, triage, findings
$HUD_ROOT/projects/<project>/prs/PR-N/raw/state.json     phase, gates, verdict; what the HUD reviews panel shows
$HUD_ROOT/projects/<project>/prs/PR-N/raw/runs/          earlier reviews of the PR, one .tar.gz each
```

**Reading the artifact.** TL;DR, verdict, confirmed findings, job-level
impact are open. If the verdict surprises you, open *Decision ledger* and
find the row it turned on; the row names the file that settled it. *Evidence
manifest* lists UNAVAILABLE probes first: those are the things the review
could not check.

**Probe packs.** A probe pack is a named group of shell commands (probes)
that the evidence script runs when the PR touches files matching the pack's
globs, such as `go build`/`go vet` for Go changes. Each pack states the
question its output answers, so the review can tell an answer exists. Their
output lands in `raw/evidence/`, and a probe whose tool is missing is
recorded UNAVAILABLE rather than skipped. The generic packs ship in
`packs.yaml`.

**Adding your own packs.** A check that needs knowledge of your
organization (a deploy workflow, a metric name, an internal CLI) does not go
in `packs.yaml`, because this repo is public. Copy
`packs.site.example.yaml` to `$HUD_ROOT/review-packs.yaml` (just for you)
or `<repo>/.claude/review-packs.yaml` (for everyone reviewing that repo),
and set the env vars the example names in your shell profile. A repo's file
is read from your trusted checkout at the base commit, never from the PR,
since probes run with your credentials.

**`--fast`, and the early signal.** `/review <pr> --fast` is a first look
in about a quarter of an hour: evidence, questions and settle run, then the
early signal names every candidate that already rests on hard evidence (a
failed build it cites, or a reader's `[Blocking]` tag backed by something
that ran), and the run stops with a PRELIMINARY verdict. Nothing in it has
been refuted or triaged, so `check.mjs` refuses to call it postable and it
is never the basis for an approval; when the early signal is empty, rerun
without the flag before deciding anything. The early signal itself is on in
every mode — fast, light, default, deep — and appears in the artifact as an
open "Early signal (unrefuted)" section only while it has something to say.

**Replaying.** The *Replay* block holds the exact evidence command and the
manifest hash. Re-run it; a different hash means the evidence moved.

**Tests.** `bash skills/review/test/run.sh`.
