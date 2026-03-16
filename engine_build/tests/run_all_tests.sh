#!/usr/bin/env bash
# =============================================================================
# run_all_tests.sh – Master Test Runner for Godot Engine Build
# =============================================================================
# Runs all automated host-side verification tests.
# Device tests (ADB/Xcode) are noted but must be run manually or in CI.
# =============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

echo -e "${CYAN}${BOLD}"
echo "============================================================"
echo "  Godot Engine Build – Test Suite"
echo "============================================================${NC}"

# Ensure outputs exist
SO_PATH="$SCRIPT_DIR/../output/android/libgodot.so"
XCFW_PATH="$SCRIPT_DIR/../output/ios/libgodot.xcframework"

if [[ ! -f "$SO_PATH" ]] && [[ ! -d "$XCFW_PATH" ]]; then
    echo -e "${RED}✗ No build outputs found in engine_build/output/.${NC}"
    echo "  Run engine_build/build_godot.sh first."
    exit 1
fi

FAIL=0

run_test() {
    local script=$1
    echo -e "\n${BOLD}Running $script...${NC}"
    if bash "$script"; then
        echo -e "${GREEN}✓ $script PASSED${NC}"
    else
        echo -e "${RED}✗ $script FAILED${NC}"
        FAIL=$((FAIL+1))
    fi
}

run_test "01_structure_check.sh"
run_test "02_symbol_audit.sh"
run_test "04_ios_symbol_check.sh"
run_test "05_pck_mount/pck_header_check.sh"

echo -e "\n${CYAN}${BOLD}============================================================${NC}"
if [[ "$FAIL" -eq 0 ]]; then
    echo -e "${GREEN}${BOLD}  All Host Tests Passed! (${FAIL} failures)${NC}"
else
    echo -e "${RED}${BOLD}  Test Suite Failed with $FAIL error(s).${NC}"
fi
echo -e "${CYAN}${BOLD}============================================================${NC}"

# Instruction for device tests
echo -e "\n${YELLOW}Device Tests available:${NC}"
echo "  To run the Android on-device dlopen integration test (requires ADB):"
echo "  $ bash tests/07_jni_smoke_test.sh"
echo ""

exit "$FAIL"
