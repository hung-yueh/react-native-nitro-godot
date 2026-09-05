/**
 * useGodotEngine.hook.test.tsx — real hook rendering via react-test-renderer.
 *
 * Unlike useGodotEngine.test.ts (pure-logic contracts), these tests mount the
 * hook for real and drive it through the surface/AppState lifecycle:
 *   - initial surface → start()
 *   - surface recreated while 'running' → resumeOS() (regression: tab
 *     round-trip used to leave the fresh surface unattached → black view)
 *   - suspend on background (with ghost-touch release), resume on foreground
 *   - ENGINE_ERROR message → engineState 'error' + lastError
 *   - unmount → release() (suspend, keep native alive), remount reuses the
 *     engine and resumes on the new surface without a second start()
 */

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { AppState } from 'react-native';
import { useGodotEngine, type UseGodotEngineResult } from '../useGodotEngine';
import { createMockEngine } from './__mocks__/react-native-nitro-modules';
import { flushRAF, resetRAF } from './testUtils';
import { __resetSharedGodotEngineForTests } from '../GodotEngine';

// The hook ingests STATE_SYNC into godotState — isolate that dependency.
jest.mock('../godotState', () => ({
  ingestStateSync: jest.fn(),
  state$: {},
}));

// ── Minimal renderHook harness (react-test-renderer, node env) ───────────────

function renderHook(pckPath = '/test/game.pck') {
  const result: { current: UseGodotEngineResult } = { current: null as any };

  function Harness({ path }: { path: string }) {
    result.current = useGodotEngine(path);
    return null;
  }

  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(<Harness path={pckPath} />);
  });

  return {
    result,
    unmount: () => act(() => renderer.unmount()),
    /** Re-render the same mounted hook with a different pck path */
    rerender: (path: string) => act(() => renderer.update(<Harness path={path} />)),
  };
}

/** Prepare the raw-engine mock the hook will receive from NitroModules */
function primeMockEngine() {
  const mockRaw = createMockEngine();
  const NitroModules = require('react-native-nitro-modules').NitroModules;
  NitroModules.createHybridObject.mockReturnValueOnce(mockRaw);
  return mockRaw;
}

function surfaceEvent(pointer: string) {
  return { nativeEvent: { pointer } } as any;
}

/** The AppState change handler registered by the hook's effect */
function appStateHandler(): (next: string) => void {
  const calls = (AppState.addEventListener as jest.Mock).mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1][1];
}

beforeEach(() => {
  resetRAF();
  jest.clearAllMocks();
  __resetSharedGodotEngineForTests();
});

