/**
 * Tests for the SimulationEvent → UiNotification bridge (W31 / RV6-2).
 *
 * `apps/web/lib/format/event-to-notification.ts` maps non-`notification`
 * SimulationEvents into `pushNotification` payloads. The NotificationsPanel
 * filters to `ACTIONABLE_NOTIFICATION_CODES`, so every code this mapper emits
 * MUST be in that set (otherwise the notification is stored in the bounded
 * buffer but never rendered, evicting actionable alerts).
 *
 * Pre-W31 the bridge emitted `weather-severe` / `season-changed` /
 * `scheduled-event-fired` / `system-${id}` — none actionable — so 5 of 6
 * actionable codes were effectively never produced. These tests pin the W31
 * fix: each actionable code is produced by the event that should map to it,
 * + the W31 invariant (every emitted code is in the whitelist) is asserted.
 */
import { describe, it, expect } from 'vitest';
import type { SimulationEvent } from '@capitalist-tree/shared';
import {
  simulationEventToNotifications,
  simulationEventsToNotifications,
} from '../../../lib/format/event-to-notification';
import { ACTIONABLE_NOTIFICATION_CODES } from '../../../components/dashboard/NotificationsPanel';

describe('simulationEventToNotifications (W31 — bridge end-to-end)', () => {
  it('tree-died → critical tree-died notification', () => {
    const out = simulationEventToNotifications({
      type: 'tree-died',
      at: 100,
      payload: { treeId: 't1', cause: 'reserves-exhausted', detail: 'reserves hit 0' },
    } as SimulationEvent);
    expect(out).toHaveLength(1);
    expect(out[0]!.code).toBe('tree-died');
    expect(out[0]!.severity).toBe('critical');
    expect(out[0]!.at).toBe(100);
    expect(String(out[0]!.message)).toMatch(/died/i);
  });

  it('expense-due UNPAID → warning expense-due notification', () => {
    const out = simulationEventToNotifications({
      type: 'expense-due',
      at: 200,
      payload: {
        category: 'food',
        amount: '500',
        paid: false,
        source: 'auto-bill',
        playerBalanceAfter: '0',
        unpaidDaysAfter: 3,
      },
    } as SimulationEvent);
    expect(out).toHaveLength(1);
    expect(out[0]!.code).toBe('expense-due');
    expect(out[0]!.severity).toBe('warning');
    expect(String(out[0]!.message)).toMatch(/unpaid/i);
  });

  it('expense-due PAID → not surfaced (returns [])', () => {
    const out = simulationEventToNotifications({
      type: 'expense-due',
      at: 200,
      payload: {
        category: 'food',
        amount: '500',
        paid: true,
        source: 'auto-bill',
        playerBalanceAfter: '45000',
        unpaidDaysAfter: 0,
        transactionId: 'tx1',
      },
    } as SimulationEvent);
    expect(out).toEqual([]);
  });

  it('issuance-rejected → warning issuance-rejected notification (uses the event message)', () => {
    const out = simulationEventToNotifications({
      type: 'issuance-rejected',
      at: 300,
      payload: {
        requestId: 'r1',
        treeId: 't1',
        amount: '1000',
        currencyId: 'c1',
        source: 'harvest-leaves',
        reason: 'per-request-limit-exceeded',
        message: 'Issuance refused: per-request limit exceeded.',
      },
    } as SimulationEvent);
    expect(out).toHaveLength(1);
    expect(out[0]!.code).toBe('issuance-rejected');
    expect(out[0]!.severity).toBe('warning');
    expect(out[0]!.message).toBe('Issuance refused: per-request limit exceeded.');
  });

  it('weather-damage → warning storm-damage notification', () => {
    const out = simulationEventToNotifications({
      type: 'weather-damage',
      at: 400,
      payload: { condition: 'frost', intensity: 0.8, damageType: 'frost', severity: 0.6, treeIds: ['t1'] },
    } as SimulationEvent);
    expect(out).toHaveLength(1);
    expect(out[0]!.code).toBe('storm-damage');
    expect(out[0]!.severity).toBe('warning');
    expect(String(out[0]!.message)).toMatch(/frost/i);
  });

  it('weather-changed severe → warning severe-weather notification', () => {
    const out = simulationEventToNotifications({
      type: 'weather-changed',
      at: 500,
      payload: { from: 'sunny', to: 'frost' },
    } as SimulationEvent);
    expect(out).toHaveLength(1);
    expect(out[0]!.code).toBe('severe-weather');
    expect(out[0]!.severity).toBe('warning');
  });

  it('weather-changed routine → not surfaced', () => {
    const out = simulationEventToNotifications({
      type: 'weather-changed',
      at: 500,
      payload: { from: 'sunny', to: 'cloudy' },
    } as SimulationEvent);
    expect(out).toEqual([]);
  });

  it('scheduled-event severe → warning severe-weather notification', () => {
    const out = simulationEventToNotifications({
      type: 'scheduled-event',
      at: 600,
      payload: { eventId: 'e1', kind: 'drought', data: null },
    } as SimulationEvent);
    expect(out).toHaveLength(1);
    expect(out[0]!.code).toBe('severe-weather');
  });

  it('scheduled-event routine → not surfaced', () => {
    const out = simulationEventToNotifications({
      type: 'scheduled-event',
      at: 600,
      payload: { eventId: 'e1', kind: 'routine-flavor', data: null },
    } as SimulationEvent);
    expect(out).toEqual([]);
  });

  it('notification event passes through with its own code', () => {
    const out = simulationEventToNotifications({
      type: 'notification',
      at: 700,
      payload: { severity: 'critical', code: 'save-corrupt', message: 'Save file is corrupt.' },
    } as SimulationEvent);
    expect(out).toHaveLength(1);
    expect(out[0]!.code).toBe('save-corrupt');
    expect(out[0]!.severity).toBe('critical');
    expect(out[0]!.message).toBe('Save file is corrupt.');
  });

  it('season-changed / system / tick are NOT surfaced (non-actionable, dropped)', () => {
    expect(
      simulationEventToNotifications({ type: 'season-changed', at: 1, payload: { from: 'spring', to: 'summer' } } as SimulationEvent),
    ).toEqual([]);
    expect(
      simulationEventToNotifications({ type: 'system', at: 1, payload: { systemId: 'economy', message: 'market shortage' } } as SimulationEvent),
    ).toEqual([]);
    expect(simulationEventToNotifications({ type: 'tick', at: 1, payload: {} } as SimulationEvent)).toEqual([]);
  });

  // The W31 invariant: every code the mapper produces (for non-`notification`
  // events) is in ACTIONABLE_NOTIFICATION_CODES, so the panel renders it.
  // Pre-W31 this failed for ALL bridge output (weather-severe, season-changed,
  // scheduled-event-fired, system-* were none of them actionable).
  it('every produced code is actionable (the panel will render it)', () => {
    const cases: SimulationEvent[] = [
      { type: 'tree-died', at: 1, payload: { treeId: 't', cause: 'stress' } },
      {
        type: 'expense-due',
        at: 1,
        payload: { category: 'food', amount: '1', paid: false, source: 'auto-bill', playerBalanceAfter: '0', unpaidDaysAfter: 1 },
      },
      {
        type: 'issuance-rejected',
        at: 1,
        payload: { requestId: 'r', treeId: 't', amount: '1', currencyId: 'c', source: 's', reason: 'invalid-amount', message: 'm' },
      },
      { type: 'weather-damage', at: 1, payload: { condition: 'frost', intensity: 0.5, damageType: 'frost', severity: 0.4, treeIds: ['t'] } },
      { type: 'weather-changed', at: 1, payload: { from: null, to: 'drought' } },
      { type: 'scheduled-event', at: 1, payload: { eventId: 'e', kind: 'heat-wave', data: null } },
    ];
    for (const e of cases) {
      const out = simulationEventToNotifications(e);
      expect(out.length).toBeGreaterThan(0);
      for (const n of out) {
        expect(ACTIONABLE_NOTIFICATION_CODES.has(n.code)).toBe(true);
      }
    }
  });

  it('simulationEventsToNotifications dedupes by code within the batch', () => {
    // weather-changed + scheduled-event for the same storm both map to severe-weather.
    const out = simulationEventsToNotifications([
      { type: 'weather-changed', at: 1, payload: { from: null, to: 'frost' } },
      { type: 'scheduled-event', at: 2, payload: { eventId: 'e', kind: 'frost', data: null } },
      { type: 'tree-died', at: 3, payload: { treeId: 't', cause: 'stress' } },
    ] as SimulationEvent[]);
    const codes = out.map((n) => n.code);
    // severe-weather appears once (deduped), then tree-died.
    expect(codes).toEqual(['severe-weather', 'tree-died']);
  });
});
