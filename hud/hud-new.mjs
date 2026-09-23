#!/usr/bin/env node
/**
 * hud-new.mjs — write one entry into the content tree.
 *
 * The authoring verb. What it replaces is a convention: skills/hud/SKILL.md
 * spelt out six file shapes, the directory each lives in, a date prefix, a
 * kebab slug, the frontmatter keys legal for each, and two bookkeeping appends
 * owed after every write — all of it prose, none of it checked. A convention
 * that has to be remembered is one that gets forgotten silently, and the
 * failure mode is not an error message: it is a note filed where nobody will
 * look for it again.
 *
 * None of those rules live here. They live in hud-contract.mjs, which the read
 * path and the doc generator consume too. This file is the verb: resolve the
 * intent, build a plan, and — if the plan says so — carry it out.
 *
 * The split is `plan()` then `execute()`, and it is not cosmetic. --dry-run
 * and --json are the same plan rendered differently rather than three code
 * paths that can disagree about what would happen; and a plan can be asserted
 * in-process without a tree, a shell, or a subprocess.
 *
 * It writes the tree DIRECTLY, and deliberately. The server is watch-only by
 * construction — its content routes are GET-only and tested to stay that way —
 * so there is no write endpoint to post to and this adds none. Only HUD_ROOT
 * is written, never a [read.<name>] store: the same one-writable-store split
 * that lets `sync` push without knowing read stores exist.
 *
 *   node hud/hud-new.mjs <kind> [options]     # or: hud new <kind> [options]
 *
 * Respects HUD_ROOT. Never creates the tree — that is `hud init`'s job.
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { defaultRoot } from "./server.mjs";
import {
  BOOKKEEPING,
  KINDS,
  KIND_NAMES,
  SLUG,
  composePath,
  keyLegality,
  FIELDS,
  renderFrontmatter,
} from "./hud-contract.mjs";

/**
 * Outcomes come from a closed set, the same discipline `hud pull` states:
 *
 *   created   the file was written and both bookkeeping lines appended
 *   planned   --dry-run: the whole plan, and none of it done
 *   refused   it could have written and should not. The only non-zero exit.
 *
 * There is no "nothing to do" outcome, and that is a decision rather than a
 * gap: being asked to create a file that already exists is a refusal here, not
 * a no-op, because the body that came with the request would otherwise be
 * silently dropped. That refusal is also what makes the bookkeeping
 * idempotent — a repeat write adds no second catalog line because it adds
 * nothing at all.
 */
export const OUTCOMES = Object.freeze(["created", "planned", "refused"]);

// ------------------------------------------------------------------ slug

/**
 * Lowercase, and only the declared alphabet survives. Every path component
 * goes through here, which is also the containment argument: a component that
 * has been normalized cannot name `..` or an absolute path.
 */
