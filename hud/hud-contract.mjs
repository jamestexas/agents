// hud-contract.mjs — what an entry in the content tree IS, declared once.
//
// This file is the authoring contract. Six kinds, where each one lives, which
// frontmatter keys are legal on it, what the reader assumes when a key is
// absent, and how a path decomposes back into meaning. Everything else about
// writing the tree — the CLI, the prose in docs/ and skills/, the HUD.md that
// `init` scaffolds into every tree — is derived from here rather than restated.
//
// It exists because the contract used to live in six places at once:
// skills/hud/SKILL.md, server.mjs, the HUD.md template inside `hud`,
// docs/SOURCES.md, hud-schema.json, and $HUD_ROOT/HUD.md in every tree anyone
// had scaffolded. That is not a DRY complaint. Those copies had already
// drifted — SOURCES.md documents a `status` value as an entry fact on kinds
// whose template never writes one — and the copy that ships to users is the
// one nobody can go back and fix.
//
// ---------------------------------------------------------------------------
// This is a DECLARATION, not CONFIGURATION, and the difference is load-bearing.
//
// It is versioned with the code and no user edits it. It is deliberately NOT
// readable from $HUD_ROOT/hud.toml, for two reasons:
//
//   1. The reader has to agree with it. A tree that could declare its own kind
//      would produce entries the HUD's own reader has no `inferType` arm for,
//      no section sentence for, and no UI for — a knob whose only output is
//      entries that cannot be read back.
//   2. It keeps a trust boundary the right way round. $HUD_ROOT is private
//      data; this is machinery. Data must not tell the machinery where to
//      write.
//
// The asymmetry that survives: SECTIONS are an OPEN set — any top-level
// directory becomes one, zero config — while KINDS are a CLOSED set. The
// escape hatches that make sections open (`inferType`'s fallback to note,
// `aboutSection`'s fallback sentence) stay in server.mjs as code, precisely so
// they do not look like entries in a table someone could close.
//
// ---------------------------------------------------------------------------
// Paths are declared as an invertible SEGMENT GRAMMAR, not as a template
// string, and this is the call the whole design rests on.
//
// `projects/{project}/notes/{date}-{slug}.md` is write-only: you cannot run it
// backwards. But running it backwards is exactly what the read path does —
// `inferType` derives an entry's type purely from its position, the top-level
// directory IS the section, a subdirectory of projects/ IS the group, and a
// filename prefix IS the date. Write composes a path from intent; read
// decomposes meaning out of a path. Those are one rule, and if they can
// disagree then an entry can be written as one type and read back as another
// with nothing detecting it.
//
// So `composePath` and `decomposePath` below are generated from one `segments`
// array per kind. `decomposePath` is written and tested here but called by
// nothing yet; wiring it into server.mjs is a separate bead, and it lands with
// evidence rather than as a new idea.
//
// No imports, by design: nothing in here may depend on anything, so both the
// write path and the read path can consume it without a cycle.

// ---------------------------------------------------------------- fields

/**
 * The frontmatter vocabulary. Every key any kind may carry, declared once.
 *
 * `readDefault` and `emit` are SEPARATE CONCERNS and collapsing them into one
 * `default` field is how the drift in docs/SOURCES.md happened. `status` has a
 * readDefault of "active" — the reader substitutes it when the key is absent
 * (server.mjs buildEntry) — but almost nothing EMITS it, so documenting it as
 * a fact about the file is false. One says what the reader assumes; the other
 * says what lands on disk. A kind's `emit` list, below, is the second half.
 *
 * `type` is one of: scalar | list | date.
 */
