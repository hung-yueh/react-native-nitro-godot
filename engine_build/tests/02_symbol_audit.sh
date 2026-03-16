#!/usr/bin/env bash
# =============================================================================
# 02_symbol_audit.sh – Dynamic symbol export audit (host-side, no device)
# =============================================================================
# Validates that libgodot.so exports the expected JNI and GDExtension symbols
# needed for Android runtime integration.
#
# Hard-required: all 6 core GodotLib JNI symbols must be present.
# Soft-required: FreeType functions (confirms linked-in thirdparty libs).
# Advisory only: libgodot_create_godot_instance (Godot 4.5+ embedding API).
#
# Exit codes: 0 = all hard-required checks passed, 1 = any hard failure.
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SO="$SCRIPT_DIR/../output/android/libgodot.so"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

PASS=0; FAIL=0; WARN=0

ok()   { echo -e "  ${GREEN}✓${NC} $1"; PASS=$((PASS+1)); }
fail() { echo -e "  ${RED}✗${NC} $1"; FAIL=$((FAIL+1)); }
warn() { echo -e "  ${YELLOW}⚠${NC}  $1"; WARN=$((WARN+1)); }
section() { echo -e "\n${CYAN}${BOLD}▶ $1${NC}"; }

# ── Pre-flight ────────────────────────────────────────────────────────────────
if [[ ! -f "$SO" ]]; then
    echo -e "${RED}✗ libgodot.so not found at $SO${NC}" >&2
    echo "  Run engine_build/build_godot.sh first." >&2
    exit 1
fi

if ! command -v nm &>/dev/null; then
    echo -e "${RED}✗ 'nm' not found. Install binutils (macOS: brew install binutils).${NC}" >&2
    exit 1
fi

# Build the full dynamic symbol table once — expensive on 55 MB binary, cache it.
SYMTAB=$(nm -gD "$SO" 2>/dev/null)

# ── Test 2.1: Total exported symbol count ────────────────────────────────────
section "2.1 – Total exported text symbols (expect ≥ 400)"
TOTAL_T=$(echo "$SYMTAB" | grep -c " T " || true)
echo "       Total exported text symbols: $TOTAL_T"
if [[ "$TOTAL_T" -ge 400 ]]; then
    ok "$TOTAL_T symbols ≥ 400 ✓"
else
    fail "$TOTAL_T symbols is below the expected ≥ 400 minimum"
fi

# ── Test 2.2: Core GodotLib & libgodot C-API symbols (hard-required) ───────────
section "2.2 – Core GodotLib & C-API symbols (hard-required)"

REQUIRED_JNI=(
    "libgodot_create_godot_instance"
    "Java_org_godotengine_godot_GodotLib_initialize"
    "Java_org_godotengine_godot_GodotLib_setup"
    "Java_org_godotengine_godot_GodotLib_step"
    "Java_org_godotengine_godot_GodotLib_ondestroy"
    "Java_org_godotengine_godot_GodotLib_newcontext"
    "Java_org_godotengine_godot_GodotLib_resize"
    "Java_org_godotengine_godot_GodotLib_back"
    "Java_org_godotengine_godot_GodotLib_focusin"
    "Java_org_godotengine_godot_GodotLib_focusout"
)

for sym in "${REQUIRED_JNI[@]}"; do
    if echo "$SYMTAB" | grep -q " T ${sym}$"; then
        ok "$sym"
    else
        fail "MISSING: $sym"
    fi
done

# ── Test 2.3: Input JNI symbols ───────────────────────────────────────────────
section "2.3 – Input/sensor JNI symbols"
INPUT_JNI=(
    "Java_org_godotengine_godot_GodotLib_key"
    "Java_org_godotengine_godot_GodotLib_dispatchTouchEvent"
    "Java_org_godotengine_godot_GodotLib_accelerometer"
    "Java_org_godotengine_godot_GodotLib_gyroscope"
    "Java_org_godotengine_godot_GodotLib_magnetometer"
    "Java_org_godotengine_godot_GodotLib_joyaxis"
    "Java_org_godotengine_godot_GodotLib_joybutton"
)
for sym in "${INPUT_JNI[@]}"; do
    if echo "$SYMTAB" | grep -q " T ${sym}$"; then
        ok "$sym"
    else
        fail "MISSING: $sym"
    fi
done

# ── Test 2.4: Plugin JNI symbols ─────────────────────────────────────────────
section "2.4 – Plugin/Callable JNI symbols"
PLUGIN_JNI=(
    "Java_org_godotengine_godot_plugin_GodotPlugin_nativeRegisterSingleton"
    "Java_org_godotengine_godot_plugin_GodotPlugin_nativeEmitSignal"
    "Java_org_godotengine_godot_variant_Callable_nativeCall"
    "Java_org_godotengine_godot_variant_Callable_nativeCallObject"
)
for sym in "${PLUGIN_JNI[@]}"; do
    if echo "$SYMTAB" | grep -q " T ${sym}$"; then
        ok "$sym"
    else
        fail "MISSING: $sym"
    fi
done

# ── Test 2.5: FreeType symbols (thirdparty linkage sanity) ───────────────────
section "2.5 – Third-party sanity checks (e.g. FreeType is statically linked)"
REQUIRED_FREETYPE=(
    "FT_Init_FreeType"
    "FT_New_Face"
)
for sym in "${REQUIRED_FREETYPE[@]}"; do
    if echo "$SYMTAB" | grep -q " T ${sym}$"; then
        ok "$sym"
    else
        fail "MISSING FreeType symbol: $sym"
    fi
done

# ── Test 2.7: Full Java_* count ──────────────────────────────────────────────
section "2.7 – Total Java_* JNI symbol count (expect ≥ 40)"
JAVA_COUNT=$(echo "$SYMTAB" | grep -c " T Java_" || true)
echo "       Total Java_ JNI symbols: $JAVA_COUNT"
if [[ "$JAVA_COUNT" -ge 40 ]]; then
    ok "$JAVA_COUNT Java_ symbols ≥ 40 ✓"
else
    fail "$JAVA_COUNT Java_ symbols is below expected ≥ 40"
fi

# ── Test 2.8: No undefined weak symbols that could cause crashes ──────────────
section "2.9 – Undefined symbols (should be only well-known Android syscalls)"
UNDEF=$(nm -gDu "$SO" 2>/dev/null | grep " U " | grep -v "^__" | \
        grep -vi "pthread\|android\|log\|dl_\|_Zn\|_Zd\|stdc\|__" | head -10 || true)
if [[ -z "$UNDEF" ]]; then
    ok "No unexpected undefined symbols ✓"
else
    warn "Potentially unexpected undefined symbols:"
    echo "$UNDEF" | while read -r line; do echo "         $line"; done
fi

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo "============================================================"
echo "  Test 02: Symbol Audit"
echo "  Passed : $PASS  |  Failed : $FAIL  |  Warnings : $WARN"
echo "============================================================"

[[ "$FAIL" -eq 0 ]] && exit 0 || exit 1
