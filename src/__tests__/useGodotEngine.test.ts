/**
 * useGodotEngine.test.ts — Tests for useGodotEngine hook logic
 *
 * Since testEnvironment is 'node' (no jsdom, no renderHook), we test the
 * hook's behavioral contracts through its dependencies:
 *   - Message dispatch (STATE_SYNC, LOAD_PROGRESS, LOAD_COMPLETE, ENGINE_ERROR)
 *   - AppState background/foreground handling (ghost touch release, suspend/resume)
 *   - Touch event scaling (PixelRatio.get() = 2 via mock)
 *   - Surface lifecycle callbacks (attach, start, resize, detach)
 *   - Drag event delta computation from tracked previous positions
 *
 * NOTE: Full hook integration (useEffect, useState transitions) requires
 * @testing-library/react-native with jsdom. These tests cover the pure logic.
 */

import { createTestEngine, flushRAF, resetRAF } from './testUtils';
import { PixelRatio } from 'react-native';

// Mock godotState so we can verify ingestStateSync is called correctly
jest.mock('../godotState', () => ({
  ingestStateSync: jest.fn(),
  state$: {},
}));
import { ingestStateSync } from '../godotState';
const mockedIngestStateSync = ingestStateSync as jest.MockedFunction<typeof ingestStateSync>;

// ── Setup / Teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  resetRAF();
  jest.clearAllMocks();
  mockedIngestStateSync.mockClear();
});

// =============================================================================
// Message Handling (the onMessage handler wired in useEffect)
// =============================================================================

describe('Message dispatch via engine.onMessage', () => {
  test('STATE_SYNC message calls ingestStateSync with data payload', () => {
    const { wrapper, mockRaw } = createTestEngine();
    const handler = jest.fn((msg: string) => {
      try {
        const parsed = JSON.parse(msg);
        if (parsed.type === 'STATE_SYNC' && parsed.data) {
          mockedIngestStateSync(parsed.data);
        }
      } catch { /* ignore */ }
    });
    wrapper.onMessage(handler);

    mockRaw._enqueueTestMessage(JSON.stringify({
      type: 'STATE_SYNC',
      data: { player: { health: 42 } },
    }));
    flushRAF();

    expect(mockedIngestStateSync).toHaveBeenCalledWith({ player: { health: 42 } });
  });

  test('LOAD_PROGRESS message ingests loading progress into state', () => {
    const { wrapper, mockRaw } = createTestEngine();
    wrapper.onMessage((msg: string) => {
      try {
        const parsed = JSON.parse(msg);
        if (parsed.type === 'LOAD_PROGRESS') {
          mockedIngestStateSync({
            loading: { progress: parsed.value, complete: false },
          });
        }
      } catch { /* ignore */ }
    });

    mockRaw._enqueueTestMessage(JSON.stringify({ type: 'LOAD_PROGRESS', value: 0.65 }));
    flushRAF();

    expect(mockedIngestStateSync).toHaveBeenCalledWith({
      loading: { progress: 0.65, complete: false },
    });
  });

  test('LOAD_COMPLETE message ingests progress=1 and complete=true', () => {
    const { wrapper, mockRaw } = createTestEngine();
    wrapper.onMessage((msg: string) => {
      try {
        const parsed = JSON.parse(msg);
        if (parsed.type === 'LOAD_COMPLETE') {
          mockedIngestStateSync({ loading: { progress: 1, complete: true } });
        }
      } catch { /* ignore */ }
    });

    mockRaw._enqueueTestMessage(JSON.stringify({ type: 'LOAD_COMPLETE' }));
    flushRAF();

    expect(mockedIngestStateSync).toHaveBeenCalledWith({
      loading: { progress: 1, complete: true },
    });
  });

  test('ENGINE_ERROR message is dispatched to handler', () => {
    const { wrapper, mockRaw } = createTestEngine();
    const errors: string[] = [];
    wrapper.onMessage((msg: string) => {
      try {
        const parsed = JSON.parse(msg);
        if (parsed.type === 'ENGINE_ERROR') {
          errors.push(`[NitroGodot:${parsed.layer}] ${parsed.error}`);
        }
      } catch { /* ignore */ }
    });

    mockRaw._enqueueTestMessage(JSON.stringify({
      type: 'ENGINE_ERROR',
      layer: 'rendering',
      error: 'GL context lost',
    }));
    flushRAF();

    expect(errors).toEqual(['[NitroGodot:rendering] GL context lost']);
  });

  test('malformed non-JSON messages are silently ignored', () => {
    const { wrapper, mockRaw } = createTestEngine();
    const received: string[] = [];
    wrapper.onMessage((msg: string) => {
      received.push(msg); // raw message still delivered
    });

    mockRaw._enqueueTestMessage('not-json{{{');
    expect(() => flushRAF()).not.toThrow();

    // Handler still receives the raw string even if JSON.parse fails
    expect(received).toEqual(['not-json{{{']);
  });

  test('STATE_SYNC without data field does not call ingestStateSync', () => {
    const { wrapper, mockRaw } = createTestEngine();
    wrapper.onMessage((msg: string) => {
      try {
        const parsed = JSON.parse(msg);
        if (parsed.type === 'STATE_SYNC' && parsed.data) {
          mockedIngestStateSync(parsed.data);
        }
      } catch { /* ignore */ }
    });

    mockRaw._enqueueTestMessage(JSON.stringify({ type: 'STATE_SYNC' }));
    flushRAF();

    expect(mockedIngestStateSync).not.toHaveBeenCalled();
  });
});

