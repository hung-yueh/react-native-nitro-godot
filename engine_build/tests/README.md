# Godot Engine Build — Test Suite

This directory contains standalone verification tools for the outputs produced by `engine_build/`. These tests simulate the behavior of a host app (like React Native Nitro) attempting to dynamically load, map, and interact with the compiled `.so` and `.xcframework`.

## 1. Automated Host Tests (No device required)

These tests validate binary structure, architecture, and symbol exports against Godot 4.4 baselines.

**Run everything:**

```bash
cd engine_build
bash tests/run_all_tests.sh
```

**Individual tests:**

- `01_structure_check.sh`: Ensures the `.so` is a valid ELF64 AArch64 binary, and the `.xcframework` contains an `Info.plist` and both slices (device + simulator).
- `02_symbol_audit.sh`: Extracts the dynamic symbol table (`nm -gD`) from the Android `.so` and verifies the exact 56 `Java_org_godotengine_*` JNI entry points required for a successful Android JVM boot.
- `04_ios_symbol_check.sh`: Scans the iOS static archive (`.a`) to verify it contains over 10,000 compiled Godot symbols and targeting `arm64`.
- `05_pck_mount/`: Contains `gen_test_pck.py`, a script that emits a structurally perfect (but empty) Godot PCK v2 binary for mount testing.

## 2. On-Device Integration Tests

These tests require physical hardware or emulators to prove the libraries actually execute without `SIGSEGV` or linker errors.

### 03 & 07: Android Dynamic Loader (ADB)

Proves that the Android `libgodot.so` can be mapped into memory, all its dependencies are met, and its C++ function pointers can be resolved via `dlsym` without crashing.

**Requirements**: An Android device/emulator connected via `adb`, and the NDK installed.

**Run**:

```bash
bash tests/07_jni_smoke_test.sh
```

_What it does:_ Cross-compiles a custom C++ harness (`03_android_dlopen/dlopen_test.cpp`), pushes both the harness and `libgodot.so` to `/data/local/tmp` on the device, executes the harness, and validates pointer resolution.

### 06: Native Visual Sandbox (WIP)

Documentation for creating a blank iOS surface / Android SurfaceView that passes its native window pointer into the C-API to confirm frame rendering (grey screen).
_(Visual test scaffolding pending React Native integration bridge architecture)._

---

**Note on V4 / `libgodot_create_godot_instance`**:
Godot 4.4-stable relies on the JNI surface (`Java_org_godotengine_*`) or specific `GodotAppMain` delegates for lifecycle. The C-friendly `libgodot_create_godot_instance` embedding API is slated for Godot 4.5.
