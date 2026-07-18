/**
 * EnemyHealthBars.tsx — floating health bars (Epic 4)
 *
 * For each enemy in the game state, renders a health bar anchored to the
 * enemy's 3D world position projected to screen space via the synchronous
 * JSI `engine.unprojectPosition()` call.
 *
 * How it works:
 *   - Legend-State's useSelector re-renders each bar whenever STATE_SYNC
 *     changes that enemy, so the projection is recomputed per state update.
 *   - `unprojectPosition()` is a synchronous JSI call on the JS thread —
 *     no async bridge round-trip.
 *
 * NOTE: the projection intentionally runs during render on the JS thread,
 * NOT inside a Reanimated worklet. The engine wrapper is a plain JS closure
 * over a Nitro HybridObject and is not workletizable — capturing it in a
 * useAnimatedStyle worklet crashes on the UI runtime.
 *
 * Usage:
 *   <EnemyHealthBars engine={engine} />
 *   (render inside the GodotView container, absolutely positioned)
 */

import React from 'react';
import { StyleSheet, View, Text } from 'react-native';
import { useSelector } from '@legendapp/state/react';
import { state$ } from 'react-native-nitro-godot';
import type { GodotEngineWrapper } from 'react-native-nitro-godot';

// ── Types ─────────────────────────────────────────────────────────────────────

interface EnemyData {
  x: number;
  y: number;
  z: number;
  health: number;
}

interface EnemyBarProps {
  enemyId: string;
  engine: GodotEngineWrapper;
}

// ── Single Enemy Health Bar ────────────────────────────────────────────────────

function EnemyBar({ enemyId, engine }: EnemyBarProps) {
  // Read enemy position from Legend-State as a plain reactive selector.
  // useSelector re-runs this on every STATE_SYNC that changes this enemy.
  const enemy = useSelector<EnemyData | undefined>(() => {
    const enemies = (state$ as any).enemies?.get();
    return enemies?.[enemyId] as EnemyData | undefined;
  });

  if (!enemy) return null;

  // Project 3D world position to 2D screen coords (synchronous JSI call).
  const projected = engine.unprojectPosition(enemy.x, enemy.y + 1.2, enemy.z);
  if (!projected) return null;

  const healthPct = Math.max(0, Math.min(100, enemy.health));

  return (
    <View
      style={[
        styles.barContainer,
        {
          transform: [
            { translateX: projected[0] - 40 }, // center the 80px bar
            { translateY: projected[1] - 16 }, // sit just above the enemy
          ],
        },
      ]}
    >
      <View style={styles.barTrack}>
        <View style={[styles.barFill, { width: `${healthPct}%` }]} />
      </View>
      <Text style={styles.enemyLabel}>{enemyId.slice(0, 6)}</Text>
    </View>
  );
}

// ── Container — maps over all active enemies ───────────────────────────────────

export interface EnemyHealthBarsProps {
  engine: GodotEngineWrapper;
}

/**
 * EnemyHealthBars — renders a floating health bar for every live enemy.
 *
 * When an enemy dies and is removed from state$.enemies, its bar disappears
 * automatically — zero manual cleanup required.
 */
export function EnemyHealthBars({ engine }: EnemyHealthBarsProps) {
  // Get the list of enemy IDs reactively from Legend-State
  const enemyIds = useSelector<string[]>(() => {
    const enemies = (state$ as any).enemies?.get();
    return enemies ? Object.keys(enemies) : [];
  });

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {enemyIds.map((id) => (
        <EnemyBar key={id} enemyId={id} engine={engine} />
      ))}
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  barContainer: {
    position: 'absolute',
    width: 80,
    alignItems: 'center',
    gap: 2,
  },
  barTrack: {
    width: 80,
    height: 8,
    backgroundColor: 'rgba(0,0,0,0.7)',
    borderRadius: 4,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  barFill: {
    height: '100%',
    backgroundColor: '#ef4444',
    borderRadius: 4,
  },
  enemyLabel: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 9,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
});
