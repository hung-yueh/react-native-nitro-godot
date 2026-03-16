# Add `libgodot_set_native_window` to C-API to Support Embedding LibGodot into Existing Native UI Hierarchies

## Describe the project you are working on

We are embedding Godot 4.6+ as a shared library (`LibGodot`) inside a React Native (Expo) application, enabling native 3D rendering on iOS and Android alongside standard UI components. We use `libgodot_create_godot_instance` to boot the engine in-memory and a GDExtension entry point for scripting via the Nitro Modules / JSI bridge.

---

## Describe the problem or limitation

`libgodot_create_godot_instance` (introduced in **PR #110863**) boots the engine successfully, but there is currently no standardized way for a host application to provide an existing OS-level rendering surface *before* `DisplayServer` initialises. The host UI framework already owns the window — Godot must render *into* it, not create a new one.

Without a dedicated API, the only options are fragile, platform-specific workarounds:

| Platform | Current workaround |
|----------|--------------------|
| Android  | Manually invoke the internal `GodotLib.newcontext(Surface)` JNI bridge, bypassing the C-API entirely |
| iOS      | Use a GDExtension `SERVERS`-level init hook to locate `DisplayServerIOS` via `get_proc_address` and inject a `CAMetalLayer*` through an undocumented path |
| Windows  | No documented path exists; a host `HWND` cannot be provided to the `DisplayServerWindows` boot sequence |

These approaches break across minor Godot versions and impose significant integration maintenance on every framework that embeds LibGodot (React Native, Flutter, Qt, SwiftUI, Unreal co-rendering, etc.).

---

## Describe the feature / enhancement

Add a single function to `libgodot.h` that lets a host application register a native window handle *before* booting the engine. The `DisplayServer` reads this pointer during `initialize()` and renders into the provided surface instead of requesting a new OS window.

This is a well-established pattern across graphics and UI frameworks:

- **SDL**: `SDL_CreateWindowFrom(void* native_handle)`
- **Qt**: `QWindow::fromWinId(WId handle)`
- **WebGPU / Dawn**: `SurfaceDescriptorFromWindowsHWND` / `SurfaceDescriptorFromMetalLayer`

---

## Proposed API (`libgodot.h`)

```c
/**
 * Provide a native OS window/surface handle to LibGodot before the engine boots.
 *
 * MUST be called before libgodot_create_godot_instance().
 *
 * The engine's DisplayServer will render into this surface instead of
 * creating a new OS window. Ignored if NULL.
 *
 * Platform-specific handle types:
 *   Android : ANativeWindow*        (from ANativeWindow_fromSurface())
 *   iOS     : CAMetalLayer*         (UIView.layer via +layerClass override)
 *   macOS   : CAMetalLayer* / NSView*
 *   Windows : HWND
 *   Linux   : wl_surface* (Wayland) / Window XID (X11)
 */
GDE_EXPORT void libgodot_set_native_window(void *p_godot_instance, void *p_os_surface);
```

### Correct call sequence for host applications

```cpp
// 1. Obtain the OS surface from your UI framework
void* surface = get_metal_layer_or_anative_window();

// 2. Register it — BEFORE the engine boots
libgodot_set_native_window(godot_instance, surface);

// 3. Boot the engine; DisplayServer adopts the provided surface
libgodot_create_godot_instance(argc, argv, &gdext_entry_func);

// 4. Drive the render loop
while (running) {
    libgodot_iteration(godot_instance);
}
```

### Engine-side implementation sketch

The implementation requires two small changes:

**`libgodot.cpp`** — store the pointer:
```cpp
void libgodot_set_native_window(void *p_instance, void *p_os_surface) {
    // Store as pending state on the OS singleton (thread-safe atomic)
    OS::get_singleton()->set_pending_native_window(p_os_surface);
}
```

**Each `DisplayServer` platform implementation** — consume it at init:
```cpp
void DisplayServerAndroid::initialize() {
    if (void* surface = OS::get_singleton()->get_pending_native_window()) {
        // Use the host-provided surface — skip OS window creation
        _adopt_external_surface(static_cast<ANativeWindow*>(surface));
    } else {
        // Existing path: request a new surface from the OS
        _create_os_window();
    }
}
```

The same pattern applies to `DisplayServerIOS`, `DisplayServerWindows`, `DisplayServerMacOS`, and `DisplayServerLinuxBSD`.

---

## If this enhancement will not be used often, can it be worked around with a few lines of script?

No. This requires a one-time C-API addition and a small guard in each platform's `DisplayServer::initialize()`. The workarounds currently required (JNI bridges, undocumented `get_proc_address` hacks) mean every framework embedding LibGodot must independently re-solve the same platform-specific bootstrapping problem. There is no GDScript or GDExtension equivalent.

---

## Is there a reason why this should be core and not an add-on in the asset library?

Yes. `LibGodot` is a core feature, and a first-class embedding API must include surface injection. Without it, every team attempting to use Godot as an embedded rendering engine — inside React Native, Flutter, SwiftUI, Qt, or a custom game engine — will independently arrive at the same fragile workarounds described above.

Standardising this in `libgodot.h` is the minimal, backward-compatible change that makes Godot genuinely viable as a composable rendering layer alongside other UI frameworks — a significant expansion of the Godot ecosystem's reach.
