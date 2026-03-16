# ⚔️ Dungeon Dash

A touch-controlled 3D dungeon crawler built with **react-native-nitro-godot**. This example exercises every epic and API surface of the library.

## What It Tests

| Epic | Feature | How Tested |
|------|---------|------------|
| **1** | Lock-free SPSC messaging | ActionBar → `dispatchGameIntent()` → Godot processes → `STATE_SYNC` back |
| **2** | OS lifecycle | Background app → `suspendOS()` + ghost touch release → resume |
| **3** | Async scene loading | Portal → `loadSceneAsync()` → `LoadingScreen` with progress bar |
| **4** | 3D→2D projection | `FloatingLabel` tracks a world-space position via `unprojectPosition()` |
| **5** | CQRS state sync | `GameHUD` updates at 60Hz via Legend-State `<Memo>` — 0 re-renders |
| — | Touch forwarding | Tap on `GodotView` → `sendTouchEvent` → player walks to tap position |
| — | Zero-copy buffers | "Buffer" button → `createNativeArrayBuffer(1MB)` → `updateSharedBuffer()` |

## Setup

### 1. Build the Godot Project

```bash
# Open the project in Godot 4.6 (master branch with libgodot C-API)
# File path: examples/dungeon-dash/godot-project/

# From the Godot editor:
# 1. Project → Export → Add Preset (any platform)
# 2. Export PCK/ZIP → save as: examples/dungeon-dash/assets/game.pck
```

### 2. Enable the PCK in App.tsx

Uncomment this line in `App.tsx`:

```tsx
const { pckPath, extracting, error } = usePckExtract(require('./assets/game.pck'));
```

### 3. Install & Run

```bash
cd examples/dungeon-dash
npm install
npx expo run:ios      # or: npx expo run:android
```

## Architecture

```
┌────────────────────────────────────┐
│  React Native                      │
│                                    │
│   App.tsx                          │
│     ├─ useGodotEngine(pckPath)     │
│     ├─ <GodotView>   (touch fwd)  │
│     ├─ <GameHUD>     (zero-render) │
│     ├─ <ActionBar>   (CQRS)       │
│     ├─ <FloatingLabel>(3D→2D)     │
│     └─ <LoadingScreen>(async)     │
├────────────────────────────────────┤
│  Godot (headless, background thread)│
│                                    │
│   Main.tscn                        │
│     ├─ Player (CharacterBody3D)    │
│     ├─ Enemy × 3 (patrol/chase)   │
│     ├─ Sword + Potion (pickups)   │
│     └─ Portal → DungeonFloor2     │
└────────────────────────────────────┘
```

## Game Controls

- **Tap on the Godot view** → Player walks to that position
- **⚔️ Attack** → Melee swing (damages nearby enemies)
- **🧪 Potion** → Restore 30 HP
- **🔧 Equip** → Cycle through collected weapons
- **📦 Buffer** → Tests the zero-copy ArrayBuffer pipeline

## Project Structure

```
examples/dungeon-dash/
├── App.tsx                      # Main game screen
├── components/
│   ├── GameHUD.tsx              # Zero-render HUD (Epic 5)
│   ├── FloatingLabel.tsx        # 3D→2D projection (Epic 4)
│   ├── LoadingScreen.tsx        # Async loading overlay (Epic 3)
│   └── ActionBar.tsx            # CQRS intent dispatch (Epic 5)
├── godot-project/
│   ├── project.godot            # Godot project config
│   ├── scripts/
│   │   ├── RNBridge.gd          # Bridge singleton (AutoLoad)
│   │   ├── Player.gd            # Player controller
│   │   ├── Enemy.gd             # Enemy AI
│   │   ├── Collectible.gd       # Item pickups
│   │   └── Portal.gd            # Floor transition
│   └── scenes/
│       ├── Main.tscn            # Floor 1 (L-shaped dungeon)
│       └── DungeonFloor2.tscn   # Floor 2 (async loaded)
├── package.json
├── app.json
├── metro.config.js
├── tsconfig.json
└── index.js
```
