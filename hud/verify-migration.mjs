#!/usr/bin/env node
// Verifies a one-time legacy-notes ingest was lossless.
//
// The guarantee being checked is byte-preservation, not similarity: for a
// markdown entry, frontmatter may only have been PREPENDED, so the original
// bytes must survive as the exact byte TAIL of the destination file. That is
// checked by hashing the last N bytes of the destination (N = original byte
// length) and comparing against the manifest's sha256 — which is why the
// manifest records `bytes` alongside `sha256`. Non-markdown artifacts must be
// byte-identical outright.
//
// Exits 0 only if every check passes. Every miss is printed.

import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

import { defaultRoot, generatedDir } from "./server.mjs";

// The tree being verified cannot be derived from this file's location: the
// machinery lives in a shared repo and the content tree is somewhere else
// entirely. `defaultRoot()` is the server's own answer to the same question,
// so there is one rule for where the HUD tree is.
const HUD_ROOT = resolve(defaultRoot());

const GENERATED = generatedDir(HUD_ROOT);
const MANIFEST = join(GENERATED, "migration-manifest.json");
// The legacy source path is content, not machinery: it lives in the gitignored
// .generated/ dir next to the manifest rather than being baked in here.
const SOURCE_POINTER = join(GENERATED, "migration-source.txt");

const MIN_ENTRIES = 15;
// `_hud` is a symlink to the machinery repo; walking it would inventory public
// code as if it were tree content.
const EXCLUDED_DIRS = new Set([".git", "_hud"]);

const misses = [];
const miss = (m) => misses.push(m);

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

function walk(dir, skip = () => false) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (skip(p, name)) continue;
    const st = statSync(p);
    if (st.isDirectory()) out.push(...walk(p, skip));
    else if (st.isFile()) out.push(p);
  }
  return out;
}

// ---- check 1: manifest exists and is big enough -------------------------

if (!existsSync(MANIFEST)) {
  console.error(`MISS: manifest not found at ${MANIFEST}`);
  console.error("\nFAIL: 1 miss");
  process.exit(1);
}

let manifest;
try {
  manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
} catch (err) {
  console.error(`MISS: manifest is not valid JSON: ${err.message}`);
  console.error("\nFAIL: 1 miss");
  process.exit(1);
}

if (!Array.isArray(manifest)) {
  console.error("MISS: manifest is not a JSON array");
  console.error("\nFAIL: 1 miss");
  process.exit(1);
}

if (manifest.length < MIN_ENTRIES) {
  miss(`manifest has ${manifest.length} entries, expected >= ${MIN_ENTRIES}`);
}

// ---- inventory of the destination tree ----------------------------------

const hudFiles = walk(HUD_ROOT, (p, name) => {
  if (EXCLUDED_DIRS.has(name)) return true;
  return p === GENERATED || p.startsWith(GENERATED + "/");
});

// Full-file hash of every candidate, for the byte-identical ("other") check.
const bytesByPath = new Map();
const pathsByFullHash = new Map();
for (const p of hudFiles) {
  const buf = readFileSync(p);
  bytesByPath.set(p, buf);
  const h = sha256(buf);
  if (!pathsByFullHash.has(h)) pathsByFullHash.set(h, []);
  pathsByFullHash.get(h).push(p);
}

const rel = (p) => (p.startsWith(HUD_ROOT + "/") ? p.slice(HUD_ROOT.length + 1) : p);

// Does `path`'s content end with the exact original bytes described by entry?
function tailMatches(path, entry) {
  const buf = bytesByPath.get(path) ?? readFileSync(path);
  if (buf.length < entry.bytes) return false;
  return sha256(buf.subarray(buf.length - entry.bytes)) === entry.sha256;
}

function findTailMatch(entry) {
  for (const p of hudFiles) if (tailMatches(p, entry)) return p;
  return null;
}

// ---- checks 2 and 3: every entry survived --------------------------------

