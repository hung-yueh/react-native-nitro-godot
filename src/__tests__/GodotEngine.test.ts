/**
 * GodotEngine.test.ts — Tests for engine wrapper message handling
 *
 * Tests the createGodotEngine wrapper's message dispatch system:
 *   - onMessage handler registration / unsubscription
 *   - Multiple handlers receiving the same message
 *   - Handler errors being caught (not crashing the drain)
 *   - Empty poll stopping the drain loop
 *
 * These tests mock requestAnimationFrame to run synchronously.
 */

import { createTestEngine, flushRAF, resetRAF } from './testUtils';

describe('createGodotEngine', () => {
  beforeEach(() => {
    resetRAF();
    jest.clearAllMocks();
  });

  test('initializes engine with pck path', () => {
    const { mockRaw } = createTestEngine();
    expect(mockRaw.initialize).toHaveBeenCalledWith('/test/game.pck');
  });

  test('registers wake-up callback', () => {
    const { mockRaw } = createTestEngine();
    expect(mockRaw.setOnWakeUp).toHaveBeenCalledWith(expect.any(Function));
  });

  // ── Message Handlers ──────────────────────────────────────────────────

  test('onMessage handler receives polled messages', () => {
    const { wrapper, mockRaw } = createTestEngine();
    const received: string[] = [];

    wrapper.onMessage((msg) => received.push(msg));

    // Simulate Godot sending a message
    mockRaw._enqueueTestMessage('{"type":"STATE_SYNC","data":{"player":{"health":80}}}');
    flushRAF();

    expect(received).toHaveLength(1);
    expect(received[0]).toContain('STATE_SYNC');
  });

  test('multiple handlers all receive the same message', () => {
    const { wrapper, mockRaw } = createTestEngine();
    const handler1: string[] = [];
    const handler2: string[] = [];

    wrapper.onMessage((msg) => handler1.push(msg));
    wrapper.onMessage((msg) => handler2.push(msg));

    mockRaw._enqueueTestMessage('{"type":"TEST"}');
    flushRAF();

    expect(handler1).toEqual(['{"type":"TEST"}']);
    expect(handler2).toEqual(['{"type":"TEST"}']);
  });

  test('unsubscribe removes handler', () => {
    const { wrapper, mockRaw } = createTestEngine();
    const received: string[] = [];

    const unsub = wrapper.onMessage((msg) => received.push(msg));

    // First message should be received
    mockRaw._enqueueTestMessage('msg1');
    flushRAF();
    expect(received).toEqual(['msg1']);

    // Unsubscribe and send another
    unsub();
    mockRaw._enqueueTestMessage('msg2');
    flushRAF();

    // Should NOT receive msg2
    expect(received).toEqual(['msg1']);
  });

  test('handler errors are caught and logged', () => {
    const { wrapper, mockRaw } = createTestEngine();
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
    const goodHandler: string[] = [];

    // Register a broken handler first, then a good one
    wrapper.onMessage(() => {
      throw new Error('broken handler');
    });
    wrapper.onMessage((msg) => goodHandler.push(msg));

    mockRaw._enqueueTestMessage('test');
    flushRAF();

    // Good handler should still receive the message
    expect(goodHandler).toEqual(['test']);
    // Error should be logged
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Message handler error'),
      expect.any(Error)
    );

    consoleSpy.mockRestore();
  });

  test('multiple messages drained in single frame', () => {
    const { wrapper, mockRaw } = createTestEngine();
    const received: string[] = [];

    wrapper.onMessage((msg) => received.push(msg));

    // Queue multiple messages before flushing
    mockRaw._enqueueTestMessage('msg1');
    mockRaw._enqueueTestMessage('msg2');
    mockRaw._enqueueTestMessage('msg3');
    flushRAF();

    expect(received).toEqual(['msg1', 'msg2', 'msg3']);
  });

  // ── Lifecycle ─────────────────────────────────────────────────────────

  test('sendMessage delegates to raw engine', () => {
    const { wrapper, mockRaw } = createTestEngine();
    wrapper.sendMessage('hello');
    expect(mockRaw.sendMessage).toHaveBeenCalledWith('hello');
  });

  test('destroy stops drain loop and clears handlers', () => {
    const { wrapper, mockRaw } = createTestEngine();
    const received: string[] = [];

    wrapper.onMessage((msg) => received.push(msg));
    wrapper.destroy();

    // Messages after destroy should not be received
    mockRaw._enqueueTestMessage('after-destroy');
    flushRAF();

    expect(received).toEqual([]);
    expect(mockRaw.destroy).toHaveBeenCalled();
  });

  // ── Polling ───────────────────────────────────────────────────────────

  describe('startPolling / stopPolling', () => {
    test('startPolling keeps the drain loop alive across frames', () => {
      const { wrapper, mockRaw } = createTestEngine();
      const received: string[] = [];
      wrapper.onMessage((msg) => received.push(msg));

      wrapper.startPolling();

      // Frame 1: empty queue — loop should continue because polling is true
      flushRAF();

      // Enqueue between frames
      mockRaw._enqueueTestMessage('delayed');

      // Frame 2: should pick up the message
      flushRAF();
      expect(received).toEqual(['delayed']);
    });

    test('stopPolling stops the drain loop and notifies C++', () => {
      const { wrapper, mockRaw } = createTestEngine();
      wrapper.startPolling();
      flushRAF(); // start the loop

      wrapper.stopPolling();
      expect(mockRaw.notifyPollingStopped).toHaveBeenCalled();
    });

    test('stopPolling then startPolling restarts the loop', () => {
      const { wrapper, mockRaw } = createTestEngine();
      const received: string[] = [];
      wrapper.onMessage((msg) => received.push(msg));

      wrapper.startPolling();
      flushRAF();
      wrapper.stopPolling();

      // Restart
      wrapper.startPolling();
      mockRaw._enqueueTestMessage('after-restart');
      flushRAF();

      expect(received).toEqual(['after-restart']);
    });
  });

  // ── unprojectPosition ─────────────────────────────────────────────────

  describe('unprojectPosition', () => {
    test('returns [x, y] tuple for valid result', () => {
      const { wrapper, mockRaw } = createTestEngine();
      mockRaw.unprojectPosition.mockReturnValue([100, 200]);

      const result = wrapper.unprojectPosition(1.0, 2.0, 3.0);
      expect(result).toEqual([100, 200]);
      expect(mockRaw.unprojectPosition).toHaveBeenCalledWith(1.0, 2.0, 3.0);
    });

    test('returns undefined when raw returns undefined', () => {
      const { wrapper, mockRaw } = createTestEngine();
      mockRaw.unprojectPosition.mockReturnValue(undefined as any);

      expect(wrapper.unprojectPosition(1, 2, 3)).toBeUndefined();
    });

    test('returns undefined when raw returns empty array', () => {
      const { wrapper, mockRaw } = createTestEngine();
      mockRaw.unprojectPosition.mockReturnValue([]);

      expect(wrapper.unprojectPosition(1, 2, 3)).toBeUndefined();
    });

    test('returns undefined when raw returns single-element array', () => {
      const { wrapper, mockRaw } = createTestEngine();
      mockRaw.unprojectPosition.mockReturnValue([100]);

      expect(wrapper.unprojectPosition(1, 2, 3)).toBeUndefined();
    });
  });

  // ── OS Lifecycle ──────────────────────────────────────────────────────

  describe('suspendOS / resumeOS', () => {
    test('suspendOS delegates to raw engine', () => {
      const { wrapper, mockRaw } = createTestEngine();
      wrapper.suspendOS();
      expect(mockRaw.suspendOS).toHaveBeenCalled();
    });

    test('resumeOS delegates to raw engine with surface pointer', () => {
      const { wrapper, mockRaw } = createTestEngine();
      const ptr = BigInt('0x12345678');
      wrapper.resumeOS(ptr);
      expect(mockRaw.resumeOS).toHaveBeenCalledWith(ptr);
    });
  });

  // ── Scene Loading ─────────────────────────────────────────────────────

  describe('loadSceneAsync', () => {
    test('delegates to raw engine', () => {
      const { wrapper, mockRaw } = createTestEngine();
      wrapper.loadSceneAsync('res://levels/level_2.pck');
      expect(mockRaw.loadSceneAsync).toHaveBeenCalledWith(
        'res://levels/level_2.pck'
      );
    });
  });
});

