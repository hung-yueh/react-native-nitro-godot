# NitroGodotLab

An [Expo](https://expo.dev) CNG (Continuous Native Generation) app that serves as a comprehensive **API test harness** for `react-native-nitro-godot` — testing every Godot Engine API and fully exercising Nitro Modules' memory tracking capabilities.

## Quick Start

```bash
# 1. Install dependencies (from repo root)
npm install
cd lab && npm install

# 2. Generate native projects and run
npm run prebuild   # expo prebuild --clean
npm run ios        # expo run:ios
npm run android    # expo run:android
```

## Test UI Overview

The app is split into two areas:
- **Top 30%**: Live `<GodotView />` rendering surface with engine state indicator
- **Bottom 70%**: Scrollable test control panels

### Engine Lifecycle Panel

All lifecycle steps are **manual** — each is a separate button with state-gating (disabled when the transition is invalid). This allows testing each API independently, even when the Godot binary has build config issues.

```
➕ Create → ⚙️ Initialize → ▶️ Start → ⏸ Pause → 🛑 Destroy / 🗑 Dispose HO
```

| Button | API Called | Notes |
|--------|-----------|-------|
| **➕ Create** | `NitroModules.createHybridObject<GodotEngine>('GodotEngine')` | Allocates the HybridObject; watch the Allocated HOs counter increment |
| **⚙️ Initialize** | `engine.initialize(pckPath)` | Loads the `.pck` file; enabled only after Create |
| **▶️ Start** | `engine.start()` | Spawns the Godot render thread; enabled only after Initialize |
| **⏸ Pause** | `engine.pause()` | Signals render loop to idle; enabled only when Started |
| **🛑 Destroy** | `engine.destroy()` | Stops render thread, calls `libgodot_destroy_godot_instance()` |
| **🗑 Dispose HO** | `engine.dispose()` | Nitro API — eagerly releases `NativeState` without waiting for GC; watch HO counter decrement |

### Memory Tracker Dashboard

Auto-refreshes every 2 seconds:

| Metric | API | Description |
|--------|-----|-------------|
| **Allocated HOs** | `NitroModules.debug_getTotalAllocatedHybridObjects()` | Live count of all HybridObjects alive across all Nitro modules |
| **Native Bufs** | Local counter | Number of `createNativeArrayBuffer()` allocations still referenced |
| **Last Call** | `performance.now()` delta | Execution time of the most recent API call in milliseconds |
| **Registered HOs** | `NitroModules.getAllHybridObjectNames()` | All registered HybridObject type names (e.g., `GodotEngine`) |
| **Nitro Version** | `NitroModules.version` | The Nitro runtime version built into the app |
| **Build** | `NitroModules.buildType` | `debug` or `release` |

**📏 Update MemSize**: Calls `NitroModules.updateMemorySize(engine)` — triggers a JS → native → JS round-trip that re-reports the engine's native memory footprint to the JavaScript GC. Useful after `updateSharedBuffer()` with large data, so the GC can make informed decisions about collection priority.

### View Binding Panel

- **🔗 Attach Surface**: Manually calls `engine.attachSurface(BigInt(pointer))` using the pointer captured from `onSurfaceCreated`. Useful for re-attaching after an engine restart when the surface was created before the engine.
- The surface pointer is captured automatically when `<GodotView>` fires `onSurfaceCreated`.
- In a real app using `useGodotEngine()`, surface attachment happens automatically — the Attach Surface button exists for manual lifecycle testing only.

### Messaging Panel

- Text input sets the message payload
- **Send** calls `engine.sendMessage(text + '-' + Date.now())`
- The message travels through the GDExtension variant_call pipeline to `RNBridge.on_react_native_message()` in GDScript

### Godot→JS Polling Panel

- **Poll** calls `engine.pollMessage()` on the SPSC lock-free queue
- Messages are dequeued from the C++ SPSC queue (no mutex, no GDExtension calls on the hot path)
- Under the hood, `_relayGodotMessages()` first drains the GDScript `_outgoing_queue` into the SPSC queue in batches of up to 64 messages

### SharedBuffer Stress Tests

Tests `engine.updateSharedBuffer(buffer)` — the zero-copy `ArrayBuffer` pipeline:

| Button | Buffer size | Shows |
|--------|-------------|-------|
| **1 KB** | 1,024 bytes | Baseline latency |
| **1 MB** | 1,048,576 bytes | Mid-range throughput |
| **10 MB** | 10,485,760 bytes | Peak throughput (MB/s) |

The buffer is pre-filled with a test pattern (bytes 0x00–0xFF) before being pushed.

### Native ArrayBuffer Panel

Tests `NitroModules.createNativeArrayBuffer(size)` — allocates a native-owned buffer accessible from JS:

- **Alloc 1KB / 1MB**: Allocates and holds a reference (preventing GC)
- **Release All**: Drops all references (actual memory free is pending GC)
- Watch the **Allocated HOs** and **Native Bufs** counters while allocating and releasing

### Test Results Log

Every API call appends a row showing:
- **Pass / Fail / Pending** badge (colour-coded)
- Detail string (pointer values, error messages, before→after HO counts, throughput)
- Execution time in milliseconds

---

## How It Works

### PCK Asset Extraction

Godot's C++ `FileAccess` cannot read files from inside the iOS IPA bundle or Android APK. The `usePckExtract` hook:

1. Bundles `assets/game.pck` via Metro (registered as an asset extension in `metro.config.js`)
2. Resolves it with `expo-asset` → `Asset.fromModule(require('./assets/game.pck'))`
3. Copies it to `Paths.document` via `expo-file-system`
4. Passes the writable path to `engine.initialize(path)`

### Surface Lifecycle

```
<GodotView /> mounts
  → iOS creates CAMetalLayer* / Android creates ANativeWindow*
  → onSurfaceCreated fires with hex pointer string
  → engine.attachSurface(BigInt(pointer))
  → Godot renders into the provided surface
```

### Messaging Pipeline (Epic 1: SPSC Queue)

**JS → Godot (sendMessage):**
```
engine.sendMessage("hello!")
  → C++ variant_call: global_get_singleton("SceneTree")
  → variant_call("get_root")  
  → variant_call("get_node", "/root/RNBridge")
  → variant_call("on_react_native_message", "hello!")
  → GDScript: emit_signal("message_received", "hello!")
```

**Godot → JS (SPSC queue):**
```
GDScript: RNBridge.send_to_react_native("score:42")
  → Appends to GDScript _outgoing_queue
  → C++ _relayGodotMessages() drains into SPSC queue (batch of 64)
  → JS pollMessage() → try_dequeue() (lock-free, no mutex)
  → rAF drain loop dispatches to onMessage() handlers
```

### OS Lifecycle (Epic 2)

```
App backgrounds → AppState listener in <GodotView />
  → Synthetic "touch up" events for all active fingers (ghost touch mitigation)
  → onAppBackground callback → engine.suspendOS()
  → Godot main loop paused

App foregrounds → AppState listener
  → onAppForeground callback → engine.resumeOS(newSurfacePointer)
  → Godot main loop resumed
```

---

## Using a Real Godot Project

The bundled `assets/game.pck` is a placeholder. To use a real project:

### 1. Create RNBridge AutoLoad

In your Godot project, create `res://RNBridge.gd`:

```gdscript
extends Node
signal message_received(data: String)

var _outgoing_queue: Array[String] = []

func on_react_native_message(payload: String) -> void:
    print("[Godot] Received from React Native: ", payload)
    emit_signal("message_received", payload)

func send_to_react_native(msg: String) -> void:
    _outgoing_queue.append(msg)

func poll_message() -> String:
    if _outgoing_queue.is_empty():
        return ""
    return _outgoing_queue.pop_front()

# Push state updates to React Native's Legend-State store
func sync_state_to_rn(data: Dictionary) -> void:
    send_to_react_native(JSON.stringify({
        "type": "STATE_SYNC",
        "data": data
    }))
```

Register as AutoLoad singleton named **`RNBridge`** in **Project → Project Settings → AutoLoad**.

### 2. Export the .pck

1. Open **Project → Export**
2. Add export template (Android or iOS)
3. Select **Export PCK/ZIP** (not an executable)
4. Save as `game.pck` → copy to `lab/assets/game.pck`

### 3. Rebuild

```bash
npm run prebuild && npm run ios
```

---

## Configuration Files

| File | Purpose |
|------|---------|
| `app.json` | Expo config — bundle ID `net.libgodot.lab` |
| `metro.config.js` | Registers `.pck` as Metro asset extension, `watchFolders` for monorepo |
| `App.tsx` | Entry: `usePckExtract` → `GodotTestScreen` (manual lifecycle + full test UI) |
| `assets/game.pck` | Placeholder `.pck` (replace with your real export) |
| `RNBridge.gd` | Reference GDScript AutoLoad with SPSC relay, async loading, and state sync |

---

## Troubleshooting

### `--main-pack` abort / SIGSEGV in libgodot

```
main/main.cpp:setup(): `--main-pack` was specified, but this Godot binary was compiled
without support for path overrides. Aborting.
```

The Godot engine binary was compiled with `disable_path_overrides=yes`. Recompile with:
```bash
scons disable_path_overrides=no ...
```

Because of this, **do not use the ▶️ Start button** with a misconfigured binary — it will crash the render thread (this is a native SIGSEGV, not catchable from JS). All other panels (Create, Initialize, SharedBuffer, NativeArrayBuffer, Memory Tracker) work fine without starting Godot.

### `Cannot call hybrid function — NativeState is null`

You called an engine method after `dispose()` or after the engine was destroyed. Create a new engine instance with **➕ Create**.

### Metro: "Unable to resolve module react-native-nitro-godot"

The `metro.config.js` must include the parent directory in `watchFolders` and `nodeModulesPaths`. This is already configured — if you still see this, run:

```bash
npx expo start --clear
```

### iOS: "No provisioning profile matching net.libgodot.lab"

1. Open `ios/NitroGodotLab.xcworkspace` in Xcode
2. Select the target → **Signing & Capabilities**
3. Enable **Automatically manage signing**
4. Select your Development Team

### Android: Gradle CMake errors

Ensure NDK version matches (`27.1.12297006`). The library's `build.gradle` requires `buildFeatures.prefab = true` and explicit dependencies on `fbjni` and `react-native-nitro-modules`.
