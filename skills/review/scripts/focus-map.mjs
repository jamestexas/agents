#!/usr/bin/env node
// focus-map.mjs <prdir> [--run DIR] [--explain FILE] [--out FILE] [--title T] [--worktree keep]
//
// The join step: no model. Two passes looked at the same change without
// reading each other. explain-work said which areas are load-bearing and
// which are plumbing (the `## Areas` table at the end of explain.md); /review
// said which of its questions held, which stayed open, and which fell into a
// finding (work/ledger.md, work/findings.json, work/claims.jsonl). This
// script lays one over the other by file path and line overlap and writes
// focus.md: a 2x3 grid (weight x outcome) and a "Look here first" list.
//
// The cell to read first is load-bearing x open: code that matters, where
// the review either could not settle a question or never asked one.
//
// Defaults: --run <prdir>/raw, --explain <prdir>/explain.md,
// --out <prdir>/focus.md.
//
// The join is the last step that waits for the explain pass, the only reader
// of the PR worktree that can outlive `finish`, so after writing focus.md it
// removes the run's worktree (`--worktree keep` holds it).
//
// Outcomes, per review item:
//   fell   a finding tagged Blocking, Non-blocking or Observation
//   open   a finding tagged Question, or a ledger row whose Decision is
//          Unresolved; also any area no review item touched ("not examined")
//   held   a ledger row decided with no finding behind it (including rows
//          whose candidate triage or refute dropped)
// A finding stands in for the ledger rows it cites, so a row is never listed
// twice. An item that overlaps a load-bearing area counts as load-bearing.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { splitCells } from './cells.mjs';
import { removeRunWorktree } from './worktree.mjs';

// Files that are the review's own evidence, not code under review.
const EVIDENCE = /^(git|probes|pr|work|evidence|raw)\//;
const EVIDENCE_FILES = new Set(['manifest.json', 'owners.json', 'packs.json', 'target.json', 'claims.jsonl', 'findings.json']);
const PATH_RE = /[A-Za-z0-9_][\w./-]*\.[A-Za-z][A-Za-z0-9]{0,5}\b/y;
const SPEC = String.raw`\d+(?:\s*-\s*\d+)?(?:\s*,\s*:?\d+(?:\s*-\s*\d+)?)*`;
const COLON_SPEC = new RegExp(String.raw`:(${SPEC})`, 'y');
const WORD_SPEC = new RegExp(String.raw`lines?\s+(${SPEC})`, 'iy');

const HUNK_WORD = new RegExp(String.raw`hunks?\s+(\d+(?:\s*-\s*\d+)?(?:\s*(?:,|and)\s*\d+(?:\s*-\s*\d+)?)*)`, 'iy');
const HUNK_HEADER = /@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/y;

