import { useRef, useEffect, useCallback, useState } from 'react';
import { AppState, PixelRatio, type NativeSyntheticEvent, type AppStateStatus } from 'react-native';
import { createGodotEngine, type GodotEngineWrapper, type MessageHandler } from './GodotEngine';
import type { TouchEvent, SurfaceCreatedEvent, SurfaceChangedEvent } from './GodotView';
import { ingestStateSync } from './godotState';

// ── Lifecycle State Machine ──────────────────────────────────────────────────

/**
 * Engine lifecycle states:
 *   idle → initializing → ready → running → suspended → running
 *                                    ↓
 *                                  error
 */
export type EngineState = 'idle' | 'initializing' | 'ready' | 'running' | 'suspended' | 'error';

// ── Public API ───────────────────────────────────────────────────────────────

export interface UseGodotEngineResult {
  /** The managed GodotEngine wrapper */
  engine: GodotEngineWrapper;
  /** Current lifecycle state (for loading spinners, error overlays, etc.) */
  engineState: EngineState;
  /** Last critical engine error, or null if none. Check this when Godot view is blank. */
  lastError: string | null;

  // ── Surface Callbacks (spread into <GodotView>) ──────────────────────────

  /**
   * Callbacks to spread directly into <GodotView>.
   *
   * @example
   * ```tsx
   * const { surfaceCallbacks, handleTouchEvent } = useGodotEngine('/data/game.pck');
   * <GodotView {...surfaceCallbacks} onTouchEvent={handleTouchEvent} />
   * ```
   */
  surfaceCallbacks: {
    onSurfaceCreated:  (e: NativeSyntheticEvent<SurfaceCreatedEvent>) => void;
    onSurfaceChanged:  (e: NativeSyntheticEvent<SurfaceChangedEvent>) => void;
    onSurfaceDestroyed: (e: NativeSyntheticEvent<{}>) => void;
  };

  /** Manually pause the engine (also called automatically on surface destruction) */
  pause: () => void;
  /** Send a string message to the running Godot scene */
  sendMessage: (msg: string) => void;
  /** Forward a touch press/release event to Godot's Input system */
  sendTouchEvent: (x: number, y: number, pressed: boolean, index: number) => void;
  /** Forward a touch drag event to Godot's Input system */
  sendDragEvent: (x: number, y: number, relativeX: number, relativeY: number, velocityX: number, velocityY: number, index: number) => void;
  /**
   * Convenience handler for <GodotView onTouchEvent={handleTouchEvent} />.
   * Automatically translates native touch events to sendTouchEvent/sendDragEvent calls.
   * Also tracks active pointers for ghost-touch release on background.
   */
  handleTouchEvent: (event: NativeSyntheticEvent<TouchEvent>) => void;
}

/**
 * useGodotEngine — React hook that manages the full GodotEngine lifecycle.
 *
 * Implements the complete mount sequence:
 *   1. Create engine + initialize with pckPath
 *   2. Wait for <GodotView> surface via onSurfaceCreated callback
 *   3. attachSurface() + start() + wire SPSC polling
 *
 * Automatically handles:
 *   - AppState background/foreground → suspendOS() / resumeOS()
 *   - Ghost touch release on background (synthetic "up" for all active pointers)
 *   - Surface hot-swap (surfaceDestroyed → surfaceCreated cycle)
 *   - STATE_SYNC / LOAD_PROGRESS ingestion into Legend-State
 *
 * @param pckPath    Absolute path to the .pck file to load
 * @param onMessage  Optional callback for all messages from Godot
 *
 * @example
 * ```tsx
 * const { engine, engineState, surfaceCallbacks, handleTouchEvent } =
 *   useGodotEngine('/data/game.pck');
 *
 * return (
 *   <GodotView
 *     style={StyleSheet.absoluteFill}
 *     {...surfaceCallbacks}
 *     onTouchEvent={handleTouchEvent}
 *   />
 * );
 * ```
 */
