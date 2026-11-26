/**
 * W68 — audio variety tests.
 *
 * Three pieces:
 *   - Sound registry: 1 ambient + 3 SFX; `getSoundById` resolves; unknown
 *     throws; ambient loops, SFX don't.
 *   - HeadlessAudioPlayer: play/stop/stopAll/dispose record calls + track the
 *     playing set; disposed is a no-op.
 *   - play-sound event emission: the axe actions emit the right sound —
 *     `buy-tool` → `sfx:purchase`; `cut-down-tree` success → `sfx:notify`;
 *     `cut-down-tree` warnings (no axe / already dead) → `sfx:error`.
 */
import { describe, it, expect } from 'vitest';
import { engine } from '../src/index.js';
import { DEFAULT_GAME_CONFIG } from '../src/initial-state.js';
import { HeadlessAudioPlayer } from '../src/audio/index.js';
import { getSpeciesOrFail } from '../src/biology/index.js';
import {
  SOUNDS,
  getSoundById,
  UnknownSoundError,
  AXE_TOOL_ID,
} from '@capitalist-tree/content';
import type { GameState, GameConfig, SimulationEvent } from '@capitalist-tree/shared';

function cfg(seed: number): GameConfig {
  return { ...DEFAULT_GAME_CONFIG, seed, createdAt: 0 };
}
function freshState(): GameState {
  return engine.initialize(cfg(42));
}
function withMatureTree(state: GameState): GameState {
  const species = getSpeciesOrFail(state.originalTree.speciesId);
  return {
    ...state,
    originalTree: {
      ...state.originalTree,
      alive: true,
      health: 0.9,
      stress: 0.1,
      wear: 0.5,
      structure: {
        ...state.originalTree.structure,
        height: species.maximumHeight * 0.7,
        trunkDiameter: species.maximumTrunkDiameter * 0.7,
        branchDevelopment: species.maximumBranchDevelopment * 0.7,
        structuralIntegrity: 0.9,
      },
      foliage: { ...state.originalTree.foliage, currentLeaves: 1000 },
    },
  };
}
function withAxe(state: GameState): GameState {
  return {
    ...state,
    inventory: {
      ...state.inventory,
      items: [...state.inventory.items, { resourceId: AXE_TOOL_ID, quantity: 1 }],
    },
  };
}

/** Extract the soundId from the first play-sound event, or null. */
function playSoundId(events: readonly SimulationEvent[]): string | null {
  const e = events.find((ev) => ev.type === 'play-sound') as
    | { payload: { soundId: string } }
    | undefined;
  return e?.payload.soundId ?? null;
}

// ----------------------------------------------------------------------------
// Sound registry.
// ----------------------------------------------------------------------------

describe('W68: sound registry', () => {
  it('ships exactly 1 ambient + 3 SFX', () => {
    const ambients = SOUNDS.filter((s) => s.kind === 'ambient');
    const sfx = SOUNDS.filter((s) => s.kind === 'sfx');
    expect(ambients).toHaveLength(1);
    expect(sfx).toHaveLength(3);
    expect(SOUNDS).toHaveLength(4);
  });

  it('the ambient loops; SFX do not', () => {
    const ambient = getSoundById('ambient:forest');
    expect(ambient.kind).toBe('ambient');
    expect(ambient.loop).toBe(true);
    for (const id of ['sfx:purchase', 'sfx:notify', 'sfx:error']) {
      const sfx = getSoundById(id);
      expect(sfx.kind).toBe('sfx');
      expect(sfx.loop).toBe(false);
    }
  });

  it('getSoundById resolves each known sound', () => {
    expect(getSoundById('ambient:forest').id).toBe('ambient:forest');
    expect(getSoundById('sfx:purchase').id).toBe('sfx:purchase');
    expect(getSoundById('sfx:notify').id).toBe('sfx:notify');
    expect(getSoundById('sfx:error').id).toBe('sfx:error');
  });

  it('throws UnknownSoundError for an unknown sound id', () => {
    expect(() => getSoundById('sfx:nonexistent')).toThrowError(/Unknown sound/);
  });

  it('NO weather/harvest/seasonal sounds are registered (W68 scope)', () => {
    // W68 explicitly excludes weather/harvest/seasonal sounds.
    const ids = SOUNDS.map((s) => s.id);
    expect(ids).not.toContain('sfx:harvest');
    expect(ids).not.toContain('sfx:weather');
    expect(ids).not.toContain('sfx:season');
    expect(ids.some((id) => id.includes('harvest'))).toBe(false);
    expect(ids.some((id) => id.includes('weather'))).toBe(false);
    expect(ids.some((id) => id.includes('season'))).toBe(false);
  });
});

