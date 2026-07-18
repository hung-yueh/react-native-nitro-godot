# 👾 react-native-nitro-godot

[![npm version](https://badge.fury.io/js/react-native-nitro-godot.svg)](https://badge.fury.io/js/react-native-nitro-godot)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![React Native: Fabric](https://img.shields.io/badge/React%20Native-Fabric%20Ready-blue)](https://reactnative.dev/architecture/overview)

A high-performance React Native module that embeds the [Godot Engine](https://godotengine.org/) as a native rendering surface. Built on [Nitro Modules](https://github.com/mrousavy/nitro) for **zero-overhead JSI bridging** — no Swift/Kotlin bridge layer, all communication flows directly through pure C++ and JSI.

## ✨ Features & Philosophy

- **🔓 Zero Vendor Lock-in:** Compile `libgodot` straight from the official Godot source. You keep 100% control over C++ modules, engine features, and updates.
- **⚡️ True Zero-Copy Memory:** Pass massive `ArrayBuffer` payloads (e.g., Mobile AI tensor data) directly from JS to Godot's C++ rendering device without serialization.
- **🛡️ Deterministic UI Performance:** Godot runs on a dedicated background `std::thread`. Even under heavy 3D GPU load, your React Native UI remains perfectly smooth at 120 FPS.
- **🔒 100% Thread Isolation:** Bidirectional lock-free SPSC queues ensure the JS thread **never** calls a single Godot API, and the Godot thread **never** blocks JS. Zero mutexes, zero frame stutters.
- **🔄 Event-Driven Communication:** An intelligent drain loop replaces blind polling — JS only processes messages when Godot enqueues them.
- **📱 OS Lifecycle Safety:** Automatic suspend/resume on app background/foreground with ghost touch mitigation to prevent stuck inputs.
- **🎯 3D→2D Projection:** Synchronous camera matrix math callable from any thread (including Reanimated worklets) for zero-latency UI tracking of 3D targets.
- **📊 CQRS State Sync:** Legend-State v3 observables drive zero-render HUD updates at 60Hz+ without React re-renders.
- **👆 Native Touch Forwarding:** React Native touch events are enqueued lock-free and dispatched on the Godot thread via `Input.parse_input_event()`, allowing built-in Godot UI and physics interactions to work seamlessly.

## 🏗 Architecture

```text
┌──────────────────────────────────────────────────────────┐
│  React Native (JavaScript / TypeScript)                  │
│                                                          │
│   createGodotEngine(pckPath)  → GodotEngineWrapper       │
│       ├── onMessage(handler)  ← event-driven callbacks   │
│       ├── sendMessage(str)    → enqueue (lock-free)      │
│       ├── sendTouchEvent()    → enqueue (lock-free)      │
│       ├── startPolling()      ← rAF drain loop           │
│       ├── loadSceneAsync()    ← async scene loading      │
│       ├── unprojectPosition() ← pure math, atomic read   │
│       ├── suspendOS()         ← app background handler   │
│       └── resumeOS(ptr)       ← app foreground handler   │
│                                                          │
│   useGodotEngine(pckPath)     ← React hook (recommended) │
│       ├── auto start/poll/destroy lifecycle              │
│       ├── STATE_SYNC → Legend-State ingestion            │
│       └── LOAD_PROGRESS → loading state updates         │
│                                                          │
│   <GodotView />               ← native surface component │
│       ├── onSurfaceCreated    ← emits pointer string     │
│       ├── onTouchEvent        ← forwards touch streams   │
│       ├── onAppBackground     ← ghost touch release      │
│       └── onAppForeground     ← resume callback          │
├──────────────────────────────────────────────────────────┤
│  Nitro Modules (JSI / C++)    100% THREAD ISOLATION      │
│                                                          │
│   HybridGodotEngine.cpp                                  │
│       ├── Outbound SPSC       ← Godot→JS messages        │
│       ├── Inbound SPSC        ← JS→Godot messages        │
│       ├── Inbound Touch SPSC  ← JS→Godot touch/drag      │
│       ├── Camera double-buf   ← atomic read/write        │
│       ├── Frame callback      ← register_main_loop_cb    │
│       │    ├── _processInboundMessages  (JS→GDScript)     │
│       │    ├── _processInboundTouches   (JS→Input)        │
│       │    ├── _relayGodotMessages      (GDScript→JS)     │
│       │    └── _updateCameraCache       (Camera→JS)       │
│       ├── libgodot C-API      ← create/destroy instance  │
│       └── GDExtension entry   ← SERVERS + SCENE init     │
├──────────────────────────────────────────────────────────┤
│  Platform Native                                         │
│                                                          │
│   Android: SurfaceView → ANativeWindow* → libgodot       │
│   iOS:     UIView + CAMetalLayer* → libgodot             │
└──────────────────────────────────────────────────────────┘
```

### Thread Safety Model

| Thread            | Allowed Operations                                      | Never Touches                    |
| ----------------- | ------------------------------------------------------- | -------------------------------- |
| **JS (120 Hz)**   | SPSC enqueue, SPSC dequeue, atomic reads                | Godot API, variant_call, classdb |
| **Godot (60 Hz)** | SPSC enqueue, SPSC dequeue, variant_call, atomic writes | JS runtime, JSI                  |

All cross-thread data flows through lock-free SPSC queues or atomic double-buffers. The Godot frame callback (`register_main_loop_callbacks`) processes all queues each frame after `_process()`.

## 📦 Prerequisites

| Dependency    | Version           |
| ------------- | ----------------- |
| React Native  | >= 0.73           |
| Expo          | >= 55 (SDK 55)    |
| Nitro Modules | >= 0.35.0         |
| Godot Engine  | 4.7-stable (pinned) |
| Android NDK   | >= 27             |

### Optional Peer Dependencies

| Package            | Version | For                                   |
| ------------------ | ------- | ------------------------------------- |
| `@legendapp/state` | >= 3.0  | CQRS state sync (Epic 5: zero-render) |

## 🚀 Installation

```bash
npm install react-native-nitro-godot react-native-nitro-modules

# Optional: Legend-State for CQRS zero-render state sync
npm install @legendapp/state@beta
```

### iOS

The podspec links the compiled `libgodot.xcframework` static library from your local `engine_build/output/ios/` directory.

```bash
cd ios && pod install
```

### Android

The Gradle build links your locally compiled `libgodot.so` via CMake. Ensure the NDK and CMake versions match your React Native setup. _(Note: Requires AGP 8.9.1+ and `buildFeatures.prefab = true`)_.

---

## 📖 API Reference

### The `useGodotEngine` Hook (Recommended)

Convenience React hook that manages the full lifecycle with event-driven messaging, touch forwarding, and automatic Legend-State ingestion.

```tsx
import { StyleSheet, View, Text } from "react-native";
import { useGodotEngine, GodotView } from "react-native-nitro-godot";

function GameScreen() {
  const { engineState, lastError, surfaceCallbacks, handleTouchEvent } =
    useGodotEngine(`${FileSystem.documentDirectory}game.pck`, (msg) =>
      console.log("Godot says:", msg),
    );

  return (
    <View style={StyleSheet.absoluteFill}>
      <GodotView
        style={StyleSheet.absoluteFill}
        {...surfaceCallbacks}
        onTouchEvent={handleTouchEvent}
      />
      {engineState === "error" && (
        <Text style={{ color: "red" }}>{lastError}</Text>
      )}
    </View>
  );
}
```

### `createGodotEngine(pckPath)` — Lower-Level Wrapper

For non-React contexts or manual control:

```ts
import { createGodotEngine } from "react-native-nitro-godot";

const engine = createGodotEngine("/path/to/game.pck");
engine.onMessage((msg) => console.log("Godot→JS:", msg));
engine.startPolling(); // rAF drain loop
engine.sendMessage(JSON.stringify({ action: "START_GAME" }));
// Later: engine.destroy();
```

### Core HybridObject Methods (`GodotEngine`)

For advanced manual lifecycle control:

| Method                            | Description                                                                                |
| --------------------------------- | ------------------------------------------------------------------------------------------ |
| `initialize(pckPath: string)`     | Load a `.pck` file (Must be an extracted, absolute file system path).                      |
| `start()`                         | Spawn the render thread; begins the Godot main loop at ~60 Hz.                             |
| `attachSurface(ptr: UInt64)`      | Bind a native OS surface pointer (ANativeWindow* / CAMetalLayer*).                         |
| `updateSharedBuffer(buf)`         | Push a native ArrayBuffer for true zero-copy memory sharing.                               |
| `sendMessage(msg: string)`        | Enqueues a string into the inbound SPSC queue. Dispatched to GDScript on the Godot thread. |
| `pollMessage(): string`           | Pop from the outbound SPSC lock-free queue. Returns `""` if empty. Safe at 120Hz.          |
| `notifyPollingStopped()`          | Resets the wake-up flag after draining. Called automatically by the wrapper.               |
| `suspendOS()`                     | Pause engine on app background. Prevents GPU timeout crashes.                              |
| `resumeOS(ptr: UInt64)`           | Resume engine on foreground. Reattaches the native surface.                                |
| `loadSceneAsync(pckPath: string)` | Kick off async scene loading with progress events via SPSC queue.                          |
| `unprojectPosition(x, y, z)`      | Pure-math 3D→2D projection using cached camera matrices. Thread-safe.                      |
| `sendTouchEvent(x, y, ...)`       | Enqueues a `TouchEvent` struct. Dispatched as `InputEventScreenTouch` on Godot thread.     |
| `sendDragEvent(x, y, ...)`        | Enqueues a `DragEvent` struct. Dispatched as `InputEventScreenDrag` on Godot thread.       |
| `resizeSurface(w, h)`             | Updates Godot viewport + swapchain to match native surface dimensions.                     |
| `getLastError(): string`          | Returns last critical engine error, or `""`. Check when Godot view is blank.               |
| `destroy()`                       | Stop thread and call `libgodot_destroy_godot_instance()`.                                  |

---

## 💬 Two-Way Messaging & GDScript Contract

To enable communication between JS and Godot, you must create an AutoLoad singleton named **`RNBridge`** in your Godot project.

### 1. Godot Setup (`RNBridge.gd`)

Create this script and add it to **Project → Project Settings → AutoLoad**.

```gdscript
extends Node

var _outgoing_queue: Array[String] = []
signal message_received(data: String)

# ─── INCOMING (JS → Godot) ───────────────────────────────
# Called by C++ _processInboundMessages() on the Godot thread.
func on_react_native_message(payload: String) -> void:
    message_received.emit(payload)

    var parsed = JSON.parse_string(payload)
    if parsed is Dictionary:
        var action = parsed.get("action", "")
        if action == "LOAD_SCENE_ASYNC":
            _start_async_load(parsed.get("path", ""))

# ─── OUTGOING (Godot → JS) ───────────────────────────────
# Call this from your game logic to send data to React Native.
# C++ _relayGodotMessages() drains this queue into the outbound SPSC.
func send_to_react_native(msg: String) -> void:
    _outgoing_queue.append(msg)

func poll_message() -> String:
    if _outgoing_queue.is_empty():
        return ""
    return _outgoing_queue.pop_front()

# ─── State Sync ──────────────────────────────────────────
func sync_state_to_rn(data: Dictionary) -> void:
    send_to_react_native(JSON.stringify({
        "type": "STATE_SYNC",
        "data": data
    }))

# ─── Camera Data (3D→2D Projection) ─────────────────────
# Called by C++ _updateCameraCache() on the Godot thread.
# Returns [view_matrix(16), proj_matrix(16), viewport_w, viewport_h]
func get_camera_data() -> PackedFloat32Array:
    var vp := get_viewport()
    if not vp: return PackedFloat32Array()
    var cam := vp.get_camera_3d()
    if not cam or not cam.current: return PackedFloat32Array()
    var result := PackedFloat32Array()
    result.resize(34)
    # ... (see lab/RNBridge.gd for full implementation)
    return result
```

### 2. React Native Setup — Event-Driven (New)

The `useGodotEngine` hook automatically handles message draining. No manual polling needed:

```tsx
const { engine } = useGodotEngine(pckPath, (msg) => {
  // This fires for every message from Godot
  console.log("Godot says:", msg);
});

// Sending to Godot
const spawnEnemy = () =>
  engine.sendMessage(JSON.stringify({ action: "SPAWN" }));
```

Under the hood, an intelligent `requestAnimationFrame` drain loop pulls messages from the lock-free SPSC queue only when data is available.

---

## 🎮 CQRS State Sync (Legend-State v3)

For high-frequency game state updates without React re-renders:

```tsx
import {
  state$,
  dispatchGameIntent,
  HealthBar,
} from "react-native-nitro-godot";

// 1. Dispatch commands (JS → Godot, one-way)
dispatchGameIntent(engine, { action: "EQUIP_SWORD" });

// 2. Read state reactively (zero React re-renders)
// In GDScript: RNBridge.sync_state_to_rn({"player": {"health": 80}})
// → Flows through SPSC queue → Legend-State observable → HealthBar updates

// 3. Use the provided zero-render component
<HealthBar />; // Receives 60Hz updates, React Profiler shows 0 re-renders
```

**Rule:** Godot is the authoritative server; React Native is the reactive client. Never mutate `state$` directly — send intents via `dispatchGameIntent()` and let Godot respond with `STATE_SYNC` events.

---

## 📐 3D→2D Projection

Project 3D world positions to screen coordinates at 120Hz — safe for Reanimated worklets:

```tsx
const [sx, sy] = engine.unprojectPosition(worldX, worldY, worldZ) ?? [0, 0];
// Position a React Native view exactly over a 3D object
```

Uses cached camera matrices (double-buffered, lock-free) — **zero Godot API calls**, pure C++ math.

---

## 🧠 Nitro Memory Tracking & Zero-Copy

`react-native-nitro-godot` leverages Nitro's native memory management for AI/ML workloads. Buffer data is written once from JS and read directly from the render thread with mutex protection.

```tsx
import { NitroModules } from "react-native-nitro-modules";

// 1. Allocate a 10MB native-owned ArrayBuffer (No JS GC overhead)
const buf = NitroModules.createNativeArrayBuffer(10 * 1024 * 1024);
const view = new Float32Array(buf);
view[0] = 0.5; // E.g., Tensor output from On-Device AI

// 2. Push to engine (Zero-copy, pointer handoff only)
engine.updateSharedBuffer(buf);

// 3. Eagerly release memory footprint
NitroModules.updateMemorySize(engine);
engine.dispose();
```

## 🛠 Building Godot from Source

Unlike other solutions, `react-native-nitro-godot` does not restrict you to pre-built binaries. You must compile Godot as a library directly from the pinned version (**4.7-stable**). The provided `build_godot.sh` handles downloading, patching, compiling, and verification.

See [`engine_build/README.md`](engine_build/README.md) and [`engine_build/patches/README.md`](engine_build/patches/README.md) for details.

```bash
# Build both Android and iOS (from the repo root)
cd engine_build && ./build_godot.sh
```

> **Important**: The build script automatically applies version-pinned `.patch` files. If you upgrade the Godot version, regenerate patches — see `engine_build/patches/README.md`.

---

## 🧪 Testing

Run the full test suite:

```bash
npm test
```

### TypeScript Tests (Jest)

| Test File                    | Coverage                                                                                              |
| ---------------------------- | ----------------------------------------------------------------------------------------------------- |
| `godotState.test.ts`         | `ingestStateSync` merging, damage sequences, enemy map, edge cases                                    |
| `GodotEngine.test.ts`        | Message handler subscribe/unsubscribe, multi-handler dispatch, error resilience, drain loop lifecycle |
| `dispatchGameIntent.test.ts` | Intent serialization, payload preservation                                                            |

### C++ Compile-Time Test

`cpp/tests/test_proc_resolution.h` validates that `GDExtensionProcs::resolve()` correctly handles renamed/removed GDExtension API names across Godot versions. This guards against the class of bugs where a Godot API rename silently nulls out critical function pointers, breaking the Godot→JS message pipeline with no error.

**What it tests:**
- Simulates a "new Godot" environment where old API names (e.g. `get_type_from_variant_constructor`) return `nullptr`
- Verifies `resolve()` falls back to the correct new names (e.g. `get_variant_to_type_constructor`)
- Verifies removed destructors (`string_name_destroy`, `string_destroy`) resolve via `variant_get_ptr_destructor` fallback
- Runs automatically at library load time and logs results to logcat / Xcode console

**How to enable:**

Add the `-DTEST_PROC_RESOLUTION` preprocessor flag to your native build:

**Android** — add to `android/CMakeLists.txt`:

```cmake
# After the add_library(NitroGodot ...) block:
target_compile_definitions(NitroGodot PRIVATE TEST_PROC_RESOLUTION)
```

**iOS** — add to `react-native-nitro-godot.podspec` inside the `pod_target_xcconfig`:

```ruby
s.pod_target_xcconfig = {
  # ... existing config ...
  "GCC_PREPROCESSOR_DEFINITIONS" => "$(inherited) TEST_PROC_RESOLUTION=1",
}
```

Then rebuild (`npm run android:device` or `npm run ios:device`). Check native logs for:

```
PROC TEST: All 16 checks passed ✓
```

> **Note:** Remove the flag for production builds — the test adds a static constructor that runs at startup.

---

## 🔧 Troubleshooting

### Godot View Not Rendering (Blank Screen)

1. **Check `lastError` from the hook:**

   ```tsx
   const { lastError } = useGodotEngine(pckPath);
   // If non-null, a critical engine error occurred
   console.log("lastError:", lastError);
   ```

2. **Check native logs for `[NitroGodot]` prefixed messages:**

   ```bash
   # Android
   adb logcat -s NitroGodot:* '*:S'

   # iOS (Xcode Console)
   # Filter by: [NitroGodot]
   ```

3. **Common causes:**
   | Symptom | Likely Cause | Fix |
   |---|---|---|
   | `libgodot_create_godot_instance returned null` | Missing/wrong PCK file | Verify pckPath, ensure PCK exported from matching Godot version |
   | `Missing GDExtension procs` | stale libgodot binary | Rebuild engine: `cd engine_build && ./build_godot.sh` |
   | `Failed to set up Android JNI context` | JNI environment error | Ensure React Native activity is running |
   | Crash on startup + `RendererCompositor singleton` | Double init (iOS) | Check for multiple `GodotView` mounts |

### Build Errors

- **Patch failed to apply**: Godot source doesn't match the pinned version. Re-download the correct tarball or regenerate patches.
- **`_libgodot_create_godot_instance` undefined**: The entry point file wasn't included in the build. Check that patches 0001/0002 applied correctly.
- **iOS `nm` check fails**: Rebuild `libgodot.xcframework` — the static library must contain the C-API symbols.

### Engine Error Pipeline

Critical errors flow through a structured pipeline:

```text
C++ LOGE() → _setLastError(layer, msg)
  ├── Stored in last_error_ (readable via getLastError())
  └── Pushed to SPSC queue as ENGINE_ERROR JSON
        └── useGodotEngine → setLastError(msg), setEngineState('error')
              └── console.error(msg)
```

## License

MIT
