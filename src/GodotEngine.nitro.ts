import { type HybridObject, type UInt64 } from 'react-native-nitro-modules';

/**
 * Real frame-timing stats for the embedded engine.
 *
 * The distinction here is the whole point: the engine's iteration rate is NOT
 * what the user sees. The render loop dispatch_syncs iteration() onto the main
 * thread; if it hogs the main thread, CoreAnimation can't commit frames and the
 * on-screen rate collapses far below the iteration rate. Expose both so you can
 * see the gap (and never ship a single "fps" number that lies).
 */
export interface FrameStats {
  /** Engine render/iteration rate — how often the Godot main loop ran (frames/sec). */
  producedFps: number;
  /**
   * Frames actually presented to the display (frames/sec). On iOS this is a
   * CADisplayLink-based count of present opportunities the main run loop
   * actually serviced — when the main thread is starved this drops below
   * producedFps, which is exactly the "counter says 40, screen shows 9" case.
   * Currently iOS-only; 0 on platforms without present instrumentation.
   */
  presentedFps: number;
  /**
   * Longest gap between consecutive presented frames since the previous call
   * (milliseconds) — the stutter/jank indicator. Reset on each read.
   */
  worstFrameMs: number;
}

/**
 * GodotEngine HybridObject - zero-overhead JSI bridge to libgodot.
 *
 * Enforces pure C++ code generation for both iOS and Android via
 * `{ ios: 'c++', android: 'c++' }`. All methods are dispatched directly
 * through JSI without any Swift/Kotlin bridging layer.
 *
 * Architecture Epics:
 *   1. Lock-Free SPSC Queue & Smart Polling
 *   2. OS Graphics Context Lifecycle
 *   3. Asynchronous Bootstrap Pattern
 *   4. Zero-Latency 3D→2D Projection
 *   5. CQRS State Sync (JS-side only, no C++ spec needed)
 */
export interface GodotEngine extends HybridObject<{ ios: 'c++', android: 'c++' }> {
  // ─── Lifecycle Management ────────────────────────────────────────────────

  /**
   * Loads the Godot project from the given .pck path and initialises libgodot.
   * Must be called before start().
   */
  initialize(pckPath: string): void;

  /**
   * Spawns the Godot render thread and begins the main loop (~60 FPS).
   */
  start(): void;

  /**
   * Pauses the Godot main loop without destroying the engine state.
   */
  pause(): void;

  /**
   * Stops the render thread and destroys the engine instance.
   * Safe to call even if start() was never called.
   */
  destroy(): void;

  // ─── View Binding ────────────────────────────────────────────────────────

  /**
   * Binds a native OS surface to the Godot renderer.
   * @param surfacePointer - Raw ANativeWindow* (Android) or CAMetalLayer* (iOS)
   *   passed as a bigint (maps to int64_t in C++). Zero-copy, no serialisation.
   */
  attachSurface(surfacePointer: UInt64): void;

  // ─── Zero-Copy Data Pipelining ───────────────────────────────────────────

  /**
   * Pushes an ArrayBuffer into the shared memory region, protected by a mutex.
   * Maps to std::shared_ptr<nitro::ArrayBuffer> in C++ — zero-copy access.
   */
  updateSharedBuffer(buffer: ArrayBuffer): void;

  // ─── Messaging (Epic 1: Lock-Free SPSC Queue) ───────────────────────────

  /**
   * Sends a UTF-8 string message to the Godot GDScript/C++ layer.
   */
  sendMessage(message: string): void;

  /**
   * Polls a message from the Godot→JS SPSC lock-free queue.
   * Returns "" if the queue is empty. Safe to call at 120Hz.
   */
  pollMessage(): string;

  /**
   * Notify C++ that JS has finished draining the message queue.
   * Resets the wake-up flag so the next Godot enqueue triggers a new wake-up.
   * Called by the JS drain loop when pollMessage() returns "".
   */
  notifyPollingStopped(): void;

  /**
   * Registers a JS callback that C++ will invoke (via CallInvoker) when a
   * message is enqueued and JS is not currently polling.
   * This eliminates the need for continuous rAF polling — the drain loop
   * only runs when there are actually messages to consume.
   */
  setOnWakeUp(callback: () => void): void;