// A unified diff's hunks, numbered from 1 in file order: {file, start, end}
// on the new side (the old side for a deleted file). Readers cite
// `git/diff.patch hunk 31`; this turns that into a file and lines.
export function parsePatch(text) {
  const hunks = [];
  let file = null; let oldFile = null;
  for (const l of String(text ?? '').split('\n')) {
    if (l.startsWith('--- ')) oldFile = l.slice(4).replace(/^a\//, '');
    else if (l.startsWith('+++ ')) { const f = l.slice(4); file = f === '/dev/null' ? oldFile : f.replace(/^b\//, ''); }
    else if (l.startsWith('@@ ') && file) {
      const m = l.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
      if (!m) continue;
      const deleted = Number(m[4] ?? 1) === 0;
      const start = Number(deleted ? m[1] : m[3]); const len = Number(deleted ? (m[2] ?? 1) : (m[4] ?? 1));
      hunks.push({ file, start, end: start + Math.max(len, 1) - 1 });
    }
  }
  return hunks;
}

const parseSpec = (spec) => spec.split(',').map((p) => p.replace(/^\s*:/, '').trim()).filter(Boolean).map((p) => {
  const [a, b] = p.split('-').map((x) => Number(x.trim()));
  return [a, Number.isFinite(b) ? b : a];
});

// known: { files: [changed paths], full: Set of full paths seen in any input }
export const resolvePath = (tok, known) => {
  const t = tok.replace(/^\.\//, '');
  if (EVIDENCE.test(t) || EVIDENCE_FILES.has(t)) return [];
  if (t.includes('/')) {
    const hit = known.files.find((f) => f === t || f.endsWith(`/${t}`));
    return [hit ?? t];
  }
  const byBase = known.files.filter((f) => path.basename(f) === t);
  if (byBase.length > 1) {
    const seen = byBase.filter((f) => known.full.has(f));
    return seen.length ? seen : byBase;
  }
  if (byBase.length === 1) return byBase;
  const full = [...known.full].filter((f) => path.basename(f) === t);
  return full;
};

// Every code location named in free text: [{file, ranges: [[a,b]...] | null}].
// `:350-358`, `line 360` and `lines 159-183` with no path of their own attach
// to the last code path named before them; a null ranges means file-level.
export function parseLocations(text, known) {
  const s = String(text ?? '').replace(/[–—]/g, '-');
  const out = [];
  let last = null;
  // which patch a bare "hunk N" counts in: the last one named, else diff.patch
  let patch = 'diff';
  const patches = known.patches ?? {};
  for (let i = 0; i < s.length;) {
    const prev = i ? s[i - 1] : ' ';
    if (/[hH]/.test(s[i]) && !/\w/.test(prev)) {
      HUNK_WORD.lastIndex = i;
      const h = HUNK_WORD.exec(s);
      if (h) {
        const hunks = patches[patch] ?? [];
        for (const [a, b] of parseSpec(h[1].replace(/\band\b/g, ','))) {
          for (let k = a; k <= b && k - a < 200; k++) {
            const hk = hunks[k - 1];
            if (hk) out.push({ file: hk.file, ranges: [[hk.start, hk.end]] });
          }
        }
        i += h[0].length; continue;
      }
    }
    if (s[i] === '@' && last) {
      HUNK_HEADER.lastIndex = i;
      const h = HUNK_HEADER.exec(s);
      if (h) {
        const start = Number(h[1]); const len = Number(h[2] ?? 1);
        for (const f of last) out.push({ file: f, ranges: [[start, start + Math.max(len, 1) - 1]] });
        i += h[0].length; continue;
      }
    }
    if (/[A-Za-z0-9_]/.test(s[i]) && !/[\w./-]/.test(prev)) {
      PATH_RE.lastIndex = i;
      const m = PATH_RE.exec(s);
      if (m) {
        const pm = m[0].match(/^(?:evidence\/)?git\/([\w-]+)\.patch$/);
        if (pm) patch = pm[1];
        const files = resolvePath(m[0], known);
        i += m[0].length;
        COLON_SPEC.lastIndex = i;
        const c = COLON_SPEC.exec(s);
        const ranges = c ? parseSpec(c[1]) : null;
        if (c) i += c[0].length;
        if (files.length) {
          last = files;
          for (const f of files) out.push({ file: f, ranges });
        } else if (!/^[\w.-]+\.(go|proto|tf|md|ya?ml|sh|mjs|js|ts|py|rb|sql)$/.test(m[0])) {
          // an evidence path (`git/diff.patch`) ends the run of continuations
          if (EVIDENCE.test(m[0]) || EVIDENCE_FILES.has(m[0])) last = null;
        }
        continue;
      }
    }
    if (last && s[i] === ':' && /[\s`(@]/.test(prev)) {
      COLON_SPEC.lastIndex = i;
      const c = COLON_SPEC.exec(s);
      if (c) { for (const f of last) out.push({ file: f, ranges: parseSpec(c[1]) }); i += c[0].length; continue; }
    }
    if (last && /[lL]/.test(s[i]) && !/\w/.test(prev)) {
      WORD_SPEC.lastIndex = i;
      const w = WORD_SPEC.exec(s);
      if (w) { for (const f of last) out.push({ file: f, ranges: parseSpec(w[1]) }); i += w[0].length; continue; }
    }
    i++;
  }
  // a file named once with lines and once bare keeps only the lines
  const withLines = new Set(out.filter((l) => l.ranges).map((l) => l.file));
  const seen = new Set();
  return out.filter((l) => {
    if (!l.ranges && withLines.has(l.file)) return false;
    const k = `${l.file}:${JSON.stringify(l.ranges)}`;
    if (seen.has(k)) return false;
    seen.add(k); return true;
  });
}

// Strong: same file and line ranges within `slack` of each other. Weak: same
// file where either side has no lines, or where the item's range is wider
// than `wide` lines: a 200-line hunk overlaps every area in it, which says
// the item is in that file, not that it examined any one area.
export function overlap(item, area, { slack = 3, wide = 60 } = {}) {
  let weak = false;
  for (const x of item) for (const y of area) {
    if (x.file !== y.file) continue;
    const narrow = (x.ranges ?? []).filter(([a, b]) => b - a + 1 <= wide);
    if (!narrow.length || !y.ranges) { weak = true; continue; }
    for (const [s1, e1] of narrow) for (const [s2, e2] of y.ranges) {
      if (s1 <= e2 + slack && s2 <= e1 + slack) return 'strong';
    }
    weak = true;
  }
  return weak ? 'weak' : null;
}

const tableAfter = (md, heading) => {
  const lines = md.split('\n');
  const start = lines.findIndex((l) => heading.test(l));
  if (start === -1) return null;
  const rows = [];
  let seen = false;
  for (const l of lines.slice(start + 1)) {
    if (!l.startsWith('|')) { if (seen) break; continue; }
    seen = true;
    const c = splitCells(l);
    if (/^\d+$/.test(c[0] ?? '')) rows.push(c);
  }
  return rows;
};

export function parseAreas(md) {
  const rows = tableAfter(md, /^##\s+Areas\b/i);
  if (rows === null) return null;
  return rows.map((c) => ({
    n: Number(c[0]),
    area: c[1] ?? '',
    where: c[2] ?? '',
    weight: /load[- ]?bearing/i.test(c[3] ?? '') ? 'load-bearing' : 'plumbing',
    why: c[4] ?? '',
    // explain-work raised something here itself ("Finding 1", "gap", ...)
    flagged: /\bfinding\s*\d+|\(finding|\bgap\b|\bmisses\b|\buntested\b/i.test(c[4] ?? ''),
  }));
}

const isUnresolved = (cell) => /^\*{0,2}unresolved\b/i.test(cell ?? '');
const short = (s, n = 110) => { const t = String(s ?? '').replace(/\s+/g, ' ').replace(/`/g, '').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const readIf = (p) => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null);

// Identifiers worth matching on: camelCase, PascalCase with an inner capital,
// or snake_case, six characters or more. Plain words are not.
const IDENT = /\b(?:[a-z]+[A-Z]\w*|[A-Z][a-z0-9]+[A-Z]\w*|[A-Za-z]+_\w+)\b/g;
const idents = (text) => new Set((String(text ?? '').match(IDENT) ?? []).filter((w) => w.length >= 6));

export function join({ explain, ledger, findings, claims, files, patches }) {
  const areas = parseAreas(explain ?? '');
  if (!areas) throw new Error('explain.md has no "## Areas" table');
  const ledgerRows = ledger ? (tableAfter(ledger, /^##\s+Decision ledger/i) ?? tableAfter(ledger, /^\|\s*#\s*\|/) ?? []) : [];
  // Full paths named anywhere help resolve a bare `ces.go`.
  const corpus = [explain, ledger, JSON.stringify(findings ?? []), (claims ?? []).map((c) => c.source).join(' ')].join('\n');
  const full = new Set(corpus.match(/[A-Za-z0-9_][\w.-]*(?:\/[\w.-]+)+\.[A-Za-z][A-Za-z0-9]{0,5}\b/g) ?? []);
  const known = { files: files ?? [], full, patches: patches ?? {} };
  for (const a of areas) a.locs = parseLocations(a.where, known);
  // An identifier named by at most two areas is a symbol match when an item
  // names it too; one named by many areas (AddResources) tells nothing.
  const identCount = new Map();
  for (const a of areas) { a.idents = idents(`${a.area} ${a.where}`); for (const w of a.idents) identCount.set(w, (identCount.get(w) ?? 0) + 1); }
  for (const a of areas) a.idents = new Set([...a.idents].filter((w) => identCount.get(w) <= 2));

  const claimsByRow = new Map();
  for (const c of claims ?? []) {
    const r = Number(c.row);
    if (!claimsByRow.has(r)) claimsByRow.set(r, []);
    claimsByRow.get(r).push(c);
  }
  const rowLocs = (r) => {
    const text = [r[2], r[3], ...(claimsByRow.get(Number(r[0])) ?? []).map((c) => (Array.isArray(c.source) ? c.source.join(' ') : c.source))].join(' ');
    return parseLocations(text, known);
  };
  const rowById = new Map(ledgerRows.map((r) => [Number(r[0]), r]));

  const items = [];
  const consumed = new Set();
  (findings ?? []).forEach((f, i) => {
    const rows = (f.rows ?? []).map(Number);
    rows.forEach((r) => consumed.add(r));
    const own = parseLocations(f.file_line, known);
    const locs = own.length ? own : rows.flatMap((r) => (rowById.has(r) ? rowLocs(rowById.get(r)) : []));
    items.push({ kind: 'finding', id: `F${i + 1}`, tag: f.tag, text: f.title, where: f.file_line, rows, locs, names: idents(f.title),
      outcome: f.tag === 'Question' ? 'open' : 'fell' });
  });
  for (const r of ledgerRows) {
    const n = Number(r[0]);
    if (consumed.has(n)) continue;
    // the question and what settles it, not the decision: a decision names
    // every symbol it walked past on the way
    items.push({ kind: 'row', id: `r${n}`, text: r[1], decision: r[3], rows: [n], locs: rowLocs(r), names: idents(`${r[1]} ${r[2]}`),
      outcome: isUnresolved(r[3]) ? 'open' : 'held' });
  }

  for (const it of items) {
    const byLines = areas.filter((a) => overlap(it.locs, a.locs) === 'strong');
    const bySymbol = areas.filter((a) => !byLines.includes(a) && [...a.idents].some((w) => it.names.has(w)));
    const strong = [...byLines, ...bySymbol].sort((x, y) => x.n - y.n);
    // A weak (file-level) match counts only when nothing matched by lines or
    // symbol, and only when it singles out one or two areas; past that the
    // item is about the whole change (a build, a probe), not an area.
    const weak = strong.length ? [] : areas.filter((a) => overlap(it.locs, a.locs) === 'weak');
    it.areas = strong.length ? strong : weak.length <= 2 ? weak : [];
    it.match = byLines.length ? 'lines' : bySymbol.length ? 'symbol' : it.areas.length ? 'file' : weak.length ? 'broad' : 'none';
    it.weight = it.areas.some((a) => a.weight === 'load-bearing') ? 'load-bearing' : it.areas.length ? 'plumbing' : null;
  }
  const touched = new Set(items.flatMap((it) => it.areas.map((a) => a.n)));
  const unexamined = areas.filter((a) => !touched.has(a.n));
  return { areas, items, unexamined };
}

const label = (it) => {
  const where = it.areas.length ? ` → ${it.areas.map((a) => `A${a.n}`).join(', ')}` : '';
  if (it.kind === 'finding') return `**${it.id}** [${it.tag}] ${short(it.text)}${it.where ? ` (\`${it.where}\`)` : ''}${where}`;
  const tag = it.outcome === 'open' ? ' [Unresolved]' : '';
  return `**${it.id}**${tag} ${short(it.text, 90)}${where}`;
};
const areaName = (a) => `A${a.n} ${short(a.area, 70)}`;

export function render({ areas, items, unexamined }, { title, sources, stale = false }) {
  const cell = (weight, outcome) => {
    const list = items.filter((it) => it.weight === weight && it.outcome === outcome).map(label);
    if (outcome === 'open') list.push(...unexamined.filter((a) => a.weight === weight).map((a) => `${areaName(a)}: *not examined by review*`));
    return list.join('<br>') || '—';
  };
  const both = items.filter((it) => it.kind === 'finding' && it.outcome === 'fell' && it.areas.some((a) => a.flagged));
  const lbOpen = [
    ...items.filter((it) => it.weight === 'load-bearing' && it.outcome === 'open'),
  ];
  const lbUnexamined = unexamined.filter((a) => a.weight === 'load-bearing');
  const lbFell = items.filter((it) => it.weight === 'load-bearing' && it.outcome === 'fell' && !both.includes(it));
  const unmapped = items.filter((it) => !it.areas.length);
  const look = [];
  for (const it of both) look.push(`${label(it)} — explain-work flagged this area too: "${short(it.areas.find((a) => a.flagged).why, 90)}"`);
  for (const it of lbOpen) look.push(`${label(it)} — load-bearing, ${it.kind === 'finding' ? 'raised as a question' : 'the review could not settle it'}`);
  for (const a of lbUnexamined) look.push(`${areaName(a)} (\`${short(a.where, 80)}\`) — load-bearing, no review question reached it`);
  const outside = unmapped.filter((it) => it.outcome !== 'held');
  if (outside.length) look.push(`Outside every area: ${outside.map((it) => `**${it.id}**${it.kind === 'finding' ? ` [${it.tag}]` : ' [Unresolved]'}`).join(', ')} (see "Not mapped to an area")`);
  const counts = (o) => items.filter((it) => it.outcome === o).length;
  const out = [
    `# Focus map — ${title}`, '',
    'Two independent passes, joined by script: **explain-work** says what is load-bearing, **/review** says what held. Neither read the other.',
    `Sources: ${sources.join(', ')}.`, '',
    '## Focus map', '',
    '| | held (verified) | open / unverified | fell (finding) |',
    '|---|---|---|---|',
    `| **load-bearing** | ${cell('load-bearing', 'held')} | ${cell('load-bearing', 'open')} | ${cell('load-bearing', 'fell')} |`,
    `| **plumbing / tests** | ${cell('plumbing', 'held')} | ${cell('plumbing', 'open')} | ${cell('plumbing', 'fell')} |`, '',
    '## Look here first', '',
    ...(look.length ? look.map((l, i) => `${i + 1}. ${l}`) : ['Nothing load-bearing is open: every load-bearing area was reached and settled.']), '',
  ];
  if (lbFell.length) out.push('Also on load-bearing code, already a finding:', '', ...lbFell.map((it) => `- ${label(it)}`), '');
  // Where one pass raised something and the other did not. Not a verdict:
  // the review may have settled what explain-work worried about, or missed it.
  const disagree = [];
  for (const a of areas.filter((x) => x.flagged)) {
    const on = items.filter((it) => it.areas.includes(a));
    if (!on.some((it) => it.outcome !== 'held')) {
      disagree.push(`| A${a.n} ${short(a.area, 60)} | flagged: ${short(a.why, 100)} | ${on.length ? `held (${on.map((it) => it.id).join(', ')})` : 'not examined'} | read the rows; either the review settled it or never asked |`);
    }
  }
  for (const it of items.filter((x) => x.kind === 'finding' && x.outcome === 'fell' && x.areas.length && x.weight === 'plumbing')) {
    disagree.push(`| ${it.areas.map((a) => `A${a.n}`).join(', ')} | called plumbing | **${it.id}** [${it.tag}] ${short(it.text, 80)} | the finding sits in code explain-work did not weigh |`);
  }
  if (disagree.length) out.push('## Where the passes disagree', '', '| Area | explain-work | /review | Read as |', '|---|---|---|---|', ...disagree, '');
  out.push('## Areas', '', '| # | Area | Weight | Review items |', '|---|---|---|---|',
    ...areas.map((a) => `| A${a.n} | ${short(a.area, 80)} | ${a.weight} | ${items.filter((it) => it.areas.includes(a)).map((it) => it.id).join(', ') || '—'} |`), '');
  if (unmapped.length) {
    out.push('## Not mapped to an area', '',
      'Review items that single out no area explain-work named: the item names no code location, spans many areas at once (a build or probe question, marked *whole change*), or sits in code explain-work did not list.', '',
      ...unmapped.map((it) => `- ${label(it)} (${it.outcome}${it.match === 'broad' ? ', whole change' : ''})`), '');
  }
  const weak = items.filter((it) => it.match === 'file');
  out.push('## How this was joined', '',
    `${areas.length} areas (${areas.filter((a) => a.weight === 'load-bearing').length} load-bearing); ${items.length} review items: ${counts('held')} held, ${counts('open')} open, ${counts('fell')} fell. ` +
    `${items.filter((it) => it.match === 'lines').length} matched by line overlap, ${items.filter((it) => it.match === 'symbol').length} by symbol only, ${weak.length} by file only${weak.length ? ` (${weak.map((it) => it.id).join(', ')})` : ''}, ${unmapped.length} unmapped; ${unexamined.length} area(s) no item reached.`,
    'A finding replaces the ledger rows it cites. Generated by `skills/review/scripts/focus-map.mjs`; rerun it rather than editing this file.', '');
  if (stale) out.push('**explain.md is older than this review\'s evidence**: it may describe an earlier head. Re-run the explain pass if the PR moved.', '');
  return out.join('\n');
}

function main(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) args[a.slice(2)] = argv[++i]; else args._.push(a);
  }
  const prdir = args._[0];
  if (!prdir) { console.error('usage: focus-map.mjs <prdir> [--run DIR] [--explain FILE] [--out FILE] [--title T] [--worktree keep]'); return 2; }
  const run = args.run ?? path.join(prdir, 'raw');
  const explainPath = args.explain ?? path.join(prdir, 'explain.md');
  const outPath = args.out ?? path.join(prdir, 'focus.md');
  const explain = readIf(explainPath);
  if (explain === null) { console.error(`focus-map: no ${explainPath}`); return 1; }
  const work = (f) => path.join(run, 'work', f);
  const findingsText = readIf(work('findings.json'));
  let findings = [];
  try { findings = findingsText ? JSON.parse(findingsText) : []; } catch { console.error('focus-map: work/findings.json is not JSON'); return 1; }
  const claims = (readIf(work('claims.jsonl')) ?? '').split('\n').filter((l) => l.trim()).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const files = (readIf(path.join(run, 'evidence', 'git', 'files')) ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
  const target = (() => { try { return JSON.parse(readIf(path.join(run, 'evidence', 'target.json')) ?? 'null'); } catch { return null; } })();
  let result;
  const patches = {};
  const gitDir = path.join(run, 'evidence', 'git');
  for (const f of fs.existsSync(gitDir) ? fs.readdirSync(gitDir) : []) {
    if (f.endsWith('.patch')) patches[f.replace(/\.patch$/, '')] = parsePatch(readIf(path.join(gitDir, f)));
  }
  try { result = join({ explain, ledger: readIf(work('ledger.md')), findings, claims, files, patches }); }
  catch (e) { console.error(`focus-map: ${e.message}`); return 1; }
  const title = args.title ?? (target?.pr ? `PR ${target.pr}` : path.basename(path.resolve(prdir)));
  // explain.md from an earlier round would be joined against this round's
  // review without anyone noticing; say so rather than refuse, since the
  // explain pass may legitimately start before the evidence finishes.
  const targetPath = path.join(run, 'evidence', 'target.json');
  const stale = fs.existsSync(targetPath) && fs.statSync(explainPath).mtimeMs < fs.statSync(targetPath).mtimeMs - 60 * 60 * 1000;
  if (stale) console.error(`focus-map: ${explainPath} is more than an hour older than the evidence; it may describe an earlier head`);
  const md = render(result, { title, stale, sources: [`\`${path.basename(explainPath)}\` (Areas)`, '`work/ledger.md`', '`work/findings.json`', '`work/claims.jsonl`'] });
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, md);
  const lb = result.items.filter((it) => it.weight === 'load-bearing' && it.outcome === 'open').length
    + result.unexamined.filter((a) => a.weight === 'load-bearing').length;
  console.log(`focus-map: ${result.areas.length} areas, ${result.items.length} review items, ${lb} load-bearing x open → ${outPath}`);
  if (args.worktree !== 'keep') removeRunWorktree(run);
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) process.exit(main(process.argv.slice(2)));
