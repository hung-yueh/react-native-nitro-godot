/**
 * NitroSwarm — react-native-nitro-godot Example App
 *
 * Demonstrates WHY you'd embed Godot inside React Native:
 *   - React Native builds the app shell (tabs, settings, stats, modals)
 *   - Godot renders the 3D game view
 *   - Zero-overhead JSI bridge connects them at native speed
 *
 * Features exercised:
 *   🎮 GodotView          — Native surface embedding (iOS Metal / Android SurfaceView)
 *   🔄 SPSC Messaging     — Lock-free bidirectional messaging at 60Hz
 *   📊 Zero-Render HUD    — Legend-State <Memo> bypasses React reconciler
 *   🎯 3D→2D Projection   — unprojectPosition() JSI call for floating health bars
 *   ⚡ CQRS Dispatch      — Settings → dispatchGameIntent → GDScript
 *   🕹️ Twin-Stick Input   — Touch → C++ SPSC → Godot Input at native refresh rate
 *   💤 OS Lifecycle        — Auto suspend/resume with ghost touch mitigation
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  StyleSheet,
  View,
  Text,
  StatusBar,
  TouchableOpacity,
  Platform,
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
import { ActionBar } from './components/ActionBar';
import { RenderCounter } from './components/RenderCounter';
import { StatsScreen } from './screens/StatsScreen';
import { SettingsScreen } from './screens/SettingsScreen';

// ─── Tab Types ────────────────────────────────────────────────────────────────

type Tab = 'play' | 'stats' | 'settings';

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

// ─── Tab Bar ──────────────────────────────────────────────────────────────────

function TabBar({
  activeTab,
  onTabChange,
}: {
  activeTab: Tab;
  onTabChange: (tab: Tab) => void;
}) {
  return (
    <View style={styles.tabBar}>
      <TabButton
        icon="🎮"
        label="Play"
        active={activeTab === 'play'}
        onPress={() => onTabChange('play')}
      />
      <TabButton
        icon="📊"
        label="Stats"
        active={activeTab === 'stats'}
        onPress={() => onTabChange('stats')}
      />
      <TabButton
        icon="⚙️"
        label="Settings"
        active={activeTab === 'settings'}
        onPress={() => onTabChange('settings')}
      />
    </View>
  );
}

function TabButton({
  icon,
  label,
  active,
  onPress,
}: {
  icon: string;
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={[styles.tabButton, active && styles.tabButtonActive]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <Text style={styles.tabIcon}>{icon}</Text>
      <Text
        style={[styles.tabLabel, active && styles.tabLabelActive]}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
}

// ─── Game Screen (Play Tab) ───────────────────────────────────────────────────

function PlayScreen({
  godot,
  isLoading,
  visible,
}: {
  godot: ReturnType<typeof useGodotEngine>;
  isLoading: boolean;
  visible: boolean;
}) {
  const [showProfiler, setShowProfiler] = useState(false);
  const { engine, engineState, surfaceCallbacks, handleTouchEvent } = godot;

  // IMPORTANT: PlayScreen stays mounted (and merely hidden) on other tabs.
  // Unmounting <GodotView> destroys the native surface, and the engine cannot
  // re-attach a fresh surface while in the 'running' state — the view would
  // come back permanently black after a tab round-trip.
  return (
    <View
      style={[styles.playScreen, !visible && styles.playScreenHidden]}
      pointerEvents={visible ? 'auto' : 'none'}
    >
      {/* Godot 3D rendering surface */}
      <View style={styles.godotContainer}>
        <GodotView
          style={StyleSheet.absoluteFill}
          {...surfaceCallbacks}
          onTouchEvent={handleTouchEvent}
        />

        {/* ── Zero-Render HUD (Legend-State <Memo>) ─────────────────────── */}
        <GameHUD />

        {/* ── Twin-Stick Joysticks → C++ SPSC → Godot Input ─────────────── */}
        <NitroSwarmHUD engine={engine} />

        {/* ── 3D→2D Projected Health Bars (Epic 4) ──────────────────────── */}
        <EnemyHealthBars engine={engine} />

        {/* ── React Render Counter (proves zero-render claim) ───────────── */}
        {showProfiler && <RenderCounter />}

        {/* ── Floor Loading Overlay ──────────────────────────────────────── */}
        {isLoading && <LoadingScreen />}
      </View>

      {/* ── CQRS Action Buttons ─────────────────────────────────────────── */}
      <ActionBar engine={engine} />

      {/* ── Debug Footer ────────────────────────────────────────────────── */}
      {__DEV__ && (
        <View style={styles.debugBar}>
          <Text style={styles.debugText}>
            engine: {engineState}
          </Text>
          <TouchableOpacity
            onPress={() => setShowProfiler((s) => !s)}
            style={styles.profilerToggle}
          >
            <Text style={styles.profilerToggleText}>
              {showProfiler ? '🔬 Hide' : '🔬 Profiler'}
            </Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

// ─── Game Root (engine owner) ─────────────────────────────────────────────────
// Owns the single useGodotEngine instance so BOTH the Play tab (view, HUD) and
// the Settings tab (CQRS dispatch) talk to the same engine.

export function GameRoot({ pckPath }: { pckPath: string }) {
  const [activeTab, setActiveTab] = useState<Tab>('play');
  const [isLoading, setIsLoading] = useState(false);

  const handleMessage = useCallback((msg: string) => {
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
      console.log(`📩 Godot (raw): ${msg}`);
    }
  }, []);

  const godot = useGodotEngine(pckPath, handleMessage);

  return (
    <GestureHandlerRootView style={styles.root}>
      <StatusBar barStyle="light-content" />

      {/* ── Play Tab (Godot game + HUD + ActionBar; stays mounted) ─────── */}
      <PlayScreen godot={godot} isLoading={isLoading} visible={activeTab === 'play'} />

      {/* ── Stats Tab (pure React Native — demonstrates rich app UI) ───── */}
      <StatsScreen visible={activeTab === 'stats'} />

      {/* ── Settings Tab (CQRS dispatch — RN controls Godot) ───────────── */}
      <SettingsScreen visible={activeTab === 'settings'} engine={godot.engine} />

      {/* ── Bottom Tab Bar ──────────────────────────────────────────────── */}
      <TabBar activeTab={activeTab} onTabChange={setActiveTab} />
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
        {error ? <Text style={styles.errorText}>{error}</Text> : null}
      </View>
    );
  }

  return <GameRoot pckPath={pckPath} />;
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#050508',
  },
  playScreen: {
    flex: 1,
  },
  // Hidden-but-mounted: keeps the native Godot surface alive across tab
  // switches (opacity instead of unmount — see PlayScreen comment).
  playScreenHidden: {
    opacity: 0,
  },
  godotContainer: {
    flex: 1,
    backgroundColor: '#000',
  },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: '#0a0a12',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.06)',
    paddingBottom: Platform.select({ ios: 28, android: 8, default: 8 }),
    paddingTop: 8,
  },
  tabButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 4,
    gap: 2,
  },
  tabButtonActive: {
    // active state handled by label color
  },
  tabIcon: {
    fontSize: 20,
  },
  tabLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: '#4a5568',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  tabLabelActive: {
    color: '#00ff88',
  },
  debugBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(0,0,0,0.85)',
    paddingVertical: 4,
    paddingHorizontal: 12,
  },
  debugText: {
    color: '#00ff88',
    fontSize: 11,
    fontFamily: 'monospace',
  },
  profilerToggle: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: 'rgba(0, 255, 136, 0.1)',
  },
  profilerToggleText: {
    color: '#00ff88',
    fontSize: 10,
    fontWeight: '700',
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
  errorText: {
    fontSize: 12,
    color: '#f87171',
    marginTop: 16,
    textAlign: 'center',
  },
});
