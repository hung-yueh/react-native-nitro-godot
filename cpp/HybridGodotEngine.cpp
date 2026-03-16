///
/// HybridGodotEngine.cpp — Phase 6: GDExtension Variant Messaging Pipeline
///
/// Surface injection:
///   pending_surface_ is stored by attachSurface().
///   The render thread reads it before calling libgodot_create_godot_instance().
///   On Android: passed to Godot via os_android->set_native_window(), but this
///   requires calling through the GodotLib JNI layer (see GodotSurfaceView.kt).
///   On iOS:     CAMetalLayer* is set through platform init path.
///
/// GDExtension p_init_func (gdext_entry):
///   Fires at CORE → SERVERS → SCENE init levels inside libgodot_create_godot_instance.
///   – At SCENE: stores get_proc address and probes Engine singleton → sets live = true.
///
/// sendMessage() messaging pipeline:
///   Uses variant_call (no MethodBind hash needed) to call on Godot SceneTree.
///   Pipeline: global_get_singleton("SceneTree") → variant_call("get_root")
///             → variant_call("get_node", "/root/RNBridge")
///             → variant_call("on_react_native_message", payload_string)
///
/// Thread safety:
///   gdext_state_ is a shared_ptr; the render thread writes it, arbitrary threads
///   read it. The live flag is atomic<bool>. get_proc is written once (before live
///   is set to true) so the release/acquire of live provides the necessary ordering.
///

#include "HybridGodotEngine.hpp"
#include "GDExtensionTypes.h"

#include <chrono>
#include <cstdlib>
#include <cstring>
#include <iostream>

#if defined(__ANDROID__)
  #include <dlfcn.h>
  #include <jni.h>
  #include <android/log.h>
  #include <android/asset_manager.h>
  #include <android/asset_manager_jni.h>
  #include <android/native_window.h>
  #define LOGI(...) __android_log_print(ANDROID_LOG_INFO,  "NitroGodot", __VA_ARGS__)
  #define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, "NitroGodot", __VA_ARGS__)

  // Defined in GodotOnLoad.cpp
  extern JavaVM* NitroGodot_GetJavaVM();

  // Exported from libgodot.so (defined in our generated libgodot_android.cpp)
  extern "C" void libgodot_android_setup(JavaVM *p_jvm, JNIEnv *p_env, jobject p_asset_manager, ANativeWindow *p_native_window);

  /// Set up Android-specific Godot context (AAssetManager, JNI thread)
  /// before calling libgodot_create_godot_instance().
  ///
  /// Without this, Godot's FileAccessAndroid hits a NULL AAssetManager
  /// and SIGSEGVs during Main::setup().
  ///
  /// Uses the exported libgodot_android_setup() C-API from libgodot_android.cpp.
  static bool _setupGodotAndroidContext(ANativeWindow* p_native_window) {
    JavaVM* jvm = NitroGodot_GetJavaVM();
    if (!jvm) {
      LOGE("_setupGodotAndroidContext: JavaVM is null\n");
      return false;
    }

    JNIEnv* env = nullptr;
    bool attached = false;
    jint res = jvm->GetEnv(reinterpret_cast<void**>(&env), JNI_VERSION_1_6);
    if (res == JNI_EDETACHED) {
      res = jvm->AttachCurrentThread(&env, nullptr);
      attached = true;
    }
    if (res != JNI_OK || !env) {
      LOGE("_setupGodotAndroidContext: Failed to get JNIEnv\n");
      return false;
    }

    // Get current app context via ActivityThread.currentApplication()
    jclass atClass = env->FindClass("android/app/ActivityThread");
    if (!atClass) {
      LOGE("_setupGodotAndroidContext: Cannot find ActivityThread\n");
      if (attached) jvm->DetachCurrentThread();
      return false;
    }
    jmethodID currentApp = env->GetStaticMethodID(atClass, "currentApplication",
                                                   "()Landroid/app/Application;");
    jobject app = env->CallStaticObjectMethod(atClass, currentApp);
    if (!app) {
      LOGE("_setupGodotAndroidContext: currentApplication() returned null\n");
      if (attached) jvm->DetachCurrentThread();
      return false;
    }

    // Get AssetManager from Context.getAssets()
    jclass ctxClass = env->FindClass("android/content/Context");
    jmethodID getAssets = env->GetMethodID(ctxClass, "getAssets",
                                           "()Landroid/content/res/AssetManager;");
    jobject jAssetMgr = env->CallObjectMethod(app, getAssets);
    if (!jAssetMgr) {
      LOGE("_setupGodotAndroidContext: getAssets() returned null\n");
      if (attached) jvm->DetachCurrentThread();
      return false;
    }

    // Call the exported Godot C-API to set up AssetManager + JNI thread
    libgodot_android_setup(jvm, env, jAssetMgr, p_native_window);
    LOGI("_setupGodotAndroidContext: SUCCESS (native_window=%p)\n", p_native_window);

    // Don't detach — Godot will use this thread's JNI env.
    return true;
  }
#else
  #define LOGI(...) do { fprintf(stderr, "[NitroGodot] "); fprintf(stderr, __VA_ARGS__); } while(0)
  #define LOGE(...) do { fprintf(stderr, "[NitroGodot] "); fprintf(stderr, __VA_ARGS__); } while(0)
  #if defined(__APPLE__)
    #include "GodotRenderingBridge.h"
    #include <dispatch/dispatch.h>
  #endif
#endif

