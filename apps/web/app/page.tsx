'use client';

/**
 * Main game screen (P5b — GDD §13.1, §13.2 Simplified View).
 *
 * Replaces P0's `use-engine-game`-driven page with the real P5b game UI:
 *
 *   - **TreeView dominant** (P4d React wrapper around CanvasTreeRenderer). The
 *     tree is the central visual element per GDD §13.1 ("the original tree is
 *     the dominant visual element"). The surrounding environment reflects
 *     actual simulation conditions (weather particles, day/night, soil).
 *   - **Dashboard surrounds**: money, expenses, tree-condition, resources,
 *     weather, season + clock. Each is a small `Panel` whose body is the
 *     matching dashboard summary component (P5b).
 *   - **Speed controls** (pause + 1x/5x/15x/60x). Dispatched through the store
 *     via `setSpeed` / `pause` / `resume` (P5a action factories).
 *   - **Save / Load / New Game** buttons wired through `useSimulationLoop`
 *     (P5a hook). The hook owns the storage lifecycle; the buttons just call
 *     `loop.save() / loop.load() / loop.newGame(config)`.
 *
 * No advanced view (P5c) + no notifications panel (P5d). The simplified view
 * (GDD §13.2) is plain-language summaries + icons + colour tones — no
 * nutrient ratios, photosynthetic efficiency, or Markov matrices.
 *
 * Architecture (10 Capitalist Tree rules):
 *   - Rule 6 (TDD §15.1, GDD §6.1): rendering / UI reads state, NEVER writes.
 *     The page reads slices of `simState` via narrow Zustand selectors and
 *     dispatches actions only through `useGameStore.getState().dispatch` —
 *     never mutates `simState` directly. The simulation-loop hook is the
 *     ONLY writer of `simState` outside of UI-initiated `dispatch`.
 *   - Rule 2 (purity): `buildTreeRenderData` / `buildEnvironmentRenderData`
 *     are pure mappers — they read `simState` slices and return fresh visual
 *     data snapshots. `useMemo` recomputes only when the input slices change.
 *   - TDD §16 selective UI updates: each Panel subscribes to its own slice
 *     via the dashboard component's narrow selectors. A `player.personalCash`
 *     change re-renders `MoneyDisplay` but NOT `WeatherDisplay`. The page
 *     itself subscribes only to the slices needed to build TreeView's props
 *     (`originalTree` + `world` + `clock`).
 *
 * Lifecycle:
 *   - Mount: `useSimulationLoop(config, storage)` boots — tries to load from
 *     IDB; on miss, calls `engine.initialize(config)`. Publishes via
 *     `useGameStore.getState().commitSimState(...)`. Sets `ready = true`.
 *   - Each sim step (rAF + accumulator): the hook calls `engine.advance`
 *     and publishes via `commitSimState`. Narrow selectors re-render only
 *     the affected Panels + the TreeView (whose `useMemo` deps changed).
 *   - Save button: `loop.save()` writes the current `simState` to IDB.
 *   - Load button: `loop.load()` re-reads from IDB and republishes.
 *   - New Game button: `loop.newGame(config)` boots a fresh `engine.initialize`
 *     and republishes.
 */
import { useCallback, useMemo, type ReactElement } from 'react';
import { DEFAULT_GAME_CONFIG } from '@capitalist-tree/simulation';
import {
  buildTreeRenderData,
  buildEnvironmentRenderData,
} from '@capitalist-tree/rendering';
import type { GameConfig } from '@capitalist-tree/shared';
import { useSimulationLoop } from '../hooks/useSimulationLoop';
import { useGameStore } from '../stores/game-store';
import { createBrowserStorage } from '../lib/persistence';
import { TreeView } from '../components/tree';
import { Panel, Button } from '../components/common';
import {
  MoneyDisplay,
  TreeConditionSummary,
  ExpensesSummary,
  ResourcesSummary,
  WeatherDisplay,
  SpeedControls,
  useTreeConditionTone,
} from '../components/dashboard';

// ----------------------------------------------------------------------------
// Page component.
// ----------------------------------------------------------------------------