export const FIELDS = Object.freeze({
  title: Object.freeze({
    type: "scalar",
    readDefault: null,
    about: "The entry's name. The reader falls back to the first heading, then the filename.",
  }),
  date: Object.freeze({
    type: "date",
    readDefault: null,
    about: "The day the entry is about. The reader falls back to the filename prefix, then mtime.",
  }),
  type: Object.freeze({
    type: "scalar",
    readDefault: null,
    about: "What kind of entry this is. The reader infers it from the path when absent.",
  }),
  status: Object.freeze({
    type: "scalar",
    readDefault: "active",
    about: "Lifecycle. On a project brief it drives group rank and fold state; elsewhere it means what the author meant.",
  }),
  tags: Object.freeze({ type: "list", readDefault: null, about: "Free-form labels." }),
  repos: Object.freeze({
    type: "list",
    readDefault: null,
    about: "owner/name — lights up the PR panels for this entry.",
  }),
  tickets: Object.freeze({
    type: "list",
    readDefault: null,
    about: "Ticket ids, rendered as links through hud.toml's ticket_url_template.",
  }),
  gh: Object.freeze({
    type: "scalar",
    readDefault: null,
    about: "A GitHub handle. Drives the peers panel's PR lookup.",
  }),
  applies_to: Object.freeze({
    type: "list",
    readDefault: null,
    about: "What a playbook is for — repos, or situations.",
  }),
  last_verified: Object.freeze({
    type: "date",
    readDefault: null,
    about: "When a playbook was last known to still work.",
  }),
  links: Object.freeze({ type: "list", readDefault: null, about: "Related material." }),
});

// -------------------------------------------------------------- sections

/**
 * Left-column order for the sections the HUD knows. Any OTHER top-level
 * directory is a section too, appended alphabetically — that openness lives in
 * server.mjs's walk, not here, so this list cannot be mistaken for the whole
 * set.
 */
export const SECTIONS = Object.freeze([
  "projects",
  "playbooks",
  "peers",
  "inbox",
  "archive",
]);

/** One sentence per section, for a reader who did not design the tree. */
export const SECTION_ABOUT = Object.freeze({
  projects: "Live work — one directory per project, its CONTEXT.md the brief, notes beneath it.",
  playbooks: "Procedures worth not re-deriving: how a thing is done, written down once.",
  peers: "One file per colleague, naming the GitHub handle whose PRs light up the peers panel.",
  inbox: "Unfiled capture — notes taken before there was a project to put them in.",
  archive: "Finished or parked work, kept for reference. Nothing here needs you.",
});

// ------------------------------------------------------------ containers

/**
 * The conventional subdirectories inside a project. Both are special-cased in
 * code today and neither is written down anywhere, which is how they ended up
 * asymmetric in OPPOSITE directions:
 *
 *   notes/  the writer puts notes here; the reader has never heard of it.
 *           `projects/p/notes/x.md` and `projects/p/x.md` are the same entry.
 *   raw/    the reader special-cases it at ANY depth (listed-only, size shown
 *           instead of a date); the writer places it at exactly one depth.
 *
 * Naming them is what lets the section/group/entry vocabulary actually
 * describe the tree rather than describe four of its five ideas.
 */
export const CONTAINER_ROLES = Object.freeze({
  unknown: "The reader has never heard of this name. It organises the tree for a human and means nothing to the HUD — an entry beside it reads identically.",
  display: "The reader recognises this name and renders its entries differently.",
  inert: "The reader knows this name and deliberately assigns it no meaning.",
});

export const CONTAINERS = Object.freeze({
  notes: Object.freeze({
    within: "projects",
    // NOT `inert`. Inert would mean the reader considered this name and chose
    // to ignore it; `unknown` means the reader has genuinely never heard of
    // it — `notes` appears nowhere in server.mjs. Collapsing the two would
    // declare an accident as a decision, which is the opposite of the job.
    role: "unknown",
    matches: "exact-depth",
    about: "Where dated project entries go. Writer-side only: `projects/p/notes/x.md` and `projects/p/x.md` are the same entry to the reader.",
  }),
  raw: Object.freeze({
    within: "projects",
    role: "display",
    matches: "any-depth",
    display: "listed",
    about: "Immutable drops — transcripts, exports, patches. Listed and never opened; the meta slot shows a size instead of a date.",
  }),
});

// ----------------------------------------------------------------- depth

