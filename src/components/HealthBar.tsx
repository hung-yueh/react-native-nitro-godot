/**
 * HealthBar.tsx — Zero-Render HUD Component Example (Epic 5)
 *
 * Demonstrates Legend-State v3's fine-grained reactivity for game HUD elements.
 *
 * KEY RULES:
 *   ✅ GOOD: Use <Memo> — bypasses React diffing entirely.
 *            The component function runs exactly ONCE, ever.
 *   ❌ BAD:  Never call state$.get() in the component body — this triggers
 *            standard React render cascades on every state change.
 *
 * This component can receive 60Hz state updates from Godot while the
 * React Profiler registers ZERO component re-renders.
 *
 * @requires @legendapp/state (v3+) and @legendapp/state/react
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Memo } from '@legendapp/state/react';
import { state$ } from '../godotState';

/**
 * Zero-render health bar — updates natively without React re-renders.
 *
 * The component body executes exactly once. All reactive updates flow
 * directly to the native text views via Legend-State's fine-grained
 * observable bindings.
 */
export const HealthBar = () => {
  // ✅ This function runs exactly once — no re-renders on state changes.
  return (
    <View style={styles.container}>
      {/* Direct observable binding — re-renders only this <Memo> subtree */}
      <Text style={styles.label}>
        Health: <Memo>{state$.player.health}</Memo>
      </Text>

      {/* Computed observable — derives display text reactively */}
      <Text style={styles.ammo}>
        Ammo: <Memo>{() => String(state$.player.ammo.get())}</Memo>
      </Text>

      {/* Computed with transform */}
      <Text style={styles.weapon}>
        Weapon: <Memo>{() => state$.player.weapon.get().toUpperCase()}</Memo>
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 60,
    left: 20,
    padding: 12,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    borderRadius: 8,
  },
  label: {
    color: '#00ff88',
    fontSize: 16,
    fontWeight: 'bold',
  },
  ammo: {
    color: '#ffaa00',
    fontSize: 14,
    marginTop: 4,
  },
  weapon: {
    color: '#ffffff',
    fontSize: 14,
    marginTop: 4,
  },
});
