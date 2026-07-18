/**
 * HealthFill.tsx — shared zero-render health bar fill.
 *
 * Reads state$.player.health inside <Memo>, so the width/color update at 60Hz
 * without any React re-render. Used by GameHUD and StatsScreen — keep the
 * color thresholds here so both bars always agree.
 */

import React from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { Memo } from '@legendapp/state/react';
import { state$ } from 'react-native-nitro-godot';

export function HealthFill({ style }: { style?: StyleProp<ViewStyle> }) {
  return (
    <Memo>
      {() => {
        const health = state$.player.health.get();
        const pct = Math.max(0, Math.min(100, health)) / 100;
        const color =
          pct > 0.6 ? '#00ff88' : pct > 0.3 ? '#fbbf24' : '#f87171';
        return (
          <View
            style={[
              { height: '100%', borderRadius: 4 },
              style,
              { width: `${pct * 100}%` as any, backgroundColor: color },
            ]}
          />
        );
      }}
    </Memo>
  );
}
