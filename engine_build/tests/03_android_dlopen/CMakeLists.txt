cmake_minimum_required(VERSION 3.22)
project(godot_dlopen_test CXX C)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Provide IDE stub headers (jni.h) for linters
include_directories(${CMAKE_CURRENT_SOURCE_DIR}/include)

# ── Build a standalone executable (no shared libraries) ──────────────────────
add_executable(dlopen_test dlopen_test.cpp)

# Link against the Android dl and log libraries.
# These are always available on the Android NDK sysroot.
target_link_libraries(dlopen_test
    dl      # dlopen / dlsym / dlclose
    log     # __android_log_print (pulled in transitively by Godot)
)

# Ensure we produce a fully static binary so adb push + exec works without
# runtime dependencies (except libc / libc++_shared which are always on device).
target_link_options(dlopen_test PRIVATE
    -static-libstdc++
)

# Strip the test binary so it's small enough to push quickly.
target_link_options(dlopen_test PRIVATE
    $<$<CONFIG:Release>:-s>
)

set_target_properties(dlopen_test PROPERTIES
    RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}"
)
