#!/usr/bin/env bash
# =============================================================================
# 07_jni_smoke_test.sh – Automated ADB runner for Android dlopen test (03)
# =============================================================================
# This script requires a connected Android device or emulator.
# It compiles the dlopen_test host tool, pushes it + libgodot.so to the device,
# executes it via adb shell, and returns the result.
# =============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SO_PATH="$SCRIPT_DIR/../output/android/libgodot.so"
CMAKE_DIR="$SCRIPT_DIR/03_android_dlopen"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
CYAN='\033[0;36m'; BOLD='\033[1m'

echo -e "\n${CYAN}${BOLD}▶ 07 – JNI Smoke Test (Android ADB)${NC}"

if ! command -v adb &>/dev/null; then
    echo -e "  ${YELLOW}⚠ 'adb' not found. Ensure Android SDK platform-tools are in PATH.${NC}"
    exit 0
fi

# Check for a single connected device
DEVICES=$(adb devices | grep -v "List" | grep "device$" | wc -l)
if [[ "$DEVICES" -eq 0 ]]; then
    echo -e "  ${YELLOW}⚠ No Android device/emulator connected. Skipping test 07.${NC}"
    exit 0
fi

echo -e "  ${GREEN}✓${NC} Android device detected."

if [[ ! -f "$SO_PATH" ]]; then
    echo -e "  ${RED}✗ libgodot.so not found at $SO_PATH${NC}"
    exit 1
fi

# Locate NDK toolchain for cmake
if [[ -z "${ANDROID_NDK_ROOT:-}" ]]; then
    if [[ -z "${ANDROID_HOME:-}" ]] && [[ -d "$HOME/Library/Android/sdk/ndk" ]]; then
       ANDROID_HOME="$HOME/Library/Android/sdk"
    fi
    if [[ -n "${ANDROID_HOME:-}" ]]; then
        ANDROID_NDK_ROOT=$(ls -td "$ANDROID_HOME/ndk/"* 2>/dev/null | head -1 || true)
    fi
fi

if [[ -z "$ANDROID_NDK_ROOT" || ! -d "$ANDROID_NDK_ROOT" ]]; then
    echo -e "  ${RED}✗ ANDROID_NDK_ROOT not set. Cannot compile device test.${NC}"
    exit 1
fi

echo "  Compiling dlopen_test via NDK ($ANDROID_NDK_ROOT)..."
mkdir -p "$CMAKE_DIR/build"
cd "$CMAKE_DIR/build"
cmake .. \
    -DCMAKE_TOOLCHAIN_FILE="$ANDROID_NDK_ROOT/build/cmake/android.toolchain.cmake" \
    -DANDROID_ABI=arm64-v8a \
    -DANDROID_PLATFORM=android-24 \
    -DCMAKE_BUILD_TYPE=Release > /dev/null
make > /dev/null

TEST_BIN="$CMAKE_DIR/build/dlopen_test"
if [[ ! -f "$TEST_BIN" ]]; then
    echo -e "  ${RED}✗ Failed to compile dlopen_test${NC}"
    exit 1
fi

# Push files to device
TMP_DIR="/data/local/tmp"
echo "  Pushing test harness and libgodot.so to $TMP_DIR..."
adb push "$TEST_BIN" "$TMP_DIR/dlopen_test" > /dev/null
adb push "$SO_PATH" "$TMP_DIR/libgodot.so" > /dev/null
# libgodot.so is linked against the NDK's shared C++ runtime. A real app ships
# libc++_shared.so inside the APK; this bare harness has to push it alongside
# and point the loader at it, or dlopen fails with "libc++_shared.so not found".
LIBCXX_SHARED=$(find "$ANDROID_NDK_ROOT/toolchains/llvm/prebuilt" -path "*aarch64-linux-android/libc++_shared.so" -print -quit)
if [[ -z "$LIBCXX_SHARED" ]]; then
    echo -e "  ${RED}✗ libc++_shared.so not found under $ANDROID_NDK_ROOT${NC}"
    exit 1
fi
adb push "$LIBCXX_SHARED" "$TMP_DIR/libc++_shared.so" > /dev/null
adb shell chmod +x "$TMP_DIR/dlopen_test"

echo "  Executing test on device..."
set +e
adb shell "LD_LIBRARY_PATH=$TMP_DIR $TMP_DIR/dlopen_test $TMP_DIR/libgodot.so"
ADB_EC=$?
set -e

echo "  Cleaning up device..."
adb shell rm "$TMP_DIR/dlopen_test" "$TMP_DIR/libgodot.so" "$TMP_DIR/libc++_shared.so"

if [[ "$ADB_EC" -eq 0 ]]; then
    echo -e "  ${GREEN}✓ JNI Smoke Test Passed on device.${NC}"
    exit 0
else
    echo -e "  ${RED}✗ JNI Smoke Test Failed on device (exit code $ADB_EC).${NC}"
    exit 1
fi
