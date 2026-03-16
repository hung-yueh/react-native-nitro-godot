/**
 * FloatingLabel.tsx — 3D→2D Projected Label (Epic 4)
 *
 * Demonstrates react-native-nitro-godot's unprojectPosition() API by
 * positioning a React Native <Text> element over a 3D world coordinate.
 *
 * Uses requestAnimationFrame to poll at display refresh rate (up to 120Hz).
 * In a production app with Reanimated, you'd use useFrameCallback('worklet')
 * for even lower latency.
 */

import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { GodotEngineWrapper } from 'react-native-nitro-godot';

interface FloatingLabelProps {
  engine: GodotEngineWrapper;
  worldPosition: [number, number, number];
  label: string;
}

export function FloatingLabel({
  engine,
  worldPosition,
  label,
}: FloatingLabelProps) {
  const [screenPos, setScreenPos] = useState<[number, number] | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    function update() {
      const result = engine.unprojectPosition(
        worldPosition[0],
        worldPosition[1],
        worldPosition[2],
      );
      if (result) {
        setScreenPos(result);
      }
      rafRef.current = requestAnimationFrame(update);
    }

    rafRef.current = requestAnimationFrame(update);
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, [engine, worldPosition[0], worldPosition[1], worldPosition[2]]);

  if (!screenPos) return null;

  return (
    <View
      style={[
        styles.container,
        {
          left: screenPos[0] - 40,
          top: screenPos[1] - 30,
        },
      ]}
      pointerEvents="none"
    >
      <Text style={styles.label}>{label}</Text>
      <View style={styles.arrow} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    alignItems: 'center',
    width: 80,
  },
  label: {
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    color: '#a5b4fc',
    fontSize: 11,
    fontWeight: '700',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    overflow: 'hidden',
    textAlign: 'center',
  },
  arrow: {
    width: 0,
    height: 0,
    borderLeftWidth: 5,
    borderRightWidth: 5,
    borderTopWidth: 5,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: 'rgba(0, 0, 0, 0.75)',
  },
});
