/**
 * SettingsScreen.tsx — CQRS Command Dispatch Demo
 *
 * Settings screen demonstrating CQRS command dispatch. Each setting change
 * sends a GameIntent from React Native → C++ SPSC queue → GDScript.
 * The Godot engine is the authoritative state owner — React Native is a
 * dumb client.
 */

import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { dispatchGameIntent } from 'react-native-nitro-godot';
import type { GodotEngineWrapper } from 'react-native-nitro-godot';

// ─── Types ──────────────────────────────────────────────────────────────────

type Difficulty = 'easy' | 'normal' | 'hard';

const DIFFICULTIES: Difficulty[] = ['easy', 'normal', 'hard'];

const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  easy: 'Easy',
  normal: 'Normal',
  hard: 'Hard',
};

// ─── Component ──────────────────────────────────────────────────────────────

export function SettingsScreen({
  visible,
  engine,
}: {
  visible: boolean;
  engine: GodotEngineWrapper | null;
}) {
  const [volume, setVolume] = useState(80);
  const [cameraZoom, setCameraZoom] = useState(1.0);
  const [showFps, setShowFps] = useState(false);
  const [difficulty, setDifficulty] = useState<Difficulty>('normal');

  // ── Volume (0-100, dispatched as 0.0-1.0) ──

  const adjustVolume = useCallback(
    (delta: number) => {
      const next = Math.max(0, Math.min(100, volume + delta));
      setVolume(next);
      if (!engine) return;
      dispatchGameIntent(engine, {
        action: 'SET_VOLUME',
        value: next / 100,
      });
    },
    [engine, volume],
  );

  // ── Camera Zoom ──

  const adjustZoom = useCallback(
    (delta: number) => {
      const next = Math.round(Math.max(0.5, Math.min(3.0, cameraZoom + delta)) * 10) / 10;
      setCameraZoom(next);
      if (!engine) return;
      dispatchGameIntent(engine, {
        action: 'SET_CAMERA_ZOOM',
        value: next,
      });
    },
    [engine, cameraZoom],
  );

  // ── Show FPS ──

  const toggleFps = useCallback(() => {
    const next = !showFps;
    setShowFps(next);
    if (!engine) return;
    dispatchGameIntent(engine, {
      action: 'SET_SHOW_FPS',
      value: next,
    });
  }, [engine, showFps]);

  // ── Difficulty ──

  const selectDifficulty = useCallback(
    (d: Difficulty) => {
      setDifficulty(d);
      if (!engine) return;
      dispatchGameIntent(engine, {
        action: 'SET_DIFFICULTY',
        value: d,
      });
    },
    [engine],
  );

  if (!visible) return null;

  return (
    <View style={styles.overlay}>
      <View style={styles.panel}>
        <Text style={styles.title}>⚙️ Settings</Text>

        {/* ── Sound Volume ── */}
        <SettingRow label="Sound Volume">
          <StepperControl
            value={`${volume}%`}
            onDecrement={() => adjustVolume(-5)}
            onIncrement={() => adjustVolume(5)}
          />
        </SettingRow>

        {/* ── Camera Zoom ── */}
        <SettingRow label="Camera Zoom">
          <StepperControl
            value={`${cameraZoom.toFixed(1)}×`}
            onDecrement={() => adjustZoom(-0.1)}
            onIncrement={() => adjustZoom(0.1)}
          />
        </SettingRow>

        {/* ── Show FPS ── */}
        <SettingRow label="Show FPS">
          <TouchableOpacity
            style={[styles.toggle, showFps && styles.toggleOn]}
            onPress={toggleFps}
            activeOpacity={0.7}
          >
            <View
              style={[
                styles.toggleThumb,
                showFps && styles.toggleThumbOn,
              ]}
            />
          </TouchableOpacity>
        </SettingRow>

        {/* ── Difficulty ── */}
        <SettingRow label="Difficulty">
          <View style={styles.segmented}>
            {DIFFICULTIES.map((d) => (
              <TouchableOpacity
                key={d}
                style={[
                  styles.segmentButton,
                  difficulty === d && styles.segmentButtonActive,
                ]}
                onPress={() => selectDifficulty(d)}
                activeOpacity={0.7}
              >
                <Text
                  style={[
                    styles.segmentLabel,
                    difficulty === d && styles.segmentLabelActive,
                  ]}
                >
                  {DIFFICULTY_LABELS[d]}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </SettingRow>
      </View>
    </View>
  );
}

// ─── Setting Row ────────────────────────────────────────────────────────────

function SettingRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      {children}
    </View>
  );
}

// ─── Stepper Control ────────────────────────────────────────────────────────

function StepperControl({
  value,
  onDecrement,
  onIncrement,
}: {
  value: string;
  onDecrement: () => void;
  onIncrement: () => void;
}) {
  return (
    <View style={styles.stepper}>
      <TouchableOpacity
        style={styles.stepButton}
        onPress={onDecrement}
        activeOpacity={0.6}
      >
        <Text style={styles.stepButtonText}>−</Text>
      </TouchableOpacity>
      <Text style={styles.stepValue}>{value}</Text>
      <TouchableOpacity
        style={styles.stepButton}
        onPress={onIncrement}
        activeOpacity={0.6}
      >
        <Text style={styles.stepButtonText}>+</Text>
      </TouchableOpacity>
    </View>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(5, 5, 8, 0.92)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 200,
  },
  panel: {
    width: '88%',
    maxWidth: 380,
    backgroundColor: '#0d0d14',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(0, 255, 136, 0.12)',
    paddingVertical: 28,
    paddingHorizontal: 24,
    gap: 20,
  },
  title: {
    fontSize: 22,
    fontWeight: '900',
    color: '#e0e7ff',
    letterSpacing: 0.5,
    textAlign: 'center',
    marginBottom: 4,
  },

  // ── Row ──
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  rowLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#a0a8c0',
  },

  // ── Stepper ──
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  stepButton: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: 'rgba(0, 255, 136, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepButtonText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#00ff88',
  },
  stepValue: {
    width: 56,
    textAlign: 'center',
    fontSize: 15,
    fontWeight: '700',
    color: '#e0e7ff',
  },

  // ── Toggle ──
  toggle: {
    width: 52,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  toggleOn: {
    backgroundColor: 'rgba(0, 255, 136, 0.3)',
  },
  toggleThumb: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#666',
  },
  toggleThumbOn: {
    alignSelf: 'flex-end',
    backgroundColor: '#00ff88',
  },

  // ── Segmented Control ──
  segmented: {
    flexDirection: 'row',
    gap: 4,
  },
  segmentButton: {
    paddingVertical: 7,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
  },
  segmentButtonActive: {
    backgroundColor: 'rgba(0, 255, 136, 0.2)',
    borderWidth: 1,
    borderColor: '#00ff88',
  },
  segmentLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#666',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  segmentLabelActive: {
    color: '#00ff88',
  },
});
