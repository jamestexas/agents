#!/usr/bin/env node
/**
 * hud-docgen.mjs — render the prose that describes the content tree, from the
 * declaration that defines it.
 *
 * The contract used to live in six places at once and they had already
 * drifted: docs/SOURCES.md documents a `status` value as a fact about entries
 * whose write template never emits one, and the HUD.md scaffolded into every
 * tree is a copy nobody can go back and fix. Restating a contract is not a
 * style problem — it is a guarantee that one of the copies is wrong and that
 * nothing will say which.
 *
 * So the tables are generated into MARKED REGIONS and a check mode fails when
 * a committed file no longer matches:
 *
 *   node hud/hud-docgen.mjs --check     # exit 1 with a diff if anything drifted
 *   node hud/hud-docgen.mjs --write     # regenerate in place
 *
 * `check()` is also called in-process by test/docgen.test.mjs, so drift is
 * caught by `node --test hud/test/` rather than by a reader noticing.
 *
 * WHAT THIS DOES NOT DO, stated because the check would otherwise imply it:
 * region generation makes the TABLES undriftable. It does not make the prose
 * around them true. The SOURCES.md `status` drift was in a paragraph, not a
 * table. The mitigation is to pull load-bearing sentences inside the markers —
 * several are, below — and to accept that the residue is still a human
 * problem.
 *
 * Lives in hud/ and imports nothing outside it: hud/ is AGPL-3.0-only and
 * self-contained, and a build step reaching in from the Apache-2.0 part of
 * this repository would dissolve the boundary that makes that checkable.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  BOOKKEEPING,
  CONTAINERS,
  DEPTH,
  FIELDS,
  KINDS,
  KIND_NAMES,
  SECTIONS,
  SECTION_ABOUT,
  SERIALIZATION,
  SLUG,
  hasDatePrefix,
  pathPattern,
} from "./hud-contract.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** One line, so a table cell never breaks the table. */
const cell = (s) => String(s).replace(/\|/g, "\\|").replace(/\s*\n\s*/g, " ");
const code = (s) => `\`${s}\``;

// ------------------------------------------------------------- renderers

/**
 * Every generated region, by name. A region is a pure function of the
 * declaration — no file reads, no environment — so `render` and `check`
 * cannot disagree about what a file should contain.
 */