export default function HomePage(): ReactElement {
  // Stable-on-mount config + storage. The hook's contract says these should
  // be referentially stable across renders (the boot effect runs once).
  const config = useMemo<GameConfig>(
    () => ({ ...DEFAULT_GAME_CONFIG, createdAt: Date.now() }),
    [],
  );
  const storage = useMemo(() => createBrowserStorage(), []);

  // Drive the simulation loop. Returns `ready` (boot done), `accumulator`
  // (rAF remainder, sim seconds), and the Save/Load/NewGame callbacks.
  const loop = useSimulationLoop(config, storage);

  // Narrow subscriptions: only the slices needed to build TreeView's props.
  // Each selector returns a sub-slice reference; Zustand re-renders this page
  // only when one of these slices is replaced (engine mutators always return
  // fresh references — rule 2 purity contract).
  //
  // We deliberately DON'T subscribe to `simState` as a whole — that would
  // re-render the page on every clock tick (TDD §16 selective UI updates).
  const treeState = useGameStore((s) => s.simState?.originalTree ?? null);
  const worldState = useGameStore((s) => s.simState?.world ?? null);
  const clockState = useGameStore((s) => s.simState?.clock ?? null);

  // TreeView tint: derived from the tree's condition tier (Healthy/Stressed/
  // Critical/Dead). Reads `originalTree.alive` + `originalTree.stress` only.
  const treeTone = useTreeConditionTone();

  // Build TreeRenderData + EnvironmentRenderData once per state change.
  // The mappers are pure (rule 2 + rule 6); `useMemo` re-runs only when the
  // input slices change reference (which the engine guarantees via deep-copy
  // + replace on every advance).
  const treeRenderData = useMemo(() => {
    if (!treeState || !clockState) return null;
    return buildTreeRenderData(treeState, { season: clockState.season });
  }, [treeState, clockState]);

  const environmentRenderData = useMemo(() => {
    if (!worldState || !clockState) return null;
    return buildEnvironmentRenderData(worldState, clockState);
  }, [worldState, clockState]);

  // New-Game handler: wraps `loop.newGame` with a fresh `GameConfig` stamped
  // with the current wall-clock. (`Date.now()` here is the spec-allowed
  // single read at game-creation time — TDD §18.1.)
  const onNewGame = useCallback(() => {
    loop.newGame({ ...DEFAULT_GAME_CONFIG, createdAt: Date.now() });
  }, [loop]);

  // Loading state — boot hasn't published a non-null `simState` yet.
  if (!loop.ready || !treeRenderData || !environmentRenderData) {
    return (
      <main className="mx-auto max-w-7xl p-6">
        <Header />
        <p className="mt-12 text-center text-sm text-slate-500" data-testid="booting">
          Booting engine…
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-7xl p-4 sm:p-6" data-testid="game-screen">
      <Header />

      {/* Top row: speed + save/load controls. Always visible — the player
          should be able to pause / save without scrolling. */}
      <Panel
        title="Simulation"
        icon="⏱"
        hint="1 real s = 1 sim min"
        className="mb-4"
      >
        <SpeedControls accumulator={loop.accumulator} />
        <div className="mt-3 flex flex-wrap gap-2 border-t border-slate-800/80 pt-3">
          <Button onClick={() => void loop.save()} data-testid="save-button">
            💾 Save
          </Button>
          <Button onClick={() => void loop.load()} data-testid="load-button">
            📂 Load
          </Button>
          <Button onClick={onNewGame} data-testid="new-game-button">
            🌱 New Game
          </Button>
        </div>
      </Panel>

      {/* Main grid: TreeView dominant center; surrounds on the sides.
          Layout collapses to a single column on narrow screens. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        {/* Left column: money + expenses + resources. */}
        <aside className="flex flex-col gap-4 lg:col-span-3">
          <Panel title="Money" icon="💰" tone="emerald">
            <MoneyDisplay />
          </Panel>
          <Panel title="Expenses" icon="🏠" tone="amber">
            <ExpensesSummary />
          </Panel>
          <Panel title="Resources" icon="💧">
            <ResourcesSummary />
          </Panel>
        </aside>

        {/* Center column: the tree (dominant). */}
        <section className="lg:col-span-6">
          <Panel
            title="The Original Tree"
            icon="🌳"
            tone={treeTone ?? 'slate'}
            hint="P4 procedural renderer"
          >
            <div className="rounded-md overflow-hidden border border-slate-800/60 bg-slate-950">
              <TreeView
                tree={treeRenderData}
                environment={environmentRenderData}
                className="block w-full"
              />
            </div>
            <div className="mt-3">
              <TreeConditionSummary />
            </div>
          </Panel>
        </section>

        {/* Right column: weather + clock. */}
        <aside className="flex flex-col gap-4 lg:col-span-3">
          <Panel title="Weather" icon="🌤">
            <WeatherDisplay />
          </Panel>
        </aside>
      </div>
    </main>
  );
}

// ----------------------------------------------------------------------------
// Header (small, presentational — extracted for clarity).
// ----------------------------------------------------------------------------

function Header(): ReactElement {
  return (
    <header className="mb-6 flex flex-wrap items-baseline justify-between gap-2">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-100">
          The Capitalist Tree
        </h1>
        <p className="text-xs text-slate-500">
          P5b — main game screen (GDD §13.1 simplified view)
        </p>
      </div>
    </header>
  );
}
