#!/usr/bin/env bash
# =============================================================================
# check_env.sh – Prerequisite validator for the Godot build pipeline
# =============================================================================
# Usage: bash engine_build/check_env.sh
# Exits 0 if all prerequisites are satisfied, 1 on the first failure.
# =============================================================================

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

ERRORS=0

ok()   { echo -e "  ${GREEN}[OK]${NC}  $1"; }
warn() { echo -e "  ${YELLOW}[WARN]${NC} $1"; }
fail() { echo -e "  ${RED}[FAIL]${NC} $1"; ERRORS=$((ERRORS + 1)); }

echo ""
echo "============================================================"
echo "  Godot Build – Environment Check"
echo "============================================================"

# ---------------------------------------------------------------------------
# 1. Download tools
# ---------------------------------------------------------------------------
echo ""
echo "── Download Tools ──────────────────────────────────────────"

if command -v curl &>/dev/null; then
    ok "curl $(curl --version | head -1 | awk '{print $2}')"
elif command -v wget &>/dev/null; then
    ok "wget $(wget --version 2>&1 | head -1)"
else
    fail "Neither curl nor wget found. Install one to download the Godot source tarball."
fi

# ---------------------------------------------------------------------------
# 2. Build system
# ---------------------------------------------------------------------------
echo ""
echo "── Build System ────────────────────────────────────────────"

if command -v scons &>/dev/null; then
    ok "scons $(scons --version 2>&1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)"
else
    fail "scons not found. Install with: pip install scons"
fi

if command -v python3 &>/dev/null; then
    ok "python3 $(python3 --version 2>&1 | awk '{print $2}')"
else
    fail "python3 not found. SCons requires Python 3."
fi

# ---------------------------------------------------------------------------
# 3. Android NDK
# ---------------------------------------------------------------------------
echo ""
echo "── Android NDK ─────────────────────────────────────────────"

GODOT_VERSION=${GODOT_VERSION:-"master"}
NDK_ROOT="${ANDROID_NDK_ROOT:-${ANDROID_NDK_HOME:-${ANDROID_NDK:-}}}"

if [[ -z "$NDK_ROOT" ]]; then
    fail "ANDROID_NDK_ROOT (or ANDROID_NDK_HOME) is not set. Export it before running the build."
elif [[ ! -d "$NDK_ROOT" ]]; then
    fail "ANDROID_NDK_ROOT='$NDK_ROOT' does not exist on disk."
else
    # Check for the LLVM toolchain used by Godot
    LLVM_AR="$NDK_ROOT/toolchains/llvm/prebuilt"
    if [[ -d "$LLVM_AR" ]]; then
        ok "Android NDK at $NDK_ROOT (LLVM toolchain present)"
    else
        warn "NDK found at $NDK_ROOT but LLVM toolchain directory is missing. Version may be too old (need NDK r23+)."
    fi

    # Optional: detect NDK revision
    if [[ -f "$NDK_ROOT/source.properties" ]]; then
        NDK_VER=$(grep "Pkg.Revision" "$NDK_ROOT/source.properties" | awk -F'= ' '{print $2}')
        ok "NDK revision: $NDK_VER"
    fi
    echo "  Version : $GODOT_VERSION"
fi

# ---------------------------------------------------------------------------
# 4. iOS / Xcode (macOS only)
# ---------------------------------------------------------------------------
echo ""
echo "── iOS / Xcode ─────────────────────────────────────────────"

if [[ "$(uname)" == "Darwin" ]]; then
    if command -v xcodebuild &>/dev/null; then
        XCODE_VER=$(xcodebuild -version 2>/dev/null | head -1)
        ok "xcodebuild: $XCODE_VER"
    else
        fail "xcodebuild not found. Install Xcode from the App Store."
    fi

    if command -v lipo &>/dev/null; then
        ok "lipo ($(lipo -version 2>&1 | head -1 | awk '{print $NF}'))"
    else
        fail "lipo not found. It should ship with Xcode Command Line Tools."
    fi

    # Check Xcode Command Line Tools
    if xcode-select -p &>/dev/null; then
        ok "Xcode CLT path: $(xcode-select -p)"
    else
        fail "Xcode Command Line Tools not installed. Run: xcode-select --install"
    fi
else
    warn "Not running on macOS – iOS build steps will be skipped."
fi

# ---------------------------------------------------------------------------
# 5. Binary analysis tools (post-build verification)
# ---------------------------------------------------------------------------
echo ""
echo "── Binary Analysis Tools ───────────────────────────────────"

for tool in file nm; do
    if command -v "$tool" &>/dev/null; then
        ok "$tool"
    else
        fail "$tool not found. Required for post-build verification."
    fi
done

# ---------------------------------------------------------------------------
# 6. ccache (optional but strongly recommended)
# ---------------------------------------------------------------------------
echo ""
echo "── Optional Tools ──────────────────────────────────────────"

if command -v ccache &>/dev/null; then
    ok "ccache $(ccache --version | head -1) — incremental builds will be fast"
else
    warn "ccache not found. Builds will be slower. Install with: brew install ccache"
fi

if command -v nproc &>/dev/null; then
    ok "nproc → $(nproc) cores detected (used for -j flag)"
elif command -v sysctl &>/dev/null; then
    ok "sysctl → $(sysctl -n hw.ncpu) cores detected (used for -j flag)"
else
    warn "Neither nproc nor sysctl found. The build script will fall back to -j4."
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo ""
echo "============================================================"
if [[ "$ERRORS" -eq 0 ]]; then
    echo -e "  ${GREEN}All prerequisites satisfied. Ready to build.${NC}"
    echo "============================================================"
    echo ""
    exit 0
else
    echo -e "  ${RED}$ERRORS prerequisite(s) failed. Fix the issues above before building.${NC}"
    echo "============================================================"
    echo ""
    exit 1
fi
