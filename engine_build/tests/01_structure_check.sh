#!/usr/bin/env bash
# =============================================================================
# 01_structure_check.sh – Binary structure validation (host-side, no device needed)
# =============================================================================
# Verifies:
#   · Android libgodot.so  → valid ELF64, ARM aarch64 machine type
#   · iOS libgodot.xcframework → valid structure with 2 slices + Info.plist
#
# Exit codes: 0 = all checks passed, 1 = one or more checks failed.
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUTPUT_DIR="$SCRIPT_DIR/../output"
ANDROID_SO="$OUTPUT_DIR/android/libgodot.so"
IOS_XCFW="$OUTPUT_DIR/ios/libgodot.xcframework"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

PASS=0; FAIL=0

pass() { echo -e "  ${GREEN}✓${NC} $1"; PASS=$((PASS+1)); }
fail() { echo -e "  ${RED}✗${NC} $1"; FAIL=$((FAIL+1)); }
warn() { echo -e "  ${YELLOW}⚠${NC}  $1"; }
section() { echo -e "\n${CYAN}${BOLD}▶ $1${NC}"; }

# ── Helpers ──────────────────────────────────────────────────────────────────

# Read two hex bytes at an offset in a binary file.
# Usage: hex_at <file> <decimal-offset> <byte-count>
hex_at() {
    xxd -seek "$2" -l "$3" -g 1 "$1" 2>/dev/null | awk '{print $2, $3}' | tr -d ' \n'
}

# ── Test 1.1: Android .so existence ──────────────────────────────────────────
section "1.1 – Android libgodot.so exists"
if [[ -f "$ANDROID_SO" ]]; then
    SIZE_MB=$(echo "scale=1; $(stat -f%z "$ANDROID_SO") / 1048576" | bc)
    pass "Found: $ANDROID_SO (${SIZE_MB} MB)"
else
    fail "libgodot.so not found at $ANDROID_SO"
    echo ""
    echo -e "${RED}Cannot continue structure checks — run build_godot.sh first.${NC}" >&2
    exit 1
fi

# ── Test 1.2: ELF magic bytes ─────────────────────────────────────────────────
section "1.2 – ELF magic bytes (0x7f 'E' 'L' 'F')"
MAGIC=$(xxd -l 4 -p "$ANDROID_SO" 2>/dev/null)
if [[ "$MAGIC" == "7f454c46" ]]; then
    pass "ELF magic: 7f 45 4c 46 ✓"
else
    fail "ELF magic mismatch: got '$MAGIC' (expected 7f454c46)"
fi

# ── Test 1.3: ELF class (64-bit) ─────────────────────────────────────────────
section "1.3 – ELF class: 64-bit (EI_CLASS = 0x02)"
ELFCLASS=$(xxd -seek 4 -l 1 -p "$ANDROID_SO" 2>/dev/null)
if [[ "$ELFCLASS" == "02" ]]; then
    pass "EI_CLASS = 0x02 (ELFCLASS64) ✓"
else
    fail "EI_CLASS = 0x${ELFCLASS} (expected 02 = 64-bit)"
fi

# ── Test 1.4: ELF data encoding (little-endian) ──────────────────────────────
section "1.4 – ELF data encoding: little-endian (EI_DATA = 0x01)"
ELFDATA=$(xxd -seek 5 -l 1 -p "$ANDROID_SO" 2>/dev/null)
if [[ "$ELFDATA" == "01" ]]; then
    pass "EI_DATA = 0x01 (ELFDATA2LSB little-endian) ✓"
else
    fail "EI_DATA = 0x${ELFDATA} (expected 01 = little-endian)"
fi

# ── Test 1.5: ELF machine type (ARM64 = 0xB7 = 183) ─────────────────────────
# e_machine is at byte offset 18 (0x12), 2 bytes little-endian → EM_AARCH64 = 0x00B7
section "1.5 – ELF machine type: ARM AArch64 (e_machine = 0x00B7)"
E_MACHINE=$(xxd -seek 18 -l 2 -p "$ANDROID_SO" 2>/dev/null)
if [[ "$E_MACHINE" == "b700" ]]; then
    pass "e_machine = 0xB700 (EM_AARCH64 LE) ✓"
else
    fail "e_machine = 0x${E_MACHINE} (expected b700 = EM_AARCH64)"
fi

# ── Test 1.6: ELF type (ET_DYN = 0x03 = shared object) ──────────────────────
section "1.6 – ELF type: ET_DYN (shared library)"
# e_type is at offset 16, 2 bytes LE → 0x0003
E_TYPE=$(xxd -seek 16 -l 2 -p "$ANDROID_SO" 2>/dev/null)
if [[ "$E_TYPE" == "0300" ]]; then
    pass "e_type = 0x0003 (ET_DYN) ✓"
