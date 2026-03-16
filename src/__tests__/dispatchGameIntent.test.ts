/**
 * dispatchGameIntent.test.ts — Tests for CQRS command dispatch
 *
 * Verifies that game intents are correctly serialized and sent
 * to Godot via the engine's sendMessage() method.
 *
 * CRUCIAL: dispatchGameIntent must NEVER mutate state$ directly.
 * It's a one-way command: JS → C++ → GDScript.
 */

import { dispatchGameIntent, type GameIntent } from '../dispatchGameIntent';
import type { GodotEngineWrapper } from '../GodotEngine';

function createMockWrapper(): GodotEngineWrapper & { _sentMessages: string[] } {
  const sent: string[] = [];
  return {
    _sentMessages: sent,
    raw: {} as any,
    onMessage: jest.fn(() => () => {}),
    startPolling: jest.fn(),
    stopPolling: jest.fn(),
    sendMessage: jest.fn((msg: string) => sent.push(msg)),
    loadSceneAsync: jest.fn(),
    unprojectPosition: jest.fn(() => undefined),
    suspendOS: jest.fn(),
    resumeOS: jest.fn(),
    notifyPollingStopped: jest.fn(),
    destroy: jest.fn(),
  };
}

describe('dispatchGameIntent', () => {
  test('serializes a simple intent to JSON', () => {
    const wrapper = createMockWrapper();
    dispatchGameIntent(wrapper, { action: 'JUMP' });

    expect(wrapper.sendMessage).toHaveBeenCalledTimes(1);
    const sent = JSON.parse(wrapper._sentMessages[0]!);
    expect(sent.action).toBe('JUMP');
  });

  test('preserves all payload fields', () => {
    const wrapper = createMockWrapper();
    const intent: GameIntent = {
      action: 'MOVE',
      direction: 'north',
      speed: 5.0,
      multiplier: 1.5,
    };
    dispatchGameIntent(wrapper, intent);

    const sent = JSON.parse(wrapper._sentMessages[0]!);
    expect(sent.action).toBe('MOVE');
    expect(sent.direction).toBe('north');
    expect(sent.speed).toBe(5.0);
    expect(sent.multiplier).toBe(1.5);
  });

  test('sends via engine.sendMessage', () => {
    const wrapper = createMockWrapper();
    dispatchGameIntent(wrapper, { action: 'ATTACK' });

    expect(wrapper.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('"action":"ATTACK"')
    );
  });

  test('handles intents with nested objects', () => {
    const wrapper = createMockWrapper();
    dispatchGameIntent(wrapper, {
      action: 'EQUIP',
      item: { name: 'sword', damage: 25 },
    } as any);

    const sent = JSON.parse(wrapper._sentMessages[0]!);
    expect(sent.item.name).toBe('sword');
    expect(sent.item.damage).toBe(25);
  });
});
