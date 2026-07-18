# NitroSwarm E2E Tests

End-to-end flows for the dungeon-dash example app, written for
[Maestro](https://maestro.mobile.dev) (works on iOS simulators and Android
emulators/devices with no app instrumentation).

## Prerequisites

1. Install Maestro: `curl -Ls https://get.maestro.mobile.dev | bash`
2. Build and install a **dev build** of the app on a running simulator/emulator
   (the flows assert on the `engine: running` debug footer, which is `__DEV__`-only):

   ```sh
   npm run ios       # or: npm run android
   ```

   The Godot engine libraries must be present (see `engine_build/README.md`);
   the app id is `net.libgodot.nitroswarm`.

## Running

```sh
npm run e2e            # all flows, in order
maestro test e2e/02_tab_navigation.yaml   # a single flow
```

## Flows

| Flow | Verifies |
|------|----------|
| `01_smoke_launch` | PCK extraction completes; shell renders; engine reaches `running`. |
| `02_tab_navigation` | All three tabs render; the engine **survives a tab round-trip** (regression: unmounting GodotView used to permanently blacken the view). |
| `03_settings_dispatch` | Settings steppers update and dispatch CQRS intents to the live engine; settings state persists across tabs. |
| `04_lifecycle_suspend_resume` | Background/foreground suspends and resumes the engine cleanly. |

## Notes

- Flows are intentionally text-assertion based (tab labels, stat headers,
  stepper values, the debug footer) so they don't depend on screenshots of the
  Godot GL surface, which varies per device/GPU.
- If a flow fails at `engine: running`, check `adb logcat -s NitroGodot`
  (Android) or the Xcode console for `ENGINE_ERROR` lines — the app surfaces
  engine errors through the same message stream the tests rely on.
