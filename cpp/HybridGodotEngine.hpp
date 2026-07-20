///
/// HybridGodotEngine.hpp
/// Hand-authored C++ implementation of the Nitrogen-generated GodotEngine spec.
/// Inherits HybridGodotEngineSpec and provides a thread-safe render loop
/// for libgodot integration.
///
/// Thread model:
///   - JS thread     : calls all public methods via JSI.
///   - render_thread_: runs the libgodot main loop, isolated from UI.
///   - Outbound SPSC : Godot thread (producer) → JS thread (consumer)
///   - Inbound SPSC  : JS thread (producer) → Godot thread (consumer)
///   Both queues are lock-free via moodycamel::ReaderWriterQueue.
///

#pragma once

#include <array>
#include <atomic>
#include <chrono>
#include <cmath>
#include <memory>
#include <mutex>
#include <optional>
#include <string>
#include <thread>
#include <vector>

// Lock-free SPSC queue (moodycamel, BSD-licensed, header-only)
#include "readerwriterqueue.h"

// Godot C API — provides libgodot_create_godot_instance / libgodot_destroy_godot_instance
// Include path set via HEADER_SEARCH_PATHS (podspec) and target_include_directories (CMake)
#include "libgodot.h"
#include "GDExtensionTypes.h"

// Generated spec (virtual base class produced by `npx nitrogen`)
#include "../nitrogen/generated/shared/c++/HybridGodotEngineSpec.hpp"

namespace margelo::nitro::godot {

/**
 * HybridGodotEngine — concrete JSI-exposed implementation of GodotEngine.
 *
 * Thread model:
 *   - JS thread     : calls all public methods via JSI.
 *   - render_thread_: runs the libgodot main loop at ~60 Hz, isolated from UI.
 *
 * Synchronisation:
 *   - is_running_       : std::atomic<bool>, lock-free flag controlling the loop.
 *   - _message_queue       : moodycamel SPSC. Godot→JS (outbound).
 *   - _inbound_msg_queue   : moodycamel SPSC. JS→Godot (inbound messages).
 *   - _inbound_touch_queue : moodycamel SPSC. JS→Godot (inbound touches).
 *   - _is_js_polling    : std::atomic<bool> wake-up flag for hybrid event loop.
 *   - _camera_read_idx  : std::atomic<int> for double-buffered camera matrices.
 *   - data_mutex_       : std::mutex protecting shared_buffer_ only.
 */
class HybridGodotEngine : public HybridGodotEngineSpec {
 public:
  // ── Lightweight event structs for inbound SPSC queues ──────────────────

  /// Touch press/release event enqueued by JS, dequeued by Godot thread.
  struct TouchEvent {
    double x;
    double y;
    bool pressed;
    int pointer_id;
  };

  /// Drag/move event enqueued by JS, dequeued by Godot thread.
  struct DragEvent {
    double x;
    double y;
    double relative_x;
    double relative_y;
    double velocity_x;
    double velocity_y;
    int pointer_id;
  };
 public:
  // ── Construction / Destruction ───────────────────────────────────────────

  explicit HybridGodotEngine() : HybridObject(TAG), is_running_(false) {}

  /**
   * Destructor ensures the render thread is joined even if destroy() was
   * never explicitly called from JS (e.g., on bridge reload or GC).
   */
  ~HybridGodotEngine() override {
    _stopAndJoinThread();
  }

 public:
  // ── HybridGodotEngineSpec overrides ─────────────────────────────────────

  /**
   * Loads the Godot project and initialises the libgodot runtime.
   * Must be called on the JS thread before start().
   */
  void initialize(const std::string& pckPath) override;

  /**
   * Spawns render_thread_ which drives the libgodot main loop at ~60 FPS.
   * No-op if already running.
   */
  void start() override;

  /**
   * Signals the render loop to pause without destroying engine state.
   */
  void pause() override;

  /**
   * Stops the render loop, joins render_thread_, and tears down the engine.
   * Safe to call multiple times.
   */
  void destroy() override;

  /**
   * Binds an OS native surface to the Godot renderer.
   * @param surfacePointer  ANativeWindow* (Android) or CAMetalLayer* (iOS)
   *                        cast to uint64_t for zero-copy JSI transport.
   */
  void attachSurface(uint64_t surfacePointer) override;

  /**
   * Updates the shared memory buffer used for zero-copy data pipelining.
   * Protected by data_mutex_ to prevent data races across threads.
   */
  void updateSharedBuffer(const std::shared_ptr<ArrayBuffer>& buffer) override;

