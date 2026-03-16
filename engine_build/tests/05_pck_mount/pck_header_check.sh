#!/usr/bin/env bash
# =============================================================================
# pck_header_check.sh
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
CYAN='\033[0;36m'; BOLD='\033[1m'

PASS=0; FAIL=0

echo -e "\n${CYAN}${BOLD}▶ 05 – PCK Header check${NC}"

# 1. Generate the test PCK
python3 "$SCRIPT_DIR/gen_test_pck.py" > /dev/null
TEST_PCK="test.pck"

if [[ ! -f "$TEST_PCK" ]]; then
    echo -e "  ${RED}✗ Failed to generate test.pck${NC}"
    exit 1
fi

# 2. Verify magic
MAGIC=$(xxd -l 4 -p "$TEST_PCK")
if [[ "$MAGIC" == "47445043" ]]; then # 'GDPC' reversed in LE
    echo -e "  ${GREEN}✓${NC} test.pck magic bytes (GDPC) verified"
    PASS=$((PASS+1))
else
    echo -e "  ${RED}✗ test.pck magic mismatch: $MAGIC${NC}"
    FAIL=$((FAIL+1))
fi

rm "$TEST_PCK"

echo ""
echo "============================================================"
echo "  Test 05: PCK Generation verification"
echo "  Passed : $PASS  |  Failed : $FAIL"
echo "============================================================"

[[ "$FAIL" -eq 0 ]] && exit 0 || exit 1
