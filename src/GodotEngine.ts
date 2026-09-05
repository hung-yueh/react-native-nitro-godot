/**
 * GodotEngine.ts — High-level TypeScript wrapper for the GodotEngine HybridObject.
 *
 * Provides:
 *   - Event-driven message handling via a rAF drain loop
 *   - Integration point for CQRS state ingestion (Epic 5)
 *
 * Architecture:
 *   Call startPolling() after registering handlers — it runs a
 *   requestAnimationFrame drain loop that empties the C++ SPSC queue each
 *   frame and dispatches to onMessage handlers. C++ does NOT wake JS up on
 *   enqueue: invoking a JS callback from the Godot render thread would be a
 *   JSI threading violation, so until a CallInvoker-based wake-up is wired,
 *   messages are only delivered while the polling loop is running.
 *   (setOnWakeUp is still registered for forward compatibility, but is
 *   currently never invoked by C++.)
 */

import { NitroModules } from 'react-native-nitro-modules';
import type { GodotEngine as GodotEngineSpec, FrameStats } from './GodotEngine.nitro';

export type MessageHandler = (message: string) => void;

export interface GodotEngineWrapper {
  /** The raw Nitro HybridObject — use for direct JSI calls */
  readonly raw: GodotEngineSpec;

  /** The .pck this engine was initialized with */
  readonly pckPath: string;

  /** True once start() has been issued through {@link markStarted}. */
  readonly started: boolean;

  /** Record that the engine has been started (called by useGodotEngine after raw.start()). */
  markStarted(): void;

  /** Register a handler for messages from Godot */
  onMessage(handler: MessageHandler): () => void;

  /** Start the rAF drain loop manually (until CallInvoker wake-up is wired) */
  startPolling(): void;

  /** Stop the drain loop */
  stopPolling(): void;

  /** Send a message to Godot (JS → C++) */
  sendMessage(message: string): void;

  /** Kick off async scene loading with progress events */
  loadSceneAsync(scenePckPath: string): void;

  /** Synchronous 3D→2D projection (safe for worklets) */
  unprojectPosition(x: number, y: number, z: number): [number, number] | undefined;

  /** Suspend engine (call on app background) */
  suspendOS(): void;

  /** Resume engine (call on app foreground) */
  resumeOS(newSurfacePointer: bigint): void;

  /** Notify C++ that polling has stopped */
  notifyPollingStopped(): void;

  /**
   * Real frame-timing stats over the interval since the last call: engine
   * iteration rate vs frames actually presented to the display, plus the worst
   * present gap. Poll on a fixed cadence (e.g. 500ms) for a live readout. See
   * {@link FrameStats}. NOTE: the in-engine/counter fps is `producedFps`;
   * `presentedFps` is what the user actually sees.
   */
  getFrameStats(): FrameStats;

  /**
   * Soft release for a transient unmount (tab switch, Fast Refresh, remount):
   * stops the drain loop, drops message handlers and suspends the engine, but
   * keeps the native instance alive and registered so the next
   * {@link createGodotEngine} call adopts it and resumes on the new surface.
   * Godot cannot be re-created in-process, so this is the only path that
   * survives a React remount.
   */
  release(): void;

  /**
   * Hard teardown: stops and joins the render thread and forgets the shared
   * instance. After this, Godot cannot be started again in this process —
   * only call it when the app is shutting the game down for good.
   */
  destroy(): void;
}

// ── Process-wide shared engine ────────────────────────────────────────────
// Godot is a process singleton (see ARCHITECTURE.md §8.1). Every
// createGodotEngine() call after the first returns the same wrapper so that
// React remounts and Fast Refresh reuse the live engine instead of trying to
// start a second one.
let sharedEngine: GodotEngineWrapper | null = null;

/** The engine created earlier in this process, if any. */
export function getSharedGodotEngine(): GodotEngineWrapper | null {
  return sharedEngine;
}

/** @internal Test-only: forget the shared engine without touching native. */
export function __resetSharedGodotEngineForTests(): void {
  sharedEngine = null;
}

