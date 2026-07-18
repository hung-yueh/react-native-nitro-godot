# ⚡ NitroSwarm

A twin-stick arena shooter built with **react-native-nitro-godot** — demonstrating why you'd embed Godot inside React Native instead of building a standalone Godot app.

## Why This Example Exists

The key insight: **React Native builds the app, Godot renders the game.**

- **Stats screen** — Rich scrollable UI, charts, data display → trivial in RN, painful in Godot
- **Settings screen** — Sliders, toggles, segmented controls → RN does this natively
- **Tab navigation** — Standard app shell pattern → impossible in Godot
- **Zero-render HUD** — Legend-State `<Memo>` updates at 60Hz with 0 React re-renders
- **3D→2D health bars** — `unprojectPosition()` JSI call anchors RN views to 3D world positions
- **CQRS dispatch** — Settings changes flow from RN → C++ SPSC → GDScript instantly

## What Each Tab Demonstrates

| Tab | Library Feature | Why React Native Wins |
|-----|----------------|----------------------|
| 🎮 **Play** | `<GodotView>`, `useGodotEngine`, `NitroSwarmHUD` | Godot renders 3D; RN overlays HUD, joysticks, health bars |
| 📊 **Stats** | `state$` (Legend-State observables) | ScrollView with live game data — 5 lines of RN vs. hundreds in Godot Control nodes |
| ⚙️ **Settings** | `dispatchGameIntent()` | RN sliders → CQRS command → Godot applies change instantly |

## Quick Start

```bash
cd examples/dungeon-dash
npm install

# Build the .pck (requires Godot 4.7 with libgodot)
npm run export-pck

# Run on device
npx expo run:ios      # or: npx expo run:android
```

## Architecture

```
┌──────────────────────────────────────────────┐
│  React Native (App Shell)                    │
│                                              │
│  ┌─ Tab: Play ─────────────────────────────┐ │
│  │  <GodotView>        3D rendering        │ │
│  │  <GameHUD>          Zero-render (Memo)   │ │
│  │  <NitroSwarmHUD>    Twin-stick joysticks │ │
│  │  <EnemyHealthBars>  3D→2D projection    │ │
│  │  <ActionBar>        CQRS dispatch       │ │
│  │  <RenderCounter>    Proves 0 re-renders │ │
│  └──────────────────────────────────────────┘ │
│  ┌─ Tab: Stats ────────────────────────────┐ │
│  │  Pure React Native — reads state$       │ │
│  └──────────────────────────────────────────┘ │
│  ┌─ Tab: Settings ─────────────────────────┐ │
│  │  RN controls → dispatchGameIntent()     │ │
│  └──────────────────────────────────────────┘ │
├──────────────────────────────────────────────┤
│  Godot (headless, background thread)         │
│                                              │
│  NitroSwarm.tscn                             │
│    ├─ Player (twin-stick CharacterBody3D)    │
│    ├─ Enemy × N (patrol/chase AI, waves)     │
│    ├─ Collectibles (weapons, potions)        │
│    ├─ Portal → async floor transition        │
│    └─ RNBridge (SPSC ↔ state sync @ 60Hz)    │
└──────────────────────────────────────────────┘
```

## Game Controls

- **Left joystick** → Move
- **Right joystick** → Aim (auto-attacks when active)
- **⚔️ Attack** → Melee swing
- **🧪 Potion** → Restore HP
- **🔧 Equip** → Cycle weapons
- **📦 Buffer** → Test zero-copy ArrayBuffer pipeline

## Project Structure

```
examples/dungeon-dash/
├── App.tsx                          # Root app with tab navigation
├── components/
│   ├── GameHUD.tsx                  # Zero-render HUD (Legend-State <Memo>)
│   ├── EnemyHealthBars.tsx          # 3D→2D projected health bars
│   ├── ActionBar.tsx                # CQRS intent dispatch buttons
│   ├── FloatingLabel.tsx            # 3D→2D projected label
│   ├── LoadingScreen.tsx            # Async floor loading overlay
│   └── RenderCounter.tsx            # Visual proof of zero re-renders
├── screens/
│   ├── StatsScreen.tsx              # Pure RN stats dashboard
│   └── SettingsScreen.tsx           # Settings → CQRS → Godot
├── godot-project/
│   ├── project.godot
│   ├── scripts/
│   │   ├── RNBridge.gd              # Bridge singleton (AutoLoad)
│   │   ├── Player.gd                # Twin-stick player controller
│   │   ├── Enemy.gd                 # Patrol/chase AI
│   │   ├── GameManager.gd           # Wave spawner + scoring
│   │   ├── Collectible.gd           # Item pickups
│   │   └── Portal.gd               # Floor transition
│   └── scenes/
│       ├── NitroSwarm.tscn          # Main arena
│       └── DungeonFloor2.tscn       # Async-loaded floor 2
├── package.json
├── app.json
├── metro.config.js
└── index.js
```
