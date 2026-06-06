# Cutup GPU Render Worker (RunPod)

Dedicated **FFmpeg burn-in** service. Subtitle generation, translation, timing, ASS layout, RTL, and phrase logic remain on the main VPS.

## Layout

```
workers/gpu-render/
├── Dockerfile
├── .dockerignore
├── auto-stop.js
├── package.json
├── server.js
├── startup.sh
└── README.md
```

Imports shared burn code from `api/video-render/` (copied into the Docker image at build time).

---

## Docker image (production)

### Prerequisites

- Docker 23+ (for `--ignorefile`) or copy `.dockerignore` to repo root before build
- Build context: **repository root** (not `workers/gpu-render` alone)

### Build

```bash
# From repository root
cd /path/to/cutup

docker build \
  -f workers/gpu-render/Dockerfile \
  --ignorefile workers/gpu-render/.dockerignore \
  -t cutup-gpu-render:latest \
  .
```

Verify image:

```bash
docker run --rm cutup-gpu-render:latest node --version    # v22.x
docker run --rm cutup-gpu-render:latest ffmpeg -version
docker run --rm cutup-gpu-render:latest git --version
```

### Run locally (test)

```bash
docker run --rm -p 8787:8787 \
  -e GPU_RENDER_TOKEN=dev-secret-change-me \
  -e GPU_RENDER_PUBLIC_URL=http://127.0.0.1:8787 \
  cutup-gpu-render:latest
```

```bash
curl http://127.0.0.1:8787/health
# {"ok":true}
```

### Push to registry

```bash
# Docker Hub example
docker tag cutup-gpu-render:latest YOUR_DOCKER_USER/cutup-gpu-render:latest
docker login
docker push YOUR_DOCKER_USER/cutup-gpu-render:latest

# GitHub Container Registry example
docker tag cutup-gpu-render:latest ghcr.io/YOUR_ORG/cutup-gpu-render:latest
docker push ghcr.io/YOUR_ORG/cutup-gpu-render:latest
```

---

## RunPod deployment

### 1. Build and push image

Build on your machine or CI, push to Docker Hub / GHCR (see above).

### 2. Create RunPod GPU Pod template

| Setting | Value |
|---------|--------|
| **Container image** | `YOUR_DOCKER_USER/cutup-gpu-render:latest` |
| **GPU** | NVIDIA RTX A4000 (or any GPU with NVENC) |
| **Container disk** | ≥ 20 GB |
| **Volume** | Optional — `/tmp` is used for render jobs |
| **Expose HTTP ports** | `8787` |
| **Start command** | See below |

**RunPod start command (Docker image):**

```bash
bash /app/workers/gpu-render/startup.sh
```

Or leave empty — the image `CMD` runs `startup.sh` automatically.

**RunPod start command (git clone on volume — recommended):**

```bash
cd /workspace/cutup && git pull origin main && cd workers/gpu-render && GPU_RENDER_GIT_PULL=0 bash startup.sh
```

Or set **Start command** in the RunPod template to the one-liner above.

`startup.sh` on volume boot:

1. Optionally `git pull` when `GPU_RENDER_GIT_PULL=1`
2. Installs **Node.js 22** to `/workspace/.cutup-node` if `node` is missing (persists on volume)
3. Runs `npm install` if `node_modules` is missing
4. Installs **ffmpeg** via `apt` if missing
5. Probes NVENC, logs diagnostics, starts `server.js`

> **Why `node: command not found`?** The Dockerfile only applies when you deploy the **Docker image**. A generic RunPod template with a git clone on `/workspace` does not include Node — `startup.sh` bootstraps it to the volume.

**Verify files after `git pull`:**

```bash
cd /workspace/cutup
git rev-parse HEAD
git ls-tree -r HEAD --name-only | grep workers/gpu-render/startup.sh
ls -la workers/gpu-render/
```

### 3. Environment variables (RunPod pod / template)

| Variable | Required | Example |
|----------|----------|---------|
| `GPU_RENDER_TOKEN` | Yes | `long-random-shared-secret` |
| `GPU_RENDER_PUBLIC_URL` | Yes | `https://YOUR_POD_ID-8787.proxy.runpod.net` |
| `GPU_RENDER_PORT` | No | `8787` (default) |
| `GPU_RENDER_WORK_DIR` | No | `/tmp/cutup-gpu-render` |
| `VIDEO_RENDER_VIDEO_CODEC` | No | `h264_nvenc` (auto-fallback to `libx264`) |
| `RUNPOD_API_KEY` | For auto-stop | RunPod REST API key (also set on VPS for auto-start) |
| `RUNPOD_POD_ID` | For auto-stop | This pod’s ID (also set on VPS for auto-start) |
| `GPU_RENDER_NODE_DIR` | No | Node install on volume (default `/workspace/.cutup-node`) |
| `GPU_RENDER_NODE_VERSION` | No | Node version to bootstrap (default `22.14.0`) |
| `GPU_RENDER_GIT_PULL` | No | Set `1` to `git pull origin main` before boot |

Use the **same** `GPU_RENDER_TOKEN` on the main VPS (`GPU_RENDER_URL` points to this pod).

### Auto-stop (idle shutdown)

When both `RUNPOD_API_KEY` and `RUNPOD_POD_ID` are set, the worker:

1. Tracks active `/render` jobs and last activity time.
2. Every 30s, if **no jobs are running** and **no new jobs for 5 minutes**, calls `POST https://rest.runpod.io/v1/pods/{podId}/stop`.
3. Logs: `[auto-stop] idle detected`, `[auto-stop] stopping pod`, `[auto-stop] stop successful`.

Set `RUNPOD_POD_ID` to the pod’s own ID (RunPod console → Pod details). Without these vars, auto-stop is disabled.

### 4. Main VPS (cutup.shop)

```env
GPU_RENDER_ENABLED=1
GPU_RENDER_URL=https://YOUR_POD_PROXY:8787
GPU_RENDER_TOKEN=long-random-shared-secret
GPU_RENDER_ARTIFACT_BASE_URL=https://cutup.shop
RUNPOD_API_KEY=rpa_xxxxxxxx
RUNPOD_POD_ID=your-pod-id
```

**Auto-start (VPS):** Before each GPU render, the VPS checks `GET /health`. If the worker is offline, it calls `POST /pods/{podId}/start`, polls `/health` every 5s (5 min timeout), then dispatches the job. Logs: `[gpu-start] pod offline`, `[gpu-start] starting pod`, `[gpu-start] waiting for worker`, `[gpu-start] worker ready`.

### 5. Health check after pod starts

```bash
curl https://YOUR_POD_PROXY:8787/health
# {"ok":true}

curl https://YOUR_POD_PROXY:8787/health/ready
# {"ok":true,"ffmpeg":true,"encoder":"h264_nvenc"}
```

### 6. Updating the worker

Rebuild image → push → restart RunPod pod (or set template to `:latest` and restart).

No manual `npm install`, `apt install ffmpeg`, or `git clone` on the pod — everything is in the image.

---

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

---

## Manual install (without Docker)

```bash
cd workers/gpu-render
npm install
export GPU_RENDER_TOKEN='your-shared-secret'
export GPU_RENDER_PUBLIC_URL='https://your-runpod-host:8787'
npm start
```

Requires full repo clone (imports `../../api/video-render/*`).
