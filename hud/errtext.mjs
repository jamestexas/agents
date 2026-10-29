// The one rendering of an error for a log line or a JSON body, shared by the
// server and the card kinds, which read files and must report a failure the
// same way the rest of the HUD does.

/**
 * Render an error for a log line or a JSON body.
 *
 * ENOENT means two unrelated things, and which one is not the caller's to
 * assume: a spawn whose binary is not installed, or a filesystem call whose
 * path is not there. Both reach here — `serveSource` catches `produce()` (a
 * spawned digest command *or* an HTTP fetch) and `writeSnapshot` (pure fs) in
 * the same `try`, so no per-call-site flag could separate them.
 *
 * Node labels them distinguishably on the error itself: a spawn failure
 * carries `syscall: "spawn <binary>"`, a filesystem failure carries the
 * syscall that failed (`mkdir`, `open`, …). Keying on that is why this needs
 * no parameter.
 *
 * Mapping every ENOENT to "command not found" is what this replaces. It sent
 * a read-only bind mount to the container log as `command not found:
 * /hud/.generated` — a real condition reported as a missing binary, pointing
 * whoever read it at the wrong subsystem entirely.
 */
export function errText(err) {
  if (!err) return "unknown error";
  if (err.code === "ENOENT") {
    const where = err.path || err.syscall || "?";
    return String(err.syscall || "").startsWith("spawn")
      ? `command not found: ${where}`
      : `no such file or directory: ${where}`;
  }
  return err.message || String(err);
}