export function kebab(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * A title to a slug: `kebab` plus the two things a filename wants. Articles go
 * because SKILL.md's own worked example drops one, and the result is bounded
 * at a token boundary — a slug truncated mid-word reads as a typo.
 *
 * A title that is nothing but articles still has to produce something, so the
 * stopword pass is skipped rather than allowed to empty the slug: dropping
 * them is a nicety, not a rule worth failing over.
 */
export function slugify(title) {
  const tokens = String(title)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  const take = (list) => {
    const out = [];
    let width = 0;
    for (const tok of list) {
      if (width + tok.length + (out.length ? 1 : 0) > SLUG.maxLength) break;
      width += tok.length + (out.length ? 1 : 0);
      out.push(tok);
    }
    return out.join("-");
  };
  const kept = tokens.filter((t) => !SLUG.stopwords.includes(t));
  return take(kept) || take(tokens);
}

// --------------------------------------------------------------- helpers

class Refusal extends Error {}

/** Refuse: the reason is the whole message, and nothing has been written. */
function refuse(reason) {
  throw new Refusal(reason);
}

/**
 * The project for a note when the caller named none. SKILL.md: the repo you
 * are standing in, matched against projects that already exist.
 *
 * An inferred project must ALREADY be a directory. Inference that creates one
 * is guessing with consequences, and the caller gets inbox/ instead — which is
 * why this reads the tree rather than just the cwd.
 */
function inferProject(root, cwd) {
  let base = cwd;
  for (let dir = cwd, i = 0; i < 64; i++) {
    if (fs.existsSync(path.join(dir, ".git"))) {
      base = dir;
      break;
    }
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  const name = kebab(path.basename(base));
  if (!name) return null;
  return fs.existsSync(path.join(root, "projects", name)) ? name : null;
}

/** Split a `--set` argument, refusing the shapes that cannot mean anything. */
function parseSet(pair) {
  const eq = pair.indexOf("=");
  if (eq < 0) refuse(`--set wants KEY=VALUE, got ${pair}`);
  const key = pair.slice(0, eq);
  const value = pair.slice(eq + 1);
  if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(key)) refuse(`--set: ${key} is not a frontmatter key name`);
  if (value.includes("\n")) refuse(`--set ${key}: a frontmatter value cannot contain a newline`);
  return [key, value];
}

/**
 * Coerce a `--set` value to the shape its field declares. A list key given a
 * bare value becomes a one-element list, because `tags: retry` and
 * `tags: [retry]` render differently and only one of them is what was meant.
 */
function coerce(key, raw) {
  if (FIELDS[key]?.type !== "list") return raw;
  const inner = /^\[.*\]$/.test(raw) ? raw.slice(1, -1) : raw;
  return inner
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** The body when the caller supplied none. */
function bodyTemplate(kind, title) {
  if (KINDS[kind].body === "context") {
    return [
      "## Goal",
      "",
      "<what this project is trying to achieve>",
      "",
      "## State",
      "",
      "<where things stand right now>",
      "",
      "## Key paths",
      "",
      "<files/dirs worth knowing about>",
      "",
      "## Decisions",
      "",
      "<decisions made and why, so they aren't re-litigated>",
    ].join("\n");
  }
  return `# ${title}`;
}

function fill(template, vars) {
  return template.replace(/\{(\w+)\}/g, (_, name) => vars[name] ?? "");
}

// ------------------------------------------------------------------ plan

/**
 * Resolve an intent into everything that would happen, without doing any of
 * it. Reads the tree (to infer a project, to see whether the destination
 * exists, to see whether index.md already lists the path); writes nothing.
 *
 * Returns the `hud-new/v1` document. Refusals come back as one too — the
 * machine-readable form of "no" must not be a second code path that can drift
 * from the human one.
 */
export function plan(opts = {}) {
  const {
    kind,
    title,
    haveTitle = title !== undefined,
    project,
    handle,
    slug: slugArg,
    date: dateArg,
    ext: extArg,
    summary,
    body,
    haveBody = body !== undefined,
    root: rootArg,
    cwd = process.cwd(),
    dryRun = false,
    today,
  } = opts;

  const doc = skeleton(kind);
  doc.dry_run = Boolean(dryRun);
  doc.title = title ?? null;

  try {
    if (!kind) refuse(`which kind? one of: ${KIND_NAMES.join(", ")}`);
    if (!KIND_NAMES.includes(kind)) {
      refuse(`unknown kind ${kind} — one of: ${KIND_NAMES.join(", ")}`);
    }
    const spec = KINDS[kind];

    if (haveTitle && !title) refuse("--title was given an empty value");
    if (haveBody && opts.bodyFile) {
      refuse("--body and --body-file are two answers to the same question — pass one");
    }

    // Flags that mean nothing for this kind are refused, not ignored. A caller
    // whose --project was silently dropped believes the file is filed under
    // it, and nothing in the output would say otherwise.
    const wantsProject = pathNeeds(kind, "project");
    if (project && !wantsProject) refuse(`kind ${kind} takes no --project`);
    if (handle && kind !== "peer") refuse(`kind ${kind} takes no --handle — did you mean --title?`);
    if (extArg && kind !== "raw") {
      refuse(`kind ${kind} takes no --ext — only a raw drop is not markdown`);
    }
    if (slugArg && !pathNeeds(kind, "slug")) {
      refuse(
        kind === "peer"
          ? "kind peer takes no --slug — the file is named for the handle"
          : "kind context takes no --slug — the file is always CONTEXT.md",
      );
    }

    // The tree is never created here. SKILL.md §0: a tree that does not exist
    // is `hud init`'s business, and a write verb that scaffolded one would put
    // notes in a tree nobody configured, at a path that was very likely a typo.
    const root = resolveRoot(rootArg);
    doc.root = root;
    if (!isDir(root)) refuse(`${root} does not exist — run 'hud init' first`);
    for (const f of [BOOKKEEPING.index.file, BOOKKEEPING.log.file]) {
      if (!fs.existsSync(path.join(root, f))) {
        refuse(`${path.join(root, f)} is missing — run 'hud init' first; the bookkeeping files are not optional`);
      }
    }

    const date = dateArg || today || new Date().toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) refuse(`--date wants YYYY-MM-DD, got ${date}`);
    doc.date = date;

    const vars = { date };

    if (pathNeeds(kind, "handle")) {
      if (!handle) refuse("kind peer needs --handle");
      vars.handle = kebab(handle);
      if (!vars.handle) refuse(`--handle ${handle} has no usable characters`);
      doc.slug = vars.handle;
    }
    if (pathNeeds(kind, "slug")) {
      if (slugArg) vars.slug = kebab(slugArg);
      else if (title) vars.slug = slugify(title);
      else refuse(`kind ${kind} needs --title (the slug is derived from it), or --slug`);
      if (!vars.slug) refuse("nothing kebab-cased out of that title — pass --slug");
      doc.slug = vars.slug;
    }
    if (pathNeeds(kind, "ext")) {
      vars.ext = extArg || "md";
      if (!/^[a-z0-9]{1,8}$/.test(vars.ext)) {
        refuse(`--ext wants a short lowercase extension, got ${vars.ext}`);
      }
    }

    let effectiveKind = kind;
    if (wantsProject) {
      // An EXPLICIT project is taken as given, directories and all: the caller
      // named it, so it is not a guess.
      let resolved = project ? kebab(project) : inferProject(root, cwd);
      if (project && !resolved) refuse(`--project ${project} has no usable characters`);
      if (!resolved) {
        // The one place this verb may change the destination out from under
        // the request. A note in the wrong project is worse than an unsorted
        // one, so it routes to inbox/; a brief or a raw drop has no unfiled
        // form, since a CONTEXT.md belongs to a project by definition.
        if (spec.onUnresolvedProject !== "inbox") {
          refuse(
            `no project resolved for kind ${kind} — pass --project (a note would route to inbox/ instead, but a ${kind} has no unfiled form)`,
          );
        }
        effectiveKind = "inbox";
        doc.routed_to_inbox = true;
      } else {
        vars.project = resolved;
        doc.project = resolved;
      }
    }

    // A CONTEXT.md carries no `title:` of its own, but index.md still needs
    // link text for it, and the project name is the only honest default.
    let effectiveTitle = title;
    if (!effectiveTitle && kind === "context") effectiveTitle = doc.project;
    if (!effectiveTitle) effectiveTitle = doc.slug;
    doc.title = effectiveTitle;

    const rel = composePath(effectiveKind, vars);
    doc.path = rel;
    doc.absolute = path.join(root, rel);

    // Frontmatter: what the kind emits, then what --set adds, in order.
    const pairs = [];
    const put = (key, value) => {
      const at = pairs.findIndex(([k]) => k === key);
      if (at >= 0) pairs[at][1] = value;
      else pairs.push([key, value]);
    };
    for (const rule of KINDS[effectiveKind].emit) {
      if (rule.onlyIfGiven && !haveTitle) continue;
      const value = "value" in rule ? rule.value : { title: effectiveTitle, date, handle: vars.handle }[rule.from];
      if (value !== undefined && value !== null && value !== "") put(rule.key, value);
    }
    for (const raw of opts.set || []) {
      const [key, value] = parseSet(raw);
      const legality = keyLegality(effectiveKind, key);
      if (!legality.ok) refuse(legalityMessage(effectiveKind, key, legality.reason));
      put(key, coerce(key, value));
    }
    for (const [k, v] of pairs) doc.frontmatter[k] = v;

    // The two appends SKILL.md §7 demands after every write, and they behave
    // differently on purpose: index.md is a catalog, log.md is history.
    const indexLine = fill(BOOKKEEPING.index.line, {
      title: effectiveTitle,
      path: rel,
      summary: summary || kind,
    });
    const logLine = fill(BOOKKEEPING.log.line, { date, kind, path: rel });
    const listed = readOr(path.join(root, BOOKKEEPING.index.file), "").includes(`](${rel})`);
    doc.index = { file: BOOKKEEPING.index.file, action: listed ? "kept" : "append", line: indexLine };
    doc.log = { file: BOOKKEEPING.log.file, action: "append", line: logLine };

    // Refuse before touching anything, and refuse having done nothing. The
    // body that came with this request is why an existing destination is not a
    // no-op: overwriting loses the file, skipping loses the body, and neither
    // is this verb's call to make.
    if (fs.existsSync(doc.absolute)) refuse(existsMessage(kind, rel));

    doc.outcome = dryRun ? "planned" : "created";
    doc._write = { body: resolveBody(opts, effectiveKind, effectiveTitle), pairs };
    return doc;
  } catch (err) {
    if (!(err instanceof Refusal)) throw err;
    doc.outcome = "refused";
    doc.reason = err.message;
    // A refusal wrote nothing, so it must not claim a bookkeeping action.
    doc.index = null;
    doc.log = null;
    return doc;
  }
}

/**
 * An empty `hud-new/v1` document. Every field the schema names is present and
 * null rather than absent, so a consumer can read `.path` on a refusal without
 * first checking whether the key exists — "there is no path" and "I did not
 * get far enough to have one" look the same to a caller either way, and an
 * undefined key is the shape that breaks `JSON.parse` consumers.
 */
function skeleton(kind) {
  return {
    schema: "hud-new/v1",
    outcome: "refused",
    dry_run: false,
    kind: kind ?? null,
    root: null,
    project: null,
    path: null,
    absolute: null,
    slug: null,
    date: null,
    title: null,
    routed_to_inbox: false,
    frontmatter: {},
    index: null,
    log: null,
    reason: null,
  };
}

function pathNeeds(kind, name) {
  for (const seg of KINDS[kind].segments) {
    if (seg.var === name) return true;
    if (seg.file) {
      if (seg.file.stem === name) return true;
      if (name === "ext" && seg.file.ext === "var:ext") return true;
    }
  }
  return false;
}

function legalityMessage(kind, key, reason) {
  if (reason === "none") {
    return `kind ${kind} carries no frontmatter — it is an immutable drop, so --set ${key} has nowhere to go`;
  }
  if (reason === "derived") {
    if (key === "type") return "type is derived from the destination directory, not --set";
    if (key === "title") return "title is derived from --title, not --set";
    if (key === "date") return "date is derived from --date, not --set";
    return `${key} is derived by the verb, not --set`;
  }
  const legal = KINDS[kind].settable.join(", ");
  return `${key} is not a legal frontmatter key for kind ${kind} (legal: ${legal})`;
}

function existsMessage(kind, rel) {
  if (kind === "context") {
    return `${rel} already exists — CONTEXT.md is the single current brief for a project, so edit it in place rather than recreating it`;
  }
  if (kind === "peer") {
    return `${rel} already exists — one file per person, so edit that one rather than adding a second`;
  }
  return `${rel} already exists — nothing was written. Pass --slug or --date for a different name, or edit that file.`;
}

function resolveBody(opts, kind, title) {
  if (opts.bodyFile !== undefined) {
    if (opts.bodyFile === "-") return readStdin();
    if (!fs.existsSync(opts.bodyFile)) refuse(`--body-file ${opts.bodyFile} does not exist`);
    return fs.readFileSync(opts.bodyFile, "utf8").replace(/\n+$/, "");
  }
  if (opts.haveBody ?? opts.body !== undefined) return opts.body;
  if (KINDS[kind].body === null) {
    refuse("kind raw needs --body or --body-file: the drop IS the content, and there is no template for one");
  }
  return bodyTemplate(kind, title);
}

function readStdin() {
  try {
    return fs.readFileSync(0, "utf8").replace(/\n+$/, "");
  } catch {
    return "";
  }
}

function resolveRoot(rootArg) {
  const raw = rootArg || defaultRoot();
  // Matches what the shell did with `cd && pwd -P`, and what install.sh
  // resolves: a symlinked HUD_ROOT must resolve the same way everywhere, or
  // the paths this prints name files nothing else agrees about.
  try {
    return fs.realpathSync(raw);
  } catch {
    return path.resolve(raw);
  }
}

function isDir(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function readOr(p, fallback) {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return fallback;
  }
}

// --------------------------------------------------------------- execute

/**
 * Carry out a `created` plan. Everything it needs was decided in `plan()`, so
 * this does no deciding: it is the only function here that touches the disk
 * for writing, which is what makes "--dry-run wrote nothing" a property of the
 * call graph rather than of a flag check scattered through the logic.
 */
export function execute(doc) {
  if (doc.outcome !== "created") throw new Error(`execute: refusing a ${doc.outcome} plan`);
  const { body, pairs } = doc._write;

  fs.mkdirSync(path.dirname(doc.absolute), { recursive: true });
  // Rendered to a temp file and moved into place, so a render that dies
  // half-way leaves no file rather than a truncated entry — the same posture
  // `install_file` takes in `hud init`, and for the same reason.
  const tmp = `${doc.absolute}.hud-new.tmp`;
  const front = renderFrontmatter(pairs);
  fs.writeFileSync(tmp, `${front}${front ? "\n" : ""}${body}\n`);
  fs.renameSync(tmp, doc.absolute);

  const root = doc.root;
  if (doc.index.action === "append") append(path.join(root, doc.index.file), doc.index.line);
  append(path.join(root, doc.log.file), doc.log.line);
  return doc;
}

/**
 * Append one line, making sure the file ends in a newline first. index.md and
 * log.md are hand-edited too, and a file whose last line lost its newline
 * would otherwise get this one glued onto the end of it.
 */
function append(file, line) {
  const current = readOr(file, "");
  const gap = current.length > 0 && !current.endsWith("\n") ? "\n" : "";
  fs.appendFileSync(file, `${gap}${line}\n`);
}

// ----------------------------------------------------------- the report

/** Render a list for the report only. The FILE gets a block sequence. */
function reportValue(value) {
  return Array.isArray(value) ? `[${value.join(", ")}]` : String(value);
}

/**
 * The plan, printed identically whether or not it is about to be carried out —
 * a dry run that showed a different report would not be a preview of anything.
 */
export function report(doc) {
  const out = [];
  const row = (label, value) => out.push(`  ${label.padEnd(11)} ${value}`);
  out.push(`hud new ${doc.kind}`);
  if (doc.dry_run) out.push("  (--dry-run — the whole plan, and none of it done)");
  row("root", doc.root);
  if (doc.project) row("project", doc.project);
  if (doc.routed_to_inbox) {
    row("routed", "no project resolved — filed under inbox/ rather than guessed at");
  }
  row("dest", doc.path);
  const keys = Object.keys(doc.frontmatter);
  if (keys.length > 0) {
    out.push("  frontmatter");
    for (const k of keys) out.push(`    ${k.padEnd(13)} ${reportValue(doc.frontmatter[k])}`);
  } else {
    row("frontmatter", "none — a raw drop carries no schema");
  }
  out.push(`  ${"index".padEnd(11)} ${doc.index.action.padEnd(7)} ${doc.index.line}`);
  out.push(`  ${"log".padEnd(11)} ${doc.log.action.padEnd(7)} ${doc.log.line}`);
  return out.join("\n");
}

/** The document a consumer sees: the internals of `execute` are not part of it. */
export function publicDoc(doc) {
  const { _write, ...rest } = doc;
  return rest;
}

// -------------------------------------------------------------- the CLI

const FLAGS = {
  "--title": "title",
  "--project": "project",
  "--handle": "handle",
  "--slug": "slug",
  "--date": "date",
  "--ext": "ext",
  "--summary": "summary",
  "--body": "body",
  "--body-file": "bodyFile",
};

export function parseArgs(argv) {
  const opts = { set: [] };
  if (argv.length === 0) return opts;
  if (argv[0].startsWith("-")) {
    if (argv[0] === "--json") opts.json = true;
    else if (argv[0] === "-n" || argv[0] === "--dry-run") opts.dryRun = true;
    else opts.badKind = `the kind comes first: hud new <${KIND_NAMES.join("|")}> [options]`;
    // Keep scanning so --json is still honoured on the way out.
  } else {
    opts.kind = argv[0];
  }

  for (let i = opts.kind ? 1 : 0; i < argv.length; i++) {
    const arg = argv[i];
    const eq = arg.indexOf("=");
    const name = eq > 2 && arg.startsWith("--") ? arg.slice(0, eq) : arg;
    const inline = eq > 2 && arg.startsWith("--") ? arg.slice(eq + 1) : null;

    if (name === "--json") {
      opts.json = true;
      continue;
    }
    if (name === "-n" || name === "--dry-run") {
      opts.dryRun = true;
      continue;
    }
    if (name === "--set") {
      const value = inline ?? argv[++i];
      if (value === undefined) return { ...opts, error: "--set needs KEY=VALUE" };
      opts.set.push(value);
      continue;
    }
    const field = FLAGS[name];
    if (!field) {
      if (opts.badKind) continue;
      return { ...opts, error: `unknown option ${arg}` };
    }
    const value = inline ?? argv[++i];
    if (value === undefined) {
      return { ...opts, error: `${name} needs ${name === "--body-file" ? "a path" : "a value"}` };
    }
    opts[field] = value;
    if (field === "title") opts.haveTitle = true;
    if (field === "body") opts.haveBody = true;
  }
  return opts;
}

export function main(argv, io = {}) {
  const stdout = io.stdout || ((s) => process.stdout.write(s));
  const stderr = io.stderr || ((s) => process.stderr.write(s));

  // --json is read off the raw argv before anything can fail, so that a
  // refusal caused by an argument EARLIER in the line than the flag is still a
  // document. Parsing first and consulting opts.json would make the contract
  // depend on flag order, which is the sort of thing a caller discovers by
  // getting prose where it expected JSON.
  const asJson = argv.includes("--json");
  const opts = parseArgs(argv);

  // Every refusal goes out the same door, including a malformed invocation.
  // An agent that asked for --json and got a bare English sentence on stderr
  // would have to parse prose to learn it failed, which is the one thing the
  // flag exists to avoid.
  const bail = (reason, from) => {
    const doc = { ...(from || skeleton(opts.kind)), outcome: "refused", index: null, log: null, reason };
    if (asJson) stdout(`${JSON.stringify(publicDoc(doc), null, 2)}\n`);
    else stderr(`hud new: ${reason}\nNothing was written.\n`);
    return 1;
  };
  if (opts.badKind) return bail(opts.badKind);
  if (opts.error) return bail(opts.error);

  let doc;
  try {
    doc = plan(opts);
    if (doc.outcome !== "refused" && !opts.dryRun) execute(doc);
  } catch (err) {
    if (err instanceof Refusal) return bail(err.message);
    throw err;
  }

  if (doc.outcome === "refused") return bail(doc.reason, doc);

  if (asJson) {
    stdout(`${JSON.stringify(publicDoc(doc), null, 2)}\n`);
    return 0;
  }
  stdout(`${report(doc)}\n`);
  stdout(doc.dry_run ? "\n--dry-run: nothing was written.\n" : `\ncreated ${doc.path}\n`);
  return 0;
}

// Same self-start guard server.mjs uses: run only when argv named THIS file,
// so importing it from a test or another module costs nothing.
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = main(process.argv.slice(2));
}
