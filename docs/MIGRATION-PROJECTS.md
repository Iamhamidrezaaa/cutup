# My Projects — Migration Plan

## Overview

Cutup adds a first-class **Projects** layer on top of existing `saved_outputs`. Each project groups transcript, summary, and SRT for one source (URL or upload). **Export history** is stored in `project_exports` when users render MP4.

## 1. Database changes

New file: `api/db/schema-projects.sql` (applied by `migrate.mjs`)

| Table | Purpose |
|-------|---------|
| `projects` | One row per user workspace item (title, URL, thumbnail, statuses, search text) |
| `project_exports` | Persistent export history (style, quality, job id, durations, file size) |
| `saved_outputs.project_id` | FK linking legacy outputs to projects |

### Status fields

- `transcript_status`: `none` \| `in_progress` \| `ready`
- `export_status`: `none` \| `in_progress` \| `exported` \| `failed`
- `lifecycle_status`: `active` \| `archived`

## 2. Deploy steps

```bash
# 1. Apply schema (includes projects tables)
node api/db/migrate.mjs

# 2. Backfill existing saved_outputs into projects (optional, recommended)
node api/db/migrate-projects-backfill.mjs

# 3. Deploy API + website
# server.js registers GET/POST /api/projects
```

## 3. API endpoints

| Method | Route | Action | Description |
|--------|-------|--------|-------------|
| GET | `/api/projects` | `list` | Paginated list + filters + search |
| GET | `/api/projects` | `get` | Project detail + outputs + exports |
| GET | `/api/projects` | `restore` | Payload for Continue Editing |
| GET | `/api/projects` | `latestExport` | Latest completed export for download |
| POST | `/api/projects` | `rename` | Rename project |
| POST | `/api/projects` | `duplicate` | Copy project + outputs |
| POST | `/api/projects` | `archive` | Archive / unarchive |
| POST | `/api/projects` | `delete` | Delete project (cascade outputs) |

### Automatic writes (no client change required)

- `POST /api/subscription?action=saveOutput` → upserts project + links `project_id`
- `POST /api/export-video` → inserts `project_exports` row
- Render queue completion → updates export + project `export_status`

## 4. UI

- Dashboard sidebar: **My Projects**
- Files: `website/dashboard-projects.js`, `website/dashboard-projects.css`
- Filters: All, In Progress, Exported, Archived
- Search: title, URL, transcript snippet (`search_text`)
- Pagination: 12 per page
- Actions: Open, Continue, Download, Rename, Duplicate, Delete, Archive

## 5. Rollback

If needed:

1. Remove nav section (dashboard still works with Saved outputs)
2. Stop writing projects (revert `saveOutputDb` / export hooks)
3. Tables can remain — they do not break existing flows

## 6. Known limitations (v1)

- MP4 download after server restart only works if render job files still exist (same as before); DB stores job id for retry within TTL (`PROJECT_EXPORT_TTL_DAYS`, default 14)
- Upload-only projects without `source_url` are grouped by `source_filename` when available
- Full server-side workspace snapshot (segments, preset versions) is planned via `projects.workspace_snapshot` — v1 restores from saved outputs + localStorage handoff

## 7. Verification checklist

- [ ] `node api/db/migrate.mjs` succeeds
- [ ] Transcribe while logged in → project appears in My Projects
- [ ] Export MP4 → export row + Exported filter
- [ ] Continue Editing → homepage loads with workspace localStorage
- [ ] Search finds transcript keywords
- [ ] Mobile: no horizontal overflow on project cards
