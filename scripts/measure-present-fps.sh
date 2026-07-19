#!/usr/bin/env bash
#
# measure-present-fps.sh — measure the REAL, on-screen frame rate of a
# react-native-nitro-godot app on the iOS Simulator.
#
# Why this exists
# ---------------
# The engine's own counter (Godot's Engine.get_frames_per_second, or any
# JS/RN fps readout) measures the RENDER / ITERATION rate — how often the Godot
# main loop runs. That is NOT the same as the PRESENT rate — how many frames
# CoreAnimation actually commits to the display. Because the render loop drives
# iteration() via a background thread that dispatch_syncs onto the main thread,
# a heavy or slow-to-present frame can starve CoreAnimation and drop the present
# rate far below the iteration counter (most visible on the iOS Simulator, whose
# software-emulated GL present is slow). We have observed a 40fps counter while
# only ~9fps actually reached the screen. Never trust the counter alone.
#
# How it works
# ------------
# `xcrun simctl io recordVideo` is variable-frame-rate: it encodes a frame ONLY
# when the composited screen actually changes. So the presentation timestamps
# (PTS) of the encoded frames are a log of "when did the display update", and
# the gaps between consecutive PTS are the true present cadence. We record a
# window (while you interact with the app), then report the distribution of
# those gaps — median/mean/p90/max interval and the implied fps.
#
# Usage
# -----
#   scripts/measure-present-fps.sh <simulator-udid> [seconds]
#       Record the given simulator for [seconds] (default 12) while you play,
#       then print the on-screen present rate.
#
#   scripts/measure-present-fps.sh --analyze <video.mp4> [t0 t1]
#       Analyze an existing recording, optionally within the [t0,t1] time window
#       (seconds). Useful to focus on a specific gameplay/animation segment.
#
# Tips
# ----
# * Interact with the app for the WHOLE window — a static screen has nothing to
#   present and reads ~0fps (correct, but uninformative).
# * For a reading independent of whether your scene happens to be animating, add
#   a node that changes every frame (rotate/translate a sprite in _process) so
#   every presented frame differs; then this measures the pure present rate.
# * On a real device, prefer Xcode Instruments (Core Animation FPS / Metal
#   System Trace) for hardware-accurate presented-frame timing.
#
# Requires: xcrun (Xcode), ffprobe (ffmpeg), python3.
set -euo pipefail

analyze() {
  local file="$1" t0="${2:-0}" t1="${3:-1e9}"
  command -v ffprobe >/dev/null || { echo "error: ffprobe (install ffmpeg) is required" >&2; exit 1; }
  ffprobe -v error -select_streams v:0 -show_entries frame=pts_time -of csv=p=0 "$file" 2>/dev/null \
    | awk -F, -v a="$t0" -v b="$t1" '{t=$1+0; if (t>=a && t<=b) print t}' \
    | python3 -c '
import sys, statistics
ts = [float(x) for x in sys.stdin.read().split()]
if len(ts) < 2:
    print("Not enough frame changes in the window — the screen barely updated.")
    print("Interact with the app during the recording, or widen the time window.")
    sys.exit(0)
ds = sorted((ts[i] - ts[i-1]) * 1000.0 for i in range(1, len(ts)))
n = len(ds); span = ts[-1] - ts[0]
pct = lambda q: ds[min(n-1, int(n*q))]
fluid = 100.0 * sum(1 for d in ds if d <= 45) / n
print(f"presented frames : {len(ts)} over {span:.1f}s  =>  {len(ts)/span:.1f} fps ON SCREEN")
print(f"update interval  : median {statistics.median(ds):.0f}ms  mean {statistics.mean(ds):.0f}ms"
      f"  p90 {pct(0.9):.0f}ms  max {ds[-1]:.0f}ms")
print(f"fluidity         : {fluid:.0f}% of updates within 45ms (>= 22fps)")
print()
print("  guide: median <=20ms ~ 50fps+   20-40ms ~ 25-50fps   >60ms = visible stutter")
'
}

if [ "${1:-}" = "--analyze" ]; then
  analyze "${2:?usage: --analyze <video.mp4> [t0 t1]}" "${3:-0}" "${4:-1e9}"
  exit 0
fi

UDID="${1:?usage: measure-present-fps.sh <simulator-udid> [seconds]   (or --analyze <video.mp4>)}"
SECS="${2:-12}"
OUT="$(mktemp -d)/present_fps_capture.mp4"

echo "Recording ${SECS}s from simulator ${UDID} — interact with the app now..."
xcrun simctl io "$UDID" recordVideo --codec h264 --force "$OUT" &
REC=$!
sleep "$SECS"
kill -INT "$REC" 2>/dev/null || true
wait "$REC" 2>/dev/null || true
sleep 1

echo
echo "=== Real on-screen (presented) frame rate ==="
analyze "$OUT"
echo
echo "video saved to: $OUT"