export const REGIONS = {
  /** The six kinds and where each one lands. */
  "kinds-table": () =>
    table(
      ["kind", "destination", "date prefix"],
      KIND_NAMES.map((k) => [code(k), code(pathPattern(k)), hasDatePrefix(k) ? "yes" : "no"]),
    ),

  /** The same six, as intents — what SKILL.md's reader is actually asking. */
  "intent-table": () =>
    table(
      ["Intent", "Kind", "Target"],
      KIND_NAMES.map((k) => [
        cell(KINDS[k].intent),
        code(k),
        code(`$HUD_ROOT/${pathPattern(k)}`),
      ]),
    ),

  /** What each kind writes, what it will accept, and what it refuses. */
  "frontmatter-table": () =>
    table(
      ["kind", "written for you", "`--set` may add", "refused"],
      KIND_NAMES.map((k) => {
        const spec = KINDS[k];
        // `onlyIfGiven` is the difference between a key the writer always puts
        // in the file and one it puts in only when you supplied it — exactly
        // the distinction whose absence let `status` be documented as a fact
        // about entries that never carry it.
        const emitted = spec.emit.map((r) => (r.onlyIfGiven ? `${code(r.key)} (if given)` : code(r.key)));
        const settable = spec.settable.map((r) => code(r));
        const derived = spec.derived.map((r) => code(r));
        return [
          code(k),
          emitted.length ? emitted.join(", ") : "—",
          settable.length ? settable.join(", ") : "— (nothing)",
          derived.length ? `${derived.join(", ")} (derived)` : "everything",
        ];
      }),
    ),

  /** The frontmatter vocabulary, and the distinction that caused the drift. */
  "fields-table": () =>
    table(
      ["key", "type", "reader assumes when absent", "what it is"],
      Object.entries(FIELDS).map(([k, f]) => [
        code(k),
        f.type,
        f.readDefault === null ? "—" : code(f.readDefault),
        cell(f.about),
      ]),
    ),

  /** The closed outcome vocabulary. */
  "outcomes-table": () =>
    table(
      ["", "Means"],
      [
        ["`created`", "the file was written and both bookkeeping lines appended"],
        ["`planned`", "`--dry-run`: the whole plan, and none of it done"],
        ["`refused`", "it could have written and should not. **The only non-zero exit.**"],
      ],
    ),

  /** The two appends, and why they are not the same rule. */
  "bookkeeping-table": () =>
    [
      table(
        ["file", "semantics", "line"],
        [BOOKKEEPING.index, BOOKKEEPING.log].map((b) => [
          code(b.file),
          b.semantics,
          code(b.line),
        ]),
      ),
      "",
      `${cell(BOOKKEEPING.index.about)} ${cell(BOOKKEEPING.log.about)}`,
    ].join("\n"),

  /** Sections: the ordered ones, and the sentence that keeps the set open. */
  "sections-table": () =>
    [
      table(
        ["section", "what it is"],
        SECTIONS.map((s) => [code(s), cell(SECTION_ABOUT[s])]),
      ),
      "",
      // Self-contained on purpose: a region is rendered into several files and
      // cannot refer to "the table above", which is a different table in each.
      "Sections are an **open set**: the five above fix the left-column order, and any",
      "other top-level directory becomes a section too, appended alphabetically with a",
      `fallback sentence. Kinds are the opposite — closed, and there are exactly ${KIND_NAMES.length}.`,
    ].join("\n"),

  /** The two conventional containers, and their opposite asymmetries. */
  "containers-table": () =>
    [
      table(
        ["directory", "within", "known to the reader?", "matched at", "what it means"],
        Object.entries(CONTAINERS).map(([name, c]) => [
          code(`${name}/`),
          code(c.within),
          // Spelt out rather than printed as a bare role word, because the
          // distinction the role encodes is the whole point: one of these has
          // no reader meaning by accident, the other by design.
          { unknown: "**no — never heard of it**", display: "yes, and renders differently", inert: "yes, ignored on purpose" }[c.role],
          c.matches === "any-depth" ? "any depth" : "exactly its declared depth",
          cell(c.about),
        ]),
      ),
      "",
      "Those two columns are not the same claim. `notes/` means nothing to the",
      "reader because the reader has **never heard of it** — the name appears",
      "nowhere in `server.mjs`, so an entry inside it and one beside it are",
      "indistinguishable. `raw/` is the opposite: the reader knows it, matches it",
      "at any depth, and changes how its entries display. One is an accident and",
      "one is a decision, and a table that called both \"inert\" would hide that.",
      "",
      `A path deeper than its kind's declared shape is currently **${DEPTH.overflow}**${
        DEPTH.overflowIsCorrect ? "" : "ed — and that is the known-wrong answer"
      }: the`,
      "intermediate directories vanish into the group, so the tree looks like you did",
      "nothing. It is named here rather than left implicit so that changing it is a",
      "declaration edit.",
    ].join("\n"),

  /** How frontmatter is written, and what the reader has to tolerate. */
  "serialization-rules": () =>
    [
      `- **Dates are normalized on READ**, not on write: ${SERIALIZATION.dateAccepts
        .map(code)
        .join(" and ")} are both accepted and both become ${code(
        SERIALIZATION.dateNormalizesTo,
      )}. A writer-side convention would depend on a per-machine setting that is not committed; a reader that accepts both depends on nothing.`,
      `- **Empty collections are omitted**, never emitted as ${code("[]")}. YAML has no block spelling of an empty sequence, so ${code(
        "[]",
      )} is the one form with a second representation to drift into — and a key whose value you do not know is a key you were told not to write.`,
      `- Lists are **block sequences**, indent is **${SERIALIZATION.indent} spaces**, scalars are quoted only where bare would be misread, and there are **no comments** inside the block.`,
      `- **Key order is not significant** and neither is formatting. Read keys and values; anything that depends on their arrangement is depending on something no serializer preserves.`,
    ].join("\n"),

  /** How a slug is derived — the one algorithm the docs must state exactly. */
  "slug-rule": () =>
    `A slug is the title, lowercased, reduced to ${code(SLUG.alphabet)}, with ${SLUG.stopwords
      .map(code)
      .join(", ")} dropped and the result bounded at ${SLUG.maxLength} characters on a word boundary. The dropped article is not a liberty — it is what SKILL.md's own worked example does.`,
};

