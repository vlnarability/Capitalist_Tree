/**
 * Tests for TreeView's live canvas aria-label (W56 / RV6-7).
 *
 * RV6-7: the canvas's aria-label was static. W56 makes it dynamic —
 * reflecting the tree's current biological state (condition tier + canopy
 * fullness + season + weather), bucketed so it only changes on meaningful
 * transitions. A visually-hidden `aria-live="polite"` region announces
 * condition-tier changes.
 *
 * Environment: happy-dom. TreeView takes TreeRenderData + EnvironmentRenderData
 * props (built from a fresh game state via the rendering mappers).
 */
// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { engine, DEFAULT_GAME_CONFIG } from '@capitalist-tree/simulation';
import type { GameState } from '@capitalist-tree/shared';
import {
  buildTreeRenderData,
  buildEnvironmentRenderData,
} from '@capitalist-tree/rendering';
import {
  __resetGameStoreForTests,
} from '../../../stores/game-store';
import { TreeView } from '../../../components/tree/TreeView';

function freshState(overrides: Partial<GameState> = {}): GameState {
  return {
    ...engine.initialize({ ...DEFAULT_GAME_CONFIG, createdAt: 1_700_000_000_000 }),
    ...overrides,
  };
}

/** Build the render-data pair from a state (the page does the same). */
function renderData(state: GameState) {
  return {
    tree: buildTreeRenderData(state.originalTree, { season: state.clock.season }),
    environment: buildEnvironmentRenderData(state.world, state.clock),
  };
}

describe('TreeView (W56 / RV6-7) — live canvas aria-label', () => {
  beforeEach(() => __resetGameStoreForTests());
  afterEach(() => cleanup());

  it('aria-label reflects a healthy tree + season + weather', () => {
    const { tree, environment } = renderData(freshState());
    const { getByRole } = render(
      <TreeView tree={tree} environment={environment} width={100} height={80} />,
    );
    const label = getByRole('img').getAttribute('aria-label') ?? '';
    // Pristine tree → low stress → Healthy.
    expect(label).toMatch(/Healthy/i);
    // Season is present (capitalized).
    expect(label).toMatch(/Spring|Summer|Autumn|Winter/);
  });

  it('aria-label reflects Stressed when stress is moderate', () => {
    const base = freshState();
    const { tree, environment } = renderData(
      freshState({ originalTree: { ...base.originalTree, stress: 0.5 } }),
    );
    const { getByRole } = render(
      <TreeView tree={tree} environment={environment} width={100} height={80} />,
    );
    expect(getByRole('img').getAttribute('aria-label') ?? '').toMatch(/Stressed/i);
  });

  it('aria-label reflects Critical when stress is high', () => {
    const base = freshState();
    const { tree, environment } = renderData(
      freshState({ originalTree: { ...base.originalTree, stress: 0.85 } }),
    );
    const { getByRole } = render(
      <TreeView tree={tree} environment={environment} width={100} height={80} />,
    );
    expect(getByRole('img').getAttribute('aria-label') ?? '').toMatch(/Critical/i);
  });

  it('aria-label reflects Dead when the tree is not alive', () => {
    const base = freshState();
    const { tree, environment } = renderData(
      freshState({ originalTree: { ...base.originalTree, alive: false } }),
    );
    const { getByRole } = render(
      <TreeView tree={tree} environment={environment} width={100} height={80} />,
    );
    expect(getByRole('img').getAttribute('aria-label') ?? '').toMatch(/Dead/i);
  });

  it('aria-label includes canopy fullness for a living tree', () => {
    const { tree, environment } = renderData(freshState());
    const { getByRole } = render(
      <TreeView tree={tree} environment={environment} width={100} height={80} />,
    );
    const label = getByRole('img').getAttribute('aria-label') ?? '';
    // Pristine sapling has 50 leaves; capacity is higher → moderate or sparse
    // canopy. The label must include one of the fullness buckets.
    expect(label).toMatch(/canopy/i);
  });

  it('aria-label includes "click to harvest" when interactive (onHarvest wired)', () => {
    const { tree, environment } = renderData(freshState());
    const { getByRole } = render(
      <TreeView
        tree={tree}
        environment={environment}
        width={100}
        height={80}
        onHarvest={() => {}}
      />,
    );
    // Interactive → role="button".
    const label = getByRole('button').getAttribute('aria-label') ?? '';
    expect(label).toMatch(/click to harvest/i);
    // Still carries the condition.
    expect(label).toMatch(/Healthy|Stressed|Critical/i);
  });

  it('renders a visually-hidden live region with aria-live=polite', () => {
    const { tree, environment } = renderData(freshState());
    const { getByTestId } = render(
      <TreeView tree={tree} environment={environment} width={100} height={80} />,
    );
    const liveRegion = getByTestId('canvas-live-region');
    expect(liveRegion.getAttribute('aria-live')).toBe('polite');
    expect(liveRegion.className).toMatch(/sr-only/);
    expect(liveRegion.textContent ?? '').toMatch(/Tree condition/i);
  });

  it('live region reflects the condition tier (Healthy for a pristine tree)', () => {
    const { tree, environment } = renderData(freshState());
    const { getByTestId } = render(
      <TreeView tree={tree} environment={environment} width={100} height={80} />,
    );
    expect(getByTestId('canvas-live-region').textContent ?? '').toMatch(/Healthy/i);
  });

  it('live region reflects Dead when the tree is not alive', () => {
    const base = freshState();
    const { tree, environment } = renderData(
      freshState({ originalTree: { ...base.originalTree, alive: false } }),
    );
    const { getByTestId } = render(
      <TreeView tree={tree} environment={environment} width={100} height={80} />,
    );
    expect(getByTestId('canvas-live-region').textContent ?? '').toMatch(/Dead/i);
  });
});
