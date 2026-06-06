#!/usr/bin/env bash
# Cutup GPU render worker bootstrap — recovers after fresh RunPod boot.
# Supports:
#   - Docker image (/app/workers/gpu-render, node/ffmpeg preinstalled)
#   - Volume git clone (/workspace/cutup/workers/gpu-render, bootstraps node/ffmpeg to volume)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKER_ROOT="${GPU_RENDER_WORKER_ROOT:-$SCRIPT_DIR}"
NODE_INSTALL_DIR="${GPU_RENDER_NODE_DIR:-/workspace/.cutup-node}"
NODE_VERSION="${GPU_RENDER_NODE_VERSION:-22.14.0}"

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

node_platform() {
  local arch
  arch="$(uname -m)"
  case "$arch" in
    x86_64|amd64) echo "linux-x64" ;;
    aarch64|arm64) echo "linux-arm64" ;;
    *) fail "unsupported architecture for Node bootstrap: $arch" ;;
  esac
}

ensure_node_on_path() {
  if [[ -x "$NODE_INSTALL_DIR/bin/node" ]]; then
    export PATH="$NODE_INSTALL_DIR/bin:$PATH"
  fi
}

install_node_to_volume() {
  local platform tarball url tmp
  platform="$(node_platform)"
  tarball="node-v${NODE_VERSION}-${platform}.tar.xz"
  url="https://nodejs.org/dist/v${NODE_VERSION}/${tarball}"

  log "node missing — installing Node.js v${NODE_VERSION} to $NODE_INSTALL_DIR"
  mkdir -p "$NODE_INSTALL_DIR"

  if command -v curl >/dev/null 2>&1; then
    tmp="$(mktemp)"
    curl -fsSL "$url" -o "$tmp"
    tar -xJf "$tmp" -C "$NODE_INSTALL_DIR" --strip-components=1
    rm -f "$tmp"
  elif command -v wget >/dev/null 2>&1; then
    tmp="$(mktemp)"
    wget -qO "$tmp" "$url"
    tar -xJf "$tmp" -C "$NODE_INSTALL_DIR" --strip-components=1
    rm -f "$tmp"
  else
    fail "curl or wget required to bootstrap Node.js"
  fi

  export PATH="$NODE_INSTALL_DIR/bin:$PATH"
  log "node bootstrap complete: $(node --version) npm=$(npm --version)"
}

ensure_node() {
  ensure_node_on_path
  if command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1; then
    return
  fi
  install_node_to_volume
  require_cmd node
  require_cmd npm
}

install_ffmpeg_if_missing() {
  if command -v ffmpeg >/dev/null 2>&1; then
    return
  fi

  log "ffmpeg missing — installing system packages"
  export DEBIAN_FRONTEND=noninteractive
  if command -v apt-get >/dev/null 2>&1; then
    apt-get update -qq
    apt-get install -y --no-install-recommends \
      ffmpeg \
      fontconfig \
      fonts-noto-core \
      fonts-dejavu-core \
      ca-certificates \
      curl
    fc-cache -f >/dev/null 2>&1 || true
  else
    fail "ffmpeg not found and apt-get unavailable — use the cutup-gpu-render Docker image or install ffmpeg manually"
  fi
}

sync_repo_if_requested() {
  if [[ "${GPU_RENDER_GIT_PULL:-0}" != "1" ]]; then
    return
  fi

  local repo_root
  repo_root="$(cd "$WORKER_ROOT/../.." && pwd)"
  if [[ ! -d "$repo_root/.git" ]]; then
    log "WARN: GPU_RENDER_GIT_PULL=1 but $repo_root is not a git repo"
    return
  fi

  log "git pull in $repo_root"
  git -C "$repo_root" pull --ff-only origin main
}

log "boot diagnostics"
log "time=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
log "host=$(hostname 2>/dev/null || echo unknown)"
log "worker_root=$WORKER_ROOT"
log "pwd=$(pwd)"
log "node_install_dir=$NODE_INSTALL_DIR"

sync_repo_if_requested

if [[ ! -f "$WORKER_ROOT/package.json" ]]; then
  fail "package.json not found in $WORKER_ROOT — run: cd /workspace/cutup && git pull origin main"
fi

if [[ ! -f "$WORKER_ROOT/server.js" ]]; then
  fail "server.js not found in $WORKER_ROOT"
fi

if [[ ! -f "$WORKER_ROOT/startup.sh" ]]; then
  fail "startup.sh not found in $WORKER_ROOT — run: cd /workspace/cutup && git pull origin main"
fi

API_RENDER_DIR="$(cd "$WORKER_ROOT/../../api/video-render" 2>/dev/null && pwd || true)"
if [[ -z "$API_RENDER_DIR" || ! -d "$API_RENDER_DIR" ]]; then
  fail "api/video-render not found (expected $WORKER_ROOT/../../api/video-render) — clone full repo on /workspace/cutup"
fi
log "api_render_dir=$API_RENDER_DIR"

ensure_node
log "node=$(node --version) npm=$(npm --version)"

if [[ ! -d "$WORKER_ROOT/node_modules" ]]; then
  log "node_modules missing — running npm install"
  npm install --omit=dev
  log "npm install complete"
else
  log "node_modules present — skipping npm install"
fi

install_ffmpeg_if_missing
require_cmd ffmpeg

FFMPEG_VERSION="$(ffmpeg -version 2>/dev/null | head -n 1 || echo unknown)"
log "ffmpeg=$FFMPEG_VERSION"

ENCODER_LIST="$(ffmpeg -hide_banner -encoders 2>/dev/null || true)"
SELECTED_ENCODER="libx264"

if grep -qE '\bh264_nvenc\b' <<<"$ENCODER_LIST"; then
  SELECTED_ENCODER="h264_nvenc"
elif grep -qE '\bhevc_nvenc\b' <<<"$ENCODER_LIST"; then
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
