/**
 * GameHUD.tsx — Zero-Render HUD Component (Epic 5)
 *
 * Demonstrates Legend-State v3's fine-grained reactivity for game HUD elements.
 * All reactive updates flow directly to native text views via <Memo> —
 * the React Profiler should register ZERO component re-renders while
 * receiving 60Hz state updates from Godot.
 *
 * KEY RULES:
 *   ✅ GOOD: Use <Memo> — bypasses React diffing entirely
 *   ❌ BAD:  Never call state$.get() in the component body
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Memo } from '@legendapp/state/react';
import { state$ } from 'react-native-nitro-godot';
import { HealthFill } from './HealthFill';
import { TOP_INSET } from './insets';

// ─── Main HUD ───────────────────────────────────────────────────────────────

export const GameHUD = () => {
  // Sit below the top safe area (and below NitroSwarmHUD's score bar).
  return (
    <View style={[styles.container, { top: TOP_INSET + 40 }]} pointerEvents="none">
      {/* Health Bar */}
      <View style={styles.statRow}>
        <Text style={styles.statIcon}>❤️</Text>
        <View style={styles.healthBarBg}>
          <HealthFill />
        </View>
        <Text style={styles.healthText}>
          <Memo>{() => String(state$.player.health.get())}</Memo>
        </Text>
      </View>

      {/* Weapon */}
      <View style={styles.statRow}>
        <Text style={styles.statIcon}>⚔️</Text>
        <Text style={styles.statValue}>
          <Memo>{() => state$.player.weapon.get().toUpperCase()}</Memo>
        </Text>
      </View>

      {/* Ammo */}
      <View style={styles.statRow}>
        <Text style={styles.statIcon}>🎯</Text>
        <Text style={styles.statValue}>
          <Memo>{() => `${state$.player.ammo.get()}`}</Memo>
        </Text>
      </View>

      {/* Floor */}
      <View style={styles.floorBadge}>
        <Text style={styles.floorText}>
          Floor <Memo>{state$.loading.currentScene}</Memo>
        </Text>
      </View>
    </View>
  );
};

// ─── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 60,
    left: 12,
    right: 12,
    gap: 6,
  },
  statRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    gap: 8,
    alignSelf: 'flex-start',
  },
  statIcon: {
    fontSize: 14,
  },
  statValue: {
    color: '#e0e7ff',
    fontSize: 13,
    fontWeight: '600',
  },
  healthBarBg: {
    width: 100,
    height: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    borderRadius: 4,
    overflow: 'hidden',
  },
  healthText: {
    color: '#e0e7ff',
    fontSize: 12,
    fontWeight: '700',
    width: 30,
    textAlign: 'right',
  },
  floorBadge: {
    position: 'absolute',
    top: 0,
    right: 0,
    backgroundColor: 'rgba(99, 102, 241, 0.7)',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  floorText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
});
