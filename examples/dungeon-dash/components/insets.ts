/**
 * insets.ts — shared safe-area constants for the demo.
 *
 * Approx. top safe-area inset (status bar / notch / Dynamic Island). For exact
 * per-device values, wrap the app in react-native-safe-area-context and use
 * useSafeAreaInsets(); this constant keeps the demo dependency-free.
 *
 * Single source of truth — do not copy this Platform.select into components.
 */

import { Platform, StatusBar } from 'react-native';

export const TOP_INSET = Platform.select({
  ios: 59,
  android: StatusBar.currentHeight ?? 24,
  default: 24,
})!;
