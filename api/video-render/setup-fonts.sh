#!/bin/bash
# Install fonts required for RTL subtitle burn-in (Persian/Arabic via libass/ffmpeg).
set -euo pipefail

if command -v apt-get >/dev/null 2>&1; then
  apt-get update -qq
  apt-get install -y --no-install-recommends \
    fonts-noto \
    fonts-noto-core \
    fonts-noto-extra \
    fonts-noto-ui-core \
    fonts-freefont-ttf \
    fonts-dejavu-core
else
  echo "apt-get not found — install Noto Arabic fonts manually for RTL burn-in." >&2
  exit 1
fi

if command -v fc-cache >/dev/null 2>&1; then
  fc-cache -fv
fi

echo "=== Checking Arabic fonts ==="
fc-list :lang=ar | head -20
echo "=== Checking Persian fonts ==="
fc-list :lang=fa | head -20
