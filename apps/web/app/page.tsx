'use client';

/**
 * Main game screen (P5b + P5c — GDD §13.1, §13.2 Simplified View, §13.3 Advanced View).
 *
 * Replaces P0's `use-engine-game`-driven page with the real game UI:
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
 *   - **Advanced view toggle** (P5c — GDD §13.3). When `ui.advancedView` is
 *     true, a second row of Panels surfaces the BiologyPanel /
 *     EnvironmentPanel / HarvestControls / PurchaseControls /
 *     TransactionsPanel / CurrencyCosmeticPicker — the formulas + transactions
 *     + controls GDD §13.3 calls out. The toggle is the gateway: simplified
 *     view (GDD §13.2) by default; advanced view on demand.
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
 *     (`originalTree` + `world` + `clock`) + the `ui.advancedView` boolean
 *     that gates the advanced panels.
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
 *   - Advanced view toggle: flips `ui.advancedView` (a UI-only slice —
 *     `simState` reference is untouched, rule 6). The page re-renders to
 *     mount / unmount the advanced Panels.
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
  AdvancedViewToggle,
  NotificationsPanel,
  useTreeConditionTone,
} from '../components/dashboard';
import { BiologyPanel, EnvironmentPanel } from '../components/environment';
import {
  TransactionsPanel,
  HarvestControls,
  PurchaseControls,
  CurrencyCosmeticPicker,
} from '../components/economy';

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

  // P5c — GDD §13.3: the advanced-view toggle gates the BiologyPanel /
  // EnvironmentPanel / TransactionsPanel / HarvestControls /
  // PurchaseControls / CurrencyCosmeticPicker below. Subscribes narrowly
  // to a primitive boolean — Zustand's `useSyncExternalStore` bails out
  // when the value is unchanged, so an unrelated `simState` commit does
  // NOT re-render the page on this selector. (The other selectors above
  // do re-render the page on every step, but that's intentional — the
  // TreeView needs the fresh slice. The `advancedView` selector rides
  // along for free; the page re-renders + mounts/unmounts the advanced
  // Panels only when the boolean actually flips.)
  const advancedView = useGameStore((s) => s.ui.advancedView);

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

      {/* P5d — GDD §13.5 Notifications. Floating top-right toast panel.
          The panel returns `null` when there are no actionable
          notifications to show, so this container collapses to nothing
          (no reserved space, no empty UI). ARIA `role="region"` on the
          panel + `role="alert"`/`"status"` per item — keyboard users tab
          through the dismiss buttons; the panel respects
          `prefers-reduced-motion` via `useReducedMotion()` inside. */}
      <div
        className="pointer-events-none fixed right-4 top-4 z-50 w-[min(22rem,calc(100vw-2rem))]"
        data-testid="notifications-panel-container"
      >
        {/* Re-enable pointer events on the panel itself so the buttons
            are clickable; the wrapper stays `pointer-events-none` so
            empty space doesn't intercept clicks meant for the tree. */}
        <div className="pointer-events-auto">
          <NotificationsPanel />
        </div>
      </div>

      {/* Top row: speed + save/load controls + the advanced-view toggle.
          Always visible — the player should be able to pause / save /
          switch views without scrolling. */}
      <Panel
        title="Simulation"
        icon="⏱"
        hint="1 real s = 1 sim min"
        className="mb-4"
      >
        <SpeedControls accumulator={loop.accumulator} />
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-800/80 pt-3">
          <Button onClick={() => void loop.save()} data-testid="save-button">
            💾 Save
          </Button>
          <Button onClick={() => void loop.load()} data-testid="load-button">
            📂 Load
          </Button>
          <Button onClick={onNewGame} data-testid="new-game-button">
            🌱 New Game
          </Button>
          {/* P5c: the advanced-view toggle lives in the Simulation panel so
              the player can flip between simplified (GDD §13.2) and
              advanced (GDD §13.3) without losing the speed / save controls. */}
          <div className="ml-auto">
            <AdvancedViewToggle />
          </div>
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

      {/* P5c — GDD §13.3 Advanced View. Rendered only when the player flips
          `ui.advancedView` to true. The panels themselves subscribe narrowly
          to their own slices (BiologyPanel reads `originalTree` +
          `world.environment` + `clock`; PurchaseControls reads `economy.markets`
          + `player.personalCash`; etc.) so mounting them doesn't add per-step
          re-renders to the page — each panel re-renders independently when its
          slice changes.

          Layout: a responsive 1/2/3-column grid so the panel count stays
          readable across viewport widths (single column on phones, two on
          tablets, three on desktops). The order is intentional — biology
          + environment lead (the player's primary advanced view into the
          tree), then the harvest + market controls (the player's levers),
          then the currency picker (cosmetic) + transactions (history). */}
      {advancedView ? (
        <div
          className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3"
          data-testid="advanced-view"
        >
          <Panel
            title="Biology"
            icon="🧬"
            tone="emerald"
            hint="GDD §13.3 / §5"
          >
            <BiologyPanel />
          </Panel>
          <Panel title="Environment" icon="🌍" hint="GDD §13.3">
            <EnvironmentPanel />
          </Panel>
          <Panel title="Harvest" icon="🍃" tone="emerald" hint="GDD §5.4">
            <HarvestControls />
          </Panel>
          <Panel title="Markets" icon="🛒" hint="GDD §8.5">
            <PurchaseControls />
          </Panel>
          <Panel title="Transactions" icon="📒" hint="Recent">
            <TransactionsPanel />
          </Panel>
          <Panel title="Currency" icon="💵" hint="Cosmetic only">
            <CurrencyCosmeticPicker />
          </Panel>
        </div>
      ) : null}
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
          P5b + P5c — main game screen (GDD §13.1; advanced view §13.3)
        </p>
      </div>
    </header>
  );
}
