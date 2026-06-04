# Cutup GPU Render Worker (RunPod)

Dedicated **FFmpeg burn-in** service. Subtitle generation, translation, timing, ASS layout, RTL, and phrase logic remain on the main VPS.

## Layout

```
workers/gpu-render/
├── package.json
├── server.js
├── README.md
└── .gitignore
```

The worker imports shared burn code from `api/video-render/burn-export-phase.js` (same pipeline as VPS, encoder only differs).

## Requirements

- Node.js 18+
- FFmpeg with **h264_nvenc** (falls back to **libx264** if NVENC is missing)
- Full Cutup repo clone (imports `../../api/video-render/*`)

## Install & run

```bash
cd workers/gpu-render
npm install

export GPU_RENDER_TOKEN='your-shared-secret'
export GPU_RENDER_PUBLIC_URL='https://your-runpod-host:8787'

npm start
```

## Environment

| Variable | Description |
|----------|-------------|
| `GPU_RENDER_TOKEN` | Bearer secret (required) |
| `GPU_RENDER_PUBLIC_URL` | Public base URL for `outputUrl` in responses |
| `GPU_RENDER_PORT` | Listen port (default `8787`) |
| `GPU_RENDER_WORK_DIR` | Temp dir (default `/tmp/cutup-gpu-render`) |
| `VIDEO_RENDER_VIDEO_CODEC` | Force `h264_nvenc`, `hevc_nvenc`, or `libx264` |
| `VIDEO_RENDER_NVENC_PRESET` | NVENC preset (default `p4`) |
| `VIDEO_RENDER_NVENC_CQ` | NVENC CQ (default `23`) |

## API

### `GET /health`

```json
{ "ok": true }
```

### `GET /health/ready`

```json
{ "ok": true, "ffmpeg": true, "encoder": "h264_nvenc" }
```

### `POST /render`

Header: `Authorization: Bearer <GPU_RENDER_TOKEN>`

```json
{
  "jobId": "abc123",
  "videoUrl": "https://cutup.shop/api/export-video?action=gpu-artifact&jobId=abc123&kind=video&token=...",
  "subtitleUrl": "https://cutup.shop/api/export-video?action=gpu-artifact&jobId=abc123&kind=ass&token=...",
  "preset": "mrbeast",
  "quality": "fast"
}
```

Response:

```json
{
  "success": true,
  "jobId": "abc123",
  "outputUrl": "https://your-runpod-host:8787/outputs/abc123",
  "renderMs": 45230,
  "preset": "mrbeast",
  "encoder": "h264_nvenc"
}
```

### `GET /outputs/:jobId`

Download rendered MP4 (Bearer token required).

## Main VPS integration

```env
GPU_RENDER_ENABLED=1
GPU_RENDER_URL=https://your-runpod-host:8787
GPU_RENDER_TOKEN=your-shared-secret
GPU_RENDER_ARTIFACT_BASE_URL=https://cutup.shop
```

When `GPU_RENDER_ENABLED=0`, the VPS uses local FFmpeg (`libx264`) unchanged.

Integration modules (VPS):

- `api/video-render/gpu-render-client.js`
- `api/video-render/gpu-render-artifacts.js`
- `api/video-render/burn-export-phase.js`
- `api/video-render/video-encoder.js`
- `api/video-render/render-queue.js` (dispatch when enabled)
- `api/export-video.js` (`action=gpu-artifact` for worker downloads)