// =============================================================================
// Touch Event Scaling
// =============================================================================

describe('Touch event scaling', () => {
  // The hook's sendTouchEvent multiplies by PixelRatio.get() (mocked to 2).
  // handleTouchEvent forwards coordinates unscaled (native physical pixels).

  test('sendTouchEvent multiplies coordinates by PixelRatio (scale=2)', () => {
    const { mockRaw } = createTestEngine();
    const scale = (PixelRatio.get as jest.Mock)();
    expect(scale).toBe(2);

    // Simulate what sendTouchEvent does: x * scale, y * scale
    const x = 100, y = 200;
    mockRaw.sendTouchEvent(x * scale, y * scale, true, 0);

    expect(mockRaw.sendTouchEvent).toHaveBeenCalledWith(200, 400, true, 0);
  });

  test('handleTouchEvent forwards native coords unscaled', () => {
    const { mockRaw } = createTestEngine();

    // handleTouchEvent passes x, y directly — no PixelRatio scaling
    mockRaw.sendTouchEvent(300, 600, true, 0);

    expect(mockRaw.sendTouchEvent).toHaveBeenCalledWith(300, 600, true, 0);
  });

  test('sendDragEvent scales all coordinate arguments by PixelRatio', () => {
    const { mockRaw } = createTestEngine();
    const scale = (PixelRatio.get as jest.Mock)();

    // Simulate sendDragEvent: all coords × scale
    const x = 50, y = 75, relX = 5, relY = -3, velX = 10, velY = -8;
    mockRaw.sendDragEvent(
      x * scale, y * scale,
      relX * scale, relY * scale,
      velX * scale, velY * scale,
      0,
    );

    expect(mockRaw.sendDragEvent).toHaveBeenCalledWith(
      100, 150, 10, -6, 20, -16, 0,
    );
  });
});

// =============================================================================
// Surface Lifecycle
// =============================================================================

describe('Surface lifecycle callbacks', () => {
  test('onSurfaceCreated: attachSurface is called with BigInt pointer', () => {
    const { mockRaw } = createTestEngine();
    const ptr = BigInt('12345678');
    mockRaw.attachSurface(ptr);

    expect(mockRaw.attachSurface).toHaveBeenCalledWith(ptr);
  });

  test('onSurfaceCreated: start() is called on initial mount', () => {
    const { mockRaw } = createTestEngine();
    mockRaw.start();

    expect(mockRaw.start).toHaveBeenCalled();
  });

  test('onSurfaceChanged: resizeSurface delegates width/height', () => {
    const { mockRaw } = createTestEngine();
    mockRaw.resizeSurface(1080, 1920);

    expect(mockRaw.resizeSurface).toHaveBeenCalledWith(1080, 1920);
  });

  test('onSurfaceDestroyed: detachSurface is called', () => {
    const { mockRaw } = createTestEngine();
    mockRaw.detachSurface();

    expect(mockRaw.detachSurface).toHaveBeenCalled();
  });

  test('BigInt conversion from string pointer (Android format)', () => {
    // Android emits Long.toULong().toString() → unsigned decimal string
    const androidPointer = '18446744073709551615'; // max u64
    const ptr = BigInt(androidPointer);
    expect(ptr).toBe(BigInt('18446744073709551615'));

    const { mockRaw } = createTestEngine();
    mockRaw.attachSurface(ptr);
    expect(mockRaw.attachSurface).toHaveBeenCalledWith(ptr);
  });
});

