import { describe, it, expect } from 'vitest';
import { schedule, due, cancel } from '../src/events/scheduler.js';
import { engine } from '../src/index.js';
import { DEFAULT_GAME_CONFIG } from '../src/initial-state.js';
import type { GameState, ScheduledEvent } from '@capitalist-tree/shared';

function freshState(): GameState {
  return engine.initialize({ ...DEFAULT_GAME_CONFIG, seed: 1 });
}

function ev(id: string, at: number): ScheduledEvent {
  return { id, at, kind: 'custom', payload: { id } };
}

describe('EventScheduler', () => {
  it('due(now) returns events in time order', () => {
    let s = freshState();
    s = schedule(s, ev('b', 200));
    s = schedule(s, ev('a', 100));
    s = schedule(s, ev('c', 300));
    const { fired } = due(s, 250);
    expect(fired.map((e) => e.id)).toEqual(['a', 'b']);
  });

  it('due(now) removes fired events from the queue', () => {
    let s = freshState();
    s = schedule(s, ev('a', 100));
    s = schedule(s, ev('b', 200));
    const { fired, state } = due(s, 150);
    expect(fired.map((e) => e.id)).toEqual(['a']);
    expect(state.scheduler.events.map((e) => e.id)).toEqual(['b']);
  });

  it('cancel removes a specific event', () => {
    let s = freshState();
    s = schedule(s, ev('a', 100));
    s = schedule(s, ev('b', 200));
    s = cancel(s, 'a');
    expect(s.scheduler.events.map((e) => e.id)).toEqual(['b']);
  });

  it('engine.advance emits scheduled-event SimulationEvents for due events', () => {
    let s = freshState();
    // Schedule an event 1 step in the future (60 sim seconds).
    const at = s.clock.elapsedSeconds + 60;
    s = schedule(s, ev('e1', at));
    // Advance 1 step.
    const r = engine.advance(s, 60);
    const fired = r.events.filter((e) => e.type === 'scheduled-event');
    expect(fired.length).toBe(1);
    if (fired[0] && fired[0].type === 'scheduled-event') {
      expect(fired[0].payload.eventId).toBe('e1');
      expect(fired[0].payload.kind).toBe('custom');
    }
    // Event should be removed from the scheduler in the returned state.
    expect(r.state.scheduler.events).toEqual([]);
  });

  it('does not fire events scheduled for the future', () => {
    let s = freshState();
    const at = s.clock.elapsedSeconds + 600; // 10 steps ahead
    s = schedule(s, ev('future', at));
    const r = engine.advance(s, 60);
    const fired = r.events.filter((e) => e.type === 'scheduled-event');
    expect(fired.length).toBe(0);
    expect(r.state.scheduler.events.length).toBe(1);
  });
});
