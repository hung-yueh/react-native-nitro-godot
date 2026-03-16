# engine_build

Automated pipeline to download, patch, and compile **Godot 4.x** as an optimised shared library for Android and iOS, for use as the native engine backend in a React Native Nitro module.

The Godot version is pinned in the [`GODOT_VERSION`](./GODOT_VERSION) file (currently **4.7-dev2**).

---

## Prerequisites

| Tool                  | Purpose                   | Install                               |
| --------------------- | ------------------------- | ------------------------------------- |
| `scons`               | Godot's build system      | `pip install scons`                   |
| `python3`             | Required by SCons         | <https://python.org>                  |
| `curl` or `wget`      | Download source tarball   | macOS: built-in / `brew install wget` |
| Android NDK r27+      | Android toolchain         | Android Studio SDK Manager            |
| Xcode + CLT           | iOS builds & xcframework  | App Store + `xcode-select --install`  |
| `ccache` _(optional)_ | Faster incremental builds | `brew install ccache`                 |

Set `ANDROID_NDK_ROOT` before running:

```bash
export ANDROID_NDK_ROOT=/path/to/ndk/26.3.11579264
```

---

## Quick Start

```bash
# 1. Verify your environment has all the prerequisites
bash check_env.sh

# 2. Run the build (uses version from GODOT_VERSION file)
bash build_godot.sh
```

### Dry-run mode (CI / environment testing)

Downloads and extracts the real source, writes `custom.py`, but skips actual `scons` invocations and verifies error-path handling:

```bash
GODOT_DRY_RUN=1 bash engine_build/build_godot.sh
```

---

## Outputs

```
engine_build/output/
├── android/
│   └── libgodot.so          ← ARM64 shared library for Android
└── ios/
    └── libgodot.xcframework ← Universal XCFramework (device + simulator)
        ├── ios-arm64/
        └── ios-arm64-simulator/
```

---

## Environment Variables

You can override the defaults by explicitly exporting these variables before running the build:

| Variable           | Default                    | Description                                                                                                                                                                                          |
| ------------------ | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GODOT_VERSION`    | read from `GODOT_VERSION`  | The GitHub tag to build. Defaults to the value in `engine_build/GODOT_VERSION`. Override with env var for one-off builds, e.g. `GODOT_VERSION=4.8-dev1 bash build_godot.sh`. |
| `ANDROID_NDK_ROOT` | _(auto-discovered)_       | Absolute path to your Android NDK. If omitted, the script attempts to auto-discover it based on `ANDROID_HOME` or your macOS `~/Library/Android/sdk/` paths.                                         |

---

## Feature-Stripping Configuration (`custom.py`)

Automatically injected into `godot-src/custom.py`:

| Flag                        | Value  | Effect                                    |
| --------------------------- | ------ | ----------------------------------------- |
| `production`                | `yes`  | Enables all release-mode guards           |
| `optimize`                  | `size` | Optimise for binary size (`-Os`)          |
| `lto`                       | `full` | Link-Time Optimisation across all TUs     |
| `disable_path_overrides`    | `no`   | **Required**: enables `--main-pack` CLI   |
| `use_volk`                  | `no`   | Use the NDK/system Vulkan loader          |
| `disable_2d`                | `yes`  | Strip 2D rendering (non-standard flag)    |
| `disable_advanced_gui`      | `yes`  | Strip advanced GUI nodes                  |
| `module_physics_2d_enabled` | `no`   | Disable 2D physics module                 |
| `module_physics_3d_enabled` | `no`   | Disable 3D physics module                 |
| `module_navigation_enabled` | `no`   | Disable navigation mesh module            |
| `module_webxr_enabled`      | `no`   | Disable WebXR module                      |
| `module_mono_enabled`       | `no`   | Disable C# / .NET scripting               |
| `module_theora_enabled`     | `no`   | Disable Theora video decoder              |
| `module_vorbis_enabled`     | `no`   | Disable Vorbis audio decoder              |
| `module_csg_enabled`        | `no`   | Disable CSG (Constructive Solid Geometry) |
| `module_enet_enabled`       | `no`   | Disable ENet networking module            |

> **Note:** `disable_2d` and `disable_advanced_gui` are custom keys not present in the upstream Godot SCons system. They are included for forward-compatibility but will be silently ignored by Godot 4.4 unless a custom SConstruct reads them.

---

## Verification Gates Explained

The build script runs four gates after compilation. Any failure exits with **code 1**.

1.  **V1 – Artifact Existence**: Proves the output files (`.so` and `.xcframework`) actually generated.
2.  **V2 – Binary Size**: Ensures the Android `.so` is stripped and appropriately small. Warns if > 60 MB, aborts if > 80 MB. (Godot `master` with `-Os` typically sits around 50–65 MB).
3.  **V3 – Architecture**: Verifies the compiled binaries contain the `arm64` / `aarch64` machine code slices required by modern phones.
4.  **V4 – C-API Symbol Export**: Validates that both `libgodot_create_godot_instance` and `libgodot_destroy_godot_instance` are exported from Android (`libgodot.so` via `nm -gD`) **and** iOS (`libgodot.a` via `nm`). These are **hard requirements** for embedding Godot into the React Native process via Nitro. If V4 fails, the corresponding patch (`0001` for Android, `0002` for iOS) likely did not apply correctly.

---

## Upgrading Godot

To upgrade the Godot engine version:

```bash
# 1. Edit the pinned version (e.g. to 4.7-dev3)
echo "4.7-dev3" > engine_build/GODOT_VERSION