  // ─── OS Graphics Lifecycle (Epic 2) ─────────────────────────────────────

  /**
   * Suspends the Godot engine when the app is backgrounded.
   * Pauses MainLoop, RenderingServer, and AudioServer to prevent
   * GPU timeout crashes and background audio violations.
   */
  suspendOS(): void;

  /**
   * Resumes the Godot engine when the app returns to foreground.
   * Reattaches the native surface and resumes all servers.
   * @param newSurfacePointer  New ANativeWindow* or CAMetalLayer* (may differ from original)
   */
  resumeOS(newSurfacePointer: UInt64): void;

  // ─── Async Bootstrap (Epic 3) ───────────────────────────────────────────

  /**
   * Kick off async scene loading via GDScript ResourceLoader.
   * Progress events are pushed to the SPSC queue as LOAD_PROGRESS payloads.
   * @param scenePckPath  Path to the heavy game .pck to load asynchronously.
   */
  loadSceneAsync(scenePckPath: string): void;

  // ─── 3D→2D Projection (Epic 4) ─────────────────────────────────────────

  /**
   * Synchronous JSI method: projects a 3D world position to screen coordinates.
   * Uses cached camera matrices — NO Godot API calls, safe from any thread.
   *
   * Can be called inside a Reanimated useFrameCallback('worklet') for
   * zero-latency UI tracking of 3D targets at 120Hz.
   *
   * @returns [screenX, screenY] or undefined if camera cache not ready.
   */
  unprojectPosition(x: number, y: number, z: number): number[] | undefined;

  // ─── Touch Input Forwarding ─────────────────────────────────────────────

  /**
   * Forward a screen touch event (press/release) to Godot's Input system.
   * Constructs an InputEventScreenTouch via GDExtension and calls
   * Input.parse_input_event().
   *
   * @param x         Touch X position in viewport coordinates
   * @param y         Touch Y position in viewport coordinates
   * @param pressed   true for touch-down, false for touch-up
   * @param index     Pointer/finger index (0 for primary touch)
   */
  sendTouchEvent(x: number, y: number, pressed: boolean, index: number): void;

  /**
   * Forward a screen drag (touch-move) event to Godot's Input system.
   * Constructs an InputEventScreenDrag via GDExtension and calls
   * Input.parse_input_event().
   *
   * @param x         Current touch X position in viewport coordinates
   * @param y         Current touch Y position in viewport coordinates
   * @param relativeX Delta X from the last position
   * @param relativeY Delta Y from the last position
   * @param velocityX Horizontal velocity in pixels/sec
   * @param velocityY Vertical velocity in pixels/sec
   * @param index     Pointer/finger index (0 for primary touch)
   */
  sendDragEvent(x: number, y: number, relativeX: number, relativeY: number, velocityX: number, velocityY: number, index: number): void;

  // ─── Viewport Resizing ──────────────────────────────────────────────────

  /**
   * Resize Godot's Vulkan swapchain and root viewport to match the
   * native surface dimensions. Called when the Android SurfaceView
   * completes layout and reports its final pixel size.
   *
   * @param width   Surface width in physical pixels
   * @param height  Surface height in physical pixels
   */
  resizeSurface(width: number, height: number): void;

  // ─── Error Reporting ──────────────────────────────────────────────────────

  /**
   * Returns the last critical engine error as a human-readable string.
   * Returns "" if no error has occurred.
   *
   * Errors are set at key failure points:
   * - libgodot_create_godot_instance() failure
   * - Surface binding failure
   * - GDExtension init failure
   * - Render loop exceptions
   *
   * Also pushed as ENGINE_ERROR messages through the SPSC queue.
   */
  getLastError(): string;

  // ─── Frame Timing ─────────────────────────────────────────────────────────

  /**
   * Returns real frame-timing stats (see {@link FrameStats}). Rates are
   * measured over the interval since the previous call, so poll it on a fixed
   * cadence (e.g. every 500ms) for a live readout. Cheap; safe to call from JS.
   */
  getFrameStats(): FrameStats;
}