namespace margelo::nitro::godot {

// Opaque type sizes and typedefs are defined in GDExtensionTypes.h

// ─── Global engine pointer for Godot frame callback ──────────────────────────
// Set in start(), cleared in destroy(). Only accessed from the Godot thread
// (via the frame callback) and from start()/destroy() (which are serialised).
static HybridGodotEngine* g_engine = nullptr;

// Set to true AFTER GodotInstance::start() completes successfully.
// The frame callback is a no-op until this is true, preventing
// SceneTree lookups before the main loop has been created.
static std::atomic<bool> g_godot_started{false};

// ── Process-wide Godot init guard ────────────────────────────────────────────
// Godot uses process-wide C++ static singletons (RendererCompositor, etc.)
// that Main::cleanup() does NOT fully reset. A second call to
// libgodot_create_godot_instance() — even from a NEW HybridGodotEngine
// object (e.g. after Expo hot reload) — corrupts global state and crashes.
// These statics ensure only ONE init attempt ever happens per process.
static bool g_godot_init_attempted = false;
static void* g_godot_instance = nullptr;

// Static GDExtension state pointer — set in start() before calling
// libgodot_create_godot_instance(), read in gdext_entry/gdext_initialize.
// Needed because libgodot_create_godot_instance() doesn't pass our init_struct
// to gdext_entry — Godot creates its own GDExtensionInitialization internally.
static std::shared_ptr<HybridGodotEngine::GodotExtensionState> s_gdext_state;

// ─── Proc address compatibility shim ─────────────────────────────────────────

/// Load proc address and cast to target function pointer type.
/// Returns nullptr if the function is not available.
///
/// Includes a compatibility layer for Godot 4.6-dev (master) where certain
/// GDExtension interface function names were removed or renamed:
///   - "string_name_destroy" → resolved via variant_get_ptr_destructor(STRING_NAME)
///   - "string_destroy"      → resolved via variant_get_ptr_destructor(STRING)
///   - "get_type_from_variant_constructor" → renamed to "get_variant_to_type_constructor"
///   - "packed_float32_array_destroy" → resolved via variant_get_ptr_destructor(PACKED_FLOAT32_ARRAY)
template <typename FnT>
static FnT load_proc(GDExtensionInterfaceGetProcAddress get_proc, const char* name) {
  // ── Compatibility: check for removed/renamed names BEFORE calling get_proc ──
  // get_proc() internally calls GDExtension::get_interface_function() which logs
  // a warning for unknown names. We intercept known-bad names first to avoid
  // flooding the log.

  // Helper: resolve a type destructor via variant_get_ptr_destructor(type)
  using FnGetPtrDestructor = void(*(*)(GDExtensionVariantType))(GDExtensionTypePtr);
  auto resolve_destructor = [&](GDExtensionVariantType type) -> FnT {
    static FnGetPtrDestructor getter = nullptr;
    if (!getter) {
      auto raw = get_proc("variant_get_ptr_destructor");
      if (!raw) return nullptr;
      getter = reinterpret_cast<FnGetPtrDestructor>((void*)raw);
    }
    auto dtor = getter(type);
    return reinterpret_cast<FnT>((void*)dtor);
  };

  // Destructors removed in 4.6-dev — resolve via variant_get_ptr_destructor
  if (strcmp(name, "string_name_destroy") == 0) {
    return resolve_destructor(GDEXTENSION_VARIANT_TYPE_STRING_NAME);
  }
  if (strcmp(name, "string_destroy") == 0) {
    return resolve_destructor(GDEXTENSION_VARIANT_TYPE_STRING);
  }
  if (strcmp(name, "packed_float32_array_destroy") == 0) {
    return resolve_destructor(GDEXTENSION_VARIANT_TYPE_PACKED_FLOAT32_ARRAY);
  }

  // Renamed in 4.6-dev
  if (strcmp(name, "get_type_from_variant_constructor") == 0) {
    auto fn = get_proc("get_variant_to_type_constructor");
    if (fn) return reinterpret_cast<FnT>((void*)fn);
    return nullptr;
  }

  // Removed in 4.6-dev — callers handle nullptr gracefully
  if (strcmp(name, "packed_float32_array_size") == 0) {
    return nullptr;  // caller falls back to variant_call("size") or skips
  }

  // ── Standard lookup ────────────────────────────────────────────────────────
  auto fn = get_proc(name);
  if (fn) return reinterpret_cast<FnT>((void*)fn);
  return nullptr;
}

// ─── Godot thread frame callback ─────────────────────────────────────────────
//
// Registered via register_main_loop_callbacks in gdext_initialize.
// Runs on the Godot thread after all _process() methods, before ScriptServer::frame().
// This is the ONLY place where variant_call into Godot's SceneTree is safe.
//
static void _godot_frame_callback() {
  if (!g_engine) return;
  // Don't attempt SceneTree lookups until GodotInstance::start() has completed.
  // Before start(), SceneTree doesn't exist and global_get_singleton logs errors.
  if (!g_godot_started.load(std::memory_order_acquire)) return;

  // 0. Apply pending viewport resize (from resizeSurface())
  g_engine->_applyViewportResize();

  // 1. Process JS → Godot (Inbound: Commands & Touch Input)
  g_engine->_processInboundMessages();
  g_engine->_processInboundTouches();
  // 2. Process Godot → JS (Outbound: State Sync & Camera Cache)
  g_engine->_relayGodotMessages();
  g_engine->_updateCameraCache();
}

// ─── GDExtension init callbacks ───────────────────────────────────────────────

static void gdext_initialize(void* p_userdata, GDExtensionInitializationLevel level) {
  auto* state = s_gdext_state.get();
  if (!state) return;

  if (level == GDEXTENSION_INITIALIZATION_SCENE) {
    // ── Resolve all GDExtension proc addresses (once) ────────────────────
    if (!state->procs.resolve(state->get_proc)) {
      LOGE("SCENE init: failed to resolve critical GDExtension procs\n");
      return;
    }

    // ── Probe Engine singleton to verify runtime is live ──────────────────
    const auto& P = state->procs;
    alignas(void*) uint8_t sn_engine[kStringNameSize] = {};
    P.sn_new(sn_engine, "Engine", false);
    GDExtensionObjectPtr engine = P.get_singleton(sn_engine);
    if (P.sn_destroy) P.sn_destroy(sn_engine);

    if (!engine) {
      LOGE("SCENE init: Engine singleton unreachable\n");
      return;
    }

    // ── Mark live (atomic release — all writes above happen-before) ───────
    // procs are fully populated above; setting live=true provides the
    // acquire fence for all consumers (sendMessage, frame callback, etc.).
    state->live.store(true, std::memory_order_release);
    LOGI("SCENE init: Engine singleton reachable — messaging pipeline live\n");

    // ── Register main loop frame callback ─────────────────────────────────
    // Runs _relayGodotMessages() and _updateCameraCache() on the Godot thread
    // each frame, AFTER all _process() methods.
    using FnRegisterMLCB = void(*)(GDExtensionClassLibraryPtr, const GDExtensionMainLoopCallbacks*);
    auto register_ml_cb = reinterpret_cast<FnRegisterMLCB>(
        (void*)state->get_proc("register_main_loop_callbacks"));
    if (register_ml_cb && state->library) {
      GDExtensionMainLoopCallbacks ml_cbs{};
      ml_cbs.startup_func  = nullptr;
      ml_cbs.shutdown_func = nullptr;
      ml_cbs.frame_func    = _godot_frame_callback;
      register_ml_cb(state->library, &ml_cbs);
      LOGI("SCENE init: main loop frame callback registered\n");
    } else {
      LOGE("SCENE init: register_main_loop_callbacks not available\n");
    }
  }

  if (level == GDEXTENSION_INITIALIZATION_SERVERS) {
    // SERVERS fires while DisplayServer is being initialized.
    // The pending_surface_ pointer is available here, but injecting it
    // requires calling OS_Android::set_native_window() which is only accessible
    // via Godot's internal C++ API, not through GDExtension.
    //
    // Future fix: add libgodot_set_native_window(void*) to libgodot.h.
    //
    LOGI("SERVERS init: DisplayServer initializing — surface injection deferred to GodotLib JNI path\n");
  }
}

static void gdext_deinitialize(void* p_userdata, GDExtensionInitializationLevel level) {
  if (level == GDEXTENSION_INITIALIZATION_SCENE) {
    auto* state = s_gdext_state.get();
    if (state) {
      state->live.store(false, std::memory_order_release);
      LOGI("SCENE deinit: messaging pipeline shut down\n");
    }
  }
}

// Entry point passed as p_init_func to libgodot_create_godot_instance.
static GDExtensionBool gdext_entry(
    GDExtensionInterfaceGetProcAddress p_get_proc_address,
    GDExtensionClassLibraryPtr         p_library,
    GDExtensionInitialization*         r_initialization)
{
  LOGI("gdext_entry CALLED — get_proc=%p library=%p init=%p s_gdext_state=%p\n",
       (void*)p_get_proc_address, (void*)p_library, (void*)r_initialization,
       (void*)s_gdext_state.get());

  auto* state = s_gdext_state.get();
  if (!state) {
    LOGE("gdext_entry: s_gdext_state is null!\n");
    return 0;
  }

  // store get_proc before live is set — provides happens-before for sendMessage reads
  state->get_proc = p_get_proc_address;
  state->library  = p_library;

  r_initialization->minimum_initialization_level = GDEXTENSION_INITIALIZATION_SERVERS;
  r_initialization->initialize   = gdext_initialize;
  r_initialization->deinitialize = gdext_deinitialize;

  LOGI("gdext_entry returning 1 (SUCCESS)\n");
  return 1;
}

// ─── Lifecycle ───────────────────────────────────────────────────────────────

void HybridGodotEngine::initialize(const std::string& pckPath) {
  // Expo's File.uri returns "file:///path/…" but Godot expects a plain
  // filesystem path. Strip the scheme prefix if present.
  const std::string kFileScheme = "file://";
  if (pckPath.rfind(kFileScheme, 0) == 0) {
    pck_path_ = pckPath.substr(kFileScheme.size());
  } else {
    pck_path_ = pckPath;
  }

  // Create the GDExtension state object shared with the render thread lambda.
  gdext_state_ = std::make_shared<GodotExtensionState>();
  LOGI("initialize() — pck: %s\n", pck_path_.c_str());
}

void HybridGodotEngine::start() {
  if (is_running_.load()) return;
  if (!gdext_state_) {
    LOGE("start() called before initialize() — aborting\n");
    _setLastError("init", "start() called before initialize()");
    return;
  }

  // ── Guard: Godot can only be instantiated ONCE per process. ─────────────
  // libgodot_create_godot_instance → Main::setup() uses process-wide static
  // singletons (OS_IOS, PackedData, etc.) that Main::cleanup() does NOT
  // fully reset.  A second call — even if the first one FAILED — always
  // corrupts global state and crashes in PackedData::~PackedData().
  // g_godot_init_attempted is a FILE-STATIC (not member) so a new
  // HybridGodotEngine object (e.g. from Expo hot reload) won't bypass it.
  if (g_godot_init_attempted) {
    LOGI("start() — Godot init already attempted, resuming (no re-init)\n");
    godot_instance_ = g_godot_instance;  // reuse existing instance
    is_running_ = true;
    is_paused_  = false;
    return;
  }

  is_running_ = true;
  is_paused_  = false;
  g_engine    = this;

  // ── Set the init guard IMMEDIATELY (before spawning the thread) ─────────
  // Two concurrent start() calls from React can race past the guard above
  // unless we set the flag HERE, before the render thread is created.
  g_godot_init_attempted = true;

  // Join any previous thread that finished but was never joined.
  // Assigning to a joinable std::thread calls std::terminate().
  _stopAndJoinThread();

  // Capture shared state by value (bump ref count for the lambda).
  auto gdext_state_copy = gdext_state_;

  render_thread_ = std::thread([this, gdext_state_copy]() {
    LOGI("render_thread_ started\n");

    // ── Wait for surface from React Native ──────────────────────────────
    // The <GodotView> component fires onSurfaceCreated which calls
    // attachSurface() from JS. We poll for up to 5 seconds to allow the
    // surface to arrive before falling back to headless mode.
    void* surface = nullptr;
    for (int i = 0; i < 100 && is_running_; ++i) {
      surface = pending_surface_.load(std::memory_order_acquire);
      if (surface) break;
      std::this_thread::sleep_for(std::chrono::milliseconds(50));
    }
    bool has_surface = (surface != nullptr);
    if (has_surface) {
      LOGI("start() — ANativeWindow/CAMetalLayer stored: 0x%llx\n",
           (unsigned long long)(uintptr_t)surface);
    }

#if defined(__APPLE__) && !defined(__ANDROID__)
    // ── iOS: Inject CAMetalLayer into Godot stubs ─────────────────────────
    // The display server reads GDTAppDelegateService.viewController.godotView
    // during init. We must wire the layer BEFORE libgodot_create_godot_instance.
    // Must dispatch to main thread since it accesses UIKit APIs.
    if (has_surface) {
      dispatch_sync(dispatch_get_main_queue(), ^{
        godot_rendering_bridge_set_layer(surface);
      });
      LOGI("Injected CAMetalLayer into GDTAppDelegateService stub\n");
    }
#endif

    // ── Wire GDExtension state for static gdext_entry callback ───────────
    s_gdext_state = gdext_state_copy;

    // ── Build argv ────────────────────────────────────────────────────────
    // When a native surface is available (CAMetalLayer on iOS, ANativeWindow
    // on Android), start with rendering enabled. Otherwise fall back to
    // --headless to avoid Metal/Vulkan init crashes.
    std::vector<char*> argv_vec;
    argv_vec.push_back(const_cast<char*>("godot"));
    if (!has_surface) {
      argv_vec.push_back(const_cast<char*>("--headless"));
      LOGI("No surface available — starting headless\n");
    }
    argv_vec.push_back(const_cast<char*>("--verbose"));
    argv_vec.push_back(const_cast<char*>("--main-pack"));
    argv_vec.push_back(const_cast<char*>(pck_path_.c_str()));
    argv_vec.push_back(nullptr);
    int argc = static_cast<int>(argv_vec.size()) - 1; // exclude nullptr

    // g_godot_init_attempted already set in start() above (before thread spawn).

#if defined(__APPLE__) && !defined(__ANDROID__)
    // On iOS, Godot's DisplayServer constructor (created during
    // GodotInstance::start → Main::setup2) calls UIKit APIs like
    // [UIApplication setIdleTimerDisabled:] which MUST run on the main
    // thread. We dispatch_sync to the main queue for both the instance
    // creation and the initial start() call. The render loop (iteration)
    // can then run on our background thread safely.
    __block void* instance_result = nullptr;
    int argc_copy = argc;
    char** argv_ptr = argv_vec.data();
    auto* gdext_ptr = &gdext_entry;
    dispatch_sync(dispatch_get_main_queue(), ^{
      instance_result = libgodot_create_godot_instance(argc_copy, argv_ptr, gdext_ptr);
    });
    godot_instance_ = instance_result;
    g_godot_instance = instance_result;
#else
    // ── Android: Set up Godot's Android context before instance creation ──
    // Godot's FileAccessAndroid needs a valid AAssetManager from the host
    // Activity. Our bridge bypasses GodotLib.initialize() which normally
    // sets this. Without this call → SIGSEGV in AAssetManager_open().
    if (!_setupGodotAndroidContext(has_surface ? static_cast<ANativeWindow*>(surface) : nullptr)) {
      LOGE("Failed to set up Godot Android context — Godot init will likely crash\n");
      _setLastError("init", "Failed to set up Android JNI context");
    }
    godot_instance_ = libgodot_create_godot_instance(argc, argv_vec.data(), &gdext_entry);
    g_godot_instance = godot_instance_;
#endif

    if (!godot_instance_) {
      LOGE("libgodot_create_godot_instance() returned null\n");
      _setLastError("init", "libgodot_create_godot_instance() returned null — engine failed to initialize");
      is_running_ = false;
      LOGI("render_thread_ exiting (no instance)\n");
      return;
    }

    LOGI("Godot instance created — calling start() and entering render loop\n");

#if defined(__APPLE__) && !defined(__ANDROID__)
    // ── iOS: Apply the stored CAMetalLayer to GDTView frames ───────────
    // Now that Godot is initialized (ProjectSettings available), we can
    // safely trigger GDTView creation and frame setup.
    // Must run on main thread since it creates UIKit views.
    if (has_surface) {
      dispatch_sync(dispatch_get_main_queue(), ^{
        godot_rendering_bridge_apply_layer();
      });
      LOGI("Applied CAMetalLayer to GDTView after Godot init\n");
    }
#endif

    // ── Start the Godot main loop via variant_call ─────────────────────────
    // GodotInstance::start() calls Main::setup2() + Main::start() +
    // MainLoop::initialize(). After this, iteration() can be called.
    auto get_proc = gdext_state_copy->get_proc;
    if (!get_proc) {
      LOGE("get_proc not available — cannot call start/iteration\n");
      _setLastError("init", "GDExtension get_proc not available");
      is_running_ = false;
      return;
    }

    using FnSNNewLatin1 = void(*)(GDExtensionUninitializedStringNamePtr, const char*, GDExtensionBool);
    using FnSNDestroy   = void(*)(GDExtensionVariantPtr);
    using FnGetVarFromType = GDExtensionVariantFromTypeConstructorFunc(*)(GDExtensionVariantType);
    using FnVariantCall = void(*)(GDExtensionVariantPtr, GDExtensionConstStringNamePtr,
                                  const GDExtensionConstVariantPtr*, GDExtensionInt,
                                  GDExtensionUninitializedVariantPtr, GDExtensionCallError*);
    using FnVariantNew   = void(*)(GDExtensionUninitializedVariantPtr);
    using FnVariantDestroy = void(*)(GDExtensionVariantPtr);

    auto sn_new      = load_proc<FnSNNewLatin1>(get_proc, "string_name_new_with_latin1_chars");
    auto sn_destroy  = load_proc<FnSNDestroy>(get_proc, "string_name_destroy");
    auto get_var_from_type = load_proc<FnGetVarFromType>(get_proc, "get_variant_from_type_constructor");
    auto var_call    = reinterpret_cast<FnVariantCall>((void*)get_proc("variant_call"));
    auto var_new_nil = reinterpret_cast<FnVariantNew>((void*)get_proc("variant_new_nil"));
    auto var_destroy = reinterpret_cast<FnVariantDestroy>((void*)get_proc("variant_destroy"));

    if (!sn_new || !get_var_from_type || !var_call || !var_new_nil || !var_destroy) {
      LOGE("Missing GDExtension procs for start/iteration\n");
      _setLastError("init", "Missing GDExtension procs for start/iteration");
      is_running_ = false;
      return;
    }

    // Local stack slot types (same as SNSlot/VSlot defined later in file)
    struct LVSlot { alignas(void*) uint8_t data[kVariantSize] = {}; };
    struct LSNSlot { alignas(void*) uint8_t data[kStringNameSize] = {}; };

    // Wrap godot_instance_ in a Variant (OBJECT type)
    auto obj_to_variant = get_var_from_type(GDEXTENSION_VARIANT_TYPE_OBJECT);
    LVSlot var_instance;
    obj_to_variant(var_instance.data, &godot_instance_);

    // Call GodotInstance::start()
    // On iOS this must run on the main thread because Main::setup2()
    // creates the DisplayServer which makes UIKit calls.
    {
      LSNSlot sn_start;
      sn_new(sn_start.data, "start", false);
      LVSlot var_ret;
      var_new_nil(var_ret.data);
      GDExtensionCallError err{};

#if defined(__APPLE__) && !defined(__ANDROID__)
      {
        GDExtensionVariantPtr vi_ptr = var_instance.data;
        GDExtensionConstStringNamePtr sn_ptr = sn_start.data;
        GDExtensionUninitializedVariantPtr vr_ptr = var_ret.data;
        __block GDExtensionCallError blk_err{};
        dispatch_sync(dispatch_get_main_queue(), ^{
          var_call(vi_ptr, sn_ptr, nullptr, 0, vr_ptr, &blk_err);
        });
        err = blk_err;
      }
#else
      var_call(var_instance.data, sn_start.data, nullptr, 0, var_ret.data, &err);
#endif
      if (sn_destroy) sn_destroy(sn_start.data);

      if (err.error != GDEXTENSION_CALL_OK) {
        LOGE("GodotInstance::start() variant_call failed — error: %d\n", err.error);
        _setLastError("init", "GodotInstance::start() variant_call failed");
        var_destroy(var_ret.data);
        is_running_ = false;
        var_destroy(var_instance.data);
        return;
      }

      // Extract the bool return value from the Variant
      // start() returns bool — check if it returned false (Main::setup2 or Main::start failed)
      using FnGetTypeFromVar = GDExtensionTypeFromVariantConstructorFunc(*)(GDExtensionVariantType);
      auto get_type_from_var = load_proc<FnGetTypeFromVar>(get_proc, "get_type_from_variant_constructor");
      if (get_type_from_var) {
        auto bool_from_variant = get_type_from_var(GDEXTENSION_VARIANT_TYPE_BOOL);
        if (bool_from_variant) {
          GDExtensionBool start_result = 0;
          bool_from_variant(&start_result, var_ret.data);
          LOGI("GodotInstance::start() returned: %s\n", start_result ? "true" : "false");
          if (!start_result) {
            LOGE("GodotInstance::start() returned false — Main::setup2() or Main::start() failed!\n");
            _setLastError("init", "Godot Main::start() failed — check PCK path and engine configuration");
            var_destroy(var_ret.data);
            is_running_ = false;
            var_destroy(var_instance.data);
            return;
          }
        }
      }
      var_destroy(var_ret.data);

      // Double-check via is_started()
      {
        LSNSlot sn_is_started;
        sn_new(sn_is_started.data, "is_started", false);
        LVSlot var_is_started_ret;
        var_new_nil(var_is_started_ret.data);
        GDExtensionCallError is_started_err{};
        var_call(var_instance.data, sn_is_started.data, nullptr, 0, var_is_started_ret.data, &is_started_err);
        if (sn_destroy) sn_destroy(sn_is_started.data);
        if (is_started_err.error == GDEXTENSION_CALL_OK && get_type_from_var) {
          auto bool_from_variant = get_type_from_var(GDEXTENSION_VARIANT_TYPE_BOOL);
          if (bool_from_variant) {
            GDExtensionBool is_started_val = 0;
            bool_from_variant(&is_started_val, var_is_started_ret.data);
            LOGI("GodotInstance::is_started() = %s\n", is_started_val ? "true" : "false");
          }
        }
        var_destroy(var_is_started_ret.data);
      }

      LOGI("GodotInstance::start() succeeded\n");
      g_godot_started.store(true, std::memory_order_release);
    }

#if defined(__APPLE__) && !defined(__ANDROID__)
    // ── iOS: Connect Godot's rendering layer to the RN view ─────────────
    // start() called initializeRenderingForDriver: which created a
    // GDTMetalLayer. Move that layer into the React Native view's layer tree.
    if (has_surface) {
      dispatch_sync(dispatch_get_main_queue(), ^{
        godot_rendering_bridge_connect_layer();
      });
      LOGI("Connected Godot rendering layer to React Native view\n");
    }
#endif

    // ── Render loop: call iteration() at ~60fps ────────────────────────────
    // GodotInstance::iteration() calls DisplayServer::process_events() +
    // Main::iteration() which drives physics, scripts, and rendering.
    LSNSlot sn_iteration;
    sn_new(sn_iteration.data, "iteration", false);

    LOGI("Entering Godot render loop\n");
    while (is_running_.load(std::memory_order_acquire)) {
      if (is_paused_.load(std::memory_order_acquire)) {
        // While paused, sleep longer to reduce CPU usage
        std::this_thread::sleep_for(std::chrono::milliseconds(100));
        continue;
      }

#if defined(__ANDROID__)
      // ── Android: Skip iteration() when no valid surface is attached ─────
      // Android's OS lifecycle ruthlessly destroys the ANativeWindow when the
      // app is minimized. If we call iteration() (which triggers Vulkan
      // rendering), the GPU will segfault drawing to dead memory.
      // Keep the thread alive but idle until resumeOS() reattaches a surface.
      if (!is_surface_attached_.load(std::memory_order_acquire)) {
        std::this_thread::sleep_for(std::chrono::milliseconds(100));
        continue;
      }
#endif

      LVSlot var_ret;
      var_new_nil(var_ret.data);
      GDExtensionCallError err{};

#if defined(__APPLE__) && !defined(__ANDROID__)
      // Godot's RenderingServer::draw() and PhysicsServer3D must run on the
      // main thread. Dispatch each iteration synchronously; our background
      // thread acts as a frame-pacing scheduler.
      {
        GDExtensionVariantPtr vi_ptr = var_instance.data;
        GDExtensionConstStringNamePtr si_ptr = sn_iteration.data;
        GDExtensionUninitializedVariantPtr vr_ptr = var_ret.data;
        __block GDExtensionCallError blk_err{};
        dispatch_sync(dispatch_get_main_queue(), ^{
          var_call(vi_ptr, si_ptr, nullptr, 0, vr_ptr, &blk_err);
        });
        err = blk_err;
      }
#else
      var_call(var_instance.data, sn_iteration.data, nullptr, 0, var_ret.data, &err);
#endif
      var_destroy(var_ret.data);

      if (err.error != GDEXTENSION_CALL_OK) {
        LOGE("GodotInstance::iteration() failed — error: %d\n", err.error);
        _setLastError("render", "Godot render loop iteration failed");
        break;
      }

      // ~60fps frame pacing (16.6ms)
      std::this_thread::sleep_for(std::chrono::microseconds(16600));
    }

    if (sn_destroy) sn_destroy(sn_iteration.data);
    var_destroy(var_instance.data);

    is_running_ = false;
    LOGI("render_thread_ exiting\n");
  });
}

void HybridGodotEngine::pause() {
  is_paused_ = true;
  LOGI("pause() — signalled\n");
}

void HybridGodotEngine::destroy() {
  is_paused_  = true;
  is_running_ = false;
  g_engine    = nullptr;

  if (gdext_state_) {
    gdext_state_->live.store(false, std::memory_order_release);
  }

  // ── Do NOT destroy the Godot instance ──────────────────────────────────
  // Godot's Main::cleanup() partially tears down process-wide singletons
  // (RendererCompositor, NavigationServer, etc.) but does NOT fully reset
  // them. If Expo remounts and creates a new HybridGodotEngine, the stale
  // singletons cause "already exists" crashes. Since Godot cannot be
  // cleanly restarted within the same process, we keep the instance alive.
  // The render loop is stopped by is_running_ = false above.
  // NOTE: We intentionally leak the Godot instance — it's a process-wide
  // singleton that lives for the lifetime of the app.
  godot_instance_ = nullptr;  // drop our reference, but don't destroy

  _stopAndJoinThread();

  // Release our reference; the lambda's reference will drop when the thread exits.
  gdext_state_.reset();
  LOGI("destroy() complete\n");
}

// ─── View Binding ─────────────────────────────────────────────────────────────

void HybridGodotEngine::attachSurface(uint64_t surfacePointer) {
  void* os_surface = reinterpret_cast<void*>(static_cast<uintptr_t>(surfacePointer));
  pending_surface_.store(os_surface, std::memory_order_release);
  is_surface_attached_.store(true, std::memory_order_release);
  LOGI("attachSurface(0x%llx) — surface attached\n", (unsigned long long)surfacePointer);
}

void HybridGodotEngine::resizeSurface(double width, double height) {
  int w = static_cast<int>(width);
  int h = static_cast<int>(height);
  LOGI("resizeSurface(%d x %d) — queued for Godot thread\n", w, h);
  pending_resize_w_.store(w, std::memory_order_relaxed);
  pending_resize_h_.store(h, std::memory_order_relaxed);
  pending_resize_flag_.store(true, std::memory_order_release);
}

// ─── Zero-Copy Data Pipeline ──────────────────────────────────────────────────

void HybridGodotEngine::updateSharedBuffer(
    const std::shared_ptr<ArrayBuffer>& buffer)
{
  std::lock_guard<std::mutex> lock(data_mutex_);
  shared_buffer_ = buffer;
}

// ─── Messaging pipeline helpers ───────────────────────────────────────────────
//
// All helpers take get_proc as a parameter to keep them stateless.
//

// (load_proc is defined earlier in the file, near line 72)
// SNSlot, VSlot, and all FnXxx typedefs are defined in GDExtensionTypes.h

// ─── sendMessage (JS→Godot Inbound Queue) ────────────────────────────────────
//
// Called from JS thread. Enqueues into the inbound SPSC queue.
// The Godot frame callback (_processInboundMessages) drains and dispatches it.
// ZERO Godot API calls — thread-safe by design.
//

void HybridGodotEngine::sendMessage(const std::string& message) {
  _inbound_msg_queue.enqueue(message);
}




// ─── pollMessage (SPSC Lock-Free Queue, Epic 1) ─────────────────────────────
//
// Consumer side: JS thread dequeues from the lock-free SPSC queue.
// NO GDExtension calls, NO thread boundary crossing, NO mutex.
// Data is pushed into the queue by the Godot thread via the frame callback.
//

std::string HybridGodotEngine::pollMessage() {
  std::string msg;
  if (_message_queue.try_dequeue(msg)) {
    return msg;
  }
  return "";
}

// ─── notifyPollingStopped (Epic 1: Wake-Up Protocol) ─────────────────────────

void HybridGodotEngine::notifyPollingStopped() {
  _is_js_polling.store(false, std::memory_order_release);
}

// ─── setOnWakeUp (Epic 1: Wake-Up Protocol) ─────────────────────────────────

void HybridGodotEngine::setOnWakeUp(const std::function<void()>& callback) {
  _onWakeUp = callback;
  LOGI("setOnWakeUp() — JS wake-up callback registered\n");
}

// ─── enqueueMessageFromGodot (SPSC Producer, Epic 1) ────────────────────────
//
// Called from the Godot/render thread to push messages into the SPSC queue.
// If JS isn't actively polling, sets the wake-up flag.
// NOTE: The CallInvoker wake-up is scaffolded but not yet wired — need to
// inject CallInvoker from the JS layer. For now, JS must still poll.
//

void HybridGodotEngine::enqueueMessageFromGodot(const std::string& msg) {
  _message_queue.enqueue(msg);

  // If JS isn't polling, signal it should start.
  if (!_is_js_polling.exchange(true, std::memory_order_acq_rel)) {
    // JS was NOT polling — invoke the wake-up callback to start the drain loop.
    if (_onWakeUp) {
      _onWakeUp();
    }
  }
}

// ─── _relayGodotMessages (Interim Bridge) ────────────────────────────────────
//
// Drains the GDScript RNBridge._outgoing_queue into the C++ SPSC queue.
// This is a transitional bridge: it still uses variant_call to call
// RNBridge.poll_message() on the Godot thread, but stores results in the
// lock-free queue for the JS thread to consume without locking.
//
// Once a proper GDExtension-registered callback replaces the GDScript queue,
// this function will be removed.
//

void HybridGodotEngine::_relayGodotMessages() {
  if (!gdext_state_ || !gdext_state_->live.load(std::memory_order_acquire)) {
    return;
  }

  const auto& P = gdext_state_->procs;

  // Navigate to RNBridge via Engine.get_main_loop().get_root()
  // Note: SceneTree is NOT an Engine singleton — it's the main loop.
  // global_get_singleton("SceneTree") always returns nullptr.
  SNSlot sn_engine_name;
  P.sn_new(sn_engine_name.data, "Engine", false);
  GDExtensionObjectPtr engine_obj = P.get_singleton(sn_engine_name.data);
  if (P.sn_destroy) P.sn_destroy(sn_engine_name.data);
  if (!engine_obj) return;

  auto obj_to_variant = P.get_var_from_type(GDEXTENSION_VARIANT_TYPE_OBJECT);
  if (!obj_to_variant) return;

  VSlot var_engine;
  obj_to_variant(var_engine.data, &engine_obj);

  // Engine.get_main_loop() → SceneTree
  SNSlot sn_get_main_loop;
  P.sn_new(sn_get_main_loop.data, "get_main_loop", false);
  VSlot var_tree;
  P.var_new_nil(var_tree.data);
  GDExtensionCallError err{};
  P.var_call(var_engine.data, sn_get_main_loop.data, nullptr, 0, var_tree.data, &err);
  if (P.sn_destroy) P.sn_destroy(sn_get_main_loop.data);
  P.var_destroy(var_engine.data);
  if (err.error != GDEXTENSION_CALL_OK) return;

  // SceneTree.get_root()
  SNSlot sn_get_root;
  P.sn_new(sn_get_root.data, "get_root", false);
  VSlot var_root;
  P.var_new_nil(var_root.data);
  GDExtensionCallError root_err{};
  P.var_call(var_tree.data, sn_get_root.data, nullptr, 0, var_root.data, &root_err);
  if (P.sn_destroy) P.sn_destroy(sn_get_root.data);
  if (root_err.error != GDEXTENSION_CALL_OK) {
    P.var_destroy(var_tree.data);
    return;
  }

  SNSlot sn_get_node;
  P.sn_new(sn_get_node.data, "get_node", false);
  alignas(void*) uint8_t gd_path_str[kStringSize] = {};
  P.str_new_utf8(gd_path_str, "/root/RNBridge");
  auto str_to_variant = P.get_var_from_type(GDEXTENSION_VARIANT_TYPE_STRING);
  VSlot var_path;
  if (str_to_variant) {
    str_to_variant(var_path.data, gd_path_str);
  } else {
    P.var_new_nil(var_path.data);
  }
  if (P.str_destroy) P.str_destroy(gd_path_str);

  const GDExtensionConstVariantPtr path_args[1] = { var_path.data };
  VSlot var_bridge_node;
  P.var_new_nil(var_bridge_node.data);
  P.var_call(var_root.data, sn_get_node.data, path_args, 1, var_bridge_node.data, &err);
  if (P.sn_destroy) P.sn_destroy(sn_get_node.data);
  P.var_destroy(var_path.data);
  P.var_destroy(var_root.data);
  P.var_destroy(var_tree.data);

  if (err.error != GDEXTENSION_CALL_OK) {
    return;
  }

  // Drain RNBridge._outgoing_queue → SPSC queue
  // Call poll_message() in a loop until we get an empty string.
  SNSlot sn_poll;
  P.sn_new(sn_poll.data, "poll_message", false);

  for (int drain_limit = 64; drain_limit > 0; --drain_limit) {
    VSlot var_ret;
    P.var_new_nil(var_ret.data);
    P.var_call(var_bridge_node.data, sn_poll.data, nullptr, 0, var_ret.data, &err);

    if (err.error != GDEXTENSION_CALL_OK) {
      P.var_destroy(var_ret.data);
      break;
    }

    // Extract string from returned Variant
    std::string result;
    if (P.get_type_from_var && P.str_to_utf8) {
      auto string_from_variant = P.get_type_from_var(GDEXTENSION_VARIANT_TYPE_STRING);
      if (string_from_variant) {
        alignas(void*) uint8_t gd_str[kStringSize] = {};
        string_from_variant(gd_str, var_ret.data);

        GDExtensionInt len = P.str_to_utf8(gd_str, nullptr, 0);
        if (len > 0) {
          result.resize(len);
          P.str_to_utf8(gd_str, result.data(), len + 1);
        }
        if (P.str_destroy) P.str_destroy(gd_str);
      }
    }

    P.var_destroy(var_ret.data);

    // Empty string = queue drained
    if (result.empty()) break;

    // Push into SPSC queue
    _message_queue.enqueue(std::move(result));
  }

  if (P.sn_destroy) P.sn_destroy(sn_poll.data);
  P.var_destroy(var_bridge_node.data);
}

// ─── _updateCameraCache (Epic 4: Camera Matrix Writer) ──────────────────────
//
// Called from the Godot render thread after draining messages.
// Reads Camera3D matrices from RNBridge.get_camera_data() — expected to return
// a PackedFloat32Array of 34 floats:
//   [view_matrix(16), proj_matrix(16), viewport_width, viewport_height]
//
// Writes into the *inactive* buffer (_camera_buffers[1 - read_idx]), then
// atomically flips _camera_read_idx so the JS thread sees the fresh data.
//

void HybridGodotEngine::_updateCameraCache() {
  if (!gdext_state_ || !gdext_state_->live.load(std::memory_order_acquire)) {
    return;
  }

  const auto& P = gdext_state_->procs;

  // Navigate to RNBridge node
  // Get SceneTree via Engine.get_main_loop() (SceneTree is NOT an Engine singleton)
  SNSlot sn_engine_name;
  P.sn_new(sn_engine_name.data, "Engine", false);
  GDExtensionObjectPtr engine_obj = P.get_singleton(sn_engine_name.data);
  if (P.sn_destroy) P.sn_destroy(sn_engine_name.data);
  if (!engine_obj) return;

  auto obj_to_var_local = P.get_var_from_type(GDEXTENSION_VARIANT_TYPE_OBJECT);
  if (!obj_to_var_local) return;

  VSlot var_engine;
  obj_to_var_local(var_engine.data, &engine_obj);

  SNSlot sn_get_main_loop;
  P.sn_new(sn_get_main_loop.data, "get_main_loop", false);
  VSlot var_scene_tree;
  P.var_new_nil(var_scene_tree.data);
  GDExtensionCallError ml_err{};
  P.var_call(var_engine.data, sn_get_main_loop.data, nullptr, 0, var_scene_tree.data, &ml_err);
  if (P.sn_destroy) P.sn_destroy(sn_get_main_loop.data);
  P.var_destroy(var_engine.data);
  if (ml_err.error != GDEXTENSION_CALL_OK) return;

  // SceneTree is already in var_scene_tree as a Variant. Call get_root() on it.
  SNSlot sn_get_root;
  P.sn_new(sn_get_root.data, "get_root", false);
  VSlot var_root;
  P.var_new_nil(var_root.data);
  GDExtensionCallError err{};
  P.var_call(var_scene_tree.data, sn_get_root.data, nullptr, 0, var_root.data, &err);
  if (P.sn_destroy) P.sn_destroy(sn_get_root.data);
  if (err.error != GDEXTENSION_CALL_OK) {
    P.var_destroy(var_scene_tree.data);
    return;
  }

  SNSlot sn_get_node;
  P.sn_new(sn_get_node.data, "get_node", false);
  alignas(void*) uint8_t gd_path_str[kStringSize] = {};
  P.str_new_utf8(gd_path_str, "/root/RNBridge");
  auto str_to_variant = P.get_var_from_type(GDEXTENSION_VARIANT_TYPE_STRING);
  VSlot var_path;
  if (str_to_variant) {
    str_to_variant(var_path.data, gd_path_str);
  } else {
    P.var_new_nil(var_path.data);
  }
  if (P.str_destroy) P.str_destroy(gd_path_str);

  const GDExtensionConstVariantPtr path_args[1] = { var_path.data };
  VSlot var_bridge_node;
  P.var_new_nil(var_bridge_node.data);
  P.var_call(var_root.data, sn_get_node.data, path_args, 1, var_bridge_node.data, &err);
  if (P.sn_destroy) P.sn_destroy(sn_get_node.data);
  P.var_destroy(var_path.data);
  P.var_destroy(var_root.data);
  P.var_destroy(var_scene_tree.data);

  if (err.error != GDEXTENSION_CALL_OK) {
    return;
  }

  // Call RNBridge.get_camera_data() → returns PackedFloat32Array(34)
  SNSlot sn_get_cam;
  P.sn_new(sn_get_cam.data, "get_camera_data", false);
  VSlot var_cam_ret;
  P.var_new_nil(var_cam_ret.data);
  P.var_call(var_bridge_node.data, sn_get_cam.data, nullptr, 0, var_cam_ret.data, &err);
  if (P.sn_destroy) P.sn_destroy(sn_get_cam.data);
  P.var_destroy(var_bridge_node.data);

  if (err.error != GDEXTENSION_CALL_OK) {
    P.var_destroy(var_cam_ret.data);
    return;
  }

  // Extract PackedFloat32Array from Variant
  if (!P.get_type_from_var) {
    P.var_destroy(var_cam_ret.data);
    return;
  }
  auto pfa32_from_variant = P.get_type_from_var(GDEXTENSION_VARIANT_TYPE_PACKED_FLOAT32_ARRAY);
  if (!pfa32_from_variant) {
    P.var_destroy(var_cam_ret.data);
    return;
  }

  // Extract PackedFloat32Array from Variant
  // PackedFloat32Array is typically 16 bytes or so — use conservative size
  static constexpr size_t kPFA32Size = 32;
  alignas(void*) uint8_t pfa32_buf[kPFA32Size] = {};
  pfa32_from_variant(pfa32_buf, var_cam_ret.data);
  P.var_destroy(var_cam_ret.data);

  // Read elements via operator_index_const(pfa32, idx) → pointer to float at idx
  if (!P.pfa32_index) {
    if (P.pfa32_destroy) P.pfa32_destroy(pfa32_buf);
    return;
  }

  // We expect 34 floats: view(16) + proj(16) + vp_w + vp_h
  GDExtensionInt arr_size = 0;
  if (P.pfa32_size) {
    arr_size = P.pfa32_size(pfa32_buf);
  }

  if (arr_size < 34) {
    // Not enough data — camera not ready in GDScript
    if (P.pfa32_destroy) P.pfa32_destroy(pfa32_buf);
    return;
  }

  // Write to the inactive buffer
  int read_idx = _camera_read_idx.load(std::memory_order_acquire);
  int write_idx = 1 - read_idx;
  auto& write_buf = _camera_buffers[write_idx];

  // Read 34 floats from the packed array
  for (int i = 0; i < 16; ++i) {
    const float* fp = P.pfa32_index(pfa32_buf, i);
    write_buf.view_matrix[i] = fp ? *fp : 0.0f;
  }
  for (int i = 0; i < 16; ++i) {
    const float* fp = P.pfa32_index(pfa32_buf, 16 + i);
    write_buf.proj_matrix[i] = fp ? *fp : 0.0f;
  }
  {
    const float* fp_w = P.pfa32_index(pfa32_buf, 32);
    const float* fp_h = P.pfa32_index(pfa32_buf, 33);
    write_buf.viewport_width  = fp_w ? *fp_w : 0.0f;
    write_buf.viewport_height = fp_h ? *fp_h : 0.0f;
  }
  write_buf.valid = true;

  // Flip the read index
  _camera_read_idx.store(write_idx, std::memory_order_release);

  // Clean up the PackedFloat32Array
  if (P.pfa32_destroy) P.pfa32_destroy(pfa32_buf);
}

// ─── _callSingletonBoolMethod (Epic 2 Helper) ──────────────────────────────
//
// DRY helper: calls singleton_name.method_name(bool_arg) via variant_call.
// Used by suspendOS()/resumeOS() to toggle SceneTree, RenderingServer, etc.
//

static void _callSingletonBoolMethod(
    const GDExtensionProcs& P,
    const char* singleton_name,
    const char* method_name,
    bool bool_arg)
{
  // Get the singleton object.
  // Special case: SceneTree is NOT an Engine singleton — it's the main loop.
  // Use Engine.get_main_loop() to access it.
  VSlot var_obj;

  if (strcmp(singleton_name, "SceneTree") == 0) {
    // SceneTree via Engine.get_main_loop()
    SNSlot sn_engine;
    P.sn_new(sn_engine.data, "Engine", false);
    GDExtensionObjectPtr engine_obj = P.get_singleton(sn_engine.data);
    if (P.sn_destroy) P.sn_destroy(sn_engine.data);
    if (!engine_obj) {
      LOGE("_callSingletonBoolMethod: Engine singleton not found\n");
      return;
    }

    auto obj_to_var = P.get_var_from_type(GDEXTENSION_VARIANT_TYPE_OBJECT);
    if (!obj_to_var) return;
    VSlot var_engine;
    obj_to_var(var_engine.data, &engine_obj);

    SNSlot sn_get_ml;
    P.sn_new(sn_get_ml.data, "get_main_loop", false);
    P.var_new_nil(var_obj.data);
    GDExtensionCallError ml_err{};
    P.var_call(var_engine.data, sn_get_ml.data, nullptr, 0, var_obj.data, &ml_err);
    if (P.sn_destroy) P.sn_destroy(sn_get_ml.data);
    P.var_destroy(var_engine.data);
    if (ml_err.error != GDEXTENSION_CALL_OK) {
      LOGE("_callSingletonBoolMethod: Engine.get_main_loop() failed\n");
      return;
    }
  } else {
    // Normal singleton
    SNSlot sn_singleton;
    P.sn_new(sn_singleton.data, singleton_name, false);
    GDExtensionObjectPtr singleton = P.get_singleton(sn_singleton.data);
    if (P.sn_destroy) P.sn_destroy(sn_singleton.data);
    if (!singleton) {
      LOGE("_callSingletonBoolMethod: %s singleton not found\n", singleton_name);
      return;
    }

    auto obj_to_variant = P.get_var_from_type(GDEXTENSION_VARIANT_TYPE_OBJECT);
    if (!obj_to_variant) return;
    obj_to_variant(var_obj.data, &singleton);
  }

  // Build bool argument
  GDExtensionBool gd_bool = bool_arg ? 1 : 0;
  auto bool_to_variant = P.get_var_from_type(GDEXTENSION_VARIANT_TYPE_BOOL);
  if (!bool_to_variant) { P.var_destroy(var_obj.data); return; }
  VSlot var_arg;
  bool_to_variant(var_arg.data, &gd_bool);

  // Call method
  SNSlot sn_method;
  P.sn_new(sn_method.data, method_name, false);
  const GDExtensionConstVariantPtr args[1] = { var_arg.data };
  VSlot var_ret;
  P.var_new_nil(var_ret.data);
  GDExtensionCallError err{};
  P.var_call(var_obj.data, sn_method.data, args, 1, var_ret.data, &err);

  if (P.sn_destroy) P.sn_destroy(sn_method.data);
  P.var_destroy(var_ret.data);
  P.var_destroy(var_arg.data);
  P.var_destroy(var_obj.data);

  if (err.error != GDEXTENSION_CALL_OK) {
    LOGE("_callSingletonBoolMethod: %s.%s() failed (error %d)\n",
         singleton_name, method_name, err.error);
  }
}

// ─── _callSingletonIntBoolMethod (Epic 2 Helper) ─────────────────────────────
//
// Like _callSingletonBoolMethod but takes (int, bool) — used for
// AudioServer.set_bus_mute(bus_idx, muted).
//

static void _callSingletonIntBoolMethod(
    const GDExtensionProcs& P,
    const char* singleton_name,
    const char* method_name,
    int64_t int_arg,
    bool bool_arg)
{
  // Get singleton
  SNSlot sn_singleton;
  P.sn_new(sn_singleton.data, singleton_name, false);
  GDExtensionObjectPtr singleton = P.get_singleton(sn_singleton.data);
  if (P.sn_destroy) P.sn_destroy(sn_singleton.data);
  if (!singleton) {
    LOGE("_callSingletonIntBoolMethod: %s singleton not found\n", singleton_name);
    return;
  }

  auto obj_to_variant = P.get_var_from_type(GDEXTENSION_VARIANT_TYPE_OBJECT);
  if (!obj_to_variant) return;
  VSlot var_obj;
  obj_to_variant(var_obj.data, &singleton);

  // Build int argument
  auto int_to_variant = P.get_var_from_type(GDEXTENSION_VARIANT_TYPE_INT);
  if (!int_to_variant) { P.var_destroy(var_obj.data); return; }
  VSlot var_int_arg;
  int_to_variant(var_int_arg.data, &int_arg);

  // Build bool argument
  GDExtensionBool gd_bool = bool_arg ? 1 : 0;
  auto bool_to_variant = P.get_var_from_type(GDEXTENSION_VARIANT_TYPE_BOOL);
  if (!bool_to_variant) { P.var_destroy(var_int_arg.data); P.var_destroy(var_obj.data); return; }
  VSlot var_bool_arg;
  bool_to_variant(var_bool_arg.data, &gd_bool);

  // Call method(int, bool)
  SNSlot sn_method;
  P.sn_new(sn_method.data, method_name, false);
  const GDExtensionConstVariantPtr args[2] = { var_int_arg.data, var_bool_arg.data };
  VSlot var_ret;
  P.var_new_nil(var_ret.data);
  GDExtensionCallError err{};
  P.var_call(var_obj.data, sn_method.data, args, 2, var_ret.data, &err);

  if (P.sn_destroy) P.sn_destroy(sn_method.data);
  P.var_destroy(var_ret.data);
  P.var_destroy(var_bool_arg.data);
  P.var_destroy(var_int_arg.data);
  P.var_destroy(var_obj.data);

  if (err.error != GDEXTENSION_CALL_OK) {
    LOGE("_callSingletonIntBoolMethod: %s.%s() failed (error %d)\n",
         singleton_name, method_name, err.error);
  }
}

// ─── suspendOS (Epic 2: OS Lifecycle) ────────────────────────────────────────
//
// Called from JS thread when app enters background.
// Pauses SceneTree, disables RenderingServer render loop, mutes AudioServer.
//

void HybridGodotEngine::suspendOS() {
  LOGI("suspendOS() — pausing engine\n");

#if defined(__ANDROID__)
  // ── Android: Detach the surface BEFORE pausing servers ──────────────────
  // Android will destroy the ANativeWindow imminently after this call.
  // We must prevent the render thread from calling iteration() (which
  // would draw to dead memory) by clearing the surface-attached flag FIRST.
  is_surface_attached_.store(false, std::memory_order_release);
  pending_surface_.store(nullptr, std::memory_order_release);
  LOGI("suspendOS() — ANativeWindow detached (surface guard active)\n");
#endif

  is_paused_ = true;

  // Flush all inbound SPSC queues to discard stale events.
  // This prevents ghost touches from being processed on resume
  // (e.g., a finger that was down when the user pressed Home).
  _flushInboundQueues();

  if (!gdext_state_ || !gdext_state_->live.load(std::memory_order_acquire)) {
    LOGI("suspendOS() — GDExtension not live, paused flag only\n");
    return;
  }

  const auto& P = gdext_state_->procs;

  // 1. Pause the SceneTree main loop
  _callSingletonBoolMethod(P, "SceneTree", "set_pause", true);

  // 2. Disable rendering to stop GPU submissions (prevents gputimeout crash)
  _callSingletonBoolMethod(P, "RenderingServer", "set_render_loop_enabled", false);

  // 3. Mute master audio bus (bus 0) to prevent background audio violations
  _callSingletonIntBoolMethod(P, "AudioServer", "set_bus_mute", 0, true);

  LOGI("suspendOS() — SceneTree paused, RenderingServer disabled, AudioServer muted\n");
}

// ─── resumeOS (Epic 2: OS Lifecycle) ─────────────────────────────────────────
//
// Called from JS thread when app returns to foreground.
// Reattaches the native surface and resumes all servers.
//

void HybridGodotEngine::resumeOS(uint64_t newSurfacePointer) {
  LOGI("resumeOS(0x%llx) — resuming engine\n", (unsigned long long)newSurfacePointer);

  // Store new surface pointer
  void* os_surface = reinterpret_cast<void*>(static_cast<uintptr_t>(newSurfacePointer));
  pending_surface_.store(os_surface, std::memory_order_release);

#if defined(__ANDROID__)
  // ── Android: Re-attach the surface ─────────────────────────────────────
  // Android has created a brand new ANativeWindow for us. Store it and
  // re-enable the surface-attached guard so the render loop can resume
  // calling iteration().
  is_surface_attached_.store(os_surface != nullptr, std::memory_order_release);
  LOGI("resumeOS() — ANativeWindow hot-swapped: 0x%llx\n",
       (unsigned long long)newSurfacePointer);
#endif

  if (!gdext_state_ || !gdext_state_->live.load(std::memory_order_acquire)) {
    is_paused_ = false;
    LOGI("resumeOS() — GDExtension not live, unpaused flag only\n");
    return;
  }

  const auto& P = gdext_state_->procs;

  // 1. Re-enable rendering
  _callSingletonBoolMethod(P, "RenderingServer", "set_render_loop_enabled", true);

  // 2. Unmute master audio bus
  _callSingletonIntBoolMethod(P, "AudioServer", "set_bus_mute", 0, false);

  // 3. Unpause the SceneTree
  _callSingletonBoolMethod(P, "SceneTree", "set_pause", false);

  is_paused_ = false;
  LOGI("resumeOS() — RenderingServer enabled, AudioServer unmuted, SceneTree unpaused\n");
}

// ─── loadSceneAsync (Epic 3: Async Bootstrap) ────────────────────────────────
//
// Delegates async scene loading to GDScript's ResourceLoader.
// Sends a JSON command to RNBridge which triggers load_threaded_request().
// Progress events flow back through the SPSC queue.
//

void HybridGodotEngine::loadSceneAsync(const std::string& scenePckPath) {
  LOGI("loadSceneAsync() — requesting async load: %s\n", scenePckPath.c_str());

  // Send a structured command to the GDScript RNBridge AutoLoad.
  // RNBridge.on_react_native_message() will parse this and call
  // ResourceLoader.load_threaded_request(path).
  std::string cmd = "{\"action\":\"LOAD_SCENE_ASYNC\",\"path\":\"";
  cmd += scenePckPath;
  cmd += "\"}";
  sendMessage(cmd);
}

// ─── unprojectPosition (Epic 4: 3D→2D Projection) ───────────────────────────
//
// Pure C++ MVP matrix multiplication on cached camera data.
// NO Godot API calls — safe to call from any thread, including
// Reanimated's UI thread worklets.
//
// Matrix layout: column-major 4×4 (OpenGL convention).
// m[col*4 + row] accesses element at (row, col).
//

std::optional<std::vector<double>> HybridGodotEngine::unprojectPosition(
    double x, double y, double z)
{
  int idx = _camera_read_idx.load(std::memory_order_acquire);
  const auto& cache = _camera_buffers[idx];

  if (!cache.valid) {
    return std::nullopt;
  }

  const auto& V = cache.view_matrix;  // column-major
  const auto& P = cache.proj_matrix;  // column-major

  // Compute: clip = P * V * vec4(x, y, z, 1.0)
  // Step 1: eye = V * world
  float wx = static_cast<float>(x);
  float wy = static_cast<float>(y);
  float wz = static_cast<float>(z);

  float ex = V[0]*wx + V[4]*wy + V[8]*wz  + V[12];
  float ey = V[1]*wx + V[5]*wy + V[9]*wz  + V[13];
  float ez = V[2]*wx + V[6]*wy + V[10]*wz + V[14];
  float ew = V[3]*wx + V[7]*wy + V[11]*wz + V[15];

  // Step 2: clip = P * eye
  float cx = P[0]*ex + P[4]*ey + P[8]*ez  + P[12]*ew;
  float cy = P[1]*ex + P[5]*ey + P[9]*ez  + P[13]*ew;
  // float cz = P[2]*ex + P[6]*ey + P[10]*ez + P[14]*ew;  // unused
  float cw = P[3]*ex + P[7]*ey + P[11]*ez + P[15]*ew;

  // Behind camera check
  if (std::abs(cw) < 1e-6f) {
    return std::nullopt;
  }

  // NDC (perspective divide)
  float ndcX = cx / cw;
  float ndcY = cy / cw;

  // Screen coordinates
  // NDC range [-1, 1] → screen [0, width/height]
  // Y is flipped: NDC +1 is top, screen +Y is down.
  double screenX = static_cast<double>((ndcX * 0.5f + 0.5f) * cache.viewport_width);
  double screenY = static_cast<double>((1.0f - (ndcY * 0.5f + 0.5f)) * cache.viewport_height);

  return std::vector<double>{screenX, screenY};
}

// ─── Touch Input Forwarding ──────────────────────────────────────────────────
//
// Helper: dispatch a constructed InputEvent to Godot's Input singleton via
// Input.parse_input_event(event). The event object is destroyed after dispatch.
//

static void _dispatchInputEvent(
    GDExtensionInterfaceGetProcAddress get_proc,
    uint8_t* var_event_data)
{
  using FnSNNewLatin1  = void(*)(GDExtensionUninitializedStringNamePtr, const char*, GDExtensionBool);
  using FnSNDestroy    = void(*)(GDExtensionVariantPtr);
  using FnGetSingleton = GDExtensionObjectPtr(*)(GDExtensionConstStringNamePtr);
  using FnGetVarFromType = GDExtensionVariantFromTypeConstructorFunc(*)(GDExtensionVariantType);
  using FnVariantCall  = void(*)(GDExtensionVariantPtr, GDExtensionConstStringNamePtr,
                                  const GDExtensionConstVariantPtr*, GDExtensionInt,
                                  GDExtensionUninitializedVariantPtr, GDExtensionCallError*);
  using FnVariantNew   = void(*)(GDExtensionUninitializedVariantPtr);
  using FnVariantDestroy = void(*)(GDExtensionVariantPtr);

  auto sn_new      = load_proc<FnSNNewLatin1>(get_proc, "string_name_new_with_latin1_chars");
  auto sn_destroy  = load_proc<FnSNDestroy>(get_proc, "string_name_destroy");
  auto get_single  = load_proc<FnGetSingleton>(get_proc, "global_get_singleton");
  auto get_var_from_type = load_proc<FnGetVarFromType>(get_proc, "get_variant_from_type_constructor");
  auto var_call    = load_proc<FnVariantCall>(get_proc, "variant_call");
  auto var_new_nil = load_proc<FnVariantNew>(get_proc, "variant_new_nil");
  auto var_destroy = load_proc<FnVariantDestroy>(get_proc, "variant_destroy");

  if (!sn_new || !get_single || !get_var_from_type || !var_call || !var_destroy) {
    LOGE("_dispatchInputEvent: failed to load proc addresses\n");
    return;
  }

  // Get Input singleton
  SNSlot sn_input;
  sn_new(sn_input.data, "Input", false);
  GDExtensionObjectPtr input_singleton = get_single(sn_input.data);
  if (sn_destroy) sn_destroy(sn_input.data);

  if (!input_singleton) {
    LOGE("_dispatchInputEvent: Input singleton not found\n");
    return;
  }

  // Wrap Input singleton as Variant
  auto obj_to_variant = get_var_from_type(GDEXTENSION_VARIANT_TYPE_OBJECT);
  if (!obj_to_variant) return;

  VSlot var_input;
  obj_to_variant(var_input.data, &input_singleton);

  // Call Input.parse_input_event(event) using the EXISTING event Variant
  // (no second obj_to_variant — that would call init_ref() again on the
  //  RefCounted InputEvent, which silently nullifies the Variant)
  SNSlot sn_parse;
  sn_new(sn_parse.data, "parse_input_event", false);

  const GDExtensionConstVariantPtr parse_args[1] = { var_event_data };
  VSlot var_ret;
  var_new_nil(var_ret.data);
  GDExtensionCallError err{};
  var_call(var_input.data, sn_parse.data, parse_args, 1, var_ret.data, &err);

  if (sn_destroy) sn_destroy(sn_parse.data);
  var_destroy(var_ret.data);
  var_destroy(var_input.data);

  if (err.error != GDEXTENSION_CALL_OK) {
    LOGE("_dispatchInputEvent: parse_input_event() FAILED (error %d)\n", err.error);
  } else {
    LOGI("_dispatchInputEvent: parse_input_event() OK\n");
  }
}



static void _setVariantPropertyBool(
    GDExtensionInterfaceGetProcAddress get_proc,
    uint8_t* var_obj,
    const char* setter_name,
    bool value)
{
  using FnSNNewLatin1  = void(*)(GDExtensionUninitializedStringNamePtr, const char*, GDExtensionBool);
  using FnSNDestroy    = void(*)(GDExtensionVariantPtr);
  using FnGetVarFromType = GDExtensionVariantFromTypeConstructorFunc(*)(GDExtensionVariantType);
  using FnVariantCall  = void(*)(GDExtensionVariantPtr, GDExtensionConstStringNamePtr,
                                  const GDExtensionConstVariantPtr*, GDExtensionInt,
                                  GDExtensionUninitializedVariantPtr, GDExtensionCallError*);
  using FnVariantNew   = void(*)(GDExtensionUninitializedVariantPtr);
  using FnVariantDestroy = void(*)(GDExtensionVariantPtr);

  auto sn_new      = load_proc<FnSNNewLatin1>(get_proc, "string_name_new_with_latin1_chars");
  auto sn_destroy  = load_proc<FnSNDestroy>(get_proc, "string_name_destroy");
  auto get_var_from_type = load_proc<FnGetVarFromType>(get_proc, "get_variant_from_type_constructor");
  auto var_call    = load_proc<FnVariantCall>(get_proc, "variant_call");
  auto var_new_nil = load_proc<FnVariantNew>(get_proc, "variant_new_nil");
  auto var_destroy = load_proc<FnVariantDestroy>(get_proc, "variant_destroy");

  SNSlot sn_setter;
  sn_new(sn_setter.data, setter_name, false);

  GDExtensionBool gd_bool = value ? 1 : 0;
  auto bool_to_variant = get_var_from_type(GDEXTENSION_VARIANT_TYPE_BOOL);
  VSlot var_val;
  bool_to_variant(var_val.data, &gd_bool);

  const GDExtensionConstVariantPtr args[1] = { var_val.data };
  VSlot var_ret;
  var_new_nil(var_ret.data);
  GDExtensionCallError err{};
  var_call(var_obj, sn_setter.data, args, 1, var_ret.data, &err);

  if (sn_destroy) sn_destroy(sn_setter.data);
  var_destroy(var_val.data);
  var_destroy(var_ret.data);
}

static void _setVariantPropertyVector2(
    GDExtensionInterfaceGetProcAddress get_proc,
    uint8_t* var_obj,
    const char* setter_name,
    double x, double y)
{
  using FnSNNewLatin1  = void(*)(GDExtensionUninitializedStringNamePtr, const char*, GDExtensionBool);
  using FnSNDestroy    = void(*)(GDExtensionVariantPtr);
  using FnGetVarFromType = GDExtensionVariantFromTypeConstructorFunc(*)(GDExtensionVariantType);
  using FnVariantCall  = void(*)(GDExtensionVariantPtr, GDExtensionConstStringNamePtr,
                                  const GDExtensionConstVariantPtr*, GDExtensionInt,
                                  GDExtensionUninitializedVariantPtr, GDExtensionCallError*);
  using FnVariantNew   = void(*)(GDExtensionUninitializedVariantPtr);
  using FnVariantDestroy = void(*)(GDExtensionVariantPtr);

  auto sn_new      = load_proc<FnSNNewLatin1>(get_proc, "string_name_new_with_latin1_chars");
  auto sn_destroy  = load_proc<FnSNDestroy>(get_proc, "string_name_destroy");
  auto get_var_from_type = load_proc<FnGetVarFromType>(get_proc, "get_variant_from_type_constructor");
  auto var_call    = load_proc<FnVariantCall>(get_proc, "variant_call");
  auto var_new_nil = load_proc<FnVariantNew>(get_proc, "variant_new_nil");
  auto var_destroy = load_proc<FnVariantDestroy>(get_proc, "variant_destroy");

  SNSlot sn_setter;
  sn_new(sn_setter.data, setter_name, false);

  // Vector2 is two floats (real_t) — Godot uses float by default (32-bit builds)
  // but the Variant constructor for Vector2 takes a Vector2 struct { real_t x, y }
  // For GDExtension, Vector2 is 8 bytes (2 × float) or 16 bytes (2 × double)
  // depending on the build config. We'll construct via Variant call instead:
  // Create a Vector2 by calling Vector2(x, y) through the Variant system.

  // Simpler approach: set position via the float components using set_position
  // which takes a Vector2. We construct a Vector2 variant from two floats.

  // Vector2 in Godot is typically 2 × float (32-bit). We'll use the raw struct.
  struct GodotVector2 { float x; float y; };
  GodotVector2 vec2 = { static_cast<float>(x), static_cast<float>(y) };

  auto vec2_to_variant = get_var_from_type(GDEXTENSION_VARIANT_TYPE_VECTOR2);
  VSlot var_val;
  vec2_to_variant(var_val.data, &vec2);

  const GDExtensionConstVariantPtr args[1] = { var_val.data };
  VSlot var_ret;
  var_new_nil(var_ret.data);
  GDExtensionCallError err{};
  var_call(var_obj, sn_setter.data, args, 1, var_ret.data, &err);

  if (sn_destroy) sn_destroy(sn_setter.data);
  var_destroy(var_val.data);
  var_destroy(var_ret.data);
}

static void _setVariantPropertyInt(
    GDExtensionInterfaceGetProcAddress get_proc,
    uint8_t* var_obj,
    const char* setter_name,
    int64_t value)
{
  using FnSNNewLatin1  = void(*)(GDExtensionUninitializedStringNamePtr, const char*, GDExtensionBool);
  using FnSNDestroy    = void(*)(GDExtensionVariantPtr);
  using FnGetVarFromType = GDExtensionVariantFromTypeConstructorFunc(*)(GDExtensionVariantType);
  using FnVariantCall  = void(*)(GDExtensionVariantPtr, GDExtensionConstStringNamePtr,
                                  const GDExtensionConstVariantPtr*, GDExtensionInt,
                                  GDExtensionUninitializedVariantPtr, GDExtensionCallError*);
  using FnVariantNew   = void(*)(GDExtensionUninitializedVariantPtr);
  using FnVariantDestroy = void(*)(GDExtensionVariantPtr);

  auto sn_new      = load_proc<FnSNNewLatin1>(get_proc, "string_name_new_with_latin1_chars");
  auto sn_destroy  = load_proc<FnSNDestroy>(get_proc, "string_name_destroy");
  auto get_var_from_type = load_proc<FnGetVarFromType>(get_proc, "get_variant_from_type_constructor");
  auto var_call    = load_proc<FnVariantCall>(get_proc, "variant_call");
  auto var_new_nil = load_proc<FnVariantNew>(get_proc, "variant_new_nil");
  auto var_destroy = load_proc<FnVariantDestroy>(get_proc, "variant_destroy");

  SNSlot sn_setter;
  sn_new(sn_setter.data, setter_name, false);

  auto int_to_variant = get_var_from_type(GDEXTENSION_VARIANT_TYPE_INT);
  VSlot var_val;
  int_to_variant(var_val.data, &value);

  const GDExtensionConstVariantPtr args[1] = { var_val.data };
  VSlot var_ret;
  var_new_nil(var_ret.data);
  GDExtensionCallError err{};
  var_call(var_obj, sn_setter.data, args, 1, var_ret.data, &err);

  if (sn_destroy) sn_destroy(sn_setter.data);
  var_destroy(var_val.data);
  var_destroy(var_ret.data);
}

// ─── sendTouchEvent (JS→Godot Inbound Queue) ────────────────────────────────
//
// Called from JS thread. Enqueues a TouchEvent struct into the inbound SPSC queue.
// The Godot frame callback (_processInboundTouches) drains and dispatches it.
// ZERO Godot API calls — thread-safe by design.
//

void HybridGodotEngine::sendTouchEvent(double x, double y, bool pressed, double index) {
  LOGI("sendTouchEvent: x=%.1f y=%.1f pressed=%d index=%d\n", x, y, pressed, (int)index);
  TouchEvent ev;
  ev.x = x;
  ev.y = y;
  ev.pressed = pressed;
  ev.pointer_id = static_cast<int>(index);
  _inbound_touch_queue.enqueue(ev);
}

// ─── sendDragEvent (JS→Godot Inbound Queue) ─────────────────────────────────
//
// Called from JS thread. Enqueues a DragEvent struct into the inbound SPSC queue.
// The Godot frame callback (_processInboundTouches) drains and dispatches it.
// ZERO Godot API calls — thread-safe by design.
//

void HybridGodotEngine::sendDragEvent(
    double x, double y,
    double relativeX, double relativeY,
    double velocityX, double velocityY,
    double index)
{
  LOGI("sendDragEvent: x=%.1f y=%.1f rel=(%.1f,%.1f) index=%d\n", x, y, relativeX, relativeY, (int)index);
  DragEvent ev;
  ev.x = x;
  ev.y = y;
  ev.relative_x = relativeX;
  ev.relative_y = relativeY;
  ev.velocity_x = velocityX;
  ev.velocity_y = velocityY;
  ev.pointer_id = static_cast<int>(index);
  _inbound_drag_queue.enqueue(ev);
}

// ─── _processInboundMessages (Godot Thread — Inbound Drain) ─────────────────
//
// Called from _godot_frame_callback on the Godot thread.
// Drains _inbound_msg_queue and dispatches each message to
// RNBridge.on_react_native_message() via variant_call.
// Limited to 64 messages per frame to prevent stalling the render thread.
//

void HybridGodotEngine::_processInboundMessages() {
  if (!gdext_state_ || !gdext_state_->live.load(std::memory_order_acquire)) {
    return;
  }

  const auto& P = gdext_state_->procs;

  // ── Cache SceneTree → RNBridge node lookup (once per frame) ─────────────
  // Get SceneTree via Engine.get_main_loop() (SceneTree is NOT an Engine singleton)
  SNSlot sn_engine_name;
  P.sn_new(sn_engine_name.data, "Engine", false);
  GDExtensionObjectPtr engine_obj = P.get_singleton(sn_engine_name.data);
  if (P.sn_destroy) P.sn_destroy(sn_engine_name.data);
  if (!engine_obj) return;

  auto obj_to_var_cam = P.get_var_from_type(GDEXTENSION_VARIANT_TYPE_OBJECT);
  if (!obj_to_var_cam) return;

  VSlot var_engine_cam;
  obj_to_var_cam(var_engine_cam.data, &engine_obj);

  SNSlot sn_get_main_loop_cam;
  P.sn_new(sn_get_main_loop_cam.data, "get_main_loop", false);
  VSlot var_scene_tree_cam;
  P.var_new_nil(var_scene_tree_cam.data);
  GDExtensionCallError ml_err_cam{};
  P.var_call(var_engine_cam.data, sn_get_main_loop_cam.data, nullptr, 0, var_scene_tree_cam.data, &ml_err_cam);
  if (P.sn_destroy) P.sn_destroy(sn_get_main_loop_cam.data);
  P.var_destroy(var_engine_cam.data);
  if (ml_err_cam.error != GDEXTENSION_CALL_OK) return;

  // SceneTree is already in var_scene_tree_cam as a Variant. Call get_root() on it.
  SNSlot sn_get_root;
  P.sn_new(sn_get_root.data, "get_root", false);
  VSlot var_root;
  P.var_new_nil(var_root.data);
  GDExtensionCallError err{};
  P.var_call(var_scene_tree_cam.data, sn_get_root.data, nullptr, 0, var_root.data, &err);
  if (P.sn_destroy) P.sn_destroy(sn_get_root.data);
  if (err.error != GDEXTENSION_CALL_OK) {
    P.var_destroy(var_scene_tree_cam.data);
    return;
  }

  SNSlot sn_get_node;
  P.sn_new(sn_get_node.data, "get_node", false);
  alignas(void*) uint8_t gd_path[kStringSize] = {};
  P.str_new_utf8(gd_path, "/root/RNBridge");
  auto str_to_var = P.get_var_from_type(GDEXTENSION_VARIANT_TYPE_STRING);
  VSlot var_path;
  if (str_to_var) str_to_var(var_path.data, gd_path);
  else P.var_new_nil(var_path.data);
  if (P.str_destroy) P.str_destroy(gd_path);

  const GDExtensionConstVariantPtr path_args[1] = { var_path.data };
  VSlot var_bridge;
  P.var_new_nil(var_bridge.data);
  P.var_call(var_root.data, sn_get_node.data, path_args, 1, var_bridge.data, &err);
  if (P.sn_destroy) P.sn_destroy(sn_get_node.data);
  P.var_destroy(var_path.data);
  P.var_destroy(var_root.data);
  P.var_destroy(var_scene_tree_cam.data);
  if (err.error != GDEXTENSION_CALL_OK) return;

  // ── Drain loop: dispatch up to 64 messages ────────────────────────────
  SNSlot sn_receive;
  P.sn_new(sn_receive.data, "on_react_native_message", false);

  std::string msg;
  int drain_limit = 64;
  while (drain_limit-- > 0 && _inbound_msg_queue.try_dequeue(msg)) {
    alignas(void*) uint8_t gd_msg[kStringSize] = {};
    P.str_new_utf8(gd_msg, msg.c_str());
    VSlot var_msg;
    if (str_to_var) str_to_var(var_msg.data, gd_msg);
    else P.var_new_nil(var_msg.data);
    if (P.str_destroy) P.str_destroy(gd_msg);

    const GDExtensionConstVariantPtr msg_args[1] = { var_msg.data };
    VSlot var_ret;
    P.var_new_nil(var_ret.data);
    P.var_call(var_bridge.data, sn_receive.data, msg_args, 1, var_ret.data, &err);
    P.var_destroy(var_msg.data);
    P.var_destroy(var_ret.data);
  }

  if (P.sn_destroy) P.sn_destroy(sn_receive.data);
  P.var_destroy(var_bridge.data);
}

// ─── _processInboundTouches (Godot Thread — Inbound Drain) ──────────────────
//
// Called from _godot_frame_callback on the Godot thread.
// Drains _inbound_touch_queue and _inbound_drag_queue, constructs
// InputEventScreenTouch / InputEventScreenDrag via GDExtension, and injects
// them into Godot's Input system via Input.parse_input_event().
// Memory: InputEvent objects are destroyed immediately after injection
// to prevent leaks (per user rule #3).
//

void HybridGodotEngine::_processInboundTouches() {
  if (!gdext_state_ || !gdext_state_->live.load(std::memory_order_acquire)) {
    return;
  }

  const auto& P = gdext_state_->procs;

  // ── Drain touch events → track finger-up per pointer_id ────────────────
  bool move_released = false;
  bool aim_released  = false;
  int touchCount = 0;
  TouchEvent touch;
  while (_inbound_touch_queue.try_dequeue(touch)) {
    touchCount++;
    if (!touch.pressed) {
      if (touch.pointer_id == 0) move_released = true;
      if (touch.pointer_id == 1) aim_released  = true;
    }
  }

  // ── Drain drag events → track LAST relative per pointer_id ─────────────
  double move_rx = 0, move_ry = 0;
  double aim_rx  = 0, aim_ry  = 0;
  bool has_move_drag = false;
  bool has_aim_drag  = false;
  int dragCount = 0;
  DragEvent drag;
  while (_inbound_drag_queue.try_dequeue(drag)) {
    dragCount++;
    if (drag.pointer_id == 0) {
      move_rx = drag.relative_x;
      move_ry = drag.relative_y;
      has_move_drag = true;
    } else if (drag.pointer_id == 1) {
      aim_rx = drag.relative_x;
      aim_ry = drag.relative_y;
      has_aim_drag = true;
    }
  }

  if (touchCount > 0) LOGI("_processInboundTouches: drained %d touch events\n", touchCount);
  if (dragCount > 0)  LOGI("_processInboundTouches: drained %d drag events\n", dragCount);

  // ── Nothing to update? ────────────────────────────────────────────────────
  if (touchCount == 0 && dragCount == 0) return;

  // ── Normalise joystick values (same as RNBridge._input): ──────────────────
  //    normalised = Vector2(drag.relative.x, drag.relative.y) / JOYSTICK_SCALE
  //    normalised = normalised.limit_length(1.0)
  static constexpr double JOYSTICK_SCALE = 80.0;

  double jmx = 0.0, jmy = 0.0;
  if (has_move_drag && !move_released) {
    jmx = move_rx / JOYSTICK_SCALE;
    jmy = move_ry / JOYSTICK_SCALE;
    double len = std::sqrt(jmx*jmx + jmy*jmy);
    if (len > 1.0) { jmx /= len; jmy /= len; }
  }

  double jax = 0.0, jay = 0.0;
  if (has_aim_drag && !aim_released) {
    jax = aim_rx / JOYSTICK_SCALE;
    jay = aim_ry / JOYSTICK_SCALE;
    double len = std::sqrt(jax*jax + jay*jay);
    if (len > 1.0) { jax /= len; jay /= len; }
  }

  // ── Set RNBridge.joystick_move / joystick_aim directly ────────────────────
  // Navigate: SceneTree → root → get_node("/root/RNBridge")
  //           then call variant_set with property name + Vector2 value.

  // Get Engine singleton → get_main_loop() → SceneTree
  SNSlot sn_engine;
  P.sn_new(sn_engine.data, "Engine", false);
  GDExtensionObjectPtr engine_obj = P.get_singleton(sn_engine.data);
  if (P.sn_destroy) P.sn_destroy(sn_engine.data);
  if (!engine_obj) { LOGE("_processInboundTouches: Engine singleton not found\n"); return; }

  auto obj_to_var = P.get_var_from_type(GDEXTENSION_VARIANT_TYPE_OBJECT);
  VSlot var_engine;
  obj_to_var(var_engine.data, &engine_obj);

  // Engine.get_main_loop() → SceneTree
  SNSlot sn_get_main_loop;
  P.sn_new(sn_get_main_loop.data, "get_main_loop", false);
  VSlot var_scene_tree;
  P.var_new_nil(var_scene_tree.data);
  GDExtensionCallError err{};
  P.var_call(var_engine.data, sn_get_main_loop.data, nullptr, 0, var_scene_tree.data, &err);
  if (P.sn_destroy) P.sn_destroy(sn_get_main_loop.data);
  P.var_destroy(var_engine.data);
  if (err.error != GDEXTENSION_CALL_OK) { LOGE("_processInboundTouches: get_main_loop() failed\n"); return; }

  // SceneTree.get_root()
  SNSlot sn_get_root;
  P.sn_new(sn_get_root.data, "get_root", false);
  VSlot var_root;
  P.var_new_nil(var_root.data);
  P.var_call(var_scene_tree.data, sn_get_root.data, nullptr, 0, var_root.data, &err);
  if (P.sn_destroy) P.sn_destroy(sn_get_root.data);
  P.var_destroy(var_scene_tree.data);
  if (err.error != GDEXTENSION_CALL_OK) { LOGE("_processInboundTouches: get_root() failed\n"); return; }

  // root.get_node("/root/RNBridge")
  // Build the NodePath as a Variant<String>
  auto str_to_var = P.get_var_from_type(GDEXTENSION_VARIANT_TYPE_STRING);

  if (!P.str_new_latin1 || !str_to_var) { P.var_destroy(var_root.data); return; }

  alignas(void*) uint8_t gd_path[kStringSize] = {};
  P.str_new_latin1(gd_path, "RNBridge");
  VSlot var_path;
  str_to_var(var_path.data, gd_path);
  if (P.str_destroy) P.str_destroy(gd_path);

  SNSlot sn_get_node;
  P.sn_new(sn_get_node.data, "get_node", false);
  const GDExtensionConstVariantPtr get_node_args[1] = { var_path.data };
  VSlot var_bridge;
  P.var_new_nil(var_bridge.data);
  P.var_call(var_root.data, sn_get_node.data, get_node_args, 1, var_bridge.data, &err);
  if (P.sn_destroy) P.sn_destroy(sn_get_node.data);
  P.var_destroy(var_path.data);
  P.var_destroy(var_root.data);
  if (err.error != GDEXTENSION_CALL_OK) { LOGE("_processInboundTouches: get_node(RNBridge) failed (%d)\n", err.error); return; }


  // Helper: set a Vector2 property on var_bridge using Object.set(name, value)
  auto vec2_to_var = P.get_var_from_type(GDEXTENSION_VARIANT_TYPE_VECTOR2);
  if (!P.str_new_latin1 || !vec2_to_var || !str_to_var) { P.var_destroy(var_bridge.data); return; }

  // Pre-build the "set" method StringName
  SNSlot sn_set_method;
  P.sn_new(sn_set_method.data, "set", false);
  SNSlot sn_get_method;
  P.sn_new(sn_get_method.data, "get", false);

  auto setJoystick = [&](const char* prop_name, double x, double y) {
    // Build property name as String Variant
    alignas(void*) uint8_t gd_str[kStringSize] = {};
    P.str_new_latin1(gd_str, prop_name);
    VSlot var_name;
    str_to_var(var_name.data, gd_str);
    if (P.str_destroy) P.str_destroy(gd_str);

    // Build Vector2 value as Variant — Vector2 is float[2] in Godot (NOT double!)
    float vec[2] = { static_cast<float>(x), static_cast<float>(y) };
    VSlot var_val;
    vec2_to_var(var_val.data, vec);

    // Call Object.set(property_name, value) on the RNBridge node
    const GDExtensionConstVariantPtr set_args[2] = { var_name.data, var_val.data };
    VSlot var_ret;
    P.var_new_nil(var_ret.data);
    GDExtensionCallError set_err{};
    P.var_call(var_bridge.data, sn_set_method.data, set_args, 2, var_ret.data, &set_err);
    P.var_destroy(var_ret.data);

#ifndef NDEBUG
    // Debug readback: verify the set was applied correctly
    const GDExtensionConstVariantPtr get_args[1] = { var_name.data };
    VSlot var_readback;
    P.var_new_nil(var_readback.data);
    GDExtensionCallError get_err{};
    P.var_call(var_bridge.data, sn_get_method.data, get_args, 1, var_readback.data, &get_err);

    float readback_vec[2] = {0, 0};
    if (P.get_var_to_type && get_err.error == GDEXTENSION_CALL_OK) {
      auto var_to_vec2 = P.get_var_to_type(GDEXTENSION_VARIANT_TYPE_VECTOR2);
      if (var_to_vec2) {
        var_to_vec2(readback_vec, var_readback.data);
      }
    }

    LOGI("_processInboundTouches: set(%s)=(%.3f,%.3f) set_err=%d | get()=(%.3f,%.3f) get_err=%d\n",
         prop_name, x, y, set_err.error,
         readback_vec[0], readback_vec[1], get_err.error);

    P.var_destroy(var_readback.data);
#endif
    P.var_destroy(var_val.data);
    P.var_destroy(var_name.data);
  };

  // Set joystick_move (pointer_id 0)
  if (has_move_drag || move_released) {
    setJoystick("joystick_move", jmx, jmy);
  }

  // Set joystick_aim (pointer_id 1)
  if (has_aim_drag || aim_released) {
    setJoystick("joystick_aim", jax, jay);
  }

  if (P.sn_destroy) P.sn_destroy(sn_set_method.data);
  if (P.sn_destroy) P.sn_destroy(sn_get_method.data);
  P.var_destroy(var_bridge.data);
}

// ─── Viewport Resize ──────────────────────────────────────────────────────────

#if defined(__ANDROID__)
// Declared in libgodot_android.cpp — exported from libgodot.so.
// DisplayServerAndroid::window_set_size() is a no-op on Android, so we call
// this custom C-API that directly invokes OS_Android::set_display_size() +
// DisplayServerAndroid::notify_surface_changed().
extern "C" void libgodot_android_resize(int p_width, int p_height);
#endif

void HybridGodotEngine::_applyViewportResize() {
  if (!pending_resize_flag_.load(std::memory_order_acquire)) return;
  pending_resize_flag_.store(false, std::memory_order_relaxed);
  int width = pending_resize_w_.load(std::memory_order_relaxed);
  int height = pending_resize_h_.load(std::memory_order_relaxed);
  if (width <= 0 || height <= 0) return;

#if defined(__ANDROID__)
  libgodot_android_resize(width, height);
#else
  // ── iOS/other: GDExtension variant_call path ──────────────────────────────
  auto* state = gdext_state_.get();
  if (!state || !state->live.load(std::memory_order_acquire)) return;
  const auto& P = state->procs;

  // ── Build a Vector2i Variant from (width, height) ─────────────────────
  struct GodotVector2i { int32_t x; int32_t y; };
  GodotVector2i v2i = { static_cast<int32_t>(width), static_cast<int32_t>(height) };
  auto vec2i_to_var = P.get_var_from_type(GDEXTENSION_VARIANT_TYPE_VECTOR2I);
  VSlot var_size;
  vec2i_to_var(var_size.data, &v2i);

  // ── 1. DisplayServer.window_set_size(Vector2i) ────────────────────────
  {
    SNSlot sn_ds;
    P.sn_new(sn_ds.data, "DisplayServer", false);
    GDExtensionObjectPtr ds = P.get_singleton(sn_ds.data);
    if (P.sn_destroy) P.sn_destroy(sn_ds.data);

    if (ds) {
      auto obj_to_var = P.get_var_from_type(GDEXTENSION_VARIANT_TYPE_OBJECT);
      VSlot var_ds;
      obj_to_var(var_ds.data, &ds);

      SNSlot sn_method;
      P.sn_new(sn_method.data, "window_set_size", false);

      const GDExtensionConstVariantPtr args[1] = { var_size.data };
      VSlot var_ret;
      P.var_new_nil(var_ret.data);
      GDExtensionCallError err{};
      P.var_call(var_ds.data, sn_method.data, args, 1, var_ret.data, &err);

      if (P.sn_destroy) P.sn_destroy(sn_method.data);
      P.var_destroy(var_ret.data);
      P.var_destroy(var_ds.data);
    }
  }

  // ── 2. SceneTree → get_root() → set_size(Vector2i) ───────────────────
  {
    SNSlot sn_engine;
    P.sn_new(sn_engine.data, "Engine", false);
    GDExtensionObjectPtr engine_obj = P.get_singleton(sn_engine.data);
    if (P.sn_destroy) P.sn_destroy(sn_engine.data);

    if (engine_obj) {
      auto obj_to_var = P.get_var_from_type(GDEXTENSION_VARIANT_TYPE_OBJECT);
      VSlot var_engine;
      obj_to_var(var_engine.data, &engine_obj);

      SNSlot sn_gml;
      P.sn_new(sn_gml.data, "get_main_loop", false);
      VSlot var_ml;
      P.var_new_nil(var_ml.data);
      GDExtensionCallError err{};
      P.var_call(var_engine.data, sn_gml.data, nullptr, 0, var_ml.data, &err);
      if (P.sn_destroy) P.sn_destroy(sn_gml.data);
      P.var_destroy(var_engine.data);

      if (err.error == GDEXTENSION_CALL_OK) {
        SNSlot sn_gr;
        P.sn_new(sn_gr.data, "get_root", false);
        VSlot var_root;
        P.var_new_nil(var_root.data);
        P.var_call(var_ml.data, sn_gr.data, nullptr, 0, var_root.data, &err);
        if (P.sn_destroy) P.sn_destroy(sn_gr.data);

        if (err.error == GDEXTENSION_CALL_OK) {
          SNSlot sn_ss;
          P.sn_new(sn_ss.data, "set_size", false);
          const GDExtensionConstVariantPtr args[1] = { var_size.data };
          VSlot var_ret;
          P.var_new_nil(var_ret.data);
          P.var_call(var_root.data, sn_ss.data, args, 1, var_ret.data, &err);
          if (P.sn_destroy) P.sn_destroy(sn_ss.data);
          P.var_destroy(var_ret.data);
        }
        P.var_destroy(var_root.data);
      }
      P.var_destroy(var_ml.data);
    }
  }

  P.var_destroy(var_size.data);
#endif

  LOGI("_applyViewportResize: applied %d x %d\n", width, height);
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

void HybridGodotEngine::_stopAndJoinThread() {
  // Only join the thread — do NOT destroy the Godot instance here.
  // Godot cannot be destroyed and recreated in the same process
  // (Main::cleanup leaves dangling global pointers).
  if (render_thread_.joinable()) {
    render_thread_.join();
  }
}

// ─── _flushInboundQueues ──────────────────────────────────────────────────────
//
// Drains and discards all pending events from the inbound SPSC queues.
// Called from suspendOS() to prevent stale touch/drag/message events from
// being processed after resume (ghost touch mitigation at C++ level).
//

void HybridGodotEngine::_flushInboundQueues() {
  int flushed = 0;

  // Drain inbound messages
  std::string msg;
  while (_inbound_msg_queue.try_dequeue(msg)) { ++flushed; }

  // Drain inbound touch events
  TouchEvent touch;
  while (_inbound_touch_queue.try_dequeue(touch)) { ++flushed; }

  // Drain inbound drag events
  DragEvent drag;
  while (_inbound_drag_queue.try_dequeue(drag)) { ++flushed; }

  if (flushed > 0) {
    LOGI("_flushInboundQueues() — discarded %d stale events\n", flushed);
  }
}

// ── Error Reporting ──────────────────────────────────────────────────────────

std::string HybridGodotEngine::getLastError() {
  std::lock_guard<std::mutex> lock(error_mutex_);
  return last_error_;
}

void HybridGodotEngine::_setLastError(const std::string& layer, const std::string& msg) {
  std::string full = "[" + layer + "] " + msg;
  {
    std::lock_guard<std::mutex> lock(error_mutex_);
    last_error_ = full;
  }
  LOGE("ENGINE_ERROR: %s\n", full.c_str());

  // Also push to SPSC so JS can detect errors via the normal message drain loop
  std::string json = "{\"type\":\"ENGINE_ERROR\",\"layer\":\"" + layer + "\",\"error\":\"" + msg + "\"}";
  enqueueMessageFromGodot(json);
}

}  // namespace margelo::nitro::godot
