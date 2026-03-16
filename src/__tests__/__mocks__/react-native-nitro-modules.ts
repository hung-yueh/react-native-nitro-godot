// Mock react-native-nitro-modules for Jest
// Provides a fake NitroModules.createHybridObject that returns a mock engine

export const NitroModules = {
  createHybridObject: jest.fn(() => createMockEngine()),
};

/** Creates a mock GodotEngine HybridObject for testing */
export function createMockEngine() {
  const messageQueue: string[] = [];
  let onWakeUp: (() => void) | null = null;

  return {
    // Lifecycle
    initialize: jest.fn(),
    destroy: jest.fn(),
    start: jest.fn(),

    // Message pipeline
    pollMessage: jest.fn(() => {
      return messageQueue.shift() ?? '';
    }),
    sendMessage: jest.fn(),
    setOnWakeUp: jest.fn((cb: () => void) => {
      onWakeUp = cb;
    }),
    notifyPollingStopped: jest.fn(),

    // Surface
    attachSurface: jest.fn(),

    // Lifecycle
    suspendOS: jest.fn(),
    resumeOS: jest.fn(),

    // Async loading
    loadSceneAsync: jest.fn(),

    // Camera projection
    unprojectPosition: jest.fn(() => [0, 0]),

    // ── Test helpers (not part of real API) ──
    /** Enqueue a message as if Godot sent it */
    _enqueueTestMessage(msg: string) {
      messageQueue.push(msg);
      if (onWakeUp) onWakeUp();
    },
    _messageQueue: messageQueue,
  };
}