  /**
   * Sends a UTF-8 string message to the running Godot scene.
   */
  void sendMessage(const std::string& message) override;

  /**
   * Polls a message from the Godot→JS SPSC lock-free queue.
   * Returns "" if the queue is empty. Safe to call at 120Hz from JS thread.
   */
  std::string pollMessage() override;

  /**
   * Notify C++ that JS has finished draining the queue.
   * Resets the wake-up flag so the next enqueue triggers a new wake-up.
   */
  void notifyPollingStopped() override;

  /**
   * Registers a JS callback invoked from C++ (via CallInvoker) when Godot
   * enqueues a message and JS isn't currently draining the queue.
   */
  void setOnWakeUp(const std::function<void()>& callback) override;

  // ─── OS Lifecycle ────────────────────────────────────────────────────────

  /**
   * Suspends the Godot engine when the app is backgrounded.
   * Pauses MainLoop, RenderingServer, and AudioServer.
   */
  void suspendOS() override;

  /**
   * Resumes the Godot engine when the app returns to foreground.
   * @param newSurfacePointer  Reattached ANativeWindow* or CAMetalLayer*
   */
  void resumeOS(uint64_t newSurfacePointer) override;

  // ─── Async Bootstrap ─────────────────────────────────────────────────────

  /**
   * Kick off async scene loading via the GDScript ResourceLoader.
   * Progress events are pushed to the SPSC queue as LOAD_PROGRESS payloads.
   */
  void loadSceneAsync(const std::string& scenePckPath) override;

  // ─── 3D→2D Projection ───────────────────────────────────────────────────

  /**
   * Synchronous JSI method: projects a 3D world position to screen coordinates.
   * Uses cached camera matrices — NO Godot API calls, safe from any thread.
   * Returns [screenX, screenY] or nullopt if camera cache not ready.
   */
  std::optional<std::vector<double>> unprojectPosition(double x, double y, double z) override;

  // ─── Touch Input ─────────────────────────────────────────────────────────

  /**
   * Forwards a screen touch event (press/release) to Godot's Input system.
   * Constructs InputEventScreenTouch via GDExtension and calls Input.parse_input_event().
   */
  void sendTouchEvent(double x, double y, bool pressed, double index) override;

  /**
   * Forwards a screen drag event to Godot's Input system.
   * Constructs InputEventScreenDrag via GDExtension and calls Input.parse_input_event().
   */
  void sendDragEvent(double x, double y, double relativeX, double relativeY,
                     double velocityX, double velocityY, double index) override;

  /**
   * Resize Godot's viewport and Vulkan swapchain to match the native surface.
   * Stores dimensions atomically; the frame callback applies them on the Godot thread.
   */
  void resizeSurface(double width, double height) override;

  /**
   * Returns the last critical engine error string, or "" if none.
   * Thread-safe: reads from last_error_ protected by error_mutex_.
   */
  std::string getLastError() override;

  /**
   * Returns real frame-timing stats measured over the interval since the last
   * call: engine iteration rate (producedFps) vs frames actually presented to
   * the display (presentedFps), plus the worst present gap (worstFrameMs).
   * See FrameCounters.hpp. Thread-safe; guarded by frame_stats_mutex_.
   */
  FrameStats getFrameStats() override;

 public:
  // ── Godot→JS message injection (called from Godot thread) ───────────────

  /**
   * Enqueue a message from the Godot thread into the SPSC queue.
   * This is the producer side — only called from the Godot/render thread.
   * If the queue was empty and JS isn't polling, triggers a wake-up.
   */
  void enqueueMessageFromGodot(const std::string& msg);

 private:
  // ── Internal helpers ─────────────────────────────────────────────────────

  /**
   * Sets is_running_ = false and joins render_thread_ if joinable.
   * Extracted to be callable from both destroy() and ~HybridGodotEngine().
   */
  void _stopAndJoinThread();

  /**
   * Drains and discards all pending events from the inbound SPSC queues.
   * Called during suspendOS() to prevent stale touch/drag/message events
   * from being processed after resume (ghost touch mitigation at C++ level).
   */
  void _flushInboundQueues();

  /**
   * Store a critical error and push it to the SPSC queue as ENGINE_ERROR.
   * Thread-safe: can be called from the Godot thread or the JS thread.
   * @param layer  Originating layer (e.g. "init", "surface", "render")
   * @param msg    Human-readable error description
   */
  void _setLastError(const std::string& layer, const std::string& msg);

