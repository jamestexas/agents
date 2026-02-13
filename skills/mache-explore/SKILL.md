---
name: mache-explore
description: Mount a mache FUSE filesystem inside the project directory so agents can explore structured data without per-file permission prompts.
---

# Mache Explore - FUSE Mount for Agent Access

Mount a mache data source inside the project directory so all file reads are auto-approved by Claude Code's permission model.

**Important:** This is a skill (prompt expansion), not an agent. The mount is ephemeral — it lives only as long as the mache process runs. If the Claude Code session ends without unmounting, the FUSE process becomes orphaned and must be cleaned up manually (see Cleanup section). The user will need to approve Bash tool calls for mount/unmount operations.

## Arguments

$ARGUMENTS

Arguments format: `<schema> <data-source> [mount-name]`

- **schema**: Path to a mache schema JSON file (e.g., `examples/go-schema.json`)
- **data-source**: Path to data (directory, `.db` file, etc.)
- **mount-name**: Optional name for the mount point (default: `default`)

Examples:
```
/mache-explore examples/go-schema.json .
/mache-explore examples/nvd-schema.json ~/.agentic-research/venturi/nvd/results/results.db nvd
```

## Workflow

### Phase 1: Parse Arguments

Extract from `$ARGUMENTS`:
- `SCHEMA` = first argument (required)
- `DATA_SOURCE` = second argument (required)
- `MOUNT_NAME` = third argument, or `default` if not provided

If fewer than 2 arguments, ask the user:
- "What schema file should I use?"
- "What data source should I mount?"

### Phase 2: Validate Inputs

**2.1 Check mache is available**
```bash
which mache || echo "ERROR: mache not found in PATH"
```

If not found, tell the user:
- "mache is not installed or not in PATH. Install it or provide the full path."

**2.2 Validate schema exists**
```bash
ls -la "$SCHEMA"
```

**2.3 Validate data source exists**
```bash
ls -la "$DATA_SOURCE"
```

If either is missing, report the error and stop.

### Phase 3: Mount

**3.1 Create mount point**
```bash
mkdir -p .mache-mount/$MOUNT_NAME
```

**3.2 Ensure .gitignore excludes mount directory**

Check if `.mache-mount/` is already in `.gitignore`. If not, append it:
```bash
grep -q '^\.mache-mount/' .gitignore 2>/dev/null || echo '.mache-mount/' >> .gitignore
```

**3.3 Self-mount guard**

If the data source resolves to the current working directory (`.`, `./`, or the absolute CWD path), check whether `.mache-mount/` is inside it. Mache's directory walker skips dot-prefixed directories, so `.mache-mount/` will not be indexed. However, warn the user:

```
⚠️  Data source is the current directory. The mount at .mache-mount/ is safe
because mache skips dot-prefixed directories during walks. Proceeding.
```

If you cannot confirm that mache skips dot-prefixed dirs (e.g., different schema or version), refuse and suggest mounting with an absolute path to the data source instead.

**3.4 Start mache in background and persist PID**

Claude Code's Bash tool does not preserve shell state between calls, so `$!` PID tracking is unreliable. Write the PID to a file instead:

```bash
mache --schema "$SCHEMA" --data "$DATA_SOURCE" .mache-mount/$MOUNT_NAME &
echo $! > .mache-mount/.pid
echo "mache PID: $(cat .mache-mount/.pid)"
```

**3.5 Wait for mount readiness**

Poll until the mount is live (up to 10 seconds):
```bash
for i in $(seq 1 10); do
  if ls .mache-mount/$MOUNT_NAME/ 2>/dev/null | head -1; then
    echo "Mount ready"
    break
  fi
  sleep 1
done
```

If mount is not ready after 10 seconds, report failure, kill the process via `.mache-mount/.pid`, and clean up.

### Phase 4: Brief the Agent

Once mounted, explore the top-level structure:
```bash
ls -la .mache-mount/$MOUNT_NAME/
```

Report to the user:
- Mount point: `.mache-mount/$MOUNT_NAME/`
- Top-level contents
- Schema used
- Data source

Then say: **"Data is mounted at `.mache-mount/$MOUNT_NAME/`. You can use `ls`, `cat`, `Read`, `Grep` freely — no permission prompts needed."**

### Phase 5: Explore (Interactive)

The agent should now freely explore the mount using standard file tools:
- `ls` to browse directories
- `Read` to view files
- `Grep` to search content
- `Glob` to find files by pattern

All of these will be auto-approved since `.mache-mount/` is inside the project directory.

## Unmounting

When the user says `/mache-unmount` or the session is ending, clean up:

```bash
# Kill mache process via PID file
if [ -f .mache-mount/.pid ]; then
  kill "$(cat .mache-mount/.pid)" 2>/dev/null
  rm .mache-mount/.pid
fi

# Try graceful unmount
umount .mache-mount/$MOUNT_NAME 2>/dev/null || diskutil unmount .mache-mount/$MOUNT_NAME 2>/dev/null || fusermount -u .mache-mount/$MOUNT_NAME 2>/dev/null

# Verify unmount
ls .mache-mount/$MOUNT_NAME/ 2>/dev/null && echo "WARNING: mount still active" || echo "Unmounted successfully"
```

If the graceful unmount fails:
```bash
# Force unmount (macOS)
umount -f .mache-mount/$MOUNT_NAME
```

## Orphan Cleanup

If a session ended without unmounting, the FUSE process is orphaned. To clean up manually:

```bash
# Find and kill orphaned mache processes
pkill -f "mache.*\.mache-mount"

# Or use the PID file if it exists
kill "$(cat .mache-mount/.pid)" 2>/dev/null && rm .mache-mount/.pid

# Force unmount any lingering mounts
umount -f .mache-mount/* 2>/dev/null

# Remove the mount directory
rm -rf .mache-mount/
```

If starting a new session and `.mache-mount/.pid` exists, check whether the process is still running before mounting:
```bash
if [ -f .mache-mount/.pid ] && kill -0 "$(cat .mache-mount/.pid)" 2>/dev/null; then
  echo "Existing mache process found (PID $(cat .mache-mount/.pid)). Unmount first or reuse."
else
  rm -f .mache-mount/.pid
  echo "No active mount. Safe to proceed."
fi
```

## Error Handling

**mache not found:**
- Check PATH, suggest installation steps

**Schema file not found:**
- List available schemas if in a mache repo: `ls examples/*.json 2>/dev/null`

**Data source not found:**
- Confirm path, suggest checking with `ls`

**Mount fails to become ready:**
- Check mache stderr output
- Verify fuse-t is installed (macOS): `ls /Library/Frameworks/fuse_t.framework`
- Verify FUSE3 is installed (Linux): `which fusermount3`
- Report error and clean up mount point

**Mount point already in use:**
- Check if already mounted: `mount | grep .mache-mount/$MOUNT_NAME`
- Offer to unmount and remount, or use a different name

## Notes

- Mount lives inside project dir = auto-approved by Claude Code read permissions. Mount/unmount Bash calls still require user approval.
- `.gitignore` keeps mount artifacts out of version control
- Multiple mounts supported via different `mount-name` values
- On macOS, uses fuse-t (not macFUSE); on Linux, uses FUSE3
- PID file at `.mache-mount/.pid` tracks the background process across Bash calls
- Self-mount (data source = `.`) is safe because mache skips dot-prefixed directories during walks, so `.mache-mount/` is never indexed