function table(headers, rows) {
  const out = [`| ${headers.join(" | ")} |`, `| ${headers.map(() => "---").join(" | ")} |`];
  for (const row of rows) out.push(`| ${row.join(" | ")} |`);
  return out.join("\n");
}

/** One region's body. Throws on a name no renderer knows — a typo in a marker. */
export function render(name) {
  const fn = REGIONS[name];
  if (!fn) throw new Error(`hud-docgen: no renderer for region ${name}`);
  return fn();
}

// ------------------------------------------------------ the whole HUD.md

/**
 * The schema file `hud init` scaffolds into every content tree. Generated in
 * full rather than region-marked, because it is not a document anyone hand-
 * maintains — and because it is the copy that SHIPS. Drift in a repo file is
 * a pull request; drift here is already on someone's disk.
 */
export function renderHudMd() {
  return `# HUD.md — schema and conventions for this tree

This file is the whole contract. Any agent told "load \`$HUD_ROOT/HUD.md\`" can
read and write this tree correctly with no other context.

Generated from \`_hud/hud-contract.mjs\`. Do not hand-edit it — it will be
rewritten, and the declaration is where an edit actually belongs.

## The six kinds

${render("kinds-table")}

${render("slug-rule")}

## Frontmatter

Every field is optional. A bare markdown file with no frontmatter is a valid
entry — filename and directory supply defaults.

${render("fields-table")}

Two of those columns are different questions and it is worth not confusing
them: **"reader assumes when absent"** is what the HUD substitutes when the key
is not in the file, which is not the same as a value the file carries. An entry
with no \`status\` reads as \`active\` and says nothing.

What each kind actually writes:

${render("frontmatter-table")}

${render("serialization-rules")}

## Sections, groups and containers

${render("sections-table")}

**Groups** exist only inside \`projects\`: the subdirectory *is* the group, and
its \`CONTEXT.md\` is the brief.

${render("containers-table")}

## After any write: the catalog

${render("bookkeeping-table")}

## The rule

**Never write a standalone note file outside \`$HUD_ROOT\`.** If you are about
to create a scratch markdown file somewhere else to capture a decision, a
transcript, or a note-to-self — put it here instead, under the closest matching
path above, or \`inbox/\` if unsure. This is the consolidation rule; it is the
entire point of this tree existing.

## Writing one

\`hud new <kind>\` derives all of the above from an intent and makes both
bookkeeping appends. It refuses rather than guesses: a frontmatter key not
legal for the kind, a project it cannot resolve, a destination that already
exists.

${render("outcomes-table")}

## Generated vs. authored

\`$HUD_ROOT/.generated/\` is machine-written only — snapshots, the service log,
the mache index. Never hand-edit it; it is gitignored. \`_hud\` is a symlink to
the machinery repository: public code, versioned elsewhere, and not content
either. Everything else in this tree is authored content and gets committed.

## The HUD app

\`hud start\` serves this tree; \`hud status\` says what it is actually wired to.
The server locates the tree by \`HUD_ROOT\`, never by where its own file sits.

\`hud.toml\`'s \`[sources.*]\` tables are the switchboard: a source present enables
its panel, absent removes it, no code change either way. Every key, what
enables it, and what each panel does when its source is absent:
\`_hud/docs/SOURCES.md\`.

**Watch-only invariant:** the HUD renders and links out, it never acts on a PR,
a ticket, or a session. Every "do" happens in the tool the human is already in.
`;
}

// -------------------------------------------------------- files and check

/** Whole-file targets: generated end to end, not region-marked. */
const WHOLE_FILES = Object.freeze({ "templates/HUD.md": renderHudMd });

