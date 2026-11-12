/**
 * Tests for the automation selectors (P6d1 — TDD §12, GDD §9).
 *
 * Pure unit tests — no DOM, no store. Covers:
 *   - `getAffordableEquipment` — filters by cost ≤ personalCash.
 *   - `getAutomationWithEquipment` — joins AutomationState with
 *     EquipmentDefinition via `automation.type === equipment.id`.
 *   - `formatPolicySummary` — threshold / schedule / event summaries.
 *   - `getCooldownRemaining` — cooldown math mirroring P6b2's
 *     `evaluateAutomation`.
 */
import { describe, it, expect } from 'vitest';
import { engine, DEFAULT_GAME_CONFIG } from '@capitalist-tree/simulation';
import type {
  AutomationState,
  AutomationPolicy,
  GameState,
  SimulationClock,
} from '@capitalist-tree/shared';
import { EQUIPMENT } from '@capitalist-tree/content';
import {
  formatPolicySummary,
  getAffordableEquipment,
  getAutomationWithEquipment,
  getCooldownRemaining,
} from '../../../lib/selectors/automation';

function freshState(overrides: Partial<GameState> = {}): GameState {
  return {
    ...engine.initialize({ ...DEFAULT_GAME_CONFIG, createdAt: 1_700_000_000_000 }),
    ...overrides,
  };
}

/** A minimal AutomationState fixture; `as AutomationState` suppresses
 *  exactOptionalPropertyTypes complaints about the spread of optional fields. */
function sampleAutomation(overrides: Partial<AutomationState> = {}): AutomationState {
  return {
    id: 'automation:equipment:sprinkler-t1:original:0',
    type: 'equipment:sprinkler-t1',
    enabled: true,
    targetId: 'original',
    schedule: { kind: 'interval', value: 86_400 },
    resourceConsumption: [{ resourceId: 'resource:water', amount: 1 }],
    energyConsumption: 0.5,
    maintenanceCost: '5',
    environmentalImpact: {
      carbonEmissions: 0.05,
      waterConsumption: 1.2,
      soilDegradation: 0,
      pollution: 0,
      landDisturbance: 0,
      biodiversityImpact: 0,
    },
    ...overrides,
  } as AutomationState;
}

function clockAt(elapsed: number): SimulationClock {
  return { ...freshState().clock, elapsedSeconds: elapsed };
}

// ----------------------------------------------------------------------------
// getAffordableEquipment.
// ----------------------------------------------------------------------------

describe('getAffordableEquipment (P6d1)', () => {
  it('returns no equipment when the player has no cash', () => {
    const base = freshState();
    const broke = { ...base, player: { ...base.player, personalCash: '0' } };
    expect(getAffordableEquipment(broke)).toHaveLength(0);
  });

  it('returns all equipment when the player is rich enough', () => {
    const base = freshState();
    const rich = {
      ...base,
      player: { ...base.player, personalCash: '9999999999' },
    };
    expect(getAffordableEquipment(rich)).toHaveLength(EQUIPMENT.length);
  });

  it('includes the basic sprinkler exactly at its price boundary', () => {
    const base = freshState();
    const state = {
      ...base,
      player: { ...base.player, personalCash: '2000' },
    };
    const affordable = getAffordableEquipment(state);
    expect(affordable.map((e) => e.id)).toContain('equipment:sprinkler-t1');
    // Every returned item's cost is ≤ the cash on hand.
    for (const e of affordable) {
      expect(BigInt(e.cost) <= 2000n).toBe(true);
    }
  });

  it('excludes equipment above the cash on hand', () => {
    const base = freshState();
    const state = {
      ...base,
      player: { ...base.player, personalCash: '2000' },
    };
    const affordable = getAffordableEquipment(state);
    // The tier-3 sprinkler ($300 = 30000 minor) is NOT affordable at $20.
    expect(affordable.map((e) => e.id)).not.toContain('equipment:sprinkler-t3');
  });
});

// ----------------------------------------------------------------------------
// getAutomationWithEquipment.
// ----------------------------------------------------------------------------

describe('getAutomationWithEquipment (P6d1)', () => {
  it('returns an empty list when no automations are purchased', () => {
    expect(getAutomationWithEquipment(freshState())).toEqual([]);
  });

  it('joins each automation with its equipment via type === equipment.id', () => {
    const base = freshState();
    const state = {
      ...base,
      automation: [sampleAutomation()],
    };
    const joined = getAutomationWithEquipment(state);
    expect(joined).toHaveLength(1);
    expect(joined[0]!.automation.id).toBe('automation:equipment:sprinkler-t1:original:0');
    expect(joined[0]!.equipment?.id).toBe('equipment:sprinkler-t1');
    expect(joined[0]!.equipment?.name).toBe('Basic Sprinkler');
  });

  it('returns undefined equipment for an automation whose type is unknown', () => {
    const base = freshState();
    const state = {
      ...base,
      automation: [sampleAutomation({ type: 'equipment:does-not-exist' })],
    };
    const joined = getAutomationWithEquipment(state);
    expect(joined).toHaveLength(1);
    expect(joined[0]!.equipment).toBeUndefined();
  });
});

