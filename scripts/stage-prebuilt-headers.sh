#!/usr/bin/env bash
# Stage the public engine headers into prebuilt/include with a layout that is
# self-consistent for consumers.
#
# Why this exists: prebuilt/ is gitignored but shipped to npm via the
# package.json "files" whitelist, and the headers used to be hand-copied. Copying
# them FLAT silently breaks libgodot.h, which includes its companion header by
# its Godot in-tree path:
#
#     libgodot.h:  #include "core/extension/gdextension_interface.gen.h"
#
# That is exactly how 0.1.6 shipped un-compilable: the header sat flat at
# prebuilt/include/gdextension_interface.gen.h, so the include resolved to a
# nonexistent prebuilt/include/core/extension/ and every consumer build failed
# with "file not found". (The include path is upstream's and changed when the
# pin moved 4.7.1-stable -> 4.7-stable.)
#
# Consumers add ONLY prebuilt/include as a search root
# (react-native-nitro-godot.podspec, android/CMakeLists.txt), and include the
# entry header flat as #include "libgodot.h". So the shipped layout must be:
#
#   prebuilt/include/libgodot.h                                  <- consumers include this
#   prebuilt/include/core/extension/gdextension_interface.gen.h  <- satisfies libgodot.h
#
# Headers are copied verbatim from the built Godot source tree so they always
# match the engine binaries produced by engine_build/build_godot.sh.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/engine_build/godot-src/core/extension"
DEST="$ROOT/prebuilt/include"

die() { echo "✗ stage-prebuilt-headers: $*" >&2; exit 1; }

[[ -d "$SRC" ]] || die "missing Godot source tree at $SRC (run engine_build/build_godot.sh first)"

for h in libgodot.h gdextension_interface.gen.h; do
  [[ -f "$SRC/$h" ]] || die "missing $SRC/$h"
done

# Entry header, flat — this is what consumers #include.
mkdir -p "$DEST"
cp -f "$SRC/libgodot.h" "$DEST/libgodot.h"

# Companion header, at the in-tree path libgodot.h refers to.
mkdir -p "$DEST/core/extension"
cp -f "$SRC/gdextension_interface.gen.h" "$DEST/core/extension/gdextension_interface.gen.h"

# Remove a stale flat copy from older layouts: keeping both means two distinct
# files with #pragma once, which double-parse (and can redefine) if a consumer
# ever includes each path in one translation unit.
rm -f "$DEST/gdextension_interface.gen.h"

echo "✓ staged headers into prebuilt/include:"
echo "    libgodot.h"
echo "    core/extension/gdextension_interface.gen.h"
