/**
 * dispatchGameIntent.ts — Command Dispatcher (CQRS, Epic 5)
 *
 * Commands flow: JS → C++ → GDScript (one-way)
 *
 * CRUCIAL RULE: This function must NOT mutate the state$ observable directly.
 * React Native is a "Dumb Client" — it sends intents and waits for Godot
 * (the authoritative server) to respond with STATE_SYNC events.
 *
 * @requires GodotEngineWrapper from GodotEngine.ts
 */

import type { GodotEngineWrapper } from './GodotEngine';

export interface GameIntent {
  /** The action identifier, e.g. "EQUIP_SWORD", "FIRE_WEAPON", "JUMP" */
  action: string;
  /** Optional payload data */
  [key: string]: any;
}

/**
 * Dispatches a game intent to Godot via the C++ bridge.
 *
 * The intent is serialized to JSON and sent through sendMessage().
 * Godot's RNBridge.gd will receive it in on_react_native_message().
 *
 * @example
 * ```ts
 * dispatchGameIntent(engine, { action: 'EQUIP_SWORD' });
 * dispatchGameIntent(engine, { action: 'MOVE', direction: 'north', speed: 5.0 });
 * ```
 *
 * @param engine  The GodotEngine wrapper instance
 * @param intent  The game intent to dispatch
 */
export function dispatchGameIntent(
  engine: GodotEngineWrapper,
  intent: GameIntent,
): void {
  // Serialize and send — do NOT mutate state$ here.
  // Godot will process this and push a STATE_SYNC event back.
  engine.sendMessage(JSON.stringify(intent));
}
