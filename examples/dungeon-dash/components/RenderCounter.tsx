/**
 * RenderCounter — Visual proof of zero-render HUD.
 *
 * This component's render count stays at 1 while game state updates at 60Hz,
 * proving that <Memo> bypasses React's reconciler entirely.
 */

import React, { useRef } from 'react';
import { View, Text, StyleSheet } from 'react-native';

export function RenderCounter() {
  const renderCount = useRef<number>(0);
  renderCount.current += 1;

  return (
    <View style={styles.container}>
      <Text style={styles.label}>React Renders</Text>
      <Text style={styles.count}>{renderCount.current}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 12,
    right: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(5, 5, 8, 0.75)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  label: {
    fontFamily: 'monospace',
    fontSize: 10,
    color: 'rgba(255, 255, 255, 0.5)',
    letterSpacing: 0.5,
  },
  count: {
    fontFamily: 'monospace',
    fontSize: 12,
    fontWeight: '700',
    color: '#00ff88',
  },
});
