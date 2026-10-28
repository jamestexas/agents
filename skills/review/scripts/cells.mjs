// cells.mjs — split one markdown table row into trimmed cells, treating `\|`
// as a literal pipe inside a cell rather than a column break. The escape is
// kept as written (`\|`), so a row rebuilt from its cells is byte-identical
// to the input. Used by check.mjs and merge-decisions.mjs; the prompts tell
// writers to escape pipes this way.
export const splitCells = (line) => {
  const s = line.replace(/\r$/, '').trimEnd();
  const out = [];
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '\\' && s[i + 1] === '|') { cur += '\\|'; i++; continue; }
    if (ch === '|') { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur);
  // a row is `| a | b |`: the text before the first pipe and after the last
  // is not a cell. A row missing its closing pipe keeps its last cell.
  const body = s.endsWith('|') ? out.slice(1, -1) : out.slice(1);
  return body.map((c) => c.trim());
};