else
    fail "e_type = 0x${E_TYPE} (expected 0300 = ET_DYN/shared object)"
fi

# ── Test 1.7: 'file' tool verification ───────────────────────────────────────
section "1.7 – 'file' tool reading"
if command -v file &>/dev/null; then
    FILE_OUT=$(file "$ANDROID_SO")
    echo "       $FILE_OUT"
    if echo "$FILE_OUT" | grep -q "aarch64\|ARM aarch64\|AArch64"; then
        pass "'file' confirms ARM AArch64 ✓"
    else
        fail "'file' did not confirm AArch64 architecture"
    fi
    if echo "$FILE_OUT" | grep -q "shared object\|dynamically linked"; then
        pass "'file' confirms shared object ✓"
    else
        fail "'file' did not confirm shared object type"
    fi
else
    warn "'file' command not found – skipping"
fi

# ── Test 1.8: iOS XCFramework exists ─────────────────────────────────────────
section "1.8 – iOS libgodot.xcframework exists"
if [[ -d "$IOS_XCFW" ]]; then
    pass "Found: $IOS_XCFW"
else
    fail "xcframework not found at $IOS_XCFW"
    echo ""
    echo -e "${RED}Skipping remaining iOS structure checks.${NC}" >&2
    # Don't exit — still count the host tests
fi

# ── Test 1.9: XCFramework Info.plist ─────────────────────────────────────────
section "1.9 – XCFramework Info.plist present"
if [[ -f "$IOS_XCFW/Info.plist" ]]; then
    pass "Info.plist found ✓"
    # Quick sanity: should contain 'XCFrameworkFormatVersion'
    if grep -q "XCFrameworkFormatVersion" "$IOS_XCFW/Info.plist" 2>/dev/null; then
        pass "Info.plist contains 'XCFrameworkFormatVersion' ✓"
    else
        warn "Info.plist exists but XCFrameworkFormatVersion key not found"
    fi
else
    fail "Info.plist missing from xcframework"
fi

# ── Test 1.10: Correct slice directories ─────────────────────────────────────
section "1.10 – XCFramework slices: ios-arm64 (device) + ios-arm64-simulator"
REQUIRED_SLICES=("ios-arm64" "ios-arm64-simulator")
for slice in "${REQUIRED_SLICES[@]}"; do
    if [[ -d "$IOS_XCFW/$slice" ]]; then
        # Check there's at least one file inside
        SLICE_FILES=$(find "$IOS_XCFW/$slice" -type f | wc -l | tr -d ' ')
        pass "Slice '$slice' present ($SLICE_FILES file(s)) ✓"
    else
        fail "Slice '$slice' missing from xcframework"
    fi
done

# ── Test 1.11: iOS device library architecture ───────────────────────────────
section "1.11 – iOS device slice architecture (arm64)"
DEVICE_LIB=$(find "$IOS_XCFW/ios-arm64" -type f -name "*.a" 2>/dev/null | head -1)
if [[ -n "$DEVICE_LIB" ]]; then
    if command -v lipo &>/dev/null; then
        LIPO_OUT=$(lipo -info "$DEVICE_LIB" 2>&1)
        echo "       lipo: $LIPO_OUT"
        if echo "$LIPO_OUT" | grep -q "arm64"; then
            pass "iOS device library contains arm64 ✓"
        else
            fail "iOS device library does not report arm64"
        fi
    else
        warn "lipo not found – skipping architecture check"
    fi
else
    warn "No .a file found in ios-arm64 slice – skipping"
fi

# ── Test 1.12: Simulator slice architecture ──────────────────────────────────
section "1.12 – iOS simulator slice architecture (arm64)"
SIM_LIB=$(find "$IOS_XCFW/ios-arm64-simulator" -type f -name "*.a" 2>/dev/null | head -1)
if [[ -n "$SIM_LIB" ]]; then
    if command -v lipo &>/dev/null; then
        LIPO_OUT=$(lipo -info "$SIM_LIB" 2>&1)
        echo "       lipo: $LIPO_OUT"
        if echo "$LIPO_OUT" | grep -q "arm64"; then
            pass "iOS simulator library contains arm64 ✓"
        else
            fail "iOS simulator library does not report arm64"
        fi
    else
        warn "lipo not found – skipping architecture check"
    fi
else
    warn "No .a file found in ios-arm64-simulator slice – skipping"
fi

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo "============================================================"
echo "  Test 01: Structure Check"
echo "  Passed : $PASS  |  Failed : $FAIL"
echo "============================================================"

[[ "$FAIL" -eq 0 ]] && exit 0 || exit 1