/**
 * How deep a kind sits is NOT declared as a number: the segment grammar below
 * states it exactly, and a second statement of the same fact is what produced
 * the disagreement that exists today. server.mjs assigns a group at
 * `parts.length >= 3` (minimum depth) but infers a project brief only at
 * `parts.length === 3` (exact depth), so a brief one level deeper silently
 * stops being a brief while its neighbours are still absorbed into the group.
 *
 * What DOES need declaring is the behaviour choice: what happens to a path
 * deeper than its kind's grammar expects.
 *
 *   absorb  the extra directories vanish into the group (what happens today)
 *   honour  the nesting is preserved and rendered
 *   report  the entry is flagged as not matching any declared shape
 *
 * `absorb` is recorded here because it is true, not because it is right — it
 * gives the user a tree that looks like they did nothing. Naming it makes
 * changing it a one-token edit instead of more surgery on the server.
 *
 * `decomposePath` below is STRICT and returns null for an overflowing path.
 * That is deliberate: the reader's current leniency is documented, not
 * reimplemented, so the two do not quietly become a third policy.
 */
export const DEPTH = Object.freeze({
  overflow: "absorb",
  overflowIsCorrect: false,
  readerGroupsAtMinimumDepth: true,
  readerInfersBriefAtExactDepth: true,
});

// ------------------------------------------------------------------ slug

/**
 * The slug ALPHABET is declared; the algorithm that produces it is not.
 *
 * A configurable stopword list is the knob nobody turns that relocates the bug
 * into data. But the output alphabet has to be here: it is both the
 * containment argument — a component that has been through the normalizer
 * cannot name `..` or an absolute path — and what `decomposePath` needs in
 * order to recognise a component as one.
 *
 * Articles are dropped because SKILL.md's own worked example drops one:
 * "debugging the flaky retry test" is documented as
 * `debugging-flaky-retry-test`.
 */
export const SLUG = Object.freeze({
  alphabet: "a-z0-9-",
  pattern: "^[a-z0-9]+(-[a-z0-9]+)*$",
  stopwords: Object.freeze(["a", "an", "the"]),
  maxLength: 60,
});

const SEGMENT_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

// --------------------------------------------------------- serialization

/**
 * How frontmatter is written, and — more importantly — what the reader has to
 * tolerate.
 *
 * The reader-side rule is the load-bearing one. A bare `YYYY-MM-DD` is only a
 * stable round-trip when an external editor has the property registered as a
 * Date type, and that registration lives in a per-machine file that is not
 * committed — so a fresh clone takes the untyped path and widens the value to
 * a full timestamp. A writer-side convention that depends on a per-machine
 * setting is not a guarantee; a reader that accepts both depends on nothing.
 *
 * Canonical emission is a real second measure, not the first one: emit YAML
 * that is already a fixed point, so a rewrite produces an empty diff. Hence
 * block sequences rather than flow arrays, two-space indent, unquoted scalars
 * where safe, and no comments inside the block.
 *
 * Empty collections are OMITTED rather than emitted, and this needs no editor
 * knowledge to justify: SKILL.md §3 says to include tags/repos/tickets "only
 * when you actually know them" and the template three lines below it shipped
 * `tags: []`. The templates contradicted their own prose. Omission is also the
 * only form with no second representation to drift into — YAML has no block
 * spelling of an empty sequence, so any block-sequence serializer must fall
 * back to flow style for empties.
 *
 * And because the whole block gets rewritten and key order is not preserved,
 * THE READER MUST NOT DEPEND ON KEY ORDER OR FORMATTING — only on keys and
 * values. That is easy to acquire accidentally and expensive to discover.
 */
export const SERIALIZATION = Object.freeze({
  indent: 2,
  sequences: "block",
  quoteScalars: "only-when-unsafe",
  commentsInFrontmatter: false,
  omitEmptyCollections: true,
  dateAccepts: Object.freeze(["YYYY-MM-DD", "ISO-8601 timestamp"]),
  dateNormalizesTo: "YYYY-MM-DD",
  keyOrderSignificant: false,
});

/**
 * Accept both date shapes and return the day. The reader's half of the rule
 * above, and the fix for a bug that needs no editor to reproduce: entries are
 * compared date-first as strings, so `2026-04-07T00:00:00` sorts ahead of
 * `2026-04-07` and any tree holding one mixed value already orders wrong.
 * Normalizing at the point the value is read is what closes that; doing it in
 * the comparator would only move it.
 *
 * Anything that is not a date shape comes back unchanged — a lenient parser
 * must not eat a value it did not understand.
 */