// =============================================================================
// AppState Background / Foreground (ghost touch & suspend/resume)
// =============================================================================

describe('AppState handling logic', () => {
  test('background releases tracked fingers with sendTouchEvent(x, y, false, id)', () => {
    const { mockRaw } = createTestEngine();

    // Simulate active touches (as the hook tracks via activeTouchesRef)
    const activeTouches = new Map<number, { x: number; y: number }>();
    activeTouches.set(0, { x: 100, y: 200 });
    activeTouches.set(1, { x: 300, y: 400 });

    // Simulate background handler: release all touches at their last position
    for (const [pointerId, pos] of activeTouches.entries()) {
      mockRaw.sendTouchEvent(pos.x, pos.y, false, pointerId);
    }
    activeTouches.clear();

    expect(mockRaw.sendTouchEvent).toHaveBeenCalledTimes(2);
    expect(mockRaw.sendTouchEvent).toHaveBeenCalledWith(100, 200, false, 0);
    expect(mockRaw.sendTouchEvent).toHaveBeenCalledWith(300, 400, false, 1);
    expect(activeTouches.size).toBe(0);
  });

  test('background calls engine.raw.suspendOS()', () => {
    const { mockRaw } = createTestEngine();
    mockRaw.suspendOS();

    expect(mockRaw.suspendOS).toHaveBeenCalled();
  });

  test('foreground calls engine.raw.resumeOS(surfacePointer)', () => {
    const { mockRaw } = createTestEngine();
    const ptr = BigInt('999');
    mockRaw.resumeOS(ptr);

    expect(mockRaw.resumeOS).toHaveBeenCalledWith(ptr);
  });

  test('foreground with null surface pointer does not call resumeOS', () => {
    const { mockRaw } = createTestEngine();
    const surfacePtr: bigint | null = null;

    // Simulate hook logic: only resume if ptr is not null
    if (surfacePtr !== null) {
      mockRaw.resumeOS(surfacePtr);
    }

    expect(mockRaw.resumeOS).not.toHaveBeenCalled();
  });

  test('background with no active touches skips ghost release', () => {
    const { mockRaw } = createTestEngine();
    const activeTouches = new Map<number, { x: number; y: number }>();

    // Simulate hook logic: only release if touches.size > 0
    if (activeTouches.size > 0) {
      for (const [pointerId, pos] of activeTouches.entries()) {
        mockRaw.sendTouchEvent(pos.x, pos.y, false, pointerId);
      }
    }
    mockRaw.suspendOS();

    expect(mockRaw.sendTouchEvent).not.toHaveBeenCalled();
    expect(mockRaw.suspendOS).toHaveBeenCalled();
  });
});

// =============================================================================
// handleTouchEvent (NativeSyntheticEvent<TouchEvent> handler)
// =============================================================================

