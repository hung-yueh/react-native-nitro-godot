# Engine Patches

Version-pinned patches for Godot **4.7-stable** to enable the `libgodot` C-API
for React Native embedding.

| Patch | Description |
|---|---|
| `0001-libgodot-android-entry.patch` | Creates `libgodot_android.cpp` entry point + patches Android `SCsub` |
| `0002-libgodot-ios-entry.patch` | Creates `libgodot_ios.mm` entry point + patches iOS `SCsub` |
| `0003-os-android-null-guards.patch` | Null guards for `godot_java` in `os_android.cpp` (prevents SIGSEGV) |
| `0004-display-server-null-guards.patch` | Null guards for `godot_view` in `display_server_android.cpp` |
| `0005-android-detect-library.patch` | Adds `"library"` to Android `detect.py` supported features |
| `0006-ios-detect-metal-sim.patch` | Keeps Metal enabled on Apple Silicon iOS simulator |

## Regenerating Patches

When upgrading the Godot version, patches may fail to apply. To regenerate:

```bash
cd engine_build/godot-src

# 1. Extract vanilla source
tar -xf ../godot-$NEW_VERSION.tar.gz --strip-components=1

# 2. Init git, commit vanilla state
git init && git add -A && git commit -m "vanilla $NEW_VERSION"

# 3. Apply your modifications manually, then:
git diff > ../patches/combined.patch
# Or split per-file as needed
```