  /**
   * Resolve the `/root/RNBridge` AutoLoad node and write it into `out_bridge`
   * as an OBJECT Variant ready for variant_call. RNBridge is an AutoLoad, so
   * its node pointer is stable for the engine's lifetime — the expensive
   * navigation chain (Engine → get_main_loop → get_root → get_node) runs only
   * ONCE and the raw pointer is cached in _rnbridge_obj_. Subsequent calls just
   * re-wrap the cached pointer (cheap), eliminating ~4 StringName allocations
   * and ~3 variant_calls per call, per frame callback. Returns false if the
   * node isn't available yet (caller skips this frame and retries).
   * Godot-thread-only; no synchronisation required.
   */
  bool _getBridgeVariant(const GDExtensionProcs& P, VSlot& out_bridge);

 public:
  // ── Godot-thread frame callback entry points ─────────────────────────────
  // Called from _godot_frame_callback() which is registered via
  // register_main_loop_callbacks. Must ONLY be called from the Godot thread.

  /**
   * Drains RNBridge._outgoing_queue (GDScript) into the SPSC queue.
   */
  void _relayGodotMessages();

  /**
   * Reads Camera3D matrices from RNBridge.get_camera_data() and writes them
   * into the inactive CameraCache double-buffer, then flips _camera_read_idx.
   */
  void _updateCameraCache();

  /**
   * Drains _inbound_msg_queue on the Godot thread and dispatches each message
   * to RNBridge.on_react_native_message(). Limited to 64 per frame.
   */
  void _processInboundMessages();

  /**
   * Drains _inbound_touch_queue and _inbound_drag_queue on the Godot thread.
   * Constructs InputEventScreenTouch / InputEventScreenDrag via GDExtension
   * and injects into Input.parse_input_event().
   */
  void _processInboundTouches();

  /**
   * Checks for a pending viewport resize and applies it on the Godot thread.
   * Reads pending_resize_* atomics internally.
   * Calls DisplayServer.window_set_size() and SceneTree root set_size().
   */
  void _applyViewportResize();

 public:
  // ── GDExtension runtime state ───────────────────────────────────────────
  // Public so static file-scope callbacks (gdext_initialize, gdext_entry)
  // can use the type via the void* userdata pointer cast.

  /// Filled in by the GDExtension init callback (called from the render thread
  /// inside libgodot_create_godot_instance). Accessed from sendMessage() on any
  /// thread, so live is atomic and get_proc is written once-before-read.
  struct GodotExtensionState {
    GDExtensionInterfaceGetProcAddress get_proc = nullptr;
    GDExtensionClassLibraryPtr        library  = nullptr;
    GDExtensionProcs                  procs;                ///< Cached proc addresses (resolved once)
    std::atomic<bool>                 live{false};
  };

  // ── Camera matrix cache (Epic 4) ──────────────────────────────────────

  /// Double-buffered camera matrix cache for lock-free 3D→2D projection.
  /// The Godot render thread writes to buffers[1 - read_idx], then flips.
  /// The JS thread reads from buffers[read_idx] — no locks needed.
  struct CameraCache {
    std::array<float, 16> view_matrix{};     ///< Column-major 4×4 view matrix
    std::array<float, 16> proj_matrix{};     ///< Column-major 4×4 projection matrix
    float viewport_width  = 0.0f;
    float viewport_height = 0.0f;
    bool  valid = false;                     ///< Set to true once first update arrives
  };

 private:

  /// Shared between HybridGodotEngine (calling thread) and the render lambda.
  /// Lifetime: created in initialize(), cleared in destroy().
  std::shared_ptr<GodotExtensionState> gdext_state_;

  /// Cached pointer to the `/root/RNBridge` AutoLoad node. Resolved lazily on
  /// the Godot thread by _getBridgeVariant() and reused for the engine's
  /// lifetime (AutoLoads survive scene changes). Godot-thread-only; reset in
  /// destroy(). nullptr until first successful resolve.
  GDExtensionObjectPtr _rnbridge_obj_ = nullptr;

  /// ObjectID of the cached RNBridge node, captured at cache time. Used by
  /// _getBridgeVariant() to revalidate _rnbridge_obj_ each call via
  /// object_get_instance_from_id — Godot's idiom for detecting a freed node —
  /// so consumer GDScript freeing/replacing the AutoLoad cannot cause a
  /// use-after-free. 0 when no id is cached (or the procs are unavailable).
  GDObjectInstanceID _rnbridge_id_ = 0;

  /// Pending OS surface pointer — stashed by attachSurface(), read by start().
  /// Android: ANativeWindow*   iOS: CAMetalLayer*
  std::atomic<void*> pending_surface_{nullptr};