export function normalizeDate(value) {
  if (typeof value !== "string") return value;
  const s = value.trim();
  if (DAY_RE.test(s)) return s;
  const iso = /^(\d{4}-\d{2}-\d{2})[T ][\d:.]+(Z|[+-]\d{2}:?\d{2})?$/.exec(s);
  return iso ? iso[1] : value;
}

// ----------------------------------------------------------- bookkeeping

/**
 * The two appends every write owes the tree, and the reason they behave
 * differently: index.md is a CATALOG, one line per path, so a path already
 * listed is left alone; log.md is APPEND-ONLY HISTORY, so it records the write
 * regardless. Skipping them is how the HUD rots back into the scattered-files
 * problem it replaced.
 */
export const BOOKKEEPING = Object.freeze({
  index: Object.freeze({
    file: "index.md",
    semantics: "catalog",
    line: "- [{title}]({path}) — {summary}",
    about: "A link plus a one-line summary. One line per path; a path already listed is kept, not listed twice.",
  }),
  log: Object.freeze({
    file: "log.md",
    semantics: "append-only",
    line: "- {date}: added {kind} {path}",
    about: "Append-only history of what happened. A second ingest of the same path is a second line, by design.",
  }),
});

// ----------------------------------------------------------------- kinds

const lit = (value) => Object.freeze({ lit: value });
const dir = (name) => Object.freeze({ var: name });
const file = (spec) => Object.freeze({ file: Object.freeze(spec) });

/**
 * One or more directory components, captured as an array. NO KIND USES THIS
 * YET, and that is deliberate — it is the slot rather than the behaviour.
 *
 * The grammar has to be able to say "arbitrarily deep" before nesting can be
 * honoured, or flipping DEPTH.overflow would be a rewrite instead of a
 * declaration edit. A grammar that describes three levels but not four has
 * exactly the latent bug that `parts.length === 3` has: it is correct until
 * someone makes a directory.
 *
 * Exported so `agents-c4ba4e` can add it to a kind's segments and get compose,
 * decompose and the round-trip property for free. At most one per grammar, and
 * never in the leaf position.
 */
export const rest = (name) => Object.freeze({ rest: name });

/**
 * The six shapes. `segments` is the grammar both directions read:
 *
 *   {lit: "projects"}                  a fixed directory name
 *   {var: "project"}                   one directory component, slug alphabet
 *   {file: {...}}                      the leaf, always last
 *     .lit      the whole filename, fixed
 *     .prefix   "date" — a YYYY-MM-DD- prefix on the stem
 *     .stem     which variable supplies the stem
 *     .ext      "md", or "var:ext" for a caller-chosen extension
 *
 * `emit` is what the writer puts in the frontmatter, in order. A `value` is
 * fixed; a `from` names a variable. `settable` is what --set may add on top;
 * `derived` is what --set is refused for, because the verb owns it.
 *
 * `onUnresolvedProject` is the one place a kind may change its own
 * destination: a note with no resolvable project goes to inbox/ rather than
 * being guessed at, because a note in the wrong project is worse than an
 * unsorted one. A brief or a raw drop refuses instead — neither has an unfiled
 * form, since a CONTEXT.md belongs to a project by definition.
 */
