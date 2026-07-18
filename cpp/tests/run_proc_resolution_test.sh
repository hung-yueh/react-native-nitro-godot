#!/usr/bin/env bash
# =============================================================================
# run_proc_resolution_test.sh — host-compile + run the GDExtension proc shim test
# =============================================================================
# Compiles GDExtensionProcs::resolve() (cpp/GDExtensionTypes.h) on the host and
# verifies the renamed/removed-API compatibility shim still resolves every
# critical proc. This is the guard against a Godot API rename silently breaking
# the Godot→JS pipeline on a version bump.
#
# Requires the Godot source headers (engine_build/godot-src/...). On a fresh
# checkout without the engine source, the test is SKIPPED (exit 0) so it is safe
# to chain after the JS test suite.
# =============================================================================
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
GD="$ROOT/engine_build/godot-src"
CXX="${CXX:-c++}"
OUT="${TMPDIR:-/tmp}/nitro_godot_proc_resolution_test"

if [[ ! -f "$GD/core/extension/libgodot.h" || ! -f "$GD/core/extension/gdextension_interface.gen.h" ]]; then
  echo "⏭  SKIP proc-resolution test: Godot source headers not found under engine_build/godot-src."
  echo "   Run 'bash engine_build/build_godot.sh' (or extract the source) first."
  exit 0
fi

echo "▶ Compiling proc-resolution test ($CXX, c++20)…"
# TEST_PROC_RESOLUTION is defined by run_proc_resolution_test.cpp itself.
"$CXX" -std=c++20 \
  -I"$HERE/.." \
  -I"$GD/core/extension" \
  -I"$GD" \
  "$HERE/run_proc_resolution_test.cpp" -o "$OUT"

echo "▶ Running…"
"$OUT"
echo "✓ proc-resolution test passed"
