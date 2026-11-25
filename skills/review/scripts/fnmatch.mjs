// fnmatchPath(pattern, path) answers what Ruby's
// File.fnmatch?(pattern, path, File::FNM_PATHNAME) answers, so pack and
// CODEOWNERS matching keep the semantics they were written against:
//   *  ?  [...]  never match "/", and never match a "." that starts a segment
//   **/          at the start of a segment matches zero or more directories,
//                none of them starting with "."
//   **           anywhere else is just *
//   \x           matches x literally; {a,b} is literal (no FNM_EXTGLOB)
//   an unterminated "[" makes the whole pattern match nothing
const cache = new Map();

export function fnmatchPath(pattern, path) {
  let re = cache.get(pattern);
  if (!re) { re = toRegExp(pattern); cache.set(pattern, re); }
  return re.test(path);
}

const lit = (c) => c.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
const classLit = (c) => c.replace(/[\\\]\[^-]/g, '\\$&');

function toRegExp(pat) {
  let re = '';
  let i = 0;
  while (i < pat.length) {
    const segStart = i === 0 || pat[i - 1] === '/';
    // a wildcard opening a segment must not consume a leading "."
    const noDot = segStart ? '(?!\\.)' : '';
    const c = pat[i];
    if (segStart && pat.startsWith('**/', i)) {
      re += '(?:(?!\\.)[^/]*/)*';
      i += 3;
    } else if (c === '*') {
      while (pat[i] === '*') i++;
      re += `${noDot}[^/]*`;
    } else if (c === '?') {
      re += `${noDot}[^/]`;
      i++;
    } else if (c === '[') {
      const cls = bracket(pat, i + 1);
      if (!cls) return /(?!)/;
      re += `${noDot}(?!/)${cls.re}`;
      i = cls.end;
    } else if (c === '\\' && i + 1 < pat.length) {
      re += lit(pat[i + 1]);
      i += 2;
    } else {
      re += lit(c);
      i++;
    }
  }
  return new RegExp(`^${re}$`, 's');
}

// bracket parses a class starting just after "[" and returns its regexp and
// the index after the closing "]", or null when the class never closes.
function bracket(pat, i) {
  let neg = false;
  if (pat[i] === '!' || pat[i] === '^') { neg = true; i++; }
  let body = '';
  const take = () => {
    if (pat[i] === '\\' && i + 1 < pat.length) i++;
    return pat[i++];
  };
  while (i < pat.length && pat[i] !== ']') {
    const lo = take();
    if (pat[i] === '-' && i + 1 < pat.length && pat[i + 1] !== ']') {
      i++;
      body += `${classLit(lo)}-${classLit(take())}`;
    } else {
      body += classLit(lo);
    }
  }
  if (i >= pat.length) return null;
  return { re: `[${neg ? '^' : ''}${body}]`, end: i + 1 };
}