let mdChecked = 0;
let otherChecked = 0;

for (const entry of manifest) {
  const { src, kind, sha256: want, bytes } = entry;
  if (typeof bytes !== "number" || typeof want !== "string") {
    miss(`${src}: manifest entry missing sha256/bytes — cannot verify`);
    continue;
  }

  // Recorded dest is checked first; a scan is the fallback so that a correct
  // migration with a stale/absent dest still verifies.
  const destPath = entry.dest ? join(HUD_ROOT, entry.dest) : null;

  if (kind === "md") {
    mdChecked++;
    if (destPath && existsSync(destPath) && tailMatches(destPath, entry)) continue;
    if (destPath && !existsSync(destPath)) {
      miss(`${src}: recorded dest does not exist: ${entry.dest}`);
      continue;
    }
    if (destPath) {
      miss(
        `${src}: recorded dest ${entry.dest} does not end with the original ` +
          `${bytes} bytes (original content was edited, reflowed, or truncated — ` +
          `frontmatter may only be PREPENDED)`,
      );
      continue;
    }
    const found = findTailMatch(entry);
    if (found) continue;
    miss(`${src}: no file under HUD_ROOT ends with the original ${bytes} bytes (sha256 ${want.slice(0, 12)})`);
  } else {
    otherChecked++;
    if (destPath && existsSync(destPath) && sha256(bytesByPath.get(destPath) ?? readFileSync(destPath)) === want) {
      continue;
    }
    if (destPath && !existsSync(destPath)) {
      miss(`${src}: recorded dest does not exist: ${entry.dest}`);
      continue;
    }
    if (destPath) {
      miss(`${src}: recorded dest ${entry.dest} is not byte-identical (expected sha256 ${want.slice(0, 12)})`);
      continue;
    }
    const found = pathsByFullHash.get(want);
    if (found && found.length) continue;
    miss(`${src}: no byte-identical copy under HUD_ROOT (sha256 ${want.slice(0, 12)})`);
  }
}

// ---- check 4: the source tree is a tombstone ----------------------------

if (!existsSync(SOURCE_POINTER)) {
  miss(
    `source pointer not found at ${SOURCE_POINTER} — cannot confirm the legacy ` +
      `tree was emptied. Write the absolute legacy path there.`,
  );
} else {
  const srcRoot = readFileSync(SOURCE_POINTER, "utf8").trim();
  if (!srcRoot) {
    miss(`source pointer at ${SOURCE_POINTER} is empty`);
  } else if (!existsSync(srcRoot)) {
    miss(`legacy source root does not exist: ${srcRoot}`);
  } else {
    const remaining = readdirSync(srcRoot).filter((n) => n !== ".git").sort();
    const allowed = ["README.md"];
    const extra = remaining.filter((n) => !allowed.includes(n));
    if (extra.length) {
      miss(`legacy source root still contains ${extra.length} unexpected entr${extra.length === 1 ? "y" : "ies"}: ${extra.join(", ")}`);
    }
    if (!remaining.includes("README.md")) {
      miss(`legacy source root has no README.md tombstone`);
    }
  }
}

// ---- report -------------------------------------------------------------

if (misses.length) {
  console.error(`Verifying ${manifest.length} manifest entries against ${HUD_ROOT}\n`);
  for (const m of misses) console.error(`MISS: ${m}`);
  console.error(`\nFAIL: ${misses.length} miss${misses.length === 1 ? "" : "es"}`);
  process.exit(1);
}

console.log(`Verifying ${manifest.length} manifest entries against ${HUD_ROOT}`);
console.log(`  ${mdChecked} md entries: original bytes survive as exact byte tail`);
console.log(`  ${otherChecked} other entries: byte-identical copy present`);
console.log(`  ${hudFiles.length} files scanned under HUD_ROOT (excluding .git, _hud, .generated)`);
console.log(`  legacy source root reduced to README.md tombstone`);
console.log("\nPASS: no misses");
