/**
 * EnemyHealthBars.tsx — Reanimated floating health bars (Epic 4)
 *
 * For each enemy in the game state, renders a health bar anchored to the
 * enemy's 3D world position projected to screen space via the synchronous
 * JSI `engine.unprojectPosition()` call.
 *
 * This is the "Holy Grail" proof:
 *   - Legend-State reactive map iterates live enemy data (no RN bridge crossing)
 *   - `unprojectPosition()` is a zero-latency, UI-thread JSI call
 *   - Reanimated animates the transform without ever touching the React bridge
 *
 * Usage:
 *   <EnemyHealthBars engine={engine} />
 *   (render inside the GodotView container, absolutely positioned)
 */

import React from 'react';
import { StyleSheet, View, Text } from 'react-native';
// @ts-ignore — react-native-reanimated is a peer dependency; install in your app
import Animated, {
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';
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

/**
 * EnemyBar — one floating health bar for one enemy.
 *
 * Uses useAnimatedStyle + useSelector for fused Legion-State + Reanimated
 * reactivity. The unprojectPosition() call runs on the UI thread with zero
 * React bridge overhead.
 */
function EnemyBar({ enemyId, engine }: EnemyBarProps) {
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);

  // Read enemy position from Legend-State as a plain reactive selector.
  // useSelector re-runs this on every STATE_SYNC that changes this enemy.
  const enemy = useSelector<EnemyData | undefined>(() => {
    const enemies = (state$ as any).enemies?.get();
    return enemies?.[enemyId] as EnemyData | undefined;
  });

  // Project 3D world position to 2D screen coords.
  // unprojectPosition() is synchronous JSI — runs on UI thread, zero latency.
  const animatedStyle = useAnimatedStyle(() => {
    if (!enemy) return { opacity: 0, transform: [] };
    const projected = engine.unprojectPosition(enemy.x, enemy.y + 1.2, enemy.z);
    if (!projected) return { opacity: 0, transform: [] };
    return {
      opacity: 1,
      transform: [
        { translateX: projected[0] - 40 },  // center the 80px bar
        { translateY: projected[1] - 16 },  // sit just above the enemy
      ],
    };
  });

  if (!enemy) return null;

  const healthPct = Math.max(0, Math.min(100, enemy.health));

  return (
    <Animated.View style={[styles.barContainer, animatedStyle]}>
      <View style={styles.barTrack}>
        <View style={[styles.barFill, { width: `${healthPct}%` }]} />
      </View>
      <Text style={styles.enemyLabel}>{enemyId.slice(0, 6)}</Text>
    </Animated.View>
  );
}

// ── Container — maps over all active enemies ───────────────────────────────────

export interface EnemyHealthBarsProps {
  engine: GodotEngineWrapper;
}

/**
 * EnemyHealthBars — renders a floating health bar for every live enemy.
 *
 * Uses Legend-State's reactive selectore to get the enemy keys array.
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
