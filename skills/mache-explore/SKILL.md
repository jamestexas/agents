---
name: mache-explore
description: Mount a mache FUSE filesystem inside the project directory so agents can explore structured data without per-file permission prompts.
---

# Mache Explore - FUSE Mount for Agent Access

Mount a mache data source inside the project directory so all file reads are auto-approved by Claude Code's permission model.

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

**3.3 Start mache in background**
```bash
mache --schema "$SCHEMA" --data "$DATA_SOURCE" .mache-mount/$MOUNT_NAME &
MACHE_PID=$!
echo "mache PID: $MACHE_PID"
```

**3.4 Wait for mount readiness**

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

If mount is not ready after 10 seconds, report failure and clean up.

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
# Try graceful unmount first
umount .mache-mount/$MOUNT_NAME 2>/dev/null || diskutil unmount .mache-mount/$MOUNT_NAME 2>/dev/null || fusermount -u .mache-mount/$MOUNT_NAME 2>/dev/null

# Verify unmount
ls .mache-mount/$MOUNT_NAME/ 2>/dev/null && echo "WARNING: mount still active" || echo "Unmounted successfully"
```

If the graceful unmount fails:
```bash
# Force unmount (macOS)
umount -f .mache-mount/$MOUNT_NAME
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
- Verify FUSE/macFUSE is installed: `kextstat | grep fuse` or `ls /Library/Filesystems/macfuse.fs`
- Report error and clean up mount point

**Mount point already in use:**
- Check if already mounted: `mount | grep .mache-mount/$MOUNT_NAME`
- Offer to unmount and remount, or use a different name

## Notes

- Mount lives inside project dir = auto-approved by Claude Code permissions
- `.gitignore` keeps mount artifacts out of version control
- Multiple mounts supported via different `mount-name` values
- On macOS, uses macFUSE; on Linux, uses FUSE3
- If data source is `.` (current dir), mache may index its own mount point — this is a known edge case the user is aware of
