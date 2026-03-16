/**
 * godotState.ts — CQRS Observable State Store (Epic 5)
 *
 * Rule: Godot is the Authoritative Server; React Native is the Reactive Client.
 *
 * This store uses Legend-State v3 fine-grained observables to receive
 * high-frequency state updates from Godot without triggering React re-renders.
 *
 * Usage:
 *   - Import state$ and read via Legend-State's <Memo> or Reactive components.
 *   - NEVER call state$.get() in a component body — this triggers standard
 *     React render cascades and defeats the purpose of fine-grained reactivity.
 *   - State mutations happen ONLY in the SPSC drain loop when Godot pushes
 *     STATE_SYNC events. JS never mutates state$ optimistically.
 *
 * @requires @legendapp/state (v3+) as a peer dependency in the consumer app.
 */

import { observable } from '@legendapp/state';

/**
 * The global reactive state graph mirroring Godot's authoritative game state.
 *
 * Extend this shape to match your game's data model.
 * All fields will be automatically reactive via Legend-State's proxy system.
 */
export const state$ = observable({
  /** Player state — updated by Godot physics/game logic */
  player: {
    health: 100,
    weapon: 'none' as string,
    ammo: 0,
    position: { x: 0, y: 0, z: 0 },
  },

  /** Loading state — driven by Epic 3 async bootstrap events */
  loading: {
    progress: 0,
    complete: false,
    currentScene: '' as string,
  },

  /** Camera projection state — driven by Epic 4 unprojectPosition() */
  camera: {
    screenX: 0,
    screenY: 0,
  },

  /** Game state — NitroSwarm arena HUD bindings */
  game: {
    score: 0,
    combo: 0,
    waveNumber: 1,
    enemyCount: 0,
  },

  /**
   * Live enemy positions for Reanimated floating health bars (Epic 4).
   * Keys are Godot node names (e.g. "Enemy", "Enemy2").
   * Values are pushed by RNBridge.sync_full_state() at 60Hz.
   */
  enemies: {} as Record<string, { x: number; y: number; z: number; health: number }>,
});

/**
 * Ingests a STATE_SYNC event from Godot into the observable store.
 * Called from the SPSC drain loop — runs on the JS thread at message arrival rate.
 *
 * @param data  Partial state object from Godot, e.g. { player: { health: 80 } }
 */
export function ingestStateSync(data: Record<string, any>): void {
  // Merge each top-level key into the observable.
  // Legend-State's .set() performs a deep merge, so partial updates are fine.
  for (const [key, value] of Object.entries(data)) {
    const node = (state$ as any)[key];
    if (node && typeof node.set === 'function') {
      node.set(value);
    }
  }
}
