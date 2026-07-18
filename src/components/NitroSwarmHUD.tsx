/**
 * NitroSwarmHUD.tsx — Twin-Stick Arena HUD (Phase 5 Stress Test)
 *
 * Demonstrates the "Holy Grail" architecture:
 *   - Two virtual joysticks (Move + Aim) feeding sendDragEvent() at gesture-handler's
 *     native 120Hz update rate through the lock-free inbound SPSC queue.
 *   - Zero-render reactive score/combo display via Legend-State <Memo>.
 *   - engine.unprojectPosition() exported cleanly for Reanimated floating health bars.
 *
 * Dependencies (peer — consumer app must install):
 *   - react-native-gesture-handler
 *   - @legendapp/state + @legendapp/state/react
 *
 * @example
 * ```tsx
 * const { engine, surfaceCallbacks, handleTouchEvent } = useGodotEngine('/data/game.pck');
 *
 * <GodotView {...surfaceCallbacks} onTouchEvent={handleTouchEvent}>
 *   <NitroSwarmHUD engine={engine} />
 * </GodotView>
 * ```
 */

import React from "react";
import { View, Text, StyleSheet, PixelRatio, Platform, StatusBar } from "react-native";
// @ts-ignore — react-native-gesture-handler is a peer dependency (consumer app must install)
import { GestureDetector, Gesture } from "react-native-gesture-handler";
import { Memo } from "@legendapp/state/react";
import { state$ } from "../godotState";
import type { GodotEngineWrapper } from "../GodotEngine";

// ── Joystick layout constants ────────────────────────────────────────────────

const JOYSTICK_SIZE = 140;
const JOYSTICK_MARGIN = 30;
const SENSITIVITY = 1.0; // Tunable multiplier for raw translation → Godot coords

// Approx. safe-area insets so the overlay HUD clears the status bar / Dynamic
// Island (top) and the home indicator (bottom). For exact per-device values,
// the consumer app can wrap in react-native-safe-area-context; this keeps the
// component dependency-free.
const TOP_INSET = Platform.select({ ios: 59, android: StatusBar.currentHeight ?? 24, default: 24 })!;
const BOTTOM_INSET = Platform.select({ ios: 34, android: 0, default: 0 })!;

// ── Props ────────────────────────────────────────────────────────────────────

export interface NitroSwarmHUDProps {
  /** The GodotEngine wrapper from useGodotEngine */
  engine: GodotEngineWrapper;
}

/**
 * NitroSwarmHUD — Twin-stick arena survival HUD overlay.
 *
 * Renders on top of the GodotView. Captures gesture input via
 * react-native-gesture-handler PanGesture and routes directly
 * to the C++ SPSC queue at native gesture update rate (120Hz on iOS).
 *
 * Score/combo counter uses Legend-State's <Memo> for zero-render reactivity:
 * the component body runs exactly ONCE, and only the <Memo> subtrees update.
 */
export function NitroSwarmHUD({ engine }: NitroSwarmHUDProps) {
  // ── Move Joystick (Left) — pointer_id = 0 ────────────────────────────────

  const moveGesture = Gesture.Pan()
    .onStart((e: any) => {
      console.log(
        "[MOVE] onStart",
        e.absoluteX.toFixed(1),
        e.absoluteY.toFixed(1),
      );
      engine.raw.sendTouchEvent(e.absoluteX, e.absoluteY, true, 0);
    })
    .onUpdate((e: any) => {
      engine.raw.sendDragEvent(
        e.absoluteX,
        e.absoluteY,
        e.translationX * SENSITIVITY,
        e.translationY * SENSITIVITY,
        e.velocityX,
        e.velocityY,
        0,
      );
    })
    .onEnd((e: any) => {
      console.log("[MOVE] onEnd");
      engine.raw.sendTouchEvent(e.absoluteX, e.absoluteY, false, 0);
    });

  // ── Aim Joystick (Right) — pointer_id = 1 ────────────────────────────────

  const aimGesture = Gesture.Pan()
    .onStart((e: any) => {
      console.log(
        "[AIM] onStart",
        e.absoluteX.toFixed(1),
        e.absoluteY.toFixed(1),
      );
      engine.raw.sendTouchEvent(e.absoluteX, e.absoluteY, true, 1);
    })
    .onUpdate((e: any) => {
      engine.raw.sendDragEvent(
        e.absoluteX,
        e.absoluteY,
        e.translationX * SENSITIVITY,
        e.translationY * SENSITIVITY,
        e.velocityX,
        e.velocityY,
        1,
      );
    })
    .onEnd((e: any) => {
      console.log("[AIM] onEnd");
      engine.raw.sendTouchEvent(e.absoluteX, e.absoluteY, false, 1);
    });

  return (
    <View style={styles.container} pointerEvents="box-none">
      {/* ── Score / Combo HUD (Zero-Render via Legend-State <Memo>) ───────── */}
      <View style={[styles.scoreBar, { top: TOP_INSET + 4 }]}>
        <Text style={styles.scoreLabel}>
          SCORE: <Memo>{() => String(state$.game.score.get())}</Memo>
        </Text>
        <Text style={styles.comboLabel}>
          COMBO: <Memo>{() => `x${state$.game.combo.get()}`}</Memo>
        </Text>
        <Text style={styles.waveLabel}>
          WAVE: <Memo>{() => String(state$.game.waveNumber.get())}</Memo>
        </Text>
      </View>

      {/* ── Enemy Counter ─────────────────────────────────────────────────── */}
      <View style={[styles.enemyCounter, { top: TOP_INSET + 40 }]}>
        <Text style={styles.enemyText}>
          🎯 <Memo>{() => String(state$.game.enemyCount.get())}</Memo>
        </Text>
      </View>

      {/* ── Move Joystick (Bottom-Left) ───────────────────────────────────── */}
      <GestureDetector gesture={moveGesture}>
        <View style={[styles.joystickZone, styles.moveZone, { bottom: JOYSTICK_MARGIN + BOTTOM_INSET }]}>
          <View style={styles.joystickRing}>
            <Text style={styles.joystickLabel}>MOVE</Text>
          </View>
        </View>
      </GestureDetector>

      {/* ── Aim Joystick (Bottom-Right) ───────────────────────────────────── */}
      <GestureDetector gesture={aimGesture}>
        <View style={[styles.joystickZone, styles.aimZone, { bottom: JOYSTICK_MARGIN + BOTTOM_INSET }]}>
          <View style={styles.joystickRing}>
            <Text style={styles.joystickLabel}>AIM</Text>
          </View>
        </View>
      </GestureDetector>

      {/* ── Player Health (from existing HealthBar or inline) ─────────────── */}
      <View style={[styles.healthBar, { bottom: JOYSTICK_MARGIN + 10 + BOTTOM_INSET }]}>
        <Text style={styles.healthLabel}>
          ❤️ <Memo>{() => String(state$.player.health.get())}</Memo>
        </Text>
        <Text style={styles.ammoLabel}>
          🔫 <Memo>{() => String(state$.player.ammo.get())}</Memo>
        </Text>
      </View>
    </View>
  );
}

