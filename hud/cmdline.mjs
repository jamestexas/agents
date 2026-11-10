// Splitting a config command string into argv, shared by every place a
// command comes from config: the digest source, the `cmd` card kind.

/**
 * Split a config command string into argv. Handles quoted segments; there is
 * deliberately no shell, no globbing and no substitution, so a command string
 * cannot grow into a shell injection.
 */
export function tokenizeCommand(cmd) {
  const argv = [];
  let cur = "";
  let quote = null;
  let quoted = false;
  for (const ch of String(cmd)) {
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      quoted = true;
      continue;
    }
    if (/\s/.test(ch)) {
      if (cur !== "" || quoted) argv.push(cur);
      cur = "";
      quoted = false;
      continue;
    }
    cur += ch;
  }
  if (cur !== "" || quoted) argv.push(cur);
  return argv;
}