# 2. Rebuild (stale source is auto-detected and re-downloaded)
bash engine_build/build_godot.sh

# 3. If patches fail to apply, regenerate them (see patches/README.md)

# 4. Re-export the game PCK with the new editor
cd examples/dungeon-dash && npm run export-pck
```

The build script automatically detects when the source tree is stale (via `.godot_version_tag` watermark) and re-downloads the correct tarball.

---

## Directory Layout

```
engine_build/
├── GODOT_VERSION           ← Pinned version (single source of truth)
├── build_godot.sh          ← Master build script
├── check_env.sh            ← Prerequisite validator
├── README.md               ← This file
├── patches/                ← Version-pinned engine patches
│   ├── README.md           ← Patch descriptions + regeneration guide
│   ├── 0001-libgodot-android-entry.patch
│   ├── 0002-libgodot-ios-entry.patch
│   ├── 0003-os-android-null-guards.patch
│   ├── 0004-display-server-null-guards.patch
│   ├── 0005-android-detect-library.patch
│   └── 0006-ios-detect-metal-sim.patch
├── godot-<version>.tar.gz  ← Cached source tarball (auto-downloaded)
├── godot-src/              ← Extracted Godot source tree
│   ├── custom.py           ← Injected feature-stripping config
│   └── .godot_version_tag  ← Version watermark (auto-generated)
└── output/
    ├── android/
    │   └── libgodot.so
    └── ios/
        └── libgodot.xcframework
```

---

## Troubleshooting

### `scons: command not found`

```bash
pip install scons
# or
pip3 install scons
```

### `ANDROID_NDK_ROOT is not set`

```bash
export ANDROID_NDK_ROOT="$HOME/Library/Android/sdk/ndk/26.3.11579264"
```

Find your NDK path in Android Studio: **SDK Manager → SDK Tools → Android NDK (Side by side)**.

### `libgodot.so` is larger than expected

- Confirm `custom.py` was written correctly: `cat engine_build/godot-src/custom.py`
- Ensure LTO is supported by your NDK's LLVM version (NDK r23+)
- Try force-cleaning and rebuilding: `rm -rf engine_build/godot-src/bin && bash engine_build/build_godot.sh`

### `libgodot_create_godot_instance` symbol not found (V4)

This symbol is created by patches `0001` (Android) and `0002` (iOS). If V4 fails:

1. **Check patch application**: Look for `"Applied 0001-libgodot-android-entry.patch"` in the build output.
2. **Re-apply manually**: `cd godot-src && patch -p1 < ../patches/0001-libgodot-android-entry.patch`
3. **Regenerate patches** if you've upgraded Godot: see [`patches/README.md`](patches/README.md).

### Patch failed to apply

This means the Godot source has changed since the patches were generated. You need to regenerate them for the new version:

```bash
# See patches/README.md for the full regeneration workflow
cd godot-src
git init && git add -A && git commit -m "vanilla"
# Apply your modifications, then:
git diff > ../patches/<patch-name>.patch
```