const BEGIN = /<!--\s*@generated-begin:\s*([\w-]+)\s*-->/g;

/** Every file that carries at least one marked region. */
const REGION_FILES = Object.freeze([
  "docs/CLI.md",
  "docs/SOURCES.md",
  "skills/hud/SKILL.md",
]);

/**
 * What `file` should contain. Region files keep everything outside their
 * markers verbatim — the generator owns the tables, never the prose around
 * them.
 */
function expected(root, file) {
  if (WHOLE_FILES[file]) return `${WHOLE_FILES[file]().replace(/\n+$/, "")}\n`;
  const current = fs.readFileSync(path.join(root, file), "utf8");
  return substitute(current, file);
}

function substitute(text, file) {
  BEGIN.lastIndex = 0;
  let out = "";
  let at = 0;
  let m;
  while ((m = BEGIN.exec(text)) !== null) {
    const name = m[1];
    const endMarker = `<!-- @generated-end: ${name} -->`;
    const endAt = text.indexOf(endMarker, m.index);
    if (endAt < 0) throw new Error(`${file}: region ${name} has no @generated-end marker`);
    out += text.slice(at, m.index + m[0].length);
    out += `\n${render(name)}\n`;
    at = endAt;
    BEGIN.lastIndex = endAt;
  }
  return out + text.slice(at);
}

/**
 * Every file that is out of date, with a line-level diff. An empty array means
 * the committed prose still matches the declaration — which is a different
 * claim from "nothing was checked", so `check` also reports what it looked at.
 */
export function check(root = HERE) {
  const findings = [];
  for (const file of [...Object.keys(WHOLE_FILES), ...REGION_FILES]) {
    const abs = path.join(root, file);
    let current = "";
    try {
      current = fs.readFileSync(abs, "utf8");
    } catch {
      findings.push({ file, reason: "missing", diff: `${file} does not exist` });
      continue;
    }
    const want = expected(root, file);
    if (current !== want) findings.push({ file, reason: "drifted", diff: diff(current, want) });
  }
  return { checked: [...Object.keys(WHOLE_FILES), ...REGION_FILES], findings };
}

/** Enough of a diff to act on, without a dependency to produce one. */
function diff(have, want) {
  const a = have.split("\n");
  const b = want.split("\n");
  const out = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] === b[i]) continue;
    if (a[i] !== undefined) out.push(`  ${i + 1}- ${a[i]}`);
    if (b[i] !== undefined) out.push(`  ${i + 1}+ ${b[i]}`);
    if (out.length > 40) {
      out.push("  … (truncated)");
      break;
    }
  }
  return out.join("\n");
}

export function write(root = HERE) {
  const written = [];
  for (const file of [...Object.keys(WHOLE_FILES), ...REGION_FILES]) {
    const abs = path.join(root, file);
    const want = expected(root, file);
    let current = null;
    try {
      current = fs.readFileSync(abs, "utf8");
    } catch {
      /* a whole-file target may not exist yet */
    }
    if (current === want) continue;
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, want);
    written.push(file);
  }
  return written;
}

export function main(argv, io = {}) {
  const stdout = io.stdout || ((s) => process.stdout.write(s));
  const stderr = io.stderr || ((s) => process.stderr.write(s));
  const mode = argv[0] || "--check";

  if (mode === "--write") {
    const written = write();
    stdout(written.length ? `regenerated:\n  ${written.join("\n  ")}\n` : "already current\n");
    return 0;
  }
  if (mode !== "--check") {
    stderr(`hud docgen: unknown argument ${mode} — use --check or --write\n`);
    return 1;
  }

  const { checked, findings } = check();
  if (findings.length === 0) {
    // "Nothing to do" has to be distinguishable from "did not look".
    stdout(`docs match the declaration (${checked.length} file(s) checked)\n`);
    return 0;
  }
  stderr(`hud docgen: ${findings.length} file(s) no longer match hud-contract.mjs\n\n`);
  for (const f of findings) stderr(`${f.file} (${f.reason})\n${f.diff}\n\n`);
  stderr("Run `hud docgen --write` to regenerate, then read what changed.\n");
  return 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = main(process.argv.slice(2));
}
