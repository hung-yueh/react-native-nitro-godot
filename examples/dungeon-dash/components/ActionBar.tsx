/**
 * ActionBar.tsx — CQRS Intent Dispatch (Epic 5)
 *
 * Demonstrates the Command Dispatch pattern:
 *   JS → dispatchGameIntent(engine, { action }) → C++ SPSC → GDScript
 *
 * CRUCIAL RULE: These buttons must NOT mutate state$ directly.
 * React Native is a "Dumb Client" — it sends intents and waits for Godot
 * (the authoritative server) to respond with STATE_SYNC events.
 *
 * Also includes a zero-copy ArrayBuffer test button for Epic 0 (buffer pipeline).
 */

import React, { useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { NitroModules } from 'react-native-nitro-modules';
import { dispatchGameIntent } from 'react-native-nitro-godot';
import type { GodotEngineWrapper } from 'react-native-nitro-godot';

interface ActionBarProps {
  engine: GodotEngineWrapper;
}

export function ActionBar({ engine }: ActionBarProps) {
  const handleAttack = useCallback(() => {
    dispatchGameIntent(engine, { action: 'ATTACK' });
  }, [engine]);

  const handleUsePotion = useCallback(() => {
    dispatchGameIntent(engine, { action: 'USE_POTION' });
  }, [engine]);

  const handleEquip = useCallback(() => {
    dispatchGameIntent(engine, { action: 'EQUIP' });
  }, [engine]);

  const handleTestBuffer = useCallback(() => {
    // Zero-copy ArrayBuffer pipeline test
    // Creates a 1MB native-owned buffer, writes test data, pushes to engine
    try {
      const sizeBytes = 1024 * 1024; // 1MB
      const buffer = NitroModules.createNativeArrayBuffer(sizeBytes);
      const view = new Float32Array(buffer);
      // Write test pattern (simulating ML tensor output)
      for (let i = 0; i < Math.min(view.length, 1024); i++) {
        view[i] = Math.sin(i * 0.01);
      }
      engine.raw.updateSharedBuffer(buffer);
      console.log('✅ Zero-copy buffer sent: 1MB');
    } catch (e: any) {
      console.warn('❌ Buffer test failed:', e?.message);
    }
  }, [engine]);

  return (
    <View style={styles.container}>
      <ActionButton
        emoji="⚔️"
        label="Attack"
        onPress={handleAttack}
        color="#ef4444"
      />
      <ActionButton
        emoji="🧪"
        label="Potion"
        onPress={handleUsePotion}
        color="#3b82f6"
      />
      <ActionButton
        emoji="🔧"
        label="Equip"
        onPress={handleEquip}
        color="#f59e0b"
      />
      <ActionButton
        emoji="📦"
        label="Buffer"
        onPress={handleTestBuffer}
        color="#8b5cf6"
      />
    </View>
  );
}

// ─── Button Component ───────────────────────────────────────────────────────

function ActionButton({
  emoji,
  label,
  onPress,
  color,
}: {
  emoji: string;
  label: string;
  onPress: () => void;
  color: string;
}) {
  return (
    <TouchableOpacity
      style={[styles.button, { backgroundColor: color }]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <Text style={styles.buttonEmoji}>{emoji}</Text>
      <Text style={styles.buttonLabel}>{label}</Text>
    </TouchableOpacity>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: '#0a0a0f',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.08)',
    paddingBottom: 32, // Safe area padding
  },
  button: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 12,
    gap: 2,
  },
  buttonEmoji: {
    fontSize: 20,
  },
  buttonLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#fff',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
});
