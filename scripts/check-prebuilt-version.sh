#!/usr/bin/env bash
# Prepack gate: refuse to publish if the binaries in prebuilt/ were not built
# from the Godot version pinned in engine_build/GODOT_VERSION.
#
# Why: prebuilt/ is gitignored but shipped to npm via the package.json "files"
# whitelist — npm packs whatever is on the publisher's disk, with no diff or
# review. This gate is what makes "pin says X, binaries are Y" fail loudly
# instead of shipping silently (as happened when 0.1.0–0.1.5 shipped 4.7-dev
# binaries while the docs said 4.7-stable).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PIN_FILE="$ROOT/engine_build/GODOT_VERSION"

die() { echo "✗ check-prebuilt-version: $*" >&2; exit 1; }

[[ -f "$PIN_FILE" ]] || die "missing $PIN_FILE"

# First non-comment line, first field: e.g. "4.7-stable"
PIN=$(grep -v '^#' "$PIN_FILE" | grep -v '^$' | head -1 | awk '{print $1}')
[[ -n "$PIN" ]] || die "could not parse a version from $PIN_FILE"

# Godot embeds the version with dots, not a dash: 4.7-stable -> 4.7.stable
EXPECTED="${PIN//-/.}"

BINARIES=(
  "$ROOT/prebuilt/android/arm64-v8a/libgodot_android.so"
  "$ROOT/prebuilt/ios/libgodot.xcframework/ios-arm64/libgodot.ios.template_release.arm64.a"
)

for BIN in "${BINARIES[@]}"; do
  [[ -f "$BIN" ]] || die "missing binary: $BIN (run engine_build/build_godot.sh)"
  # Distinct engine-version strings embedded in the binary, e.g. "4.7.stable",
  # "4.7.dev". Ignore ".custom" suffixed variants — they repeat the base string.
  FOUND=$(strings -a "$BIN" \
    | grep -oE '4\.[0-9]+(\.[0-9]+)?\.(stable|dev|beta|rc)[0-9]*' \
    | sort -u)
  [[ -n "$FOUND" ]] || die "no engine version string found in $BIN — corrupt or stripped differently than expected"
  if ! grep -qxF "$EXPECTED" <<< "$FOUND"; then
    die "pin is '$PIN' (expects embedded '$EXPECTED') but $BIN embeds: $(tr '\n' ' ' <<< "$FOUND")— rebuild with engine_build/build_godot.sh"
  fi
  # A second, conflicting version string means a stale/mixed build.
  EXTRA=$(grep -vxF "$EXPECTED" <<< "$FOUND" || true)
  [[ -z "$EXTRA" ]] || die "$BIN embeds conflicting version strings: $(tr '\n' ' ' <<< "$FOUND")— stale or mixed build, rebuild from scratch"
  echo "✓ $(basename "$BIN") embeds $EXPECTED"
done

echo "✓ prebuilt/ matches pinned $PIN"
