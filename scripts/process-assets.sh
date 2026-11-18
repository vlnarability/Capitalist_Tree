#!/usr/bin/env bash
# P13-C asset processing — convert the downloaded CC0 / CC-BY art + audio to
# web-friendly formats and place them under apps/web/public/assets/.
#
# Sources (all verified free-use; see docs/credits.md):
#   - tree-fallback.png      CC0  airockstar     (OpenGameArt "A Tree")
#   - hero-background.jpg    CC0  bevouliin.com  (OpenGameArt "Tree in Mist")
#   - music-ambient.mp3      CC-BY Kevin MacLeod ("The Forest and the Trees")
#   - sfx-click.mp3          CC0  qubodup        (OpenGameArt button-click)
#   - sfx-purchase.mp3       CC0  wobbleboxx     (OpenGameArt SoundPack01 Upper01)
#   - sfx-notification.mp3   CC0  wobbleboxx     (OpenGameArt SoundPack01 Rise01)
#
# MP3 is used for audio (universal browser support incl. Safari/iOS). The music
# is down-converted to 128 kbps to keep the web payload small (~1.5 MB).
set -euo pipefail

REPO=/home/z/my-project/capitalist-tree
DL=/tmp/asset-dl
ASSETS="$REPO/apps/web/public/assets"
mkdir -p "$ASSETS/audio" "$ASSETS/images"

# --- Images (CC0) — copy as-is ---
cp "$DL/tree/treetest_0.png"        "$ASSETS/images/tree-fallback.png"
cp "$DL/background/mist-tree-bg.jpg" "$ASSETS/images/hero-background.jpg"

# --- SFX (CC0) — convert source WAV/AIF → MP3 ---
ffmpeg -y -hide_banner -loglevel error \
  -i "$DL/sfx-click/extracted/qubodup-click/qubodup-click1.wav" \
  -c:a libmp3lame -q:a 4 "$ASSETS/audio/sfx-click.mp3"

ffmpeg -y -hide_banner -loglevel error \
  -i "$DL/sfx-coin/extracted/Upper01.aif" \
  -c:a libmp3lame -q:a 4 "$ASSETS/audio/sfx-purchase.mp3"

ffmpeg -y -hide_banner -loglevel error \
  -i "$DL/sfx-coin/extracted/Rise01.aif" \
  -c:a libmp3lame -q:a 4 "$ASSETS/audio/sfx-notification.mp3"

# --- Music (CC-BY Kevin MacLeod) — down-convert to 128 kbps MP3 ---
ffmpeg -y -hide_banner -loglevel error \
  -i "$DL/music/forest-and-the-trees.mp3" \
  -c:a libmp3lame -b:a 128k "$ASSETS/audio/music-ambient.mp3"

echo "=== placed assets ==="
ls -la "$ASSETS/audio/" "$ASSETS/images/"
echo "=== file types ==="
file "$ASSETS/audio/"*.mp3 "$ASSETS/images/"*
