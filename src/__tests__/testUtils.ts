/**
 * testUtils.ts — shared test harness for the engine wrapper suites.
 *
 * Importing this module installs a synchronous requestAnimationFrame /
 * cancelAnimationFrame polyfill for Node.js. Call resetRAF() in beforeEach
 * and flushRAF() to simulate a frame.
 *
 * Single source of truth — do not copy the polyfill or createTestEngine
 * into individual test files.
 */

import { createGodotEngine, __resetSharedGodotEngineForTests } from '../GodotEngine';
import { createMockEngine } from './__mocks__/react-native-nitro-modules';

let rafCallbacks: Array<() => void> = [];

(globalThis as any).requestAnimationFrame = (cb: () => void) => {
  rafCallbacks.push(cb);
  return rafCallbacks.length;
};
(globalThis as any).cancelAnimationFrame = (_id: number) => {
  // no-op for tests
};

/** Clear any pending rAF callbacks (call from beforeEach) */
export function resetRAF() {
  rafCallbacks = [];
}

/** Flush all pending rAF callbacks (simulates one frame) */
export function flushRAF() {
  const cbs = [...rafCallbacks];
  rafCallbacks = [];
  for (const cb of cbs) cb();
}

/** Create an engine wrapper bound to a fresh mock HybridObject */
export function createTestEngine(pckPath = '/test/game.pck') {
  __resetSharedGodotEngineForTests();
  const mockRaw = createMockEngine();

  // Monkey-patch NitroModules to return our mock
  const NitroModules = require('react-native-nitro-modules').NitroModules;
  NitroModules.createHybridObject.mockReturnValueOnce(mockRaw);

  const wrapper = createGodotEngine(pckPath);
  return { wrapper, mockRaw };
}
