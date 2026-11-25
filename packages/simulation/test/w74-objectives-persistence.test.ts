/**
 * W74 — objectives richer persistence: `eventState.objectives.details`
 * (Record<id, { achievedAt, category, reward }>) populated on first achievement.
 *
 * Asserts:
 *   - OBJECTIVE_METADATA has a category + reward for every objective id.
 *   - recordObjectiveAchievements (the extracted pure writer) populates
 *     completed + details on first achievement, matches OBJECTIVE_METADATA,
 *     is idempotent across re-crossings (first achievedAt preserved), preserves
 *     existing entries, + is a no-op when nothing is newly achieved.
 *   - A fresh state has `objectives.details = {}` (schema default / initial-state).
 */
import { describe, it, expect } from 'vitest';
import { engine } from '../src/index.js';
import { DEFAULT_GAME_CONFIG } from '../src/initial-state.js';
import {
  OBJECTIVE_IDS,
  OBJECTIVE_METADATA,
  recordObjectiveAchievements,
} from '../src/index.js';
import { type GameState } from '@capitalist-tree/shared';

function freshState(): GameState {
  return engine.initialize({ ...DEFAULT_GAME_CONFIG, seed: 42 });
}

describe('W74 — OBJECTIVE_METADATA', () => {
  it('has a category + reward for every objective id', () => {
    for (const id of OBJECTIVE_IDS) {
      const meta = OBJECTIVE_METADATA[id];
      expect(meta, `metadata for ${id}`).toBeDefined();
      expect(typeof meta.category).toBe('string');
      expect(meta.category.length).toBeGreaterThan(0);
      expect(typeof meta.reward).toBe('string');
      expect(meta.reward.startsWith('cosmetic:')).toBe(true);
    }
  });
});

describe('W74 — recordObjectiveAchievements (richer persistence writer)', () => {
  it('populates completed + details for a first-time achievement', () => {
    const result = recordObjectiveAchievements(
      { completed: [], details: {} },
      ['last-tree'],
      60,
    );
    expect(result.completed).toEqual(['last-tree']);
    expect(result.details['last-tree']).toEqual({
      achievedAt: 60,
      category: OBJECTIVE_METADATA['last-tree'].category,
      reward: OBJECTIVE_METADATA['last-tree'].reward,
    });
  });

  it('details match OBJECTIVE_METADATA (category + reward)', () => {
    const result = recordObjectiveAchievements(
      { completed: [], details: {} },
      ['wealthiest-being', 'great-restoration'],
      120,
    );
    expect(result.details['wealthiest-being'].category).toBe('wealth');
    expect(result.details['wealthiest-being'].reward).toBe('cosmetic:golden-leaf');
    expect(result.details['great-restoration'].category).toBe('environment');
    expect(result.details['great-restoration'].reward).toBe('cosmetic:restoration-grove');
  });

  it('is idempotent — a re-crossing preserves the first achievedAt', () => {
    // First achievement at t=60.
    const first = recordObjectiveAchievements(
      { completed: [], details: {} },
      ['last-tree'],
      60,
    );
    // Re-crossing at t=120 — last-tree flips false→true again this tick
    // (diffObjectives fires on every crossing after a re-drop), but details
    // must keep the FIRST achievedAt (idempotent — the permanent record).
    const second = recordObjectiveAchievements(first, ['last-tree'], 120);
    expect(second.details['last-tree'].achievedAt).toBe(60);
    expect(second.completed).toEqual(['last-tree']);
  });

  it('preserves existing completed + details entries', () => {
    const current = {
      completed: ['wealthiest-being'],
      details: {
        'wealthiest-being': {
          achievedAt: 30,
          category: 'wealth',
          reward: 'cosmetic:golden-leaf',
        },
      },
    };
    const result = recordObjectiveAchievements(current, ['natural-balance'], 90);
    expect(result.completed).toContain('wealthiest-being');
    expect(result.completed).toContain('natural-balance');
    expect(result.details['wealthiest-being'].achievedAt).toBe(30); // preserved
    expect(result.details['natural-balance'].achievedAt).toBe(90);
    expect(result.details['natural-balance'].category).toBe('balance');
  });

  it('no newlyAchieved → returns completed/details unchanged', () => {
    const current = {
      completed: ['last-tree'],
      details: {
        'last-tree': {
          achievedAt: 60,
          category: 'environment',
          reward: 'cosmetic:wasteland-mark',
        },
      },
    };
    const result = recordObjectiveAchievements(current, [], 120);
    expect(result.completed).toEqual(['last-tree']);
    expect(result.details).toEqual(current.details);
  });
});

describe('W74 — fresh state has the details field (schema default)', () => {
  it('eventState.objectives.details is an empty record on init', () => {
    const s = freshState();
    expect(s.eventState.objectives.details).toEqual({});
    expect(s.eventState.objectives.completed).toEqual([]);
  });
});
