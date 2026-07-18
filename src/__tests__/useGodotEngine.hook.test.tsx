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
 *   - unmount → destroy()
 */

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { AppState } from 'react-native';
import { useGodotEngine, type UseGodotEngineResult } from '../useGodotEngine';
import { createMockEngine } from './__mocks__/react-native-nitro-modules';
import { flushRAF, resetRAF } from './testUtils';

// The hook ingests STATE_SYNC into godotState — isolate that dependency.
jest.mock('../godotState', () => ({
  ingestStateSync: jest.fn(),
  state$: {},
}));

// ── Minimal renderHook harness (react-test-renderer, node env) ───────────────

function renderHook(pckPath = '/test/game.pck') {
  const result: { current: UseGodotEngineResult } = { current: null as any };

  function Harness() {
    result.current = useGodotEngine(pckPath);
    return null;
  }

  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(<Harness />);
  });

  return {
    result,
    unmount: () => act(() => renderer.unmount()),
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

  test('unmount destroys the engine and stops polling', () => {
    const mockRaw = primeMockEngine();
    const { unmount } = renderHook();

    unmount();

    expect(mockRaw.destroy).toHaveBeenCalled();
  });
});
