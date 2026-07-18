/**
 * App.test.tsx — integration tests for the NitroSwarm app shell.
 *
 * Renders the real <App /> (with expo/native modules mocked) and verifies the
 * app-level architecture guarantees:
 *   - the PCK extraction splash resolves into the game UI
 *   - ONE engine instance is shared by Play and Settings (CQRS wiring)
 *   - GodotView stays MOUNTED across tab switches (regression: unmounting it
 *     destroyed the native surface → permanently black view)
 *   - Settings controls reach the engine via dispatchGameIntent
 */

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { GodotView } from 'react-native-nitro-godot';
import App from '../App';
import { resetRAF } from '../../../src/__tests__/testUtils';

// ── Helpers ──────────────────────────────────────────────────────────────────

async function renderApp() {
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(<App />);
  });
  return renderer;
}

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

/** The raw engine mock created for this render (first HybridObject) */
function rawEngineMock() {
  const NitroModules = require('react-native-nitro-modules').NitroModules;
  expect(NitroModules.createHybridObject).toHaveBeenCalled();
  return NitroModules.createHybridObject.mock.results[0].value;
}

beforeEach(() => {
  resetRAF();
  jest.clearAllMocks();
});

describe('App', () => {
  test('extracts the PCK and renders the game shell with tab bar', async () => {
    const renderer = await renderApp();

    const texts = visibleTexts(renderer);
    expect(texts).toContain('Play');
    expect(texts).toContain('Stats');
    expect(texts).toContain('Settings');
    expect(renderer.root.findAllByType(GodotView)).toHaveLength(1);
  });

  test('engine is initialized once with the extracted pck path', async () => {
    await renderApp();

    const raw = rawEngineMock();
    expect(raw.initialize).toHaveBeenCalledTimes(1);
    expect(raw.initialize).toHaveBeenCalledWith(
      expect.stringContaining('game.pck')
    );
  });

  test('GodotView stays mounted when switching tabs (surface preservation)', async () => {
    const renderer = await renderApp();
    expect(renderer.root.findAllByType(GodotView)).toHaveLength(1);

    pressButton(renderer, 'Stats');
    // Stats content visible…
    expect(visibleTexts(renderer)).toContain('⚡ LIVE STATS');
    // …but the Godot surface must NOT have been unmounted.
    expect(renderer.root.findAllByType(GodotView)).toHaveLength(1);

    pressButton(renderer, 'Settings');
    expect(renderer.root.findAllByType(GodotView)).toHaveLength(1);

    pressButton(renderer, 'Play');
    expect(renderer.root.findAllByType(GodotView)).toHaveLength(1);

    // Engine was never destroyed/restarted by tab navigation
    const raw = rawEngineMock();
    expect(raw.destroy).not.toHaveBeenCalled();
    expect(raw.initialize).toHaveBeenCalledTimes(1);
  });

  test('Settings tab dispatches intents to the SAME engine as the game view', async () => {
    const renderer = await renderApp();

    pressButton(renderer, 'Settings');
    pressButton(renderer, '+'); // volume 80 → 85

    // Regression: SettingsScreen used to receive engine={null}, silently
    // dropping every intent. It must reach the single shared engine.
    const raw = rawEngineMock();
    const sent = raw.sendMessage.mock.calls.map((c: any[]) => JSON.parse(c[0]));
    expect(sent).toContainEqual({ action: 'SET_VOLUME', value: 0.85 });
  });

  test('hidden Play screen is non-interactive but still present', async () => {
    const renderer = await renderApp();

    pressButton(renderer, 'Stats');

    // The play screen root View is opacity-hidden with touches disabled
    const playRoot = renderer.root
      .findAll((n) => n.type === ('View' as any))
      .find((n) => n.props.pointerEvents === 'none' &&
        Array.isArray(n.props.style) &&
        n.props.style.some((s: any) => s && s.opacity === 0));
    expect(playRoot).toBeDefined();
  });
});
