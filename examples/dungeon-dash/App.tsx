/**
 * Dungeon Dash / NitroSwarm — React Native App
 *
 * Full vertical slice exercising every epic of react-native-nitro-godot:
 *   Epic 1: Lock-free SPSC messaging (bidirectional)
 *   Epic 2: OS lifecycle (auto suspend/resume via useGodotEngine AppState listener)
 *   Epic 3: Async scene loading (floor transitions via LOAD_SCENE_ASYNC intent)
 *   Epic 4: 3D→2D projection (EnemyHealthBars via synchronous JSI unprojectPosition)
 *   Epic 5: CQRS state sync (zero-render HUD via NitroSwarmHUD + Legend-State)
 *   Input:  Twin-stick NitroSwarmHUD → sendDragEvent → C++ SPSC → Godot _input()
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  StyleSheet,
  View,
  Text,
  StatusBar,
} from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { File, Paths } from 'expo-file-system';
import { Asset } from 'expo-asset';
import {
  useGodotEngine,
  GodotView,
  NitroSwarmHUD,
} from 'react-native-nitro-godot';

import { GameHUD } from './components/GameHUD';
import { LoadingScreen } from './components/LoadingScreen';
import { EnemyHealthBars } from './components/EnemyHealthBars';

// ─── PCK Extract Hook ─────────────────────────────────────────────────────────

function usePckExtract(pckModule: number) {
  const [pckPath, setPckPath] = useState<string | null>(null);
  const [extracting, setExtracting] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function extract() {
      try {
        const asset = Asset.fromModule(pckModule);
        await asset.downloadAsync();
        const sourceUri = asset.localUri;
        if (!sourceUri) throw new Error('Asset localUri is null');

        const destFile = new File(Paths.document, 'game.pck');
        const srcFile = new File(sourceUri);

        // Always re-copy — size-based check misses same-size GDScript edits
        if (destFile.exists) destFile.delete();
        srcFile.copy(destFile);

        if (!cancelled) {
          setPckPath(destFile.uri);
          setExtracting(false);
        }
      } catch (e: any) {
        if (!cancelled) {
          setError(e?.message ?? 'Unknown error');
          setExtracting(false);
        }
      }
    }

    extract();
    return () => {
      cancelled = true;
    };
  }, [pckModule]);

  return { pckPath, extracting, error };
}

// ─── Game Screen ──────────────────────────────────────────────────────────────

function GameScreen({ pckPath }: { pckPath: string }) {
  const [isLoading, setIsLoading] = useState(false);

  // ── Phase 5 hook API ─────────────────────────────────────────────────────
  // surfaceCallbacks handles: onSurfaceCreated → attachSurface + start,
  //                           onSurfaceDestroyed → nullify pointer
  // AppState listener inside the hook handles suspend/resume automatically.
  const {
    engine,
    engineState,
    surfaceCallbacks,
    handleTouchEvent,
  } = useGodotEngine(pckPath, (msg) => {
    try {
      const parsed = JSON.parse(msg);

      if (parsed.type === 'LOAD_PROGRESS') setIsLoading(true);
      if (parsed.type === 'LOAD_COMPLETE' || parsed.type === 'LOAD_ERROR') {
        setIsLoading(false);
      }

      if (parsed.type === 'DEBUG') {
        console.log(`🔧 ${parsed.msg}`);
      } else if (parsed.type === 'ENEMY_HIT') {
        console.log(`⚔️ Enemy killed: ${parsed.enemy} (${parsed.remaining} left)`);
      } else if (parsed.type === 'WAVE_CLEAR') {
        console.log(`🌊 Wave ${parsed.wave} cleared! Next: wave ${parsed.nextWave}`);
      } else if (parsed.type === 'WAVE_STARTED') {
        console.log(`🎮 Wave ${parsed.wave} started — ${parsed.enemyCount} enemies`);
      } else if (parsed.type !== 'STATE_SYNC') {
        console.log(`📩 Godot: ${msg}`);
      }
    } catch {
      // Non-JSON message — log it
      console.log(`📩 Godot (raw): ${msg}`);
    }
  });

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <GestureHandlerRootView style={styles.root}>
      <StatusBar barStyle="light-content" />

      {/* Godot rendering surface — fills the screen */}
      <View style={styles.godotContainer}>
        {/* Spread surfaceCallbacks directly — Phase 5 DX */}
        <GodotView
          style={StyleSheet.absoluteFill}
          {...surfaceCallbacks}
          onTouchEvent={handleTouchEvent}
        />

        {/* ── Epic 5: Zero-render HUD (Legend-State <Memo> bindings) ──── */}
        <GameHUD />

        {/* ── Epic 5: NitroSwarm twin-stick joystick overlay ────────────
            Feeds sendDragEvent() → C++ SPSC → Godot InputEventScreenDrag
            → RNBridge._input() → joystick_move/aim vectors → Player.gd   */}
        <NitroSwarmHUD engine={engine} />

        {/* ── Epic 4: Reanimated floating health bars ───────────────────
            Reads enemy 3D positions from state$.enemies (Legend-State).
            Projects to screen via engine.unprojectPosition() JSI call.
            Zero React bridge crossings for position updates.              */}
        {/* TODO: re-enable once unprojectPosition is wrapped as a worklet */}
        {/* <EnemyHealthBars engine={engine} /> */}

        {/* ── Epic 3: Floor loading overlay ───────────────────────────── */}
        {isLoading && <LoadingScreen />}
      </View>

      {/* Engine state debug overlay (dev only) */}
      {__DEV__ && (
        <View style={styles.debugBar}>
          <Text style={styles.debugText}>
            engine: {engineState}
          </Text>
        </View>
      )}
    </GestureHandlerRootView>
  );
}

