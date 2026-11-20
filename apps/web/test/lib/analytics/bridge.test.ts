/**
 * GAP-31 (DR-13) — SimulationEvent → analytics bridge tests.
 *
 * The bridge is a pure mapper (mirrors `simulationEventToNotifications`).
 * Covers: high-signal events map (tree-died, weather-damage, objective-achieved,
 * season-changed); routine events return [] (tick, weather-changed, routine
 * notifications like save.ok).
 */
import { describe, it, expect } from 'vitest';
import { mapSimulationEventToAnalytics } from '../../../lib/analytics/bridge';
import type { SimulationEvent } from '@capitalist-tree/shared';

describe('mapSimulationEventToAnalytics', () => {
  it('maps tree-died → gameplay event with the cause', () => {
    const ev: SimulationEvent = {
      type: 'tree-died',
      at: 100,
      payload: { treeId: 'original', cause: 'reserves-exhausted' },
    };
    const out = mapSimulationEventToAnalytics(ev);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({
      event: 'tree-died',
      category: 'gameplay',
      data: { treeId: 'original', cause: 'reserves-exhausted' },
    });
  });

  it('maps weather-damage → simulation event with type/intensity/severity', () => {
    const ev: SimulationEvent = {
      type: 'weather-damage',
      at: 200,
      payload: {
        condition: { kind: 'storm', label: 'Storm' } as never,
        intensity: 0.8,
        damageType: 'storm',
        severity: 0.6,
        treeIds: ['original'],
      },
    };
    const out = mapSimulationEventToAnalytics(ev);
    expect(out).toHaveLength(1);
    expect(out[0]?.event).toBe('weather-damage');
    expect(out[0]?.category).toBe('simulation');
    expect(out[0]?.data).toMatchObject({ damageType: 'storm', severity: 0.6 });
  });

  it('maps an objective-achieved notification → objective-completed gameplay event', () => {
    const ev: SimulationEvent = {
      type: 'notification',
      at: 300,
      payload: {
        severity: 'info',
        code: 'objective-achieved',
        message: 'Last Tree reached.',
      },
    };
    const out = mapSimulationEventToAnalytics(ev);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({
      event: 'objective-completed',
      category: 'gameplay',
      data: { message: 'Last Tree reached.' },
    });
  });

  it('skips routine notifications (save.ok, load.ok, expense-due)', () => {
    for (const code of ['save.ok', 'load.ok', 'expense-due', 'low-funds']) {
      const ev: SimulationEvent = {
        type: 'notification',
        at: 1,
        payload: { severity: 'info', code, message: 'routine' },
      };
      expect(mapSimulationEventToAnalytics(ev)).toEqual([]);
    }
  });

  it('maps season-changed → simulation event', () => {
    const ev: SimulationEvent = {
      type: 'season-changed',
      at: 400,
      payload: { from: 'summer', to: 'autumn', day: 1 },
    };
    const out = mapSimulationEventToAnalytics(ev);
    expect(out).toHaveLength(1);
    expect(out[0]?.event).toBe('season-changed');
    expect(out[0]?.category).toBe('simulation');
  });

  it('skips routine events (tick, weather-changed, scheduled-event, system)', () => {
    // Payload shapes vary per variant; the bridge returns [] for these types
    // regardless of payload, so cast through unknown to avoid matching every
    // variant's exact schema in this fixture.
    const routine = [
      { type: 'tick', at: 1, payload: { step: 1, day: 1, timeOfDay: 0 } },
      {
        type: 'weather-changed',
        at: 2,
        payload: { from: 'clear', to: 'weather:cloudy' },
      },
      {
        type: 'scheduled-event',
        at: 3,
        payload: { kind: 'storm' },
      },
      {
        type: 'system',
        at: 4,
        payload: { systemId: 'BiologySystem', message: 'ok' },
      },
    ] as unknown as SimulationEvent[];
    for (const ev of routine) {
      expect(mapSimulationEventToAnalytics(ev)).toEqual([]);
    }
  });
});
