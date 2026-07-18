/**
 * LoadingScreen.tsx — Floor Transition Overlay (Epic 3)
 *
 * Displays an animated loading screen between dungeon floors.
 * Driven by LOAD_PROGRESS events from Godot's ResourceLoader.load_threaded_request().
 *
 * State source: state$.loading.progress and state$.loading.complete
 * (ingested automatically by useGodotEngine's SPSC drain loop)
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Memo } from '@legendapp/state/react';
import { state$ } from 'react-native-nitro-godot';

export function LoadingScreen() {
  return (
    <View style={styles.overlay}>
      <View style={styles.content}>
        <Text style={styles.emoji}>🏰</Text>
        <Text style={styles.title}>Descending…</Text>
        <Text style={styles.subtitle}>Preparing next floor</Text>

        {/* Progress bar (reactive via Legend-State) */}
        <View style={styles.progressBg}>
          <Memo>
            {() => {
              const progress = state$.loading.progress.get();
              return (
                <View
                  style={[
                    styles.progressFill,
                    { width: `${Math.round(progress * 100)}%` as any },
                  ]}
                />
              );
            }}
          </Memo>
        </View>

        <Text style={styles.pctText}>
          <Memo>
            {() => `${Math.round(state$.loading.progress.get() * 100)}%`}
          </Memo>
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(10, 10, 15, 0.92)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 100,
  },
  content: {
    alignItems: 'center',
    padding: 40,
  },
  emoji: {
    fontSize: 48,
    marginBottom: 16,
  },
  title: {
    fontSize: 28,
    fontWeight: '900',
    color: '#e0d8f0',
    letterSpacing: 1,
  },
  subtitle: {
    fontSize: 14,
    color: '#8b82a8',
    marginTop: 6,
    marginBottom: 24,
  },
  progressBg: {
    width: 260,
    height: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#a78bfa',
    borderRadius: 4,
  },
  pctText: {
    fontSize: 12,
    color: '#a78bfa',
    fontWeight: '700',
    marginTop: 8,
  },
});