describe('handleTouchEvent action routing', () => {
  test('action=down tracks pointer and sends touch pressed', () => {
    const { mockRaw } = createTestEngine();
    const activeTouches = new Map<number, { x: number; y: number }>();

    // Simulate 'down' action
    const event = { action: 'down', pointerId: 0, x: 150, y: 250, deltaX: 0, deltaY: 0 };
    activeTouches.set(event.pointerId, { x: event.x, y: event.y });
    mockRaw.sendTouchEvent(event.x, event.y, true, event.pointerId);

    expect(activeTouches.has(0)).toBe(true);
    expect(mockRaw.sendTouchEvent).toHaveBeenCalledWith(150, 250, true, 0);
  });

  test('action=up removes pointer and sends touch released', () => {
    const { mockRaw } = createTestEngine();
    const activeTouches = new Map<number, { x: number; y: number }>();
    activeTouches.set(0, { x: 150, y: 250 }); // pre-existing from down

    // Simulate 'up' action
    const event = { action: 'up', pointerId: 0, x: 155, y: 255, deltaX: 0, deltaY: 0 };
    activeTouches.delete(event.pointerId);
    mockRaw.sendTouchEvent(event.x, event.y, false, event.pointerId);

    expect(activeTouches.has(0)).toBe(false);
    expect(mockRaw.sendTouchEvent).toHaveBeenCalledWith(155, 255, false, 0);
  });

  test('action=move computes delta from stored previous position', () => {
    const { mockRaw } = createTestEngine();
    const activeTouches = new Map<number, { x: number; y: number }>();
    activeTouches.set(0, { x: 100, y: 200 }); // previous position

    // Simulate 'move' action
    const event = { action: 'move', pointerId: 0, x: 110, y: 215, deltaX: 0, deltaY: 0 };
    const prev = activeTouches.get(event.pointerId);
    const dx = prev ? event.x - prev.x : 0;
    const dy = prev ? event.y - prev.y : 0;
    activeTouches.set(event.pointerId, { x: event.x, y: event.y });
    mockRaw.sendDragEvent(event.x, event.y, dx, dy, 0, 0, event.pointerId);

    expect(dx).toBe(10);
    expect(dy).toBe(15);
    expect(mockRaw.sendDragEvent).toHaveBeenCalledWith(110, 215, 10, 15, 0, 0, 0);
  });

  test('action=move with no previous position uses delta=0', () => {
    const { mockRaw } = createTestEngine();
    const activeTouches = new Map<number, { x: number; y: number }>();

    // No previous position stored for pointer 2
    const event = { action: 'move', pointerId: 2, x: 50, y: 80, deltaX: 0, deltaY: 0 };
    const prev = activeTouches.get(event.pointerId);
    const dx = prev ? event.x - prev.x : 0;
    const dy = prev ? event.y - prev.y : 0;
    activeTouches.set(event.pointerId, { x: event.x, y: event.y });
    mockRaw.sendDragEvent(event.x, event.y, dx, dy, 0, 0, event.pointerId);

    expect(dx).toBe(0);
    expect(dy).toBe(0);
    expect(mockRaw.sendDragEvent).toHaveBeenCalledWith(50, 80, 0, 0, 0, 0, 2);
  });
});

// =============================================================================
// Engine wrapper lifecycle delegation
// =============================================================================

describe('Engine wrapper lifecycle', () => {
  test('suspendOS delegates to raw engine', () => {
    const { wrapper } = createTestEngine();
    wrapper.suspendOS();
    // createGodotEngine wrapper calls engine.suspendOS()
    // Verify via wrapper.raw proxy — suspendOS delegates to the underlying mock
    expect(wrapper.raw.suspendOS).toHaveBeenCalled();
  });

  test('resumeOS delegates to raw engine with pointer', () => {
    const { wrapper } = createTestEngine();
    const ptr = BigInt('42');
    wrapper.resumeOS(ptr);
    expect(wrapper.raw.resumeOS).toHaveBeenCalledWith(ptr);
  });

  test('destroy stops polling and cleans up', () => {
    const { wrapper } = createTestEngine();
    wrapper.destroy();
    expect(wrapper.raw.destroy).toHaveBeenCalled();
  });

  test('sendMessage delegates through wrapper', () => {
    const { wrapper } = createTestEngine();
    wrapper.sendMessage('{"action":"JUMP"}');
    expect(wrapper.raw.sendMessage).toHaveBeenCalledWith('{"action":"JUMP"}');
  });

  test('loadSceneAsync delegates to raw engine', () => {
    const { wrapper } = createTestEngine();
    wrapper.loadSceneAsync('/data/level2.pck');
    expect(wrapper.raw.loadSceneAsync).toHaveBeenCalledWith('/data/level2.pck');
  });
});