// ----------------------------------------------------------------------------
// HeadlessAudioPlayer.
// ----------------------------------------------------------------------------

describe('W68: HeadlessAudioPlayer', () => {
  it('records play/stop/stopAll calls + tracks the playing set', () => {
    const p = new HeadlessAudioPlayer();
    p.play('ambient:forest');
    p.play('sfx:purchase');
    expect(p.playing).toEqual(['ambient:forest', 'sfx:purchase']);
    p.stop('sfx:purchase');
    expect(p.playing).toEqual(['ambient:forest']);
    p.stopAll();
    expect(p.playing).toEqual([]);
    const ops = p.calls.map((c) => c.op);
    expect(ops).toEqual(['play', 'play', 'stop', 'stopAll']);
  });

  it('is a no-op after dispose', () => {
    const p = new HeadlessAudioPlayer();
    p.play('sfx:purchase');
    p.dispose();
    expect(p.disposed).toBe(true);
    p.play('sfx:notify'); // no-op
    p.stop('sfx:purchase'); // no-op
    expect(p.calls).toHaveLength(1); // only the pre-dispose play
  });
});

// ----------------------------------------------------------------------------
// play-sound event emission from the axe actions.
// ----------------------------------------------------------------------------

describe('W68: axe actions emit play-sound events', () => {
  it('buy-tool emits sfx:purchase', () => {
    const s = freshState();
    const result = engine.executeAction(s, {
      type: 'buy-tool',
      payload: { toolId: AXE_TOOL_ID },
    });
    expect(playSoundId(result.events)).toBe('sfx:purchase');
  });

  it('cut-down-tree success emits sfx:notify', () => {
    const s = withAxe(withMatureTree(freshState()));
    const result = engine.executeAction(s, {
      type: 'cut-down-tree',
      payload: { treeId: s.originalTree.id, tick: 100 },
    });
    expect(result.state.originalTree.alive).toBe(false); // sanity: the cut happened
    expect(playSoundId(result.events)).toBe('sfx:notify');
  });

  it('cut-down-tree with no axe emits sfx:error', () => {
    const s = withMatureTree(freshState()); // no axe
    const result = engine.executeAction(s, {
      type: 'cut-down-tree',
      payload: { treeId: s.originalTree.id, tick: 100 },
    });
    expect(playSoundId(result.events)).toBe('sfx:error');
  });

  it('cut-down-tree on a dead tree emits sfx:error', () => {
    const s = withAxe({
      ...withMatureTree(freshState()),
      originalTree: { ...withMatureTree(freshState()).originalTree, alive: false },
    });
    const result = engine.executeAction(s, {
      type: 'cut-down-tree',
      payload: { treeId: s.originalTree.id, tick: 100 },
    });
    expect(playSoundId(result.events)).toBe('sfx:error');
  });

  it('a HeadlessAudioPlayer fed the buy-tool events plays sfx:purchase', () => {
    // End-to-end: the UI would subscribe to events + call player.play for each
    // play-sound. This test simulates that wiring.
    const s = freshState();
    const result = engine.executeAction(s, {
      type: 'buy-tool',
      payload: { toolId: AXE_TOOL_ID },
    });
    const player = new HeadlessAudioPlayer();
    for (const ev of result.events) {
      if (ev.type === 'play-sound') {
        player.play((ev as { payload: { soundId: string } }).payload.soundId);
      }
    }
    expect(player.calls.filter((c) => c.op === 'play')).toHaveLength(1);
    expect(player.calls[0]!.soundId).toBe('sfx:purchase');
  });
});
