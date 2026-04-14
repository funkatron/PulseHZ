#!/usr/bin/env bash
# Generate small VP9 WebM lavfi demo clips for PulseHZ dev / autoload.
# Requires ffmpeg with libvpx-vp9. Run from repo root: bash scripts/generate-demo-clips.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${ROOT}/public/demo-clips"
mkdir -p "${OUT}"
rm -f "${OUT}"/*.webm

FF=(ffmpeg -y -nostdin)
VP9=( -c:v libvpx-vp9 -b:v 200k -an -t 3 )

run_lavfi() {
  local name="$1"
  shift
  "${FF[@]}" "$@" "${VP9[@]}" "${OUT}/${name}.webm"
}

run_complex() {
  local name="$1"
  shift
  "${FF[@]}" "$@" "${VP9[@]}" "${OUT}/${name}.webm"
}

echo "Writing demo clips to ${OUT}/ ..."

# Classic patterns (quoted lavfi strings avoid shell parsing issues with =)
run_lavfi "01-testsrc-landscape" -f lavfi -i 'testsrc=duration=3:size=1280x720:rate=30'
run_lavfi "02-testsrc-portrait" -f lavfi -i 'testsrc=duration=3:size=720x1280:rate=30'
run_lavfi "03-smptebars" -f lavfi -i 'smptebars=s=1280x720:r=30'
run_lavfi "04-smpte-hd" -f lavfi -i 'smptehdbars=s=1280x720:r=30'
run_lavfi "05-rgb-zones" -f lavfi -i 'rgbtestsrc=s=960x540:r=30'
run_lavfi "06-yuv-ramps" -f lavfi -i 'yuvtestsrc=s=1280x720:r=30'
run_lavfi "07-pal75" -f lavfi -i 'pal75bars=s=720x576:r=30'
run_lavfi "08-pal100" -f lavfi -i 'pal100bars=s=720x576:r=30'
run_lavfi "09-testsrc2" -f lavfi -i 'testsrc2=size=1280x720:rate=30'
# Short small Conway (full-res life explodes file size)
"${FF[@]}" -f lavfi -i 'life=size=320x180:rate=24' -t 2 -c:v libvpx-vp9 -b:v 140k -an "${OUT}/10-life.webm"
run_lavfi "11-mandelbrot" -f lavfi -i 'mandelbrot=s=640x360'
run_lavfi "12-sierpinski" -f lavfi -i 'sierpinski=s=640x480'
run_lavfi "13-mptestsrc" -f lavfi -i 'mptestsrc' -t 3
run_complex "14-avsync-beeps" -filter_complex 'avsynctest=size=1280x720:fr=30:duration=3[v]' -map '[v]'
run_complex "15-dual-testsrc-hstack" -filter_complex 'testsrc=size=640x360:rate=30[left];testsrc2=size=640x360:rate=30[right];[left][right]hstack=inputs=2[v]' -map '[v]'

OUT="${OUT}" python3 <<'PY'
import json
import os

out = os.environ["OUT"]
files = sorted(f for f in os.listdir(out) if f.endswith(".webm"))
manifest = os.path.join(out, "manifest.json")
with open(manifest, "w", encoding="utf-8") as f:
    json.dump({"clips": files}, f, indent=2)
print(f"Wrote {manifest} ({len(files)} clips)")
PY

echo "Done."
