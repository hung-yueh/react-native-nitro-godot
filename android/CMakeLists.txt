cmake_minimum_required(VERSION 3.22.1)
project(NitroGodot)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_VERBOSE_MAKEFILE ON)

# ── Declare the main Nitro Godot shared library ─────────────────────────────
add_library(
  NitroGodot
  SHARED
  # Hand-authored C++ implementation
  ../cpp/HybridGodotEngine.cpp
  # JNI ANativeWindow* extractor for GodotSurfaceView.kt
  ../cpp/AndroidSurface.cpp
  # Registration initializer (must NOT be compiled by the autolinking CMake
  # because NitroGodotOnLoad.cpp guards it with BUILDING_NITROGODOT_WITH_GENERATED_CMAKE_PROJECT)
  ../cpp/GodotOnLoad.cpp
)

# ── Include the Nitrogen auto-linking CMake ──────────────────────────────────
# This adds:
#   - NitroGodotOnLoad.cpp, HybridGodotEngineSpec.cpp
#   - -DBUILDING_NITROGODOT_WITH_GENERATED_CMAKE_PROJECT define
#   - NitroModules, fbjni, JSI, ReactAndroid link targets
#   - include_directories for nitrogen/generated/shared/c++ and android/
#
include(${CMAKE_SOURCE_DIR}/../nitrogen/generated/android/NitroGodot+autolinking.cmake)

# ── Header search paths ──────────────────────────────────────────────────────
target_include_directories(NitroGodot PRIVATE
  # Our hand-authored C++ headers
  ../cpp
  # libgodot.h + gdextension_interface.gen.h from the Godot source tree
  ../engine_build/godot-src/core/extension
  ../engine_build/godot-src
)

# ── libgodot prebuilt shared library (Godot master branch build output) ──────
#
# The Android SCons build produces libgodot_android.so (the full engine).
# We declare it as an IMPORTED target so CMake can resolve the link
# without recompiling.
#
add_library(libgodot_prebuilt SHARED IMPORTED)
set_target_properties(libgodot_prebuilt PROPERTIES
  IMPORTED_LOCATION
  "${CMAKE_CURRENT_SOURCE_DIR}/../engine_build/godot-src/platform/android/java/lib/libs/release/arm64-v8a/libgodot_android.so"
)

# ── Link everything together ─────────────────────────────────────────────────
# Note: NitroGodot+autolinking.cmake already links NitroModules/fbjni/JSI.
# We only need to add libgodot on top of that.
target_link_libraries(NitroGodot
  libgodot_prebuilt
  android      # Android NDK APIs (ANativeWindow, etc.)
  log          # __android_log_print
)
