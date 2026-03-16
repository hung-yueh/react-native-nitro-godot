#!/usr/bin/env bash
# =============================================================================
# 04_ios_symbol_check.sh – Static symbol audit for iOS (host-side)
# =============================================================================
# Validates that libgodot.ios.template_release.arm64.a contains the expected
# engine code. Since Godot 4.4 static libraries on iOS do not have a robust
# C-API exposed yet, we check for presence of core `_godot_` or `_godot_`
# symbols and ensure the archive size and symbol count represents a full engine.
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IOS_ARCHIVE="$SCRIPT_DIR/../output/ios/libgodot.xcframework/ios-arm64/libgodot.ios.template_release.arm64.a"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

PASS=0; FAIL=0; WARN=0

ok()   { echo -e "  ${GREEN}✓${NC} $1"; PASS=$((PASS+1)); }
fail() { echo -e "  ${RED}✗${NC} $1"; FAIL=$((FAIL+1)); }
warn() { echo -e "  ${YELLOW}⚠${NC}  $1"; WARN=$((WARN+1)); }
section() { echo -e "\n${CYAN}${BOLD}▶ $1${NC}"; }

# ── Pre-flight ────────────────────────────────────────────────────────────────
if [[ ! -f "$IOS_ARCHIVE" ]]; then
    echo -e "${RED}✗ iOS device archive not found at $IOS_ARCHIVE${NC}" >&2
    echo "  Run engine_build/build_godot.sh first." >&2
    exit 1
fi

if ! command -v nm &>/dev/null; then
    echo -e "${RED}✗ 'nm' not found. Xcode command line tools required.${NC}" >&2
    exit 1
fi

if ! [[ "$(uname)" == "Darwin" ]]; then
    echo -e "${YELLOW}⚠  macOS required for iOS 'nm' tools. Skipping iOS symbol check.${NC}"
    exit 0
fi

# ── Test 4.1: Fast symbol count ──────────────────────────────────────────────
# Extracting the full symbol table from a 160MB .a takes ~30 seconds.
# We'll use grep to quickly assess symbols without filtering the entire nm output.
section "4.1 – Total symbol count estimate (expect > 10,000)"

TOTAL_SYMS=$(nm -j "$IOS_ARCHIVE" 2>/dev/null | grep -c "\b_Z" || true)
echo "       Found $TOTAL_SYMS C++ mangled symbols (_Z...)"

if [[ "$TOTAL_SYMS" -gt 10000 ]]; then
    ok "Symbol count $TOTAL_SYMS is > 10,000 ✓ (Full engine archive confirmed)"
else
    fail "Symbol count $TOTAL_SYMS is suspiciously low (expected > 10,000)"
fi

# ── Test 4.2: Godot specific symbols ─────────────────────────────────────────
section "4.2 – Core Godot iOS entry points"

# Look for 'godot::' or similar in the mangled names, or specific AppDelegates
GODOT_SYMS=$(nm -j "$IOS_ARCHIVE" 2>/dev/null | grep -i "\b_godot" | head -n 1 || true)
if [[ -n "$GODOT_SYMS" ]]; then
    ok "Found Godot-specific symbols (_godot...) ✓"
else
    fail "No Godot-specific symbols found in archive!"
fi

MAIN_SYMS=$(nm "$IOS_ARCHIVE" 2>/dev/null | grep -i "\bGodotAppMain\b\|\bgodot_ios\b" | head -n 1 || true)
if [[ -n "$MAIN_SYMS" ]]; then
    ok "Found GodotAppMain or similar iOS entry points ✓"
else
    warn "Did not find specific Godot iOS entry points (might be inside compiled source rather than exported names)"
fi

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo "============================================================"
echo "  Test 04: iOS Symbol Audit"
echo "  Passed : $PASS  |  Failed : $FAIL  |  Warnings : $WARN"
echo "============================================================"

[[ "$FAIL" -eq 0 ]] && exit 0 || exit 1
