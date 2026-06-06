# Cutup GPU render worker — production image for RunPod
# Build from repository root:
#   docker build -f workers/gpu-render/Dockerfile --ignorefile workers/gpu-render/.dockerignore -t cutup-gpu-render:latest .
FROM node:22-bookworm-slim

LABEL org.opencontainers.image.title="cutup-gpu-render-worker" \
      org.opencontainers.image.description="FFmpeg NVENC subtitle burn-in worker for Cutup" \
      org.opencontainers.image.source="https://github.com/Iamhamidrezaaa/cutup"

RUN apt-get update \
  && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    ffmpeg \
    git \
    ca-certificates \
    curl \
    fontconfig \
    fonts-noto-core \
    fonts-noto \
    fonts-noto-extra \
    fonts-noto-ui-core \
    fonts-dejavu-core \
    fonts-freefont-ttf \
  && rm -rf /var/lib/apt/lists/* \
  && fc-cache -f \
  && ffmpeg -version \
  && node --version \
  && npm --version \
  && git --version

WORKDIR /app

# Shared burn pipeline (imports only from api/video-render)
COPY api/video-render ./api/video-render

# Worker dependencies (npm install at build time)
COPY workers/gpu-render/package.json ./workers/gpu-render/
WORKDIR /app/workers/gpu-render
RUN npm install --omit=dev

COPY workers/gpu-render/server.js ./server.js
COPY workers/gpu-render/auto-stop.js ./auto-stop.js
COPY workers/gpu-render/startup.sh ./startup.sh
RUN chmod +x ./startup.sh

ENV NODE_ENV=production \
    GPU_RENDER_WORKER=1 \
    GPU_RENDER_PORT=8787 \
    GPU_RENDER_WORK_DIR=/tmp/cutup-gpu-render \
    VIDEO_RENDER_VIDEO_CODEC=h264_nvenc \
    VIDEO_RENDER_NVENC_PRESET=p4 \
    VIDEO_RENDER_NVENC_CQ=23

EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8787/health').then((r)=>r.json()).then((j)=>process.exit(j.ok?0:1)).catch(()=>process.exit(1))"

CMD ["./startup.sh"]
