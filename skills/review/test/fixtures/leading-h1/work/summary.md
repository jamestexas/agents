# PR 1 — swap parse/verify

**TL;DR** — Moves parsing ahead of signature verification. Blocks: one webhook path reads attacker bytes before verifying. Fix: swap the two calls.

**Verdict** — REQUEST_CHANGES. Turned on ledger row 1.

**What to do next**
1. Move `verify()` above `parse()` in `handler.go`.
2. Add the ordering test the diff removed.
