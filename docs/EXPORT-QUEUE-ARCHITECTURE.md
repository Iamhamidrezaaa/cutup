# Export Queue System — Architecture

## Goal

Users always know export state: queue position, real pipeline stages, and history — **no fake progress**.

## Architecture

```
┌─────────────┐     POST /api/export-video      ┌──────────────────┐
│   Browser   │ ──────────────────────────────► │  export-video.js │
│ video-export│                                 │  createRenderJob │
└──────┬──────┘                                 └────────┬─────────┘
       │                                                   │
       │  GET /api/export-video?action=stream (SSE)        ▼
       │ ◄───────────────────────────────────── ┌──────────────────┐
       │   event: status { progress, queue… }   │  render-queue.js │
       │                                        │  in-memory queue │
       └──────────────────────────────────────► └────────┬─────────┘
                                                         │
                                                         │ publishExportJobUpdate
                                                         ▼
                                                ┌──────────────────┐
                                                │ export-events.js │
                                                │  per-job channels│
                                                └──────────────────┘
```

### Why SSE (not WebSocket)

- Export updates are **server → client** only
- Works with existing Express `app.all('/api/export-video')` — no `upgrade` handler
- EventSource reconnects; fallback to one-shot `action=status` on error
- WebSocket reserved for admin audit feed (`audit-ws-setup.js`)

### Real progress sources

| Stage | Backend trigger |
|-------|-----------------|
| Queue | `waitQueue` position + `estimateQueueWaitSecFor` |
| Preparing export | `setStage('preparing')` — download/probe source |
| Generating captions | `setStage('generating_captions')` |
| Building subtitle layout | ASS generation `setStage('subtitle_layout')` |
| Rendering video | FFmpeg `onBurnProgress` → `bumpProgress` (real %) |
| Finalizing output | `setStage('finalizing')` |
| Ready to download | `setStage('ready_to_download')` progress 100 |

**Removed:** `startRenderHeartbeat` synthetic 52–88% animation.

## Queue implementation

- Global FIFO `waitQueue` + `MAX_CONCURRENT` workers (env `VIDEO_RENDER_CONCURRENCY`, default 1)
- `getQueuePositionForJob(jobId)` → position (1-based), jobsAhead
- On `pumpQueue` / new job: `notifyAllQueuedJobs()` pushes SSE updates to waiting clients
- ETA: rolling average render time × batches ahead (`averageRenderSec`)

## API

| Endpoint | Purpose |
|----------|---------|
| `POST /api/export-video` | Start job (unchanged) |
| `GET ?action=status` | One-shot status (fallback) |
| `GET ?action=stream` | **SSE** live status |

SSE payload includes: `queuePosition`, `jobsAhead`, `estimatedWaitSec`, `estimatedCompletionAt`, `pipelineStep`, `pipelineStages`, `progress`, `stage`, `pipelineLabel`.

## Frontend (`video-export.js`)

- **Queue panel:** position, jobs ahead, wait, ETA clock
- **Pipeline steps:** 6 labeled stages with done/active state
- **Progress bar:** jumps to server `progress` only (no RAF smoothing)
- **History panel:** session localStorage — completed / processing / failed + Retry
- **Mobile:** single-column queue stats, no horizontal overflow

## Scalability considerations

| Topic | Current | Scale path |
|-------|---------|------------|
| Queue storage | In-process `Map` | Redis queue + worker pool |
| SSE subscribers | In-process EventEmitter | Redis pub/sub per jobId |
| Multi-instance | Single Node holds queue | Sticky sessions or shared Redis |
| Job TTL | `VIDEO_RENDER_JOB_TTL_MS` | S3 output + DB `project_exports` (already started) |
| Concurrency | 1–3 FFmpeg | Horizontal workers + GPU dispatch |

### Production checklist

1. Set `VIDEO_RENDER_CONCURRENCY` from CPU/GPU capacity
2. Run single export worker per machine OR shared Redis queue
3. Put reverse proxy timeout > longest HQ render for SSE (`proxy_read_timeout`)
4. Disable buffering: `X-Accel-Buffering: no` (nginx)

## Files changed

- `api/video-render/export-events.js` — SSE pub/sub
- `api/video-render/export-pipeline.js` — stage labels
- `api/video-render/render-queue.js` — real events, queue fields, no fake heartbeat
- `api/export-video.js` — `action=stream` SSE handler
- `website/video-export/video-export.js` — SSE client, queue UI, history
- `website/video-export/video-export.css` — responsive panels
