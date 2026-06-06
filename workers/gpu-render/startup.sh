#!/usr/bin/env bash
# Cutup GPU render worker bootstrap — recovers after fresh RunPod boot.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKER_ROOT="${GPU_RENDER_WORKER_ROOT:-$SCRIPT_DIR}"
cd "$WORKER_ROOT"

log() {
  echo "[startup] $*"
}

fail() {
  echo "[startup] ERROR: $*" >&2
  exit 1
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "required command not found: $1"
}

log "boot diagnostics"
log "time=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
log "host=$(hostname 2>/dev/null || echo unknown)"
log "worker_root=$WORKER_ROOT"
log "pwd=$(pwd)"

require_cmd node
require_cmd npm

NODE_VERSION="$(node --version 2>/dev/null || echo unknown)"
NPM_VERSION="$(npm --version 2>/dev/null || echo unknown)"
log "node=$NODE_VERSION npm=$NPM_VERSION"

if [[ ! -f "$WORKER_ROOT/package.json" ]]; then
  fail "package.json not found in $WORKER_ROOT"
fi

if [[ ! -f "$WORKER_ROOT/server.js" ]]; then
  fail "server.js not found in $WORKER_ROOT"
fi

API_RENDER_DIR="$(cd "$WORKER_ROOT/../../api/video-render" 2>/dev/null && pwd || true)"
if [[ -z "$API_RENDER_DIR" || ! -d "$API_RENDER_DIR" ]]; then
  fail "api/video-render not found relative to worker (expected $WORKER_ROOT/../../api/video-render)"
fi
log "api_render_dir=$API_RENDER_DIR"

if [[ ! -d "$WORKER_ROOT/node_modules" ]]; then
  log "node_modules missing — running npm install"
  npm install --omit=dev
  log "npm install complete"
else
  log "node_modules present — skipping npm install"
fi

require_cmd ffmpeg

FFMPEG_VERSION="$(ffmpeg -version 2>/dev/null | head -n 1 || echo unknown)"
log "ffmpeg=$FFMPEG_VERSION"

ENCODER_LIST="$(ffmpeg -hide_banner -encoders 2>/dev/null || true)"
SELECTED_ENCODER="libx264"

if grep -q ' h264_nvenc ' <<<"$ENCODER_LIST"; then
  SELECTED_ENCODER="h264_nvenc"
elif grep -q ' hevc_nvenc ' <<<"$ENCODER_LIST"; then
  SELECTED_ENCODER="hevc_nvenc"
else
  log "WARN: NVENC encoder not found — server will fall back to libx264"
fi

export NODE_ENV="${NODE_ENV:-production}"
export GPU_RENDER_WORKER="${GPU_RENDER_WORKER:-1}"
export GPU_RENDER_PORT="${GPU_RENDER_PORT:-8787}"
export VIDEO_RENDER_VIDEO_CODEC="${VIDEO_RENDER_VIDEO_CODEC:-$SELECTED_ENCODER}"

log "encoder=$SELECTED_ENCODER configured_codec=$VIDEO_RENDER_VIDEO_CODEC"
log "port=$GPU_RENDER_PORT work_dir=${GPU_RENDER_WORK_DIR:-/tmp/cutup-gpu-render}"
log "public_url=${GPU_RENDER_PUBLIC_URL:-<unset>}"
log "auto_stop=$([[ -n "${RUNPOD_API_KEY:-}" && -n "${RUNPOD_POD_ID:-}" ]] && echo enabled || echo disabled)"
log "starting server.js"

exec node server.js