describe('useGodotEngine (mounted)', () => {
  test('initial surface starts the engine and transitions to running', () => {
    const mockRaw = primeMockEngine();
    const { result } = renderHook();

    expect(result.current.engineState).toBe('initializing');
    expect(mockRaw.initialize).toHaveBeenCalledWith('/test/game.pck');

    act(() => {
      result.current.surfaceCallbacks.onSurfaceCreated(surfaceEvent('42'));
    });

    expect(mockRaw.attachSurface).toHaveBeenCalledWith(BigInt(42));
    expect(mockRaw.start).toHaveBeenCalledTimes(1);
    expect(result.current.engineState).toBe('running');
  });

  test('surface recreated while running resumes with the new pointer', () => {
    const mockRaw = primeMockEngine();
    const { result } = renderHook();

    act(() => {
      result.current.surfaceCallbacks.onSurfaceCreated(surfaceEvent('42'));
    });
    expect(result.current.engineState).toBe('running');

    // Simulate view unmount/remount: surface destroyed, then a NEW surface
    // arrives while the engine is still 'running' (in-app tab switch — no
    // AppState change fires).
    act(() => {
      result.current.surfaceCallbacks.onSurfaceDestroyed({ nativeEvent: {} } as any);
      result.current.surfaceCallbacks.onSurfaceCreated(surfaceEvent('99'));
    });

    // Regression: this used to fall through (attachSurface only, never
    // consumed) leaving Godot rendering to a dead surface.
    expect(mockRaw.resumeOS).toHaveBeenCalledWith(BigInt(99));
    expect(mockRaw.start).toHaveBeenCalledTimes(1); // NOT restarted
    expect(result.current.engineState).toBe('running');
  });

  test('background suspends and releases active touches (ghost-touch mitigation)', () => {
    const mockRaw = primeMockEngine();
    const { result } = renderHook();

    act(() => {
      result.current.surfaceCallbacks.onSurfaceCreated(surfaceEvent('42'));
    });

    // Two active pointers mid-gesture
    act(() => {
      result.current.handleTouchEvent({
        nativeEvent: { action: 'down', pointerId: 0, x: 10, y: 20 },
      } as any);
      result.current.handleTouchEvent({
        nativeEvent: { action: 'down', pointerId: 1, x: 30, y: 40 },
      } as any);
    });
    mockRaw.sendTouchEvent.mockClear();

    act(() => {
      appStateHandler()('background');
    });

    // Both pointers released with pressed=false, then suspended
    expect(mockRaw.sendTouchEvent).toHaveBeenCalledWith(10, 20, false, 0);
    expect(mockRaw.sendTouchEvent).toHaveBeenCalledWith(30, 40, false, 1);
    expect(mockRaw.suspendOS).toHaveBeenCalled();
    expect(result.current.engineState).toBe('suspended');
  });

  test('foreground resumes with the retained surface pointer', () => {
    const mockRaw = primeMockEngine();
    const { result } = renderHook();

    act(() => {
      result.current.surfaceCallbacks.onSurfaceCreated(surfaceEvent('42'));
    });
    act(() => {
      appStateHandler()('background');
    });
    expect(result.current.engineState).toBe('suspended');

    act(() => {
      appStateHandler()('active');
    });

    expect(mockRaw.resumeOS).toHaveBeenCalledWith(BigInt(42));
    expect(result.current.engineState).toBe('running');
  });

  test('suspended + surface recreated resumes via onSurfaceCreated', () => {
    const mockRaw = primeMockEngine();
    const { result } = renderHook();

    act(() => {
      result.current.surfaceCallbacks.onSurfaceCreated(surfaceEvent('42'));
    });
    act(() => {
      result.current.surfaceCallbacks.onSurfaceDestroyed({ nativeEvent: {} } as any);
      appStateHandler()('background');
    });
    // Foreground with no surface: must wait for onSurfaceCreated
    act(() => {
      appStateHandler()('active');
    });
    expect(result.current.engineState).toBe('suspended');

    act(() => {
      result.current.surfaceCallbacks.onSurfaceCreated(surfaceEvent('77'));
    });
    expect(mockRaw.resumeOS).toHaveBeenCalledWith(BigInt(77));
    expect(result.current.engineState).toBe('running');
  });

  test('ENGINE_ERROR message transitions to error state with lastError', () => {
    const mockRaw = primeMockEngine();
    const { result } = renderHook();
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

    act(() => {
      mockRaw._enqueueTestMessage(
        '{"type":"ENGINE_ERROR","layer":"lifecycle","error":"Godot cannot restart after destroy()"}'
      );
      flushRAF();
    });

    expect(result.current.engineState).toBe('error');
    expect(result.current.lastError).toContain('[NitroGodot:lifecycle]');
    expect(result.current.lastError).toContain('Godot cannot restart');
    consoleSpy.mockRestore();
  });

  test('onSurfaceChanged forwards physical dimensions to resizeSurface', () => {
    const mockRaw = primeMockEngine();
    const { result } = renderHook();

    act(() => {
      result.current.surfaceCallbacks.onSurfaceChanged({
        nativeEvent: { width: 1170, height: 2532 },
      } as any);
    });

    expect(mockRaw.resizeSurface).toHaveBeenCalledWith(1170, 2532);
  });

  test('sendTouchEvent scales logical dp by PixelRatio, handleTouchEvent does not', () => {
    const mockRaw = primeMockEngine();
    const { result } = renderHook();

    act(() => {
      result.current.sendTouchEvent(10, 20, true, 0); // dp → ×2 (mock PixelRatio)
      result.current.handleTouchEvent({
        nativeEvent: { action: 'down', pointerId: 3, x: 100, y: 200 },
      } as any); // physical px → unscaled
    });

    expect(mockRaw.sendTouchEvent).toHaveBeenCalledWith(20, 40, true, 0);
    expect(mockRaw.sendTouchEvent).toHaveBeenCalledWith(100, 200, true, 3);
  });

  test('drag deltas are computed from the tracked previous position', () => {
    const mockRaw = primeMockEngine();
    const { result } = renderHook();

    act(() => {
      result.current.handleTouchEvent({
        nativeEvent: { action: 'down', pointerId: 0, x: 100, y: 100 },
      } as any);
      result.current.handleTouchEvent({
        nativeEvent: { action: 'move', pointerId: 0, x: 110, y: 95 },
      } as any);
    });

    expect(mockRaw.sendDragEvent).toHaveBeenCalledWith(110, 95, 10, -5, 0, 0, 0);
  });

  test('unmount releases the engine (suspends it, never destroys it)', () => {
    const mockRaw = primeMockEngine();
    const { result, unmount } = renderHook();
    act(() => {
      result.current.surfaceCallbacks.onSurfaceCreated(surfaceEvent('42'));
    });

    unmount();

    expect(mockRaw.suspendOS).toHaveBeenCalled();
    expect(mockRaw.destroy).not.toHaveBeenCalled();
  });

  test('unmount before the first surface does not suspend a never-started engine', () => {
    const mockRaw = primeMockEngine();
    const { unmount } = renderHook();

    unmount();

    expect(mockRaw.suspendOS).not.toHaveBeenCalled();
    expect(mockRaw.destroy).not.toHaveBeenCalled();
  });

  test('a pckPath change without remount suspends then resumes on the retained surface', () => {
    const mockRaw = primeMockEngine();
    const { result, rerender } = renderHook('/a.pck');
    act(() => {
      result.current.surfaceCallbacks.onSurfaceCreated(surfaceEvent('42'));
    });
    expect(result.current.engineState).toBe('running');
    const warn = jest.spyOn(console, 'warn').mockImplementation();

    // Metro re-hashed the pack asset → new extracted path → effect re-runs.
    rerender('/b.pck');

    expect(mockRaw.suspendOS).toHaveBeenCalledTimes(1);          // cleanup released it
    expect(mockRaw.resumeOS).toHaveBeenCalledWith(BigInt(42));   // effect re-run resumed it
    expect(mockRaw.start).toHaveBeenCalledTimes(1);              // never restarted
    expect(mockRaw.destroy).not.toHaveBeenCalled();
    expect(result.current.engineState).toBe('running');
    warn.mockRestore();
  });

  test('remount reuses the shared engine and resumes on the new surface without start()', () => {
    const mockRaw = primeMockEngine();
    const first = renderHook();
    act(() => {
      first.result.current.surfaceCallbacks.onSurfaceCreated(surfaceEvent('42'));
    });
    expect(mockRaw.start).toHaveBeenCalledTimes(1);
    first.unmount();

    // Second mount (Fast Refresh / navigation back): NitroModules must NOT be
    // asked for a new HybridObject and start() must not run again.
    const NitroModules = require('react-native-nitro-modules').NitroModules;
    const createCalls = (NitroModules.createHybridObject as jest.Mock).mock.calls.length;
    const second = renderHook();
    expect((NitroModules.createHybridObject as jest.Mock).mock.calls.length).toBe(createCalls);
    expect(second.result.current.engine.raw).toBe(mockRaw);
    expect(second.result.current.engineState).toBe('suspended');

    act(() => {
      second.result.current.surfaceCallbacks.onSurfaceCreated(surfaceEvent('99'));
    });
    expect(mockRaw.start).toHaveBeenCalledTimes(1);
    expect(mockRaw.resumeOS).toHaveBeenCalledWith(BigInt(99));
    expect(second.result.current.engineState).toBe('running');

    // Messages flow to the new mount's handlers.
    const received: string[] = [];
    second.result.current.engine.onMessage((m) => received.push(m));
    act(() => {
      mockRaw._enqueueTestMessage('{"type":"PONG"}');
      flushRAF();
    });
    expect(received).toEqual(['{"type":"PONG"}']);
    second.unmount();
  });
});