export function useGodotEngine(
  pckPath: string,
  onMessage?: MessageHandler,
): UseGodotEngineResult {
  const engineRef = useRef<GodotEngineWrapper | null>(null);
  const surfacePtrRef = useRef<bigint | null>(null);
  const activeTouchesRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const [engineState, setEngineState] = useState<EngineState>('idle');
  const [lastError, setLastError] = useState<string | null>(null);

  // Lazy initialization — create engine once
  if (!engineRef.current) {
    engineRef.current = createGodotEngine(pckPath);
    setEngineState('initializing');
  }
  const engine = engineRef.current;

  // ── Core lifecycle effect ──────────────────────────────────────────────────
  useEffect(() => {
    // Register the CQRS state sync ingestion handler (Epic 5).
    const unsubStateSync = engine.onMessage((msg: string) => {
      try {
        const parsed = JSON.parse(msg);
        if (parsed.type === 'STATE_SYNC' && parsed.data) {
          ingestStateSync(parsed.data);
        }
        if (parsed.type === 'LOAD_PROGRESS') {
          ingestStateSync({
            loading: { progress: parsed.value, complete: false },
          });
        }
        if (parsed.type === 'LOAD_COMPLETE') {
          ingestStateSync({
            loading: { progress: 1, complete: true },
          });
        }
        // ── ENGINE_ERROR: surface critical errors from C++ ──────────────
        if (parsed.type === 'ENGINE_ERROR') {
          const errMsg = `[NitroGodot:${parsed.layer}] ${parsed.error}`;
          console.error(errMsg);
          setLastError(errMsg);
          setEngineState('error');
        }
      } catch {
        // Not JSON — pass through as raw message
      }
    });

    // Register consumer's message handler if provided
    let unsubConsumer: (() => void) | undefined;
    if (onMessage) {
      unsubConsumer = engine.onMessage(onMessage);
    }

    // Start polling
    engine.startPolling();

    return () => {
      engine.stopPolling();
      unsubStateSync();
      unsubConsumer?.();
      engine.destroy();
      engineRef.current = null;
      surfacePtrRef.current = null;
      activeTouchesRef.current.clear();
    };
  }, [pckPath]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── AppState listener (auto suspend/resume) ────────────────────────────────
  useEffect(() => {
    const handleAppStateChange = (nextState: AppStateStatus) => {
      if (nextState === 'background' || nextState === 'inactive') {
        // Ghost touch mitigation: release all active touches.
        const touches = activeTouchesRef.current;
        if (touches.size > 0) {
          for (const [pointerId, pos] of touches.entries()) {
            engine.raw.sendTouchEvent(pos.x, pos.y, false, pointerId);
          }
          touches.clear();
        }

        engine.raw.suspendOS();
        setEngineState('suspended');
      } else if (nextState === 'active') {
        const ptr = surfacePtrRef.current;
        if (ptr !== null) {
          engine.raw.resumeOS(ptr);
          setEngineState('running');
        }
        // If ptr is null, we'll wait for onSurfaceCreated to resume
      }
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);
    return () => subscription.remove();
  }, [engine]);

  // ── Surface callbacks ──────────────────────────────────────────────────────

  const onSurfaceCreated = useCallback((e: NativeSyntheticEvent<SurfaceCreatedEvent>) => {
    // Android emits unsigned decimal string from Long.toULong().toString()
    const ptr = BigInt(e.nativeEvent.pointer);
    surfacePtrRef.current = ptr;
    engine.raw.attachSurface(ptr);

    // If this is the initial mount, start the engine.
    // If this is a hot-swap (surface recreated after background), resume.
    if (engineState === 'initializing' || engineState === 'idle') {
      engine.raw.start();
      setEngineState('running');
    } else if (engineState === 'suspended') {
      engine.raw.resumeOS(ptr);
      setEngineState('running');
    }
  }, [engine, engineState]);

  const onSurfaceDestroyed = useCallback((_e: NativeSyntheticEvent<{}>) => {
    surfacePtrRef.current = null;
    // Don't call suspendOS() here — AppState handler does it.
    // surfaceDestroyed can fire AFTER the OS has already reclaimed the window,
    // so we just nullify our pointer reference.
  }, []);

  const onSurfaceChanged = useCallback((e: NativeSyntheticEvent<SurfaceChangedEvent>) => {
    // Android SurfaceView dimensions are in physical pixels — pass directly.
    const { width, height } = e.nativeEvent;
    engine.raw.resizeSurface(width, height);
  }, [engine]);

  // ── Input forwarding ───────────────────────────────────────────────────────

  const pause = useCallback(() => {
    engine.raw.pause();
  }, [engine]);

  const sendMessage = useCallback((msg: string) => {
    engine.sendMessage(msg);
  }, [engine]);

  const sendTouchEvent = useCallback((x: number, y: number, pressed: boolean, index: number) => {
    const scale = PixelRatio.get();
    engine.raw.sendTouchEvent(x * scale, y * scale, pressed, index);
  }, [engine]);

  const sendDragEvent = useCallback((x: number, y: number, relativeX: number, relativeY: number, velocityX: number, velocityY: number, index: number) => {
    const scale = PixelRatio.get();
    engine.raw.sendDragEvent(x * scale, y * scale, relativeX * scale, relativeY * scale, velocityX * scale, velocityY * scale, index);
  }, [engine]);

  const handleTouchEvent = useCallback((event: NativeSyntheticEvent<TouchEvent>) => {
    const { action, pointerId, x, y } = event.nativeEvent;
    const touches = activeTouchesRef.current;
    // GodotSurfaceView emits in physical pixels — pass through directly.
    // (PixelRatio scaling is NOT needed here because the native Android
    //  SurfaceView.onTouchEvent already reports in the surface's pixel space.)

    if (action === 'down') {
      touches.set(pointerId, { x, y });
      engine.raw.sendTouchEvent(x, y, true, pointerId);
    } else if (action === 'up') {
      touches.delete(pointerId);
      engine.raw.sendTouchEvent(x, y, false, pointerId);
    } else if (action === 'move') {
      // Compute delta from stored previous position — native deltaX/deltaY
      // may not be forwarded correctly on all Android bridge architectures.
      const prev = touches.get(pointerId);
      const dx = prev ? x - prev.x : 0;
      const dy = prev ? y - prev.y : 0;
      touches.set(pointerId, { x, y });
      engine.raw.sendDragEvent(x, y, dx, dy, 0, 0, pointerId);
    }
  }, [engine]);

  return {
    engine,
    engineState,
    lastError,
    surfaceCallbacks: {
      onSurfaceCreated,
      onSurfaceChanged,
      onSurfaceDestroyed,
    },
    pause,
    sendMessage,
    sendTouchEvent,
    sendDragEvent,
    handleTouchEvent,
  };
}
