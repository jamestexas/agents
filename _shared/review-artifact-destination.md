**Where the notes file goes.** Resolve the destination in this order, and state
which one you used when you hand the review over:

1. **`$HUD_ROOT/projects/<project>/prs/PR-N/review.md`** when `HUD_ROOT`
   resolves — the env var if set, else `~/hud` if that directory exists. This is
   the default, and it is the HUD consolidation rule applied: a review artifact
   *is* a note, and notes live in exactly one tree — the one that is backed up,
   indexed, and searchable months later when you need the matrix again. The PR
   folder is the PR's one home: a second review of the same PR replaces
   `review.md` rather than adding a sibling, and anything else about that PR
   (reply drafts, follow-up notes) goes in the same folder, not in `notes/`.
2. **`/tmp/<owner>-<repo>-review/PR-N/review.md`** only when no HUD tree
   resolves. A scratch path is an honest "this is not being kept"; say so
   rather than letting the author assume it was filed somewhere.

Two destinations are wrong regardless of which branch you took. **Never a
browser's download directory** — it is unbacked-up, unindexed, and invisible to
every later search, so work content put there is work content lost. **Never
inside the repo under review**, which is how a private review note becomes a
commit. And never inside the agents/skills repo either: that repo holds the
review machinery, not the output of running it.
