**Never assert third-party behavior from memory.** ORM tag semantics, which plan
the query planner will pick, which driver parameter actually takes effect, how a
proto field lands on the wire, what a language feature does at an edge — these
are the claims that feel most certain and are wrong most often, because what you
remember is the common case and the finding always lives in the uncommon one.

Three things before such a claim leaves your hands:

1. **Name the layer that actually controls the behavior.** The annotation, the
   driver, the connection string, the server-side default, and the dialect each
   get a vote, and only one of them decides. *"There is a `json:` tag on the
   field"* is not a mechanism; *"the encoder at `marshal.go:212` reads that tag
   and drops the zero value"* is. A type name, an annotation, or a nearby symbol
   is a place to look, not a cause.
2. **Read that layer's official documentation** — WebFetch or WebSearch the
   vendor's own page, not a blog post recounting it — and cite the URL plus the
   section. If you could not reach it, say the claim is inferred, and from what.
3. **Run it when running it is cheap.** A five-line scratch program, one targeted
   test, an `EXPLAIN ANALYZE`, a throwaway container: each turns a remembered
   claim into a quoted output. Cite the output, not your memory of it.

This applies symmetrically. The same discipline that stops you shipping a wrong
finding is what lets you *confirm* the author's claim — *"the driver does coerce
this, see the vendor doc §4.2"* is worth as much as a defect, and it is the half
reviewers skip because being right feels like finding nothing.
