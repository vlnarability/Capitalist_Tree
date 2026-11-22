/**
 * TreeView reduced-motion test (P5d / W40 — R-P5d-2).
 *
 * Verifies the W40 wiring: TreeView consumes `useReducedMotion()` + gates the
 * per-frame `dt` passed to `CanvasTreeRenderer.render()` — when reduced motion
 * is requested (in-game override `'on'`), `dt` is `0` so branch-sway + particle
 * animation do NOT advance (WCAG 2.1 AA / 2.3.3 Animation from Interactions).
 *
 * This is a BEHAVIORAL test (the sibling `TreeView.test.tsx` is a smoke test
 * that uses the real renderer, which no-ops in happy-dom). Here we mock
 * `CanvasTreeRenderer` to capture the `dt` argument, + stub
 * `requestAnimationFrame` for deterministic tick control (no flaky timing).
 *
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import type {
  TreeRenderData,
  EnvironmentRenderData,
} from '@capitalist-tree/rendering';

// `vi.hoisted` so the spy is defined before the (hoisted) `vi.mock` factory
// runs. The mock replaces `CanvasTreeRenderer` with a constructor that returns
// an instance whose `render` is the spy — capturing the `dt` argument.
const { renderSpy } = vi.hoisted(() => ({ renderSpy: vi.fn() }));

vi.mock('@capitalist-tree/rendering', () => ({
  CanvasTreeRenderer: vi.fn().mockImplementation((opts: { currency?: { id: string } }) => ({
    render: renderSpy,
    setCurrency: vi.fn(),
    resize: vi.fn(),
    dispose: vi.fn(),
    // The loop reads `renderer.currency.id` to detect currency hot-swaps.
    currency: opts?.currency ?? { id: 'default' },
  })),
  getDefaultCurrencyVisual: vi.fn().mockReturnValue({ id: 'default' }),
}));

import { TreeView } from './TreeView';
import {
  useGameStore,
  __resetGameStoreForTests,
} from '../../stores/game-store';

// ----------------------------------------------------------------------------
// Minimal fixtures (same shapes as TreeView.test.tsx).
// ----------------------------------------------------------------------------
const TREE_FIXTURE: TreeRenderData = {
  height: 10,
  trunkDiameter: 0.5,
  branchDevelopment: 50,
  foliageDensity: 0.7,
  foliageCondition: 0.8,
  seasonalAppearance: 'summer-green',
  damage: [],
  alive: true,
  speciesId: 'species:white-oak',
  speciesShape: 'broadleaf-round',
  ageDays: 200,
  leafCount: 1000,
};

const ENV_FIXTURE: EnvironmentRenderData = {
  soilCondition: 0.9,
  soilContamination: 0,
  weatherCondition: 'sunny',
  weatherIntensity: 0.5,
  timeOfDay: 0.5,
  season: 'summer',
  pollutionLevel: 0,
  biodiversityLevel: 0.8,
  co2Level: 410,
};

// ----------------------------------------------------------------------------
// Deterministic rAF stub: capture the loop callback so the test can invoke it
// at controlled timestamps (instead of relying on happy-dom's setTimeout-based
// rAF, which would fire asynchronously + non-deterministically).
// ----------------------------------------------------------------------------
let rafCb: ((now: number) => void) | null = null;

describe('TreeView (W40) — reduced-motion gates the rAF animation dt', () => {
  beforeEach(() => {
    __resetGameStoreForTests();
    renderSpy.mockClear();
    rafCb = null;
    vi.stubGlobal(
      'requestAnimationFrame',
      (cb: (now: number) => void) => {
        rafCb = cb;
        return 1;
      },
    );
    vi.stubGlobal('cancelAnimationFrame', () => {
      rafCb = null;
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('passes dt = 0 to the renderer when reducedMotionOverride is "on" (no sway/particle advance)', () => {
    useGameStore.getState().setReducedMotionOverride('on');

    render(<TreeView tree={TREE_FIXTURE} environment={ENV_FIXTURE} />);

    // The mount effect scheduled the loop via rAF — invoke it twice with
    // increasing timestamps. With override='on', effectiveDt must be 0 on
    // EVERY tick (even though the wall-clock dt is non-zero on the 2nd).
    expect(rafCb).not.toBeNull();
    rafCb!(1_000);
    rafCb!(1_050); // 50ms later — raw dt would be 50ms, but effectiveDt must be 0.

    expect(renderSpy).toHaveBeenCalledTimes(2);
    for (const call of renderSpy.mock.calls) {
      // render(tree, env, dt) — dt is the 3rd arg (index 2).
      expect(call[2]).toBe(0);
    }
  });

  it('passes the real dt (non-zero after the first tick) when reducedMotionOverride is "off"', () => {
    useGameStore.getState().setReducedMotionOverride('off');

    render(<TreeView tree={TREE_FIXTURE} environment={ENV_FIXTURE} />);

    expect(rafCb).not.toBeNull();
    rafCb!(1_000); // first tick — dt ≈ 0 (lastFrameMs was just set)
    rafCb!(1_050); // second tick — dt = 50ms (real)

    expect(renderSpy).toHaveBeenCalledTimes(2);
    // The 2nd tick must pass the real (non-zero) dt — sway/particles advance.
    expect(renderSpy.mock.calls[1]![2]).toBe(50);
  });
});
