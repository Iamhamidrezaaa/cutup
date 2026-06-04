# Cutup GPU Render Worker (RunPod)

Standalone service that runs **only** the FFmpeg subtitle burn-in phase. ASS generation, translation, and timing stay on the main VPS.

## Requirements

- Node.js 18+
- FFmpeg with **h264_nvenc** (and optionally hevc_nvenc)
- Same repo clone as production (imports `api/video-render/*`)

## Install

```bash
cd workers/gpu-render
npm install
```

## Environment

| Variable | Description |
|----------|-------------|
| `GPU_RENDER_TOKEN` | Shared secret with main VPS (`GPU_RENDER_TOKEN`) |
| `GPU_RENDER_PUBLIC_URL` | Public URL of this worker (e.g. `https://your-runpod-host:8787`) — used in `outputUrl` |
| `GPU_RENDER_PORT` | Listen port (default `8787`) |
| `GPU_RENDER_WORK_DIR` | Temp workspace (default `/tmp/cutup-gpu-render`) |
| `VIDEO_RENDER_VIDEO_CODEC` | Default `h264_nvenc` on worker |
| `VIDEO_RENDER_NVENC_PRESET` | e.g. `p4` |
| `VIDEO_RENDER_NVENC_CQ` | e.g. `23` |

## Run

```bash
export GPU_RENDER_TOKEN='your-secret'
export GPU_RENDER_PUBLIC_URL='https://gpu.cutup.example:8787'
node server.js
```

## API

### `POST /render`

Headers: `Authorization: Bearer <GPU_RENDER_TOKEN>`

```json
{
  "jobId": "abc123",
  "videoUrl": "https://cutup.shop/api/export-video?action=gpu-artifact&...",
  "subtitleUrl": "https://cutup.shop/api/export-video?action=gpu-artifact&...",
  "preset": "mrbeast",
  "quality": "fast",
  "durationSec": 120,
  "trustPreviewTimings": false,
  "renderHints": { "hqSafeguards": false, "isVertical": true }
}
```

Response:

```json
{
  "success": true,
  "outputUrl": "https://gpu.../outputs/abc123",
  "renderMs": 45230
}
```

### `GET /health`

### `GET /outputs/:jobId`

Download rendered MP4 (Bearer token required).

## Main VPS

```env
GPU_RENDER_ENABLED=1
GPU_RENDER_URL=https://gpu.cutup.example:8787
GPU_RENDER_TOKEN=your-secret
GPU_RENDER_ARTIFACT_BASE_URL=https://cutup.shop
```

When `GPU_RENDER_ENABLED` is not `1`, exports use local FFmpeg (libx264) as before.