// ----------------------------------------------------------------------------
// formatPolicySummary.
// ----------------------------------------------------------------------------

describe('formatPolicySummary (P6d1)', () => {
  const thresholdPolicy: AutomationPolicy = {
    kind: 'threshold',
    condition: {
      field: 'world.environment.soil.soilWater',
      op: '<',
      value: 0.3,
    },
    action: 'apply-water',
    actionParams: { litres: 5 },
  };

  it('summarises a threshold policy with a percentage value + field label', () => {
    const summary = formatPolicySummary(thresholdPolicy);
    expect(summary).toMatch(/Water/);
    expect(summary).toMatch(/soil/);
    expect(summary).toMatch(/</);
    expect(summary).toMatch(/30%/);
  });

  it('summarises a threshold policy with a raw integer value', () => {
    const summary = formatPolicySummary({
      kind: 'threshold',
      condition: { field: 'originalTree.foliage.currentLeaves', op: '>=', value: 100 },
      action: 'harvest-leaves',
      actionParams: {},
    });
    expect(summary).toMatch(/Harvest/);
    expect(summary).toMatch(/current leaves/);
    expect(summary).toMatch(/>=/);
    expect(summary).toMatch(/100$/);
    expect(summary).not.toMatch(/%/);
  });

  it('summarises a schedule interval policy in sim days', () => {
    const summary = formatPolicySummary({
      kind: 'schedule',
      condition: { kind: 'interval', value: 86_400 },
      action: 'apply-water',
      actionParams: {},
    });
    expect(summary).toBe('Every 1 sim day');
  });

  it('summarises a schedule interval policy in sim hours when under a day', () => {
    const summary = formatPolicySummary({
      kind: 'schedule',
      condition: { kind: 'interval', value: 3600 },
      action: 'apply-water',
      actionParams: {},
    });
    expect(summary).toBe('Every 1 sim hour');
  });

  it('pluralises the unit for multi-day intervals', () => {
    const summary = formatPolicySummary({
      kind: 'schedule',
      condition: { kind: 'interval', value: 86_400 * 3 },
      action: 'apply-water',
      actionParams: {},
    });
    expect(summary).toBe('Every 3 sim days');
  });

  it('summarises a schedule "at" policy as a one-shot sim-time trigger', () => {
    const summary = formatPolicySummary({
      kind: 'schedule',
      condition: { kind: 'at', value: 12_345 },
      action: 'apply-water',
      actionParams: {},
    });
    expect(summary).toMatch(/Once at sim t=12345s/);
  });

  it('summarises an event policy with its eventType', () => {
    const summary = formatPolicySummary({
      kind: 'event',
      condition: { eventType: 'weather-damage' },
      action: 'apply-water',
      actionParams: {},
    });
    expect(summary).toBe('On weather-damage');
  });
});

// ----------------------------------------------------------------------------
// getCooldownRemaining.
// ----------------------------------------------------------------------------

describe('getCooldownRemaining (P6d1)', () => {
  it('returns the full cooldown when the automation has never run', () => {
    const a = sampleAutomation({ lastRunAt: 0, cooldownSeconds: 3600 });
    expect(getCooldownRemaining(a, clockAt(0))).toBe(3600);
  });

  it('returns 0 when the cooldown has fully elapsed', () => {
    const a = sampleAutomation({ lastRunAt: 0, cooldownSeconds: 3600 });
    expect(getCooldownRemaining(a, clockAt(3600))).toBe(0);
  });

  it('returns the remaining seconds mid-cooldown', () => {
    const a = sampleAutomation({ lastRunAt: 1000, cooldownSeconds: 1000 });
    expect(getCooldownRemaining(a, clockAt(1500))).toBe(500);
  });

  it('returns 0 when the automation has no cooldown configured', () => {
    const a = sampleAutomation();
    expect(getCooldownRemaining(a, clockAt(0))).toBe(0);
  });

  it('returns 0 when lastRunAt + cooldown is in the past', () => {
    const a = sampleAutomation({ lastRunAt: 100, cooldownSeconds: 100 });
    expect(getCooldownRemaining(a, clockAt(10_000))).toBe(0);
  });
});
