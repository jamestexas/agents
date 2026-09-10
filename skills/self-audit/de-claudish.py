#!/usr/bin/env python3
"""de-claudish — deterministic lint for the lexical tells of over-explained ("claudish") prose.

No model. No network. Regex + structure rules over stdin. It flags the ~80% that
is lexical/structural; the semantic 20% (re-narrating the reader's own code) needs
a rubric-judge pass, out of scope here by design.

Usage:
    cat comment.md | de-claudish.py            # findings (line, rule, span, why)
    de-claudish.py --check comment.md          # exit 1 if any finding (CI gate)
    cat draft.md   | de-claudish.py --json      # machine-readable findings

Rules map 1:1 to the de-claudify tells:
  praise      reflexive praise adjectives ("excellent", "nice touch", "clever")
  showwork    narrating my own verification as prose ("verified", "mutation-checked")
  emdash      >1 em-dash aside in a single sentence (aside stacking)
  ruleof3     three parallel clauses/list items where one would do
  hedge       stacked hedges ("just", "a bit", "somewhat", "I think", "arguably")
  announce    announcing methodology/tooling ("Reviewed with", "Using the X discipline")
"""
import re
import sys
import json
import argparse

PRAISE = re.compile(
    r"\b(excellent|great|nice touch|clever|elegant|beautiful|impressive|"
    r"exemplary|masterclass|fantastic|wonderful|lovely|slick|neat)\b", re.I)
# "verified/traced/..." as prose narration of my own process (not in a code block)
SHOWWORK = re.compile(
    r"\b(verified|mutation[- ]?checked|traced|confirmed|double[- ]?checked|"
    r"i (?:read|ran|checked|walked|inspected))\b", re.I)
EMDASH = re.compile(r"—|(?<!-)--(?!-)")
HEDGE = re.compile(
    r"\b(just|a bit|somewhat|sort of|kind of|arguably|i think|i believe|"
    r"it seems|perhaps|maybe|fairly|quite|rather|honestly|to be fair)\b", re.I)
ANNOUNCE = re.compile(
    r"\b(reviewed (?:with|locally)|using the .{0,30}? (?:discipline|skill)|"
    r"ran the .{0,30}? (?:chain|pipeline)|applied the .{0,30}? lens)\b", re.I)
# rule-of-three: "A, B, and C" of parallel multi-word phrases, or a 3-item bulleted run
LIST3_INLINE = re.compile(
    r"(?:\b\w[\w'-]*\s+\w[\w'-]*(?:\s+\w[\w'-]*)?)(?:,\s+"
    r"\w[\w'-]*\s+\w[\w'-]*(?:\s+\w[\w'-]*)?){1},?\s+and\s+"
    r"\w[\w'-]*\s+\w[\w'-]*")

RULES = [
    ("praise", PRAISE, "reflexive praise — the author knows their work is good; state the finding"),
    ("showwork", SHOWWORK, "narrating my own verification — say the confidence, not the process"),
    ("hedge", HEDGE, "hedge/qualifier — cut it or commit to the claim"),
    ("announce", ANNOUNCE, "announcing methodology — the reader wants the result, not the process"),
    ("ruleof3", LIST3_INLINE, "rule-of-three enumeration — one clause usually carries the signal"),
]


def _in_code_block(line_idx, code_line_flags):
    return code_line_flags[line_idx]


def scan(text):
    lines = text.splitlines()
    # mark fenced code-block lines so we don't lint code/examples
    code = [False] * len(lines)
    fence = False
    for i, ln in enumerate(lines):
        if ln.lstrip().startswith("```"):
            fence = not fence
            code[i] = True
            continue
        code[i] = fence or ln.startswith("    ") or ln.lstrip().startswith(">")
    findings = []
    for i, ln in enumerate(lines):
        if code[i] or not ln.strip():
            continue
        for name, rx, why in RULES:
            for m in rx.finditer(ln):
                findings.append({"line": i + 1, "rule": name, "span": m.group(0).strip(), "why": why})
        # em-dash aside stacking: >1 em-dash in one sentence
        for sent in re.split(r"(?<=[.!?])\s+", ln):
            if len(EMDASH.findall(sent)) > 1:
                findings.append({"line": i + 1, "rule": "emdash",
                                 "span": sent.strip()[:60] + ("…" if len(sent) > 60 else ""),
                                 "why": ">1 em-dash aside in one sentence — pick one, or use a period"})
    return findings


def main():
    ap = argparse.ArgumentParser(description="deterministic de-claudish lint")
    ap.add_argument("file", nargs="?", help="file to lint (default: stdin)")
    ap.add_argument("--check", action="store_true", help="exit 1 if any finding (CI gate)")
    ap.add_argument("--json", action="store_true", help="machine-readable output")
    args = ap.parse_args()
    text = open(args.file).read() if args.file else sys.stdin.read()
    findings = scan(text)
    if args.json:
        print(json.dumps(findings, indent=2))
    else:
        for f in findings:
            print(f"L{f['line']:>3}  {f['rule']:<9} {f['span']!r:<40} {f['why']}")
        if not findings:
            print("clean — no claudish tells")
        else:
            print(f"\n{len(findings)} finding(s). These are lexical; semantic re-narration needs a rubric-judge pass.")
    sys.exit(1 if (args.check and findings) else 0)


if __name__ == "__main__":
    main()
