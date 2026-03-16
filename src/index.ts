/**
 * react-native-nitro-godot — Public API
 *
 * Architecture Epics:
 *   1. Lock-Free SPSC Queue & Smart Polling
 *   2. OS Graphics Context Lifecycle
 *   3. Asynchronous Bootstrap Pattern
 *   4. Zero-Latency 3D→2D Projection
 *   5. CQRS State Sync via Legend-State v3
 */

// ── Core ──────────────────────────────────────────────────────────────────
export { GodotView } from './GodotView';
export type { GodotViewProps, SurfaceCreatedEvent, SurfaceChangedEvent, TouchEvent } from './GodotView';

export { useGodotEngine } from './useGodotEngine';
export type { UseGodotEngineResult, EngineState } from './useGodotEngine';

export { createGodotEngine } from './GodotEngine';
export type { GodotEngineWrapper, MessageHandler } from './GodotEngine';

// ── Nitro Spec (for advanced use / direct JSI access) ─────────────────
export type { GodotEngine } from './GodotEngine.nitro';

// ── Epic 5: CQRS State Sync ──────────────────────────────────────────────
export { state$, ingestStateSync } from './godotState';
export { dispatchGameIntent } from './dispatchGameIntent';
export type { GameIntent } from './dispatchGameIntent';

// ── Epic 5: Zero-Render Components ───────────────────────────────────────
export { HealthBar } from './components/HealthBar';
export { NitroSwarmHUD, unproject3DToScreen } from './components/NitroSwarmHUD';
export type { NitroSwarmHUDProps } from './components/NitroSwarmHUD';
