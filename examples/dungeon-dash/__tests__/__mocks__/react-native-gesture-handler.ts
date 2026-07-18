// Mock react-native-gesture-handler for Jest.
// Gesture builders are chainable — every method returns the same object.

export const GestureHandlerRootView = 'GestureHandlerRootView';
export const GestureDetector = 'GestureDetector';

function chainable(): any {
  const target: Record<string, unknown> = {};
  return new Proxy(target, {
    get(_t, prop) {
      // React internals probe these during element creation
      if (prop === '$$typeof' || prop === 'prototype') return undefined;
      return (..._args: unknown[]) => chainable();
    },
  });
}

export const Gesture = {
  Pan: () => chainable(),
  Tap: () => chainable(),
  Simultaneous: (...gestures: unknown[]) => gestures,
};
