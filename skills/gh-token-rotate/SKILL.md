---
name: gh-token-rotate
description: >-
  Rotate or restore the GitHub PAT that `gh` and `git push` authenticate with,
  keeping it in the macOS keychain rather than a dotfile. Use when a push fails
  with "Invalid username or token", when `gh auth status` reports the keyring
  token invalid, when a PAT expires or is regenerated, or when setting up a new
  Mac. The token is piped keychain → gh directly and is never printed, pasted,
  or written to disk.
allowed-tools: "Read, Grep, Bash(gh auth status), Bash(git config --get-regexp credential)"
disallowed-tools: Write Edit
---

# gh-token-rotate — rotate the PAT without it ever touching disk or history

A GitHub PAT expires on a schedule, and the failure it produces names neither
the token nor the fix:

```
remote: Invalid username or token. Password authentication is not supported for Git operations.
fatal: Authentication failed for 'https://github.com/<owner>/<repo>.git/'
```

`gh auth status` is the one that says it plainly — `The token in keyring is
invalid.`

The token lives in the macOS keychain under the service name `gh-pat`, and is
piped from there straight into `gh`. It is never echoed, never pasted into a
prompt, and never written to a dotfile or an `export` line.

## Procedure

1. **Regenerate** at <https://github.com/settings/tokens>. Scopes that this
   setup actually uses: `repo`, `read:org`, `workflow`. `gh auth status` prints
   the granted scopes, so compare against that rather than guessing.

2. **Store it**, pasting at the prompt rather than on the command line — `-w`
   with no value prompts twice and echoes nothing, so the token never enters
   shell history:

   ```sh
   security add-generic-password -U -a "$USER" -s gh-pat -w
   ```

   `-U` updates the existing item in place, so rotation reuses one keychain
   entry instead of accumulating one per rotation.

3. **Load it into `gh`** — the pipe is the point: the secret goes keychain →
   `gh` without a stop in a variable, a file, or the scrollback:

   ```sh
   security find-generic-password -a "$USER" -s gh-pat -w \
     | gh auth login --hostname github.com --git-protocol https --with-token \
     && gh auth setup-git
   ```

4. **Verify**: `gh auth status` should report the account logged in via
   `(keyring)` and list the scopes. Then the failing `git push` just works —
   no new remote, no re-clone.

## Two things that silently defeat this

- **`GH_TOKEN` / `GITHUB_TOKEN` in the environment outrank the keyring.** `gh`
  uses the variable and never consults the stored credential, so a stale one
  exported in a shell profile produces the same auth failure immediately after
  a successful rotation. Check before diagnosing anything else.

- **Git must delegate to `gh` for the host.** `gh auth setup-git` writes this:

  ```
  credential.https://github.com.helper
  credential.https://github.com.helper  !/opt/homebrew/bin/gh auth git-credential
  ```

  The blank first line is deliberate — it clears the inherited global
  `credential.helper osxkeychain` for this host, so github.com resolves through
  `gh` alone. A stale osxkeychain entry for github.com is otherwise consulted
  first and re-supplies the dead token. Confirm with
  `git config --get-regexp credential`.

## For the agent running this skill

Guide the human through the commands; do not run steps 2 and 3 yourself.
`security find-generic-password -w` prints the token to stdout, which in an
agent session means printing it into the transcript. The human runs the pipe so
the secret stays between two processes.

`gh auth status` and `git config --get-regexp credential` are the diagnostics
worth running — both are safe and neither reveals the token. `gh auth status
--show-token` does reveal it; it is deliberately outside this skill's grant, so
it prompts.