  /// Handle to the live Godot instance (returned by libgodot_create_godot_instance).
  /// Null until initialize() + start() are called successfully.
  GDExtensionObjectPtr godot_instance_ = nullptr;

  /// Background thread running the libgodot main loop.
  std::thread render_thread_;

  /// Lock-free flag: true while the render loop should keep iterating.
  std::atomic<bool> is_running_;

  /// Lock-free flag: true when paused (loop idles without iterating).
  std::atomic<bool> is_paused_{false};

  /// True when a valid native surface is attached.
  /// On Android, surfaceDestroyed invalidates the ANativeWindow*.
  /// The render loop skips iteration() when this is false to prevent
  /// segfaults from drawing to dead memory.
  std::atomic<bool> is_surface_attached_{false};

  /// REMOVED: godot_init_attempted_ moved to file-static in .cpp
  /// (Godot singletons are process-wide, so the guard must be too.)

  /// Protects shared_buffer_ against concurrent JS writes / render reads.
  std::mutex data_mutex_;

  /// Latest buffer pushed from JS via updateSharedBuffer().
  std::shared_ptr<ArrayBuffer> shared_buffer_;

  /// Godot project .pck path set by initialize().
  std::string pck_path_;

  // ── Epic 1: SPSC Queue & Wake-Up ──────────────────────────────────────

  /// Lock-free SPSC queue: Godot thread (producer) → JS thread (consumer).
  /// Pre-allocated with 256 slots to avoid allocations during gameplay.
  moodycamel::ReaderWriterQueue<std::string> _message_queue{256};

  /// Thread id of the single SPSC producer (the render/Godot thread). Set when
  /// the render thread starts; reset to the default id by _stopAndJoinThread()
  /// after the join. _setLastError() consults this: it enqueues into
  /// _message_queue only from the producer thread itself, OR when the id is
  /// default (no render thread alive — this thread is momentarily the sole
  /// producer, so the strict single-producer invariant holds either way).
  /// std::thread::id is trivially copyable, so this is a valid std::atomic
  /// specialisation.
  std::atomic<std::thread::id> producer_thread_id_{};

  /// Polling flag: true when JS is (believed to be) in a rAF drain loop.
  /// Reset by notifyPollingStopped(), set by enqueueMessageFromGodot().
  /// Currently write-only bookkeeping — kept for the future CallInvoker-based
  /// wake-up protocol.
  std::atomic<bool> _is_js_polling{false};

  /// JS callback to trigger the rAF drain loop. Set via setOnWakeUp().
  /// NOT currently invoked from C++: calling a JS function from the Godot
  /// render thread would violate JSI threading rules. Wire through Nitro's
  /// CallInvoker before invoking. Until then JS must call startPolling().
  std::function<void()> _onWakeUp;

  // ── Epic 4: Camera Matrix Double-Buffer ───────────────────────────────

  /// Double-buffered camera cache. Godot writes to [1 - idx], JS reads [idx].
  CameraCache _camera_buffers[2];
  std::atomic<int> _camera_read_idx{0};

  // ── Inbound SPSC Queues (JS → Godot) ──────────────────────────────────

  /// Lock-free SPSC: JS thread enqueues, Godot thread dequeues.
  moodycamel::ReaderWriterQueue<std::string>  _inbound_msg_queue{256};
  moodycamel::ReaderWriterQueue<TouchEvent>   _inbound_touch_queue{256};
  moodycamel::ReaderWriterQueue<DragEvent>    _inbound_drag_queue{256};

  // ── Pending Viewport Resize ─────────────────────────────────────────

  /// Thread-safe relay: JS thread writes new dimensions via resizeSurface(),
  /// Godot frame callback reads and applies them via DisplayServer/SceneTree.
  std::atomic<int> pending_resize_w_{0};
  std::atomic<int> pending_resize_h_{0};
  std::atomic<bool> pending_resize_flag_{false};

  // ── Error Reporting ──────────────────────────────────────────────────

  /// Last critical error message. Written from any thread, read from JS.
  std::string last_error_;
  std::mutex  error_mutex_;

  // ── Frame Stats sampling state ───────────────────────────────────────
  /// Baseline (counter + timestamp) captured on the previous getFrameStats()
  /// call, so each call reports the rate over the interval since the last one.
  std::mutex frame_stats_mutex_;
  std::chrono::steady_clock::time_point frame_stats_last_time_{};
  uint64_t frame_stats_last_produced_{0};
  uint64_t frame_stats_last_presented_{0};
  bool frame_stats_primed_{false};
};

}  // namespace margelo::nitro::godot