/**
 * Creates a wrapped GodotEngine with event-driven messaging.
 *
 * @param pckPath  Path to the bootstrap .pck file
 * @returns GodotEngineWrapper with lifecycle management and message handling
 */
export function createGodotEngine(pckPath: string): GodotEngineWrapper {
  if (sharedEngine) {
    if (sharedEngine.pckPath !== pckPath) {
      console.warn(
        `[GodotEngine] createGodotEngine("${pckPath}") — reusing the engine already running "${sharedEngine.pckPath}". ` +
          'Godot cannot load a second pack in this process; restart the app to switch packs.',
      );
    }
    return sharedEngine;
  }

  const engine = NitroModules.createHybridObject<GodotEngineSpec>('GodotEngine');
  engine.initialize(pckPath);

  const handlers = new Set<MessageHandler>();
  let rafId: number | null = null;
  let isPolling = false;
  let started = false;

  // ── rAF Drain Loop ──────────────────────────────────────────────────────
  // Drains all pending messages from the SPSC queue, dispatches to handlers,
  // then stops and signals C++ that polling has ceased.

  function startDrainLoop() {
    if (rafId !== null) return; // Already running
    rafId = requestAnimationFrame(drainLoop);
  }

  function drainLoop() {
    let msg: string;

    // Drain all available messages in this frame
    while ((msg = engine.pollMessage()) !== '') {
      for (const handler of handlers) {
        try {
          handler(msg);
        } catch (e) {
          console.error('[GodotEngine] Message handler error:', e);
        }
      }
    }

    // Queue is empty — check if we should keep polling
    if (isPolling) {
      // Keep the loop alive for the next frame
      rafId = requestAnimationFrame(drainLoop);
    } else {
      // Queue drained and not force-polling — stop
      rafId = null;
      engine.notifyPollingStopped();
    }
  }
  // ── C++ → JS Wake-Up (forward compatibility only) ─────────────────────
  // C++ does not currently invoke this callback (doing so from the Godot
  // render thread would violate JSI threading rules). Registered so the
  // drain loop starts automatically once a CallInvoker-based wake-up lands.
  // Until then, consumers MUST call startPolling() to receive messages.
  engine.setOnWakeUp(() => startDrainLoop());

  function stopDrainLoop() {
    isPolling = false;
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
      engine.notifyPollingStopped();
    }
  }

  // ── Public API ──────────────────────────────────────────────────────────

  const wrapper: GodotEngineWrapper = {
    get raw() {
      return engine;
    },

    pckPath,

    get started() {
      return started;
    },

    markStarted() {
      started = true;
    },

    onMessage(handler: MessageHandler): () => void {
      handlers.add(handler);
      return () => {
        handlers.delete(handler);
      };
    },

    startPolling() {
      isPolling = true;
      startDrainLoop();
    },

    stopPolling() {
      stopDrainLoop();
    },

    sendMessage(message: string) {
      engine.sendMessage(message);
    },

    loadSceneAsync(scenePckPath: string) {
      engine.loadSceneAsync(scenePckPath);
    },

    unprojectPosition(x: number, y: number, z: number): [number, number] | undefined {
      const result = engine.unprojectPosition(x, y, z);
      if (!result || result.length < 2) return undefined;
      return [result[0]!, result[1]!] as [number, number];
    },

    suspendOS() {
      engine.suspendOS();
    },

    resumeOS(newSurfacePointer: bigint) {
      engine.resumeOS(newSurfacePointer);
    },

    notifyPollingStopped() {
      engine.notifyPollingStopped();
    },

    getFrameStats(): FrameStats {
      return engine.getFrameStats();
    },

    release() {
      stopDrainLoop();
      handlers.clear();
      // suspendOS() pauses the SceneTree, disables the render loop and mutes
      // audio; resumeOS(newSurface) from the next mount undoes all of it.
      if (started) engine.suspendOS();
    },

    destroy() {
      stopDrainLoop();
      handlers.clear();
      engine.destroy();
      if (sharedEngine === wrapper) sharedEngine = null;
    },
  };

  sharedEngine = wrapper;
  return wrapper;
}
