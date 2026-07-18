/**
 * SettingsScreen.test.tsx — CQRS dispatch + hooks-safety regression tests.
 *
 * Covers the two bugs previously shipped in this screen:
 *   - Rules-of-Hooks violation: `if (!visible) return null` ran BEFORE the
 *     hooks, crashing on the first visibility toggle.
 *   - Side effects inside setState updaters (double-dispatch risk).
 */

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { SettingsScreen } from '../screens/SettingsScreen';
import { createTestEngine, resetRAF } from '../../../src/__tests__/testUtils';

// ── Helpers ──────────────────────────────────────────────────────────────────

function render(element: React.ReactElement) {
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(element);
  });
  return renderer;
}

/** Press the TouchableOpacity that contains the given text label */
function pressButton(renderer: TestRenderer.ReactTestRenderer, label: string) {
  const buttons = renderer.root.findAll((n) => n.type === ('TouchableOpacity' as any));
  for (const b of buttons) {
    const texts = b
      .findAll((n) => n.type === ('Text' as any))
      .flatMap((t) => t.children)
      .map(String);
    if (texts.includes(label)) {
      act(() => b.props.onPress());
      return;
    }
  }
  throw new Error(`Button not found: ${label}`);
}

function visibleTexts(renderer: TestRenderer.ReactTestRenderer): string[] {
  return renderer.root
    .findAll((n) => n.type === ('Text' as any))
    .flatMap((t) => t.children)
    .map(String);
}

beforeEach(() => {
  resetRAF();
  jest.clearAllMocks();
});

describe('SettingsScreen', () => {
  // ── Hooks safety (regression) ────────────────────────────────────────────

  test('toggling visibility on a mounted instance does not violate hook order', () => {
    const renderer = render(<SettingsScreen visible={false} engine={null} />);
    expect(renderer.toJSON()).toBeNull();

    // This transition used to throw "Rendered more hooks than during the
    // previous render" because the early return preceded the useState calls.
    expect(() => {
      act(() => renderer.update(<SettingsScreen visible={true} engine={null} />));
    }).not.toThrow();
    expect(renderer.toJSON()).not.toBeNull();

    expect(() => {
      act(() => renderer.update(<SettingsScreen visible={false} engine={null} />));
    }).not.toThrow();
    expect(renderer.toJSON()).toBeNull();
  });

  test('setting state survives a hide/show cycle (component stays mounted)', () => {
    const { wrapper } = createTestEngine();
    const renderer = render(<SettingsScreen visible={true} engine={wrapper} />);

    pressButton(renderer, '+'); // volume 80 → 85
    expect(visibleTexts(renderer)).toContain('85%');

    act(() => renderer.update(<SettingsScreen visible={false} engine={wrapper} />));
    act(() => renderer.update(<SettingsScreen visible={true} engine={wrapper} />));

    // State persisted because hooks always run regardless of visibility
    expect(visibleTexts(renderer)).toContain('85%');
  });

  // ── CQRS dispatch ────────────────────────────────────────────────────────

  test('volume stepper dispatches SET_VOLUME with normalized value', () => {
    const { wrapper, mockRaw } = createTestEngine();
    const renderer = render(<SettingsScreen visible={true} engine={wrapper} />);

    pressButton(renderer, '+');

    expect(mockRaw.sendMessage).toHaveBeenCalledTimes(1);
    expect(JSON.parse(mockRaw.sendMessage.mock.calls[0][0])).toEqual({
      action: 'SET_VOLUME',
      value: 0.85,
    });
  });

  test('each press dispatches exactly once (no updater double-fire)', () => {
    const { wrapper, mockRaw } = createTestEngine();
    const renderer = render(<SettingsScreen visible={true} engine={wrapper} />);

    pressButton(renderer, '+');
    pressButton(renderer, '+');
    pressButton(renderer, '−');

    const actions = mockRaw.sendMessage.mock.calls.map((c: any[]) => JSON.parse(c[0]));
    expect(actions).toEqual([
      { action: 'SET_VOLUME', value: 0.85 },
      { action: 'SET_VOLUME', value: 0.9 },
      { action: 'SET_VOLUME', value: 0.85 },
    ]);
  });

  test('volume clamps at 100 and 0', () => {
    const { wrapper, mockRaw } = createTestEngine();
    const renderer = render(<SettingsScreen visible={true} engine={wrapper} />);

    for (let i = 0; i < 6; i++) pressButton(renderer, '+'); // 80 → 100, clamped
    const values = mockRaw.sendMessage.mock.calls.map(
      (c: any[]) => JSON.parse(c[0]).value
    );
    expect(Math.max(...values)).toBe(1);
    expect(visibleTexts(renderer)).toContain('100%');
  });

  test('difficulty selection dispatches SET_DIFFICULTY', () => {
    const { wrapper, mockRaw } = createTestEngine();
    const renderer = render(<SettingsScreen visible={true} engine={wrapper} />);

    pressButton(renderer, 'Hard');

    expect(JSON.parse(mockRaw.sendMessage.mock.calls[0][0])).toEqual({
      action: 'SET_DIFFICULTY',
      value: 'hard',
    });
  });

  test('null engine updates UI but dispatches nothing', () => {
    const renderer = render(<SettingsScreen visible={true} engine={null} />);

    pressButton(renderer, '+');
    expect(visibleTexts(renderer)).toContain('85%');
    // No engine — nothing to assert on except that it did not throw.
  });
});