// ── Reanimated Binding Export ─────────────────────────────────────────────────

/**
 * Helper to project a 3D world position to screen coordinates.
 * Designed to be called from a Reanimated useFrameCallback('worklet')
 * for zero-latency floating 3D health bars.
 *
 * @example
 * ```ts
 * useFrameCallback(() => {
 *   'worklet';
 *   const pos = unproject3DToScreen(engine, 0, 2.5, 0);
 *   if (pos) {
 *     healthBarX.value = pos[0];
 *     healthBarY.value = pos[1];
 *   }
 * });
 * ```
 */
export function unproject3DToScreen(
  engine: GodotEngineWrapper,
  worldX: number,
  worldY: number,
  worldZ: number,
): [number, number] | undefined {
  const result = engine.unprojectPosition(worldX, worldY, worldZ);
  if (!result) return undefined;
  // Godot returns physical hardware pixels; React Native UI uses logical pixels (dp).
  const scale = PixelRatio.get();
  return [result[0] / scale, result[1] / scale];
}

// ── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
  },

  // Score bar at the top
  scoreBar: {
    position: "absolute",
    top: 30,
    left: 0,
    right: 0,
    flexDirection: "row",
    justifyContent: "center",
    gap: 24,
    paddingHorizontal: 20,
  },
  scoreLabel: {
    color: "#00ff88",
    fontSize: 18,
    fontWeight: "bold",
    textShadowColor: "rgba(0, 255, 136, 0.5)",
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 8,
  },
  comboLabel: {
    color: "#ff6600",
    fontSize: 18,
    fontWeight: "bold",
    textShadowColor: "rgba(255, 102, 0, 0.5)",
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 8,
  },
  waveLabel: {
    color: "#66ccff",
    fontSize: 18,
    fontWeight: "bold",
    textShadowColor: "rgba(102, 204, 255, 0.5)",
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 8,
  },

  // Enemy counter top-right
  enemyCounter: {
    position: "absolute",
    top: 50,
    right: 20,
    backgroundColor: "rgba(0, 0, 0, 0.6)",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  enemyText: {
    color: "#ff4444",
    fontSize: 16,
    fontWeight: "bold",
  },

  // Joystick zones
  joystickZone: {
    position: "absolute",
    bottom: JOYSTICK_MARGIN,
    width: JOYSTICK_SIZE,
    height: JOYSTICK_SIZE,
    justifyContent: "center",
    alignItems: "center",
  },
  moveZone: {
    left: JOYSTICK_MARGIN,
  },
  aimZone: {
    right: JOYSTICK_MARGIN,
  },
  joystickRing: {
    width: JOYSTICK_SIZE,
    height: JOYSTICK_SIZE,
    borderRadius: JOYSTICK_SIZE / 2,
    borderWidth: 2,
    borderColor: "rgba(255, 255, 255, 0.3)",
    backgroundColor: "rgba(255, 255, 255, 0.08)",
    justifyContent: "center",
    alignItems: "center",
  },
  joystickLabel: {
    color: "rgba(255, 255, 255, 0.4)",
    fontSize: 12,
    fontWeight: "bold",
    letterSpacing: 2,
  },

  // Health bar bottom-center
  healthBar: {
    position: "absolute",
    bottom: JOYSTICK_MARGIN + 10,
    left: JOYSTICK_MARGIN + JOYSTICK_SIZE + 20,
    right: JOYSTICK_MARGIN + JOYSTICK_SIZE + 20,
    flexDirection: "row",
    justifyContent: "center",
    gap: 20,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  healthLabel: {
    color: "#ff4444",
    fontSize: 16,
    fontWeight: "bold",
  },
  ammoLabel: {
    color: "#ffaa00",
    fontSize: 16,
    fontWeight: "bold",
  },
});
