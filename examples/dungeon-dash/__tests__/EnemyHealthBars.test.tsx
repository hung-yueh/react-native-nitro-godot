/**
 * EnemyHealthBars.test.tsx — floating health bars driven by real Legend-State.
 *
 * Uses the REAL state$ observable + ingestStateSync (no mocked selector), so
 * these tests exercise the actual reactive path Godot drives at runtime:
 *   STATE_SYNC → ingestStateSync → useSelector → projected bar positions.
 *
 * Also a regression guard: the projection must run as a plain render-time
 * JSI call — the previous Reanimated-worklet version crashed on the UI
 * runtime (the engine wrapper is not workletizable).
 */

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { ingestStateSync } from 'react-native-nitro-godot';
import { EnemyHealthBars } from '../components/EnemyHealthBars';
import { createTestEngine, resetRAF } from '../../../src/__tests__/testUtils';

function render(element: React.ReactElement) {
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(element);
  });
  return renderer;
}

function barLabels(renderer: TestRenderer.ReactTestRenderer): string[] {
  return renderer.root
    .findAll((n) => n.type === ('Text' as any))
    .flatMap((t) => t.children)
    .map(String);
}

beforeEach(() => {
  resetRAF();
  jest.clearAllMocks();
  // Reset shared observable between tests
  act(() => {
    ingestStateSync({ enemies: {} });
  });
});

describe('EnemyHealthBars', () => {
  test('renders no bars when there are no enemies', () => {
    const { wrapper } = createTestEngine();
    const renderer = render(<EnemyHealthBars engine={wrapper} />);
    expect(barLabels(renderer)).toEqual([]);
  });

  test('renders one bar per enemy from a STATE_SYNC ingest', () => {
    const { wrapper, mockRaw } = createTestEngine();
    mockRaw.unprojectPosition.mockReturnValue([120, 250]);
    const renderer = render(<EnemyHealthBars engine={wrapper} />);

    act(() => {
      ingestStateSync({
        enemies: {
          Enemy1: { x: 1, y: 0, z: 2, health: 75 },
          Enemy2: { x: -3, y: 0, z: 4, health: 40 },
        },
      });
    });

    expect(barLabels(renderer)).toEqual(['Enemy1', 'Enemy2']);
  });

  test('projects at the enemy head (y + 1.2) and offsets to center the bar', () => {
    const { wrapper, mockRaw } = createTestEngine();
    mockRaw.unprojectPosition.mockReturnValue([120, 250]);
    const renderer = render(<EnemyHealthBars engine={wrapper} />);

    act(() => {
      ingestStateSync({ enemies: { Enemy1: { x: 1, y: 0.5, z: 2, health: 75 } } });
    });

    expect(mockRaw.unprojectPosition).toHaveBeenCalledWith(1, 1.7, 2);

    // Bar container carries the projected transform (centered: -40 / -16)
    const bar = renderer.root
      .findAll((n) => n.type === ('View' as any))
      .find((n) => {
        const style = Array.isArray(n.props.style) ? n.props.style : [n.props.style];
        return style.some((s: any) => s && s.transform);
      })!;
    const transformStyle = (Array.isArray(bar.props.style) ? bar.props.style : [bar.props.style])
      .find((s: any) => s && s.transform);
    expect(transformStyle.transform).toEqual([
      { translateX: 80 },  // 120 - 40
      { translateY: 234 }, // 250 - 16
    ]);
  });

  test('hides the bar when projection is unavailable (behind camera)', () => {
    const { wrapper, mockRaw } = createTestEngine();
    mockRaw.unprojectPosition.mockReturnValue(undefined as any);
    const renderer = render(<EnemyHealthBars engine={wrapper} />);

    act(() => {
      ingestStateSync({ enemies: { Enemy1: { x: 1, y: 0, z: 2, health: 75 } } });
    });

    expect(barLabels(renderer)).toEqual([]);
  });

  test('removes the bar when the enemy dies (removed from state)', () => {
    const { wrapper, mockRaw } = createTestEngine();
    mockRaw.unprojectPosition.mockReturnValue([10, 20]);
    const renderer = render(<EnemyHealthBars engine={wrapper} />);

    act(() => {
      ingestStateSync({
        enemies: {
          Enemy1: { x: 0, y: 0, z: 0, health: 50 },
          Enemy2: { x: 1, y: 0, z: 1, health: 90 },
        },
      });
    });
    expect(barLabels(renderer)).toEqual(['Enemy1', 'Enemy2']);

    act(() => {
      ingestStateSync({ enemies: { Enemy2: { x: 1, y: 0, z: 1, health: 90 } } });
    });
    expect(barLabels(renderer)).toEqual(['Enemy2']);
  });

  test('long enemy ids are truncated to 6 characters', () => {
    const { wrapper, mockRaw } = createTestEngine();
    mockRaw.unprojectPosition.mockReturnValue([10, 20]);
    const renderer = render(<EnemyHealthBars engine={wrapper} />);

    act(() => {
      ingestStateSync({
        enemies: { EnemySkeleton42: { x: 0, y: 0, z: 0, health: 100 } },
      });
    });

    expect(barLabels(renderer)).toEqual(['EnemyS']);
  });
});
