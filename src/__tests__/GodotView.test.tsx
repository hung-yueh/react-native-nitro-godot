/**
 * GodotView.test.tsx — Smoke tests for the GodotView component
 *
 * Since testEnvironment is 'node' (no DOM), we can't render React components.
 * These tests verify:
 *   - The module loads without errors
 *   - GodotView is an exported function
 *   - The component creates a React element with expected props
 *   - requireNativeComponent is called with the correct view name
 */

import React from 'react';
import { requireNativeComponent } from 'react-native';
import { GodotView } from '../GodotView';
import type { GodotViewProps } from '../GodotView';

// requireNativeComponent is called at module load time (import side effect).
// Capture this before any test's beforeEach clears mock state.
test('registers native component with correct name', () => {
  expect(requireNativeComponent).toHaveBeenCalledWith('GodotView');
});

describe('GodotView', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── Module exports ──────────────────────────────────────────────────────

  test('GodotView is exported as a function', () => {
    expect(typeof GodotView).toBe('function');
  });

  // ── React element creation ──────────────────────────────────────────────

  test('creates a valid React element', () => {
    const element = React.createElement(GodotView, {});
    expect(React.isValidElement(element)).toBe(true);
  });

  test('element type is GodotView', () => {
    const element = React.createElement(GodotView, {});
    expect(element.type).toBe(GodotView);
  });

  test('passes callback props through', () => {
    const onCreated = jest.fn();
    const onChanged = jest.fn();
    const onDestroyed = jest.fn();
    const onTouch = jest.fn();

    const props: GodotViewProps = {
      onSurfaceCreated: onCreated,
      onSurfaceChanged: onChanged,
      onSurfaceDestroyed: onDestroyed,
      onTouchEvent: onTouch,
    };

    const element = React.createElement(GodotView, props);
    expect(element.props.onSurfaceCreated).toBe(onCreated);
    expect(element.props.onSurfaceChanged).toBe(onChanged);
    expect(element.props.onSurfaceDestroyed).toBe(onDestroyed);
    expect(element.props.onTouchEvent).toBe(onTouch);
  });

  test('accepts custom style prop', () => {
    const customStyle = { backgroundColor: 'red' };
    const element = React.createElement(GodotView, { style: customStyle });
    expect(element.props.style).toEqual(customStyle);
  });

  // ── Type-level interface checks ─────────────────────────────────────────

  test('GodotViewProps allows optional callbacks', () => {
    // Should create without any callbacks (all optional)
    const element = React.createElement(GodotView, {});
    expect(element).toBeTruthy();
  });
});