export const KINDS = Object.freeze({
  note: Object.freeze({
    intent: "capture a note",
    segments: Object.freeze([
      lit("projects"),
      dir("project"),
      lit("notes"),
      file({ prefix: "date", stem: "slug", ext: "md" }),
    ]),
    onUnresolvedProject: "inbox",
    emit: Object.freeze([
      Object.freeze({ key: "title", from: "title" }),
      Object.freeze({ key: "date", from: "date" }),
      Object.freeze({ key: "type", value: "note" }),
    ]),
    settable: Object.freeze(["status", "tags", "repos", "tickets"]),
    derived: Object.freeze(["title", "date", "type"]),
    body: "heading",
    about: "A dated entry under a project. The log of the work.",
  }),

  inbox: Object.freeze({
    intent: "capture an unfiled note",
    segments: Object.freeze([
      lit("inbox"),
      file({ prefix: "date", stem: "slug", ext: "md" }),
    ]),
    onUnresolvedProject: null,
    emit: Object.freeze([
      Object.freeze({ key: "title", from: "title" }),
      Object.freeze({ key: "date", from: "date" }),
      Object.freeze({ key: "type", value: "note" }),
    ]),
    settable: Object.freeze(["status", "tags", "repos", "tickets"]),
    derived: Object.freeze(["title", "date", "type"]),
    body: "heading",
    about: "A note taken before there was a project to put it in.",
  }),

  playbook: Object.freeze({
    intent: "capture a playbook",
    segments: Object.freeze([lit("playbooks"), file({ stem: "slug", ext: "md" })]),
    onUnresolvedProject: null,
    emit: Object.freeze([
      Object.freeze({ key: "title", from: "title" }),
      Object.freeze({ key: "type", value: "playbook" }),
      Object.freeze({ key: "last_verified", from: "date" }),
    ]),
    settable: Object.freeze(["status", "tags", "repos", "tickets", "applies_to", "last_verified"]),
    derived: Object.freeze(["title", "type"]),
    body: "heading",
    about: "A reusable process, written down once instead of re-derived.",
  }),

  context: Object.freeze({
    intent: "create a project brief",
    segments: Object.freeze([lit("projects"), dir("project"), file({ lit: "CONTEXT.md" })]),
    onUnresolvedProject: "refuse",
    emit: Object.freeze([
      Object.freeze({ key: "title", from: "title", onlyIfGiven: true }),
      Object.freeze({ key: "status", value: "active" }),
    ]),
    settable: Object.freeze(["status", "repos", "tickets", "links"]),
    derived: Object.freeze(["title", "type"]),
    body: "context",
    about: "The single current brief for a project: goal, state, key paths, decisions.",
  }),

  peer: Object.freeze({
    intent: "add a peer",
    segments: Object.freeze([lit("peers"), file({ stem: "handle", ext: "md" })]),
    onUnresolvedProject: null,
    emit: Object.freeze([Object.freeze({ key: "gh", from: "handle" })]),
    settable: Object.freeze(["gh", "repos"]),
    derived: Object.freeze(["type"]),
    body: "heading",
    about: "One file per colleague, naming the handle whose PRs light up the panel.",
  }),

  raw: Object.freeze({
    intent: "drop raw material in",
    segments: Object.freeze([
      lit("projects"),
      dir("project"),
      lit("raw"),
      file({ prefix: "date", stem: "slug", ext: "var:ext" }),
    ]),
    onUnresolvedProject: "refuse",
    emit: Object.freeze([]),
    settable: Object.freeze([]),
    derived: Object.freeze([]),
    body: null,
    about: "An immutable drop — a transcript, an export, a patch. Read, never modified.",
  }),
});

/** The kinds, in the order the docs present them. */
export const KIND_NAMES = Object.freeze(Object.keys(KINDS));

// ------------------------------------------------------------ path rules

/** Does this kind's filename carry a YYYY-MM-DD prefix? Read off the grammar. */
export function hasDatePrefix(kind) {
  const leaf = leafOf(kind);
  return Boolean(leaf && leaf.prefix === "date");
}

/** Which variables a kind's path needs. Read off the grammar, never restated. */
export function pathVars(kind) {
  const out = [];
  for (const seg of KINDS[kind].segments) {
    if (seg.var) out.push(seg.var);
    else if (seg.rest) out.push(seg.rest);
    else if (seg.file) {
      if (seg.file.prefix === "date") out.push("date");
      if (seg.file.stem) out.push(seg.file.stem);
      if (seg.file.ext === "var:ext") out.push("ext");
    }
  }
  return out;
}

/** The destination, as documentation renders it: `projects/<project>/...`. */
export function pathPattern(kind) {
  return KINDS[kind].segments
    .map((seg) => {
      if (seg.lit) return seg.lit;
      if (seg.var) return `<${seg.var}>`;
      if (seg.rest) return `<${seg.rest}>/…`;
      const f = seg.file;
      if (f.lit) return f.lit;
      const stem = `${f.prefix === "date" ? "<date>-" : ""}<${f.stem}>`;
      return `${stem}.${f.ext === "var:ext" ? "<ext>" : f.ext}`;
    })
    .join("/");
}

