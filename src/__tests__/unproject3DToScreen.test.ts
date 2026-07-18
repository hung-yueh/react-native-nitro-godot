/**
 * unproject3DToScreen.test.ts — Tests for 3D→2D screen projection helper
 *
 * Verifies that unproject3DToScreen correctly:
 *   - Calls the engine wrapper's unprojectPosition()
 *   - Divides the result by PixelRatio.get() to convert hardware px → dp
 *   - Returns undefined when the engine returns undefined
 *
 * The function is the bridge between Godot's camera projection and
 * Reanimated's worklet-driven floating health bars.
 */

import { unproject3DToScreen } from '../components/NitroSwarmHUD';
import { createTestEngine, resetRAF } from './testUtils';
import { PixelRatio } from 'react-native';

// ── Mock peer dependencies that NitroSwarmHUD imports but we don't test ──────

jest.mock('react-native-gesture-handler', () => ({
  GestureDetector: 'GestureDetector',
  Gesture: { Pan: () => ({ onStart: () => ({ onUpdate: () => ({ onEnd: () => ({}) }) }) }) },
}));

jest.mock('@legendapp/state/react', () => ({
  Memo: 'Memo',
}));

jest.mock('../godotState', () => ({
  state$: {
    player: { health: { get: () => 100 }, ammo: { get: () => 0 } },
    game: { score: { get: () => 0 }, combo: { get: () => 0 }, waveNumber: { get: () => 1 }, enemyCount: { get: () => 0 } },
  },
}));

// ── Tests ───────────────────────────────────────────────────────────────────

describe('unproject3DToScreen', () => {
  beforeEach(() => {
    resetRAF();
    jest.clearAllMocks();
    // Default PixelRatio to 2
    (PixelRatio.get as jest.Mock).mockReturnValue(2);
  });

  // ── Basic projection ────────────────────────────────────────────────────

  test('returns hardware pixels divided by PixelRatio', () => {
    const { wrapper, mockRaw } = createTestEngine();
    // Simulate Godot returning hardware pixel coords [400, 800]
    mockRaw.unprojectPosition.mockReturnValue([400, 800]);

    const result = unproject3DToScreen(wrapper, 1, 2, 3);

    // PixelRatio is 2 → dp = px / 2
    expect(result).toEqual([200, 400]);
  });

  test('passes world coordinates through to engine', () => {
    const { wrapper, mockRaw } = createTestEngine();
    mockRaw.unprojectPosition.mockReturnValue([100, 200]);

    unproject3DToScreen(wrapper, 5.5, -3.2, 10.0);

    // The wrapper calls raw.unprojectPosition with the same coords
    expect(mockRaw.unprojectPosition).toHaveBeenCalledWith(5.5, -3.2, 10.0);
  });

  // ── Undefined / null-ish results ────────────────────────────────────────

  test('returns undefined when engine returns undefined', () => {
    const { wrapper, mockRaw } = createTestEngine();
    // Wrapper's unprojectPosition returns undefined when raw returns undefined
    mockRaw.unprojectPosition.mockReturnValue(undefined as any);

    const result = unproject3DToScreen(wrapper, 1, 2, 3);
    expect(result).toBeUndefined();
  });

  test('returns undefined when engine returns null', () => {
    const { wrapper, mockRaw } = createTestEngine();
    mockRaw.unprojectPosition.mockReturnValue(null as any);

    const result = unproject3DToScreen(wrapper, 1, 2, 3);
    expect(result).toBeUndefined();
  });

  test('returns undefined when engine returns empty array', () => {
    const { wrapper, mockRaw } = createTestEngine();
    // The wrapper checks `result.length < 2` → returns undefined
    mockRaw.unprojectPosition.mockReturnValue([]);

    const result = unproject3DToScreen(wrapper, 1, 2, 3);
    expect(result).toBeUndefined();
  });

  test('returns undefined when engine returns single-element array', () => {
    const { wrapper, mockRaw } = createTestEngine();
    mockRaw.unprojectPosition.mockReturnValue([100]);

    const result = unproject3DToScreen(wrapper, 1, 2, 3);
    expect(result).toBeUndefined();
  });

  // ── Different PixelRatio values ─────────────────────────────────────────

  test('PixelRatio = 1 returns raw pixel values', () => {
    (PixelRatio.get as jest.Mock).mockReturnValue(1);
    const { wrapper, mockRaw } = createTestEngine();
    mockRaw.unprojectPosition.mockReturnValue([300, 600]);

    const result = unproject3DToScreen(wrapper, 0, 0, 0);
    expect(result).toEqual([300, 600]);
  });

  test('PixelRatio = 3 divides by 3', () => {
    (PixelRatio.get as jest.Mock).mockReturnValue(3);
    const { wrapper, mockRaw } = createTestEngine();
    mockRaw.unprojectPosition.mockReturnValue([900, 1800]);

    const result = unproject3DToScreen(wrapper, 0, 0, 0);
    expect(result).toEqual([300, 600]);
  });

  test('PixelRatio = 2.625 (Pixel density) produces fractional dp', () => {
    (PixelRatio.get as jest.Mock).mockReturnValue(2.625);
    const { wrapper, mockRaw } = createTestEngine();
    mockRaw.unprojectPosition.mockReturnValue([525, 1050]);

    const result = unproject3DToScreen(wrapper, 0, 0, 0);
    expect(result![0]).toBeCloseTo(200);
    expect(result![1]).toBeCloseTo(400);
  });

  // ── Edge-case coordinates ───────────────────────────────────────────────

  test('origin coordinates (0, 0, 0)', () => {
    const { wrapper, mockRaw } = createTestEngine();
    mockRaw.unprojectPosition.mockReturnValue([0, 0]);

    const result = unproject3DToScreen(wrapper, 0, 0, 0);
    expect(result).toEqual([0, 0]);
  });

  test('large coordinates', () => {
    const { wrapper, mockRaw } = createTestEngine();
    mockRaw.unprojectPosition.mockReturnValue([10000, 20000]);

    const result = unproject3DToScreen(wrapper, 99999, 99999, 99999);
    expect(result).toEqual([5000, 10000]);
  });

  test('negative pixel results (off-screen projection)', () => {
    const { wrapper, mockRaw } = createTestEngine();
    mockRaw.unprojectPosition.mockReturnValue([-200, -400]);

    const result = unproject3DToScreen(wrapper, -10, 5, 20);
    expect(result).toEqual([-100, -200]);
  });
});