// ─── Root App ─────────────────────────────────────────────────────────────────

export default function App() {
  const { pckPath, extracting, error } = usePckExtract(
    require('./assets/game.pck'),
  );

  if (extracting) {
    return (
      <View style={styles.splash}>
        <Text style={styles.splashEmoji}>⚡</Text>
        <Text style={styles.splashTitle}>NitroSwarm</Text>
        <Text style={styles.splashSub}>Extracting game data…</Text>
      </View>
    );
  }

  if (!pckPath) {
    return (
      <View style={styles.splash}>
        <Text style={styles.splashEmoji}>⚡</Text>
        <Text style={styles.splashTitle}>NitroSwarm</Text>
        <Text style={styles.splashSub}>react-native-nitro-godot tech demo</Text>
        <View style={styles.instructionBox}>
          <Text style={styles.instructionTitle}>Setup Required</Text>
          <Text style={styles.instructionText}>
            1. Open godot-project/ in Godot 4.6{'\n'}
            2. Export → Android/iOS → assets/game.pck{'\n'}
            3. npx expo run:android (or run:ios)
          </Text>
        </View>
        {error ? <Text style={styles.errorText}>{error}</Text> : null}
      </View>
    );
  }

  return <GameScreen pckPath={pckPath} />;
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#050508',
  },
  godotContainer: {
    flex: 1,
    backgroundColor: '#000',
  },
  debugBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0,0,0,0.7)',
    paddingVertical: 4,
    paddingHorizontal: 12,
  },
  debugText: {
    color: '#00ff88',
    fontSize: 11,
    fontFamily: 'monospace',
  },
  splash: {
    flex: 1,
    backgroundColor: '#050508',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  splashEmoji: {
    fontSize: 72,
    marginBottom: 16,
  },
  splashTitle: {
    fontSize: 40,
    fontWeight: '900',
    color: '#00ff88',
    letterSpacing: 4,
  },
  splashSub: {
    fontSize: 13,
    color: '#4a5568',
    marginTop: 8,
  },
  instructionBox: {
    marginTop: 32,
    backgroundColor: 'rgba(0, 255, 136, 0.06)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(0, 255, 136, 0.2)',
    padding: 20,
    width: '100%',
    maxWidth: 360,
  },
  instructionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#00ff88',
    marginBottom: 12,
  },
  instructionText: {
    fontSize: 13,
    color: '#a0aec0',
    lineHeight: 22,
  },
  errorText: {
    fontSize: 12,
    color: '#f87171',
    marginTop: 16,
    textAlign: 'center',
  },
});