function leafOf(kind) {
  const segs = KINDS[kind].segments;
  return segs[segs.length - 1].file || null;
}

/**
 * Intent to a relative path. Throws on a variable that is missing or that does
 * not match the declared alphabet: composing a path out of an unnormalized
 * component is how a write escapes the tree, so it is a programmer error
 * rather than something to be lenient about.
 */
export function composePath(kind, vars = {}) {
  const spec = KINDS[kind];
  if (!spec) throw new Error(`unknown kind ${kind}`);
  return composeSegments(spec.segments, vars, kind);
}

/**
 * The primitive `composePath` is built on, exported so a grammar can be
 * exercised without registering a kind for it — which is how the variadic
 * segment is proven while no kind uses one.
 */
export function composeSegments(segments, vars = {}, kind = "?") {
  const need = (name, re, what) => {
    const v = vars[name];
    if (typeof v !== "string" || v === "") throw new Error(`composePath(${kind}): missing ${name}`);
    if (!re.test(v)) throw new Error(`composePath(${kind}): ${name} is not ${what}: ${v}`);
    return v;
  };

  const out = [];
  for (const seg of segments) {
    if (seg.lit) {
      out.push(seg.lit);
      continue;
    }
    if (seg.var) {
      out.push(need(seg.var, SEGMENT_RE, `a ${SLUG.alphabet} component`));
      continue;
    }
    if (seg.rest) {
      const parts = vars[seg.rest];
      if (!Array.isArray(parts) || parts.length === 0) {
        throw new Error(`composePath(${kind}): ${seg.rest} wants a non-empty array of components`);
      }
      for (const part of parts) {
        if (!SEGMENT_RE.test(part)) {
          throw new Error(`composePath(${kind}): ${seg.rest} holds ${part}, which is not a ${SLUG.alphabet} component`);
        }
      }
      out.push(...parts);
      continue;
    }
    const f = seg.file;
    if (f.lit) {
      out.push(f.lit);
      continue;
    }
    const stem = need(f.stem, SEGMENT_RE, `a ${SLUG.alphabet} component`);
    const prefix = f.prefix === "date" ? `${need("date", DAY_RE, "a YYYY-MM-DD day")}-` : "";
    const ext = f.ext === "var:ext" ? need("ext", /^[a-z0-9]{1,8}$/, "a short extension") : f.ext;
    out.push(`${prefix}${stem}.${ext}`);
  }
  return out.join("/");
}

/**
 * A relative path back to the intent that would produce it — the inverse of
 * `composePath`, from the same grammar, so the two cannot disagree.
 *
 * STRICT: a path that is deeper, shallower, or differently shaped than every
 * declared kind returns null. That is not the same as what the reader does
 * today (see DEPTH.overflow), and the difference is recorded rather than
 * papered over: this function is the shape the read path is moving toward, and
 * a lenient version here would just be a third policy.
 *
 * Kinds are tried most-specific first, so `projects/p/CONTEXT.md` is a brief
 * rather than a note that happens to be shaped like one.
 */
export function decomposePath(rel) {
  if (typeof rel !== "string" || rel === "" || rel.startsWith("/")) return null;
  const parts = rel.split("/");
  for (const kind of KIND_NAMES) {
    const vars = matchSegments(KINDS[kind].segments, parts);
    if (vars) return { kind, vars };
  }
  return null;
}

