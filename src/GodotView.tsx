import React from 'react';
import {
  requireNativeComponent,
  StyleSheet,
  type ViewStyle,
  type NativeSyntheticEvent,
} from 'react-native';

// ── Native event payload types ─────────────────────────────────────────────

export interface SurfaceCreatedEvent {
  /** Hex-encoded native surface pointer, e.g. "0x7f3c00a8b000" */
  pointer: string;
}

export interface SurfaceChangedEvent {
  width: number;
  height: number;
}

export interface TouchEvent {
  /** 'down' | 'move' | 'up' */
  action: string;
  /** Finger/pointer index (0 for primary) */
  pointerId: number;
  /** Touch X in native pixels */
  x: number;
  /** Touch Y in native pixels */
  y: number;
  /** Delta X from previous position */
  deltaX: number;
  /** Delta Y from previous position */
  deltaY: number;
}

// ── Native component interface ────────────────────────────────────────────

interface NativeGodotViewProps {
  style?: ViewStyle;
  onSurfaceCreated?:  (e: NativeSyntheticEvent<SurfaceCreatedEvent>) => void;
  onSurfaceChanged?:  (e: NativeSyntheticEvent<SurfaceChangedEvent>) => void;
  onSurfaceDestroyed?: (e: NativeSyntheticEvent<{}>) => void;
  onTouchEvent?:      (e: NativeSyntheticEvent<TouchEvent>) => void;
}

const NativeGodotView = requireNativeComponent<NativeGodotViewProps>('GodotView');

// ── GodotView public props ────────────────────────────────────────────────

export interface GodotViewProps {
  style?: ViewStyle;
  /**
   * Fires when the native surface is ready.
   * Use the surfaceCallbacks from useGodotEngine to handle this automatically.
   */
  onSurfaceCreated?:  (event: NativeSyntheticEvent<SurfaceCreatedEvent>) => void;
  /** Fires when the surface dimensions change (Android only). */
  onSurfaceChanged?:  (event: NativeSyntheticEvent<SurfaceChangedEvent>) => void;
  /** Fires just before the surface is destroyed. */
  onSurfaceDestroyed?: (event: NativeSyntheticEvent<{}>) => void;
  /** Fires for every touch down/move/up event on the Godot surface. */
  onTouchEvent?: (event: NativeSyntheticEvent<TouchEvent>) => void;
}

/**
 * GodotView — cross-platform React Native view component that hosts a
 * native Godot rendering surface (CAMetalLayer on iOS, ANativeWindow on Android).
 *
 * This is a pure rendering wrapper. All lifecycle management (AppState,
 * surface hot-swap, ghost-touch mitigation) is handled by the useGodotEngine hook.
 *
 * @example
 * ```tsx
 * const { surfaceCallbacks, handleTouchEvent } = useGodotEngine('/path/to/game.pck');
 *
 * <GodotView
 *   style={StyleSheet.absoluteFill}
 *   {...surfaceCallbacks}
 *   onTouchEvent={handleTouchEvent}
 * />
 * ```
 */
export function GodotView({
  style,
  onSurfaceCreated,
  onSurfaceChanged,
  onSurfaceDestroyed,
  onTouchEvent,
}: GodotViewProps) {
  return (
    <NativeGodotView
      style={StyleSheet.flatten([styles.fill, style])}
      onSurfaceCreated={onSurfaceCreated}
      onSurfaceChanged={onSurfaceChanged}
      onSurfaceDestroyed={onSurfaceDestroyed}
      onTouchEvent={onTouchEvent}
    />
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
});
