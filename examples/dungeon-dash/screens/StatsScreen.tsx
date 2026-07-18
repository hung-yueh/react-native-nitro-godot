/**
 * StatsScreen.tsx — Pure React Native Stats Dashboard
 *
 * Pure React Native screen with rich UI that reads game state at 60Hz via
 * Legend-State — zero re-renders, zero bridge crossings. This is trivial
 * in React Native but painful in Godot's Control-based UI system.
 *
 * Every reactive value is wrapped in <Memo>, so the React Profiler will
 * register ZERO component re-renders while all stats stream at frame rate.
 *
 * KEY RULES:
 *   ✅ GOOD: <Memo>{() => state$.foo.get()}</Memo> — bypasses React diffing
 *   ❌ BAD:  const val = state$.foo.get() in the component body
 */

import React from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
} from 'react-native';
import { Memo } from '@legendapp/state/react';
import { state$ } from 'react-native-nitro-godot';
import { HealthFill } from '../components/HealthFill';
import { TOP_INSET } from '../components/insets';

// ─── Stat Card ──────────────────────────────────────────────────────────────

function StatCard({
  emoji,
  label,
  children,
}: {
  emoji: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardEmoji}>{emoji}</Text>
      <Text style={styles.cardLabel}>{label}</Text>
      <Text style={styles.cardValue}>{children}</Text>
    </View>
  );
}

// ─── Main Screen ────────────────────────────────────────────────────────────

export function StatsScreen({ visible }: { visible: boolean }) {
  if (!visible) return null;

  return (
    <View style={styles.root}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Header ──────────────────────────────────────────────────── */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>⚡ LIVE STATS</Text>
          <Text style={styles.headerSub}>
            60Hz reactive · zero re-renders
          </Text>
        </View>

        {/* ── Live Stats Cards ────────────────────────────────────────── */}
        <Text style={styles.sectionTitle}>📊 GAME STATUS</Text>
        <View style={styles.cardGrid}>
          <StatCard emoji="🏆" label="Score">
            <Memo>{() => String(state$.game.score.get())}</Memo>
          </StatCard>
          <StatCard emoji="🌊" label="Wave">
            <Memo>{() => String(state$.game.waveNumber.get())}</Memo>
          </StatCard>
          <StatCard emoji="🔥" label="Combo">
            <Memo>
              {() => {
                const combo = state$.game.combo.get();
                return combo > 1 ? `×${combo}` : '—';
              }}
            </Memo>
          </StatCard>
          <StatCard emoji="👾" label="Enemies">
            <Memo>{() => String(state$.game.enemyCount.get())}</Memo>
          </StatCard>
        </View>

        {/* ── Player Status ───────────────────────────────────────────── */}
        <Text style={styles.sectionTitle}>🧙 PLAYER STATUS</Text>
        <View style={styles.playerCard}>
          {/* Health */}
          <View style={styles.playerRow}>
            <Text style={styles.playerRowIcon}>❤️</Text>
            <Text style={styles.playerRowLabel}>Health</Text>
            <View style={styles.healthBarBg}>
              <HealthFill style={styles.healthFill} />
            </View>
            <Text style={styles.playerRowValue}>
              <Memo>{() => String(state$.player.health.get())}</Memo>
            </Text>
          </View>

          {/* Weapon */}
          <View style={styles.divider} />
          <View style={styles.playerRow}>
            <Text style={styles.playerRowIcon}>⚔️</Text>
            <Text style={styles.playerRowLabel}>Weapon</Text>
            <Text style={styles.playerRowHighlight}>
              <Memo>
                {() => state$.player.weapon.get().toUpperCase()}
              </Memo>
            </Text>
          </View>

          {/* Ammo */}
          <View style={styles.divider} />
          <View style={styles.playerRow}>
            <Text style={styles.playerRowIcon}>🎯</Text>
            <Text style={styles.playerRowLabel}>Ammo</Text>
            <Text style={styles.playerRowValue}>
              <Memo>{() => String(state$.player.ammo.get())}</Memo>
            </Text>
          </View>
        </View>

        {/* ── Scene Info ──────────────────────────────────────────────── */}
        <View style={styles.sceneBadge}>
          <Text style={styles.sceneBadgeLabel}>🗺️ CURRENT SCENE</Text>
          <Text style={styles.sceneBadgeValue}>
            <Memo>{() => state$.loading.currentScene.get()}</Memo>
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const ACCENT = '#00ff88';
const BG = '#050508';
const CARD_BG = 'rgba(255, 255, 255, 0.05)';
const CARD_BORDER = 'rgba(255, 255, 255, 0.08)';

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFill,
    backgroundColor: BG,
    zIndex: 200,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingTop: TOP_INSET + 16,
    paddingHorizontal: 20,
    paddingBottom: 100,
  },

  // Header
  header: {
    alignItems: 'center',
    marginBottom: 28,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: '900',
    color: ACCENT,
    letterSpacing: 2,
  },
  headerSub: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.35)',
    fontWeight: '500',
    marginTop: 4,
    letterSpacing: 0.5,
  },

  // Section titles
  sectionTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: 'rgba(255, 255, 255, 0.5)',
    letterSpacing: 1.5,
    marginBottom: 12,
    marginTop: 4,
  },

  // Card grid (2×2)
  cardGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 28,
  },
  card: {
    width: '47%' as any,
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    borderRadius: 16,
    paddingVertical: 18,
    paddingHorizontal: 16,
    alignItems: 'center',
    gap: 4,
  },
  cardEmoji: {
    fontSize: 24,
    marginBottom: 4,
  },
  cardLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: 'rgba(255, 255, 255, 0.4)',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  cardValue: {
    fontSize: 28,
    fontWeight: '900',
    color: '#fff',
  },

  // Player status card
  playerCard: {
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    borderRadius: 16,
    paddingVertical: 16,
    paddingHorizontal: 18,
    marginBottom: 28,
  },
  playerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
  },
  playerRowIcon: {
    fontSize: 18,
    width: 28,
    textAlign: 'center',
  },
  playerRowLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: 'rgba(255, 255, 255, 0.5)',
    width: 64,
  },
  playerRowValue: {
    fontSize: 18,
    fontWeight: '800',
    color: '#fff',
    marginLeft: 'auto' as any,
  },
  playerRowHighlight: {
    fontSize: 16,
    fontWeight: '800',
    color: ACCENT,
    marginLeft: 'auto' as any,
  },
  divider: {
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    marginHorizontal: -18,
  },

  // Health bar
  healthBarBg: {
    flex: 1,
    height: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 5,
    overflow: 'hidden',
  },
  healthFill: {
    height: '100%',
    borderRadius: 5,
  },

  // Scene badge
  sceneBadge: {
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    borderRadius: 16,
    paddingVertical: 18,
    paddingHorizontal: 20,
    alignItems: 'center',
    gap: 6,
  },
  sceneBadgeLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: 'rgba(255, 255, 255, 0.4)',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  sceneBadgeValue: {
    fontSize: 18,
    fontWeight: '800',
    color: ACCENT,
  },
});
