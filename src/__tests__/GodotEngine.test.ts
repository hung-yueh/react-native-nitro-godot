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

import { createGodotEngine } from '../GodotEngine';
import { createMockEngine } from './__mocks__/react-native-nitro-modules';

// Mock requestAnimationFrame / cancelAnimationFrame for Node.js
let rafCallbacks: Array<() => void> = [];
(globalThis as any).requestAnimationFrame = (cb: () => void) => {
  rafCallbacks.push(cb);
  return rafCallbacks.length;
};
(globalThis as any).cancelAnimationFrame = (_id: number) => {
  // no-op for tests
};

/** Flush all pending rAF callbacks (simulates one frame) */
function flushRAF() {
  const cbs = [...rafCallbacks];
  rafCallbacks = [];
  for (const cb of cbs) cb();
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Create an engine wrapper with a pre-configured mock */
function createTestEngine() {
  // Get the mock that NitroModules.createHybridObject will return
  const mockRaw = createMockEngine();

  // Monkey-patch NitroModules to return our mock
  const NitroModules = require('react-native-nitro-modules').NitroModules;
  NitroModules.createHybridObject.mockReturnValueOnce(mockRaw);

  const wrapper = createGodotEngine('/test/game.pck');
  return { wrapper, mockRaw };
}

describe('createGodotEngine', () => {
  beforeEach(() => {
    rafCallbacks = [];
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
});