/** The inverse primitive. Returns the captured variables, or null. */
export function matchSegments(segments, parts) {
  // A `rest` segment makes the grammar variadic, so length is a range rather
  // than an equality. With no `rest` — which is every kind today — this is the
  // exact-length check it was before, and the strictness DEPTH documents.
  const restAt = segments.findIndex((s) => s.rest);
  let expanded = segments;
  if (restAt >= 0) {
    const extra = parts.length - segments.length;
    if (extra < 0) return null;
    expanded = [
      ...segments.slice(0, restAt),
      ...Array.from({ length: extra + 1 }, () => segments[restAt]),
      ...segments.slice(restAt + 1),
    ];
  }
  if (parts.length !== expanded.length) return null;

  const vars = {};
  for (let i = 0; i < expanded.length; i++) {
    const seg = expanded[i];
    const part = parts[i];
    if (seg.rest) {
      if (!SEGMENT_RE.test(part)) return null;
      (vars[seg.rest] ||= []).push(part);
      continue;
    }
    if (seg.lit) {
      if (part !== seg.lit) return null;
      continue;
    }
    if (seg.var) {
      if (!SEGMENT_RE.test(part)) return null;
      vars[seg.var] = part;
      continue;
    }
    const f = seg.file;
    if (f.lit) {
      if (part !== f.lit) return null;
      continue;
    }
    const dot = part.lastIndexOf(".");
    if (dot <= 0) return null;
    let stem = part.slice(0, dot);
    const ext = part.slice(dot + 1);
    if (f.ext === "var:ext") {
      if (!/^[a-z0-9]{1,8}$/.test(ext)) return null;
      vars.ext = ext;
    } else if (ext !== f.ext) {
      return null;
    }
    if (f.prefix === "date") {
      const m = /^(\d{4}-\d{2}-\d{2})-(.+)$/.exec(stem);
      if (!m) return null;
      vars.date = m[1];
      stem = m[2];
    }
    if (!SEGMENT_RE.test(stem)) return null;
    vars[f.stem] = stem;
  }
  return vars;
}

// ---------------------------------------------------------- key legality

/** Keys `--set` may carry for this kind. */
export function settableKeys(kind) {
  return KINDS[kind].settable;
}

/** Keys the verb owns, so `--set` on them is refused rather than honoured. */
export function derivedKeys(kind) {
  return KINDS[kind].derived;
}

/**
 * Whether a key may be set on a kind, and if not, why — a closed set of
 * reasons, so a caller can branch on the answer rather than parse a sentence.
 *
 *   ok       set it
 *   derived  the verb owns this key; --title/--date/the kind decide it
 *   none     this kind carries no frontmatter at all
 *   illegal  not a key this kind has
 *   unknown  not a key in the vocabulary at all
 */
export function keyLegality(kind, key) {
  const spec = KINDS[kind];
  if (!spec) return { ok: false, reason: "unknown-kind" };
  if (spec.emit.length === 0 && spec.settable.length === 0) return { ok: false, reason: "none" };
  if (spec.derived.includes(key)) return { ok: false, reason: "derived" };
  if (spec.settable.includes(key)) return { ok: true, reason: "ok" };
  if (!Object.prototype.hasOwnProperty.call(FIELDS, key)) {
    return { ok: false, reason: "unknown" };
  }
  return { ok: false, reason: "illegal" };
}

// -------------------------------------------------------- yaml emission

/**
 * Canonical frontmatter from ordered [key, value] pairs. Lists become block
 * sequences, empties are dropped entirely, and scalars are quoted only when
 * leaving them bare would change what the parser reads back.
 *
 * Returns "" when nothing survives — a kind with no frontmatter gets no
 * delimiters rather than an empty block.
 */
export function renderFrontmatter(pairs) {
  const lines = [];
  for (const [key, value] of pairs) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      if (value.length === 0) continue; // SERIALIZATION.omitEmptyCollections
      lines.push(`${key}:`);
      for (const item of value) lines.push(`${" ".repeat(SERIALIZATION.indent)}- ${scalar(item)}`);
      continue;
    }
    const s = String(value);
    if (s === "") continue;
    lines.push(`${key}: ${scalar(s)}`);
  }
  if (lines.length === 0) return "";
  return `---\n${lines.join("\n")}\n---\n`;
}

/**
 * Quote only where bare would be misread. The HUD's parser treats a leading
 * `[` as a flow array and a bare `#` after whitespace as a comment, and a
 * value that is empty or has edge whitespace loses its shape either way.
 * Everything else stays unquoted, which is both what a human wants to read and
 * what an external serializer will leave alone.
 */
function scalar(value) {
  const s = String(value);
  const unsafe =
    s === "" ||
    s !== s.trim() ||
    /^[[\]{}>|*&!%@`'"]/.test(s) ||
    /\s#/.test(s) ||
    s.includes(": ") ||
    s.endsWith(":");
  if (!unsafe) return s;
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}
