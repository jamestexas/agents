---
name: break-glass
description: Emergency IAM elevation for oncall/debugging. Discovers GCP projects and guides through granting/revoking permissions.
---

# Break Glass - Emergency IAM Elevation

Help the user temporarily elevate their IAM permissions for oncall/emergency access to GCP projects.

## Arguments

$ARGUMENTS

## Workflow

### 1. Get current user
```bash
gcloud config get-value account
```

### 2. Discover and match project

If user provided a project hint (like "staging", "dev", "prod"), search for matching projects:

```bash
gcloud projects list --format="value(projectId)" --filter="projectId~HINT OR name~HINT"
```

Or list all accessible projects to help them choose:
```bash
gcloud projects list --format="table(projectId,name)" --limit=20
```

**Always confirm the exact project ID with the user before proceeding.**

### 3. Confirm prerequisites

Ask user to confirm:
- Have you notified the appropriate slack channel?
- Have you raised a ticket per your org's process?

### 4. Determine role

Parse from arguments or ask. Map shortcuts:
- `storage` -> `roles/storage.admin`
- `run` -> `roles/run.admin`
- `logs` -> `roles/logging.viewer`
- `pubsub` -> `roles/pubsub.admin`
- `bigquery` -> `roles/bigquery.admin`
- `owner` or nothing specified -> `roles/owner`

### 5. Grant access

```bash
gcloud projects add-iam-policy-binding PROJECT_ID \
  --member='user:USER_EMAIL' \
  --role='ROLE'
```

**If prompted about conditions when ADDING:**
- Choose **[2] None** (the options are: [1] EXPRESSION=..., [2] None, [3] Specify new)

### 6. Provide revoke command

Immediately after granting, give the exact revoke command:

```bash
gcloud projects remove-iam-policy-binding PROJECT_ID \
  --member='user:USER_EMAIL' \
  --role='ROLE'
```

**If prompted about conditions when REMOVING:**
- Choose **[1] None** (the options are: [1] None, [2] all conditions)
- You added without a condition, so remove without a condition

### 7. Remind about cleanup

Tell user to:
- Revoke permissions when done
- Close their ticket

## Example Usage

- `/break-glass staging` - find projects matching "staging", grant owner
- `/break-glass dev storage` - find projects matching "dev", grant storage.admin
- `/break-glass my-exact-project-id` - use exact project ID
- `/break-glass` - list projects and ask what they need
