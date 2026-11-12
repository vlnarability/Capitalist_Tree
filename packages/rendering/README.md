# @capitalist-tree/rendering

**Status:** P4a + P4b complete. P4c (environment + currency visuals polish)
and P4d (React wrapper + demo) pending.

The rendering package is responsible for translating simulation state into
visual output (Canvas / SVG / WebGL / etc.) per TDD §15. The renderer:

- Reads `GameState` (and derived render-data shapes such as `TreeRenderData`
  from TDD §15.1).
- NEVER writes to simulation state (TDD §1.8, §15.1 — rule 6: rendering reads
  state, never writes).
- Stays replaceable — the choice of Canvas vs SVG vs WebGL is an
  implementation detail of this package, selected via `createTreeRenderer`.

## What's shipped

**P4a** — data contracts + interface + headless stub (TDD §15.1, §15.2,
§15.3, §15.4):

- `TreeRenderData` / `EnvironmentRenderData` / `CurrencyVisual` types and the
  pure `buildTreeRenderData` / `buildEnvironmentRenderData` mapping functions.
- `TreeRenderer` interface + `createTreeRenderer` factory with a tagged-union
  `CreateTreeRendererTarget` discriminated by `kind`.
- `HeadlessTreeRenderer` — a no-op implementation for SSR / tests.
- Three `CurrencyVisual` cosmetics (`LEAF_BANKNOTE`, `GOLD_LEAF`, `EURO_LEAF`)
  + lookup helpers.
- Provisional visual-tuning constants in `src/constants/rendering.ts`.

**P4b** — Canvas 2D TreeRenderer (TDD §15.3, GDD §13.4):

- `CanvasTreeRenderer` implementing the full `TreeRenderer` interface,
  targeting `HTMLCanvasElement`'s 2D context.
- Procedural tree structure: recursive branch generator driven by a
  deterministic LCG seeded from the tree's structural signature (species +
  geometry + alive state + age bucket). Same TreeRenderData → same layout
  across frames.
- Environment rendering: sky gradient interpolated across night/dawn/day/dusk
  anchors by `timeOfDay`; ground band tinted by `soilCondition` +
  `soilContamination`; weather particle overlays (rain / snow) in pre-allocated
  fixed-size pools; pollution haze overlay; day/night brightness overlay.
- Animation: sinusoidal wind sway (branch depth-scaled), autumn falling-leaf
  particles. `Math.random` is used ONLY for particle init positions per the
  P4b spec; tree structure uses the deterministic LCG.
- Money-leaf visuals: each leaf drawn as a small banknote-coloured ellipse
  whose colour is taken from the `CurrencyVisual.banknoteTheme` registry
  (us-greenback / gold-foil / euro-violet + fallback).
- Layout cache keyed by structural signature — rebuilt only when the tree's
  structure or viewport changes, not every frame.
- `render()` is defensive: it never throws (clamps, no-ops on bad input,
  silent no-op when the 2D context is unavailable) per the TDD §15.3 contract
  that the animation frame loop must stay stable.

## Not yet shipped

- **P4c** — richer environment + currency visuals rendering (e.g. weather
  transitions, biodiversity-driven background vegetation, banknote glyph
  rendering on each leaf).
- **P4d** — React wrapper (`<TreeView/>`) + demo page in `apps/web`.
