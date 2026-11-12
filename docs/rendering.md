# Rendering (P4 — `@capitalist-tree/rendering`)

The rendering package is the visual surface of the simulation. It reads
`TreeState` / `WorldState` / `SimulationClock` snapshots and turns them into
pure visual-data contracts (`TreeRenderData` / `EnvironmentRenderData`) that a
backend-agnostic `TreeRenderer` consumes. The simulation NEVER imports from
this package; the web app does.

**Phase status**

| Phase | Scope | Status |
|-------|-------|--------|
| P4a   | Types + pure mapping + `HeadlessTreeRenderer` + factory + currency visuals | Shipped |
| P4b   | `CanvasTreeRenderer` (procedural Canvas 2D + particles + env overlays) | Shipped |
| P4c   | Environment + currency rendering refinements (TBD) | Future |
| P4d   | React wrapper (`TreeView`) + dev demo page + import-boundary extension | **This phase** |

> **Cardinal rule (rule 6 — TDD §15.1, GDD §6.1):** rendering reads state,
> NEVER writes. Every type in this package is either a 1:1 read of a
> simulation-state field, or a cosmetic / visual tuning value that does NOT
> feed back into the simulation. Cosmetic data (currency visuals) lives in
> this package — NOT in `packages/content` — because cosmetics must not be
> exposed to the simulation engine.

---

## 1. Public surface

Exported from `packages/rendering/src/index.ts`:

### Types

| Type | Source | Purpose |
|------|--------|---------|
| `TreeRenderData` | `types.ts` | Pure visual description of the tree (P4a). |
| `EnvironmentRenderData` | `types.ts` | Pure visual description of the surroundings (P4a). |
| `SeasonalAppearance` | `types.ts` | `'spring-buds' \| 'summer-green' \| 'autumn-color' \| 'winter-bare'`. |
| `SpeciesShape` | `types.ts` | Coarse silhouette shape (`'broadleaf-round' \| 'conical' \| ...`). |
| `DamageMarker` | `types.ts` | Visual marker for a recorded damage event. |
| `CurrencyDenomination` | `types.ts` | One denomination tier (valueMinor, label, leafTier). |
| `CurrencyVisual` | `types.ts` | Cosmetic appearance of money leaves (P4a). |
| `TreeRenderer` | `types.ts` | Backend-agnostic renderer interface (`render`/`resize`/`dispose`). |
| `TreeRendererTarget` | `types.ts` | `'canvas' \| 'svg' \| 'headless' \| 'webgl'`. |
| `CreateTreeRendererTarget` | `types.ts` | Discriminated factory target. |
| `TreeViewProps` | `types.ts` | Props shape for the React wrapper (P4d). P4a declared the shape; P4d wires the component. |

### Pure mapping functions

| Function | Source | Input → Output |
|----------|--------|----------------|
| `buildTreeRenderData(tree, options?)` | `tree-render-data.ts` | `TreeState` → `TreeRenderData`. |
| `buildEnvironmentRenderData(world, clock, options?)` | `environment-render-data.ts` | `WorldState` + `SimulationClock` → `EnvironmentRenderData`. |
| `deriveSeasonalAppearance(season, seasonalCondition)` | `tree-render-data.ts` | Season + foliage condition → `SeasonalAppearance`. |
| `resolveSpeciesShape(speciesId)` | `tree-render-data.ts` | speciesId → `SpeciesShape` (falls back to `'unknown'`). |
| `mapDamageMarker(d)` | `tree-render-data.ts` | `TreeDamageState` → `DamageMarker` (1:1 mirror). |

### Currency visuals

| Export | Description |
|--------|-------------|
| `LEAF_BANKNOTE` | Default: US-dollar-style green banknote leaves. id=`currency:leaf-dollar`. |
| `GOLD_LEAF` | Premium cosmetic: gold-foil leaves. id=`currency:gold-leaf`. |
| `EURO_LEAF` | Euro cosmetic: violet banknote leaves. id=`currency:euro-leaf`. |
| `ALL_CURRENCY_VISUALS` | All shipped cosmetics (read-only array). |
| `findCurrencyVisual(id)` | Lookup by id. |
| `getDefaultCurrencyVisual()` | Returns `LEAF_BANKNOTE`. |
| `resolveCurrencyVisual(id?)` | Lookup with default fallback. |

### Renderer factory + implementations

| Export | Description |
|--------|-------------|
| `createTreeRenderer(target)` | Discriminated factory: `{ kind: 'canvas', canvas }` / `{ kind: 'headless' }` / etc. |
| `HeadlessTreeRenderer` | No-op renderer for tests + SSR. Exposes `lastSnapshot` for assertions. |
| `CanvasTreeRenderer` | Procedural Canvas 2D renderer (P4b). Duck-typed `CanvasLike` surface accepts mocks. |
| `CanvasTreeRendererOptions` | `{ canvas: CanvasLike, currency?, width?, height? }`. |

### Provisional tuning constants

All constants are exported via `packages/rendering/src/constants/rendering.ts`
(re-exported from the package root). See §6 below.

---

## 2. `TreeRenderData` shape

```ts
interface TreeRenderData {
  // Structural — direct reads of `tree.structure.*`.
  readonly height: number;              // metres
  readonly trunkDiameter: number;        // metres
  readonly branchDevelopment: number;   // dimensionless (0..100)

  // Foliage — derived for visual use.
  readonly foliageDensity: number;       // currentLeaves / leafCapacity ∈ [0,1]
  readonly foliageCondition: number;     // 1 - tree.stress ∈ [0,1]
  readonly seasonalAppearance: SeasonalAppearance;

  // Damage markers — 1:1 mirror of `tree.damage[]`.
  readonly damage: readonly DamageMarker[];

  // Identity + lifecycle.
  readonly alive: boolean;
  readonly speciesId: string;            // e.g. 'species:white-oak'
  readonly speciesShape: SpeciesShape;
  readonly ageDays: number;
  readonly leafCount: number;            // currentLeaves — one leaf = one money-leaf
}
```

Built by `buildTreeRenderData(tree, { season })`. The function is pure — it
does NOT mutate `tree`. The output is a fresh object; later renders may safely
retain the reference.

The mapping derives `seasonalAppearance` from the clock's `Season` (the
authoritative source) and falls back to `seasonalCondition` thresholds when
no season is provided (defensive — the sim always has a season). See
`packages/rendering/src/tree-render-data.ts` for the full derivation.

---

## 3. `EnvironmentRenderData` shape

```ts
interface EnvironmentRenderData {
  // Soil — drives ground colour + contamination tint.
  readonly soilCondition: number;        // world.environment.soil.health ∈ [0,1]
  readonly soilContamination: number;    // contamination / FULL_DEGRADE ∈ [0,1]

  // Weather — drives particle overlays (rain/snow) + cloud cover.
  readonly weatherCondition: WeatherCondition;
  readonly weatherIntensity: number;     // [0,1]

  // Day/night — drives sky gradient + lighting overlay.
  readonly timeOfDay: number;            // [0,1) — 0=midnight, 0.5=noon
  readonly season: Season;

  // Atmosphere — drives pollution haze overlay.
  readonly pollutionLevel: number;       // [0,1] — coarse proxy from CO2 + emissions
  readonly biodiversityLevel: number;     // [0,1] — drives undergrowth density
  readonly co2Level: number;              // ppm — direct read
}
```

Built by `buildEnvironmentRenderData(world, clock, options?)`. Pollution is a
coarse proxy: `max(co2Excess / span, emissions / 100)` clamped to `[0,1]`. P6+
EnvironmentSystem will own a real pollution index; this is a coarse driver so
P4c has a haze signal to react to.

---

## 4. `TreeRenderer` interface + Canvas-vs-SVG decision

```ts
interface TreeRenderer {
  readonly targetKind: TreeRendererTarget;  // 'canvas' | 'svg' | 'headless' | 'webgl'
  render(tree: TreeRenderData, env: EnvironmentRenderData, frameTimeMs: number): void;
  resize(width: number, height: number): void;
  dispose(): void;  // idempotent
}
```

### Backend decision: Canvas wins

The P4b backend is `CanvasTreeRenderer` (Canvas 2D), not SVG. The decision
hinges on the per-frame work the renderer does:

| Backend | Pros | Cons | Verdict for our scene |
|---------|------|------|-----------------------|
| **Canvas 2D** | O(1) cost per draw call (cheap fill/stroke), bitmap-level pixel ops, simple particle pools, no DOM-tree churn. | No CSS styling on individual leaves; redraws need explicit clear. | **Winner** for hundreds of animated leaves + weather particles + sky gradient every frame. |
| **SVG** | Each leaf is a DOM node — accessible, stylable, debuggable via DevTools. | N leaves × M attribute mutations per frame = N×M DOM writes; layout thrash at >500 elements. AnimateTransform helps but still walks the DOM. | Loses on the money-leaf use case — a mature White Oak carries ~1000 leaves, drawn + animated every frame. |
| **WebGL** | Fastest for very high element counts; shader-driven effects. | Order-of-magnitude more code (shaders, buffers, GLSL); P1 doesn't need it. | Future phase when the scene grows to multiple trees / 3D / particle physics. |

The renderer still implements the same `TreeRenderer` interface, so swapping
to SVG or WebGL later is a one-line change via `createTreeRenderer({ kind: ... })`
— the React wrapper, the data mappers, and the constants don't change.

### Procedural structure (deterministic LCG)

The CanvasTreeRenderer builds the procedural tree from a deterministic LCG
seeded from a structural signature string:

```
signature = `${speciesId}|${height}|${trunkDiameter}|${branchDevelopment}|${alive}|${ageDays}|${width}x${height}`
```

The same `TreeRenderData` always produces the same branch layout — a sapling
doesn't jitter frame-to-frame. Only the layout is seeded; branch-sway
animation (wind) is a sine of `frameTimeMs × frequency`, NOT an LCG advance,
so the structure stays stable while the canopy gently moves. Particle init
positions use `Math.random` (cosmetic; non-deterministic; spec-allowed).

### Particle pools (no per-frame alloc)

Rain, snow, and falling-leaf particles live in pre-allocated fixed-size pools
(`PROVISIONAL_RENDER_RAIN_PARTICLE_POOL_SIZE` etc.). The renderer reuses
inactive slots rather than allocating new objects each frame — this keeps the
GC quiet during sustained animations. Pool sizes are tuned to fill a 600×480
viewport.

### render() never throws

`CanvasTreeRenderer.render()` is contractually required to never throw
(TDD §15.3 — a thrown exception in render() would crash the animation frame
loop). Construction can throw (canvas must exist); render() cannot. The
renderer silently no-ops on malformed input (clamps, skips, or returns).

---

## 5. React wrapper (`TreeView` — P4d)

File: `apps/web/components/tree/TreeView.tsx`.

```tsx
<TreeView
  tree={buildTreeRenderData(treeState, { season })}
  environment={buildEnvironmentRenderData(world, clock)}
  currency={LEAF_BANKNOTE}            // optional; defaults to LEAF_BANKNOTE
  width={600}                          // optional; default 600
  height={480}                         // optional; default 480
  className="rounded-lg border"        // optional
/>
```

### Props (`TreeViewProps`)

| Prop | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `tree` | `TreeRenderData` | yes | — | Pre-built tree snapshot. |
| `environment` | `EnvironmentRenderData` | yes | — | Pre-built environment snapshot. |
| `currency` | `CurrencyVisual` | no | `LEAF_BANKNOTE` | Cosmetic; hot-swappable at runtime. |
| `width` | `number` | no | `600` | Canvas backing-store width (px). |
| `height` | `number` | no | `480` | Canvas backing-store height (px). |
| `className` | `string` | no | — | CSS class on the `<canvas>` element. |

### Lifecycle

1. **Mount**: creates a `CanvasTreeRenderer` against the canvas ref, sets
   the backing-store size, starts a `requestAnimationFrame` loop, and
   observes the canvas with a `ResizeObserver` so the renderer's viewport
   tracks the canvas's CSS box.
2. **Each rAF tick**: computes `dt` (wall-clock ms since the previous tick,
   clamped to 250 ms so a long tab-suspend doesn't cause a huge advance),
   reads the latest props from a ref (the "latest ref" pattern — avoids
   re-subscribing the effect every render), and calls
   `renderer.render(tree, env, dt)`.
3. **Currency prop change**: calls `renderer.setCurrency(...)` — hot-swap, no
   renderer recreation, no canvas flicker, no particle-pool reallocation.
4. **Width/height prop change**: resizes the canvas backing store + calls
   `renderer.resize(...)`.
5. **Container-driven resize** (CSS box shrinks/grows): the `ResizeObserver`
   calls `renderer.resize(...)` — keeps the renderer's viewport in sync with
   the canvas's CSS box so the canvas renders crisply at any size.
6. **Unmount**: cancels the rAF, disconnects the `ResizeObserver`, disposes
   the renderer. All idempotent — safe under React StrictMode's
   mount-unmount-mount cycle in dev.

### Decoupled frame rate (TDD §15.1)

The parent re-renders React only when the simulation advances (typically
once per `engine.advance` step). The canvas itself re-draws at the browser's
native frame rate (~60 fps) against the latest snapshot. This avoids tying
the canvas to the sim's tick rate (the sim might tick once a second; the
canvas redraws at 60 fps regardless) — branch sway + weather particles
animate smoothly between sim ticks.

### Replaceable backend

The wrapper is hardcoded to `CanvasTreeRenderer` in P4d. Swapping to SVG or
WebGL is a one-line change via `createTreeRenderer({ kind: ... })` — the
React surface, the data mappers, and the constants don't change.

### Accessibility

The canvas carries `role="img"` + `aria-label="Procedural capitalist-tree
visualization"`. A future phase will add a hidden text fallback describing
the tree state (e.g. "Mature summer oak, full canopy, no damage") for screen
readers; P4d ships the static label as the minimum viable a11y surface.

---

## 6. Provisional constants

All visual tuning constants live in
`packages/rendering/src/constants/rendering.ts` and follow the
`PROVISIONAL_RENDER_*` naming convention. Each entry carries a comment
pointing at the GDD §13.4 / §14 / §17 item it resolves.

### Tree geometry (GDD §13.4)

| Constant | Value | Resolves |
|----------|-------|----------|
| `PROVISIONAL_RENDER_TREE_HEIGHT_SCALE_PX_PER_M` | `20` | Tree Visualization — height |
| `PROVISIONAL_RENDER_TRUNK_DIAMETER_SCALE_PX_PER_M` | `40` | Tree Visualization — trunk diameter |
| `PROVISIONAL_RENDER_BRANCH_SCALE_PX_PER_UNIT` | `5` | Tree Visualization — branch structure |
| `PROVISIONAL_RENDER_MIN_TREE_HEIGHT_PX` | `60` | Tree Visualization — height (floor) |
| `PROVISIONAL_RENDER_MAX_TREE_HEIGHT_PX` | `600` | Tree Visualization — height (ceiling) |
| `PROVISIONAL_RENDER_DAMAGE_MARKER_RADIUS_PX` | `6` | Tree Visualization — physical damage |
| `PROVISIONAL_RENDER_MAX_BRANCH_DEPTH` | `4` | Tree Visualization — branch structure |
| `PROVISIONAL_RENDER_BRANCH_ANGLE_SPREAD_DEG` | `35` | Tree Visualization — branch structure |
| `PROVISIONAL_RENDER_BRANCH_LENGTH_DECAY` | `0.7` | Tree Visualization — branch structure |
| `PROVISIONAL_RENDER_BRANCH_DIAMETER_DECAY` | `0.65` | Tree Visualization — branch structure |
| `PROVISIONAL_RENDER_BRANCH_CHILD_COUNT` | `2` | Tree Visualization — branch structure |

### Foliage thresholds (GDD §13.4)

| Constant | Value |
|----------|-------|
| `PROVISIONAL_RENDER_FOLIAGE_HEALTHY_THRESHOLD` | `0.7` |
| `PROVISIONAL_RENDER_FOLIAGE_STRESSED_THRESHOLD` | `0.3` |
| `PROVISIONAL_RENDER_FOLIAGE_THIN_CANOPY_THRESHOLD` | `0.4` |

### Canvas layout (GDD §13.4)

| Constant | Value |
|----------|-------|
| `PROVISIONAL_RENDER_CANVAS_TARGET_KIND` | `'canvas'` |
| `PROVISIONAL_RENDER_CANVAS_DEFAULT_WIDTH_PX` | `600` |
| `PROVISIONAL_RENDER_CANVAS_DEFAULT_HEIGHT_PX` | `480` |
| `PROVISIONAL_RENDER_GROUND_HEIGHT_FRACTION` | `0.18` |
| `PROVISIONAL_RENDER_TREE_BASELINE_FRACTION` | `0.82` |

### Particle pool sizes (TDD §15.3)

| Constant | Value |
|----------|-------|
| `PROVISIONAL_RENDER_RAIN_PARTICLE_POOL_SIZE` | `200` |
| `PROVISIONAL_RENDER_SNOW_PARTICLE_POOL_SIZE` | `150` |
| `PROVISIONAL_RENDER_FALLING_LEAF_POOL_SIZE` | `50` |

### Wind sway (TDD §15.3)

| Constant | Value |
|----------|-------|
| `PROVISIONAL_RENDER_WIND_SWAY_AMPLITUDE_PX` | `6` |
| `PROVISIONAL_RENDER_WIND_SWAY_FREQUENCY_HZ` | `0.5` |

### Money-leaf sizing (TDD §15.4)

| Constant | Value |
|----------|-------|
| `PROVISIONAL_RENDER_LEAF_TIER0_SIZE_PX` | `3` |
| `PROVISIONAL_RENDER_LEAF_TIER1_SIZE_PX` | `4.5` |
| `PROVISIONAL_RENDER_LEAF_TIER2_SIZE_PX` | `6` |
| `PROVISIONAL_RENDER_LEAF_OUTLINE_WIDTH_PX` | `0.5` |

### Banknote themes (GDD §14)

| Constant | tier0 / tier1 / tier2 |
|----------|-----------------------|
| `PROVISIONAL_RENDER_BANKNOTE_THEME_US_GREENBACK` | `#a3c98f` / `#7eb463` / `#5a8f3a` |
| `PROVISIONAL_RENDER_BANKNOTE_THEME_GOLD_FOIL` | `#f5d76e` / `#e6b94e` / `#c69a3a` |
| `PROVISIONAL_RENDER_BANKNOTE_THEME_EURO_VIOLET` | `#a3b1d4` / `#7d8cc0` / `#5a6db0` |
| `PROVISIONAL_RENDER_BANKNOTE_THEME_FALLBACK` | (alias for US greenback) |

### Sky / lighting anchors (GDD §4.1)

| Constant | Value |
|----------|-------|
| `PROVISIONAL_RENDER_DAY_PHASE_NIGHT_TOD` | `0.0` |
| `PROVISIONAL_RENDER_DAY_PHASE_DAWN_TOD` | `0.25` |
| `PROVISIONAL_RENDER_DAY_PHASE_DAY_TOD` | `0.5` |
| `PROVISIONAL_RENDER_DAY_PHASE_DUSK_TOD` | `0.75` |
| `PROVISIONAL_RENDER_NIGHT_LIGHT_LEVEL` | `0.25` |
| `PROVISIONAL_RENDER_DAWN_DUSK_LIGHT_LEVEL` | `0.7` |
| `PROVISIONAL_RENDER_DAY_LIGHT_LEVEL` | `1.0` |

### Environment / atmosphere (GDD §13.4)

| Constant | Value |
|----------|-------|
| `PROVISIONAL_RENDER_CO2_HAZE_FLOOR_PPM` | `410` |
| `PROVISIONAL_RENDER_CO2_HAZE_SATURATION_PPM` | `600` |
| `PROVISIONAL_RENDER_POLLUTION_HAZE_MAX_OPACITY` | `0.4` |
| `PROVISIONAL_RENDER_RAIN_OPACITY_MAX` | `0.5` |
| `PROVISIONAL_RENDER_CLOUD_OPACITY_MAX` | `0.7` |
| `PROVISIONAL_RENDER_SNOW_OPACITY_MAX` | `0.6` |

When a value is promoted from "provisional" to "decided" via playtesting, it
moves to a sibling `decided.ts` (future) and drops the `PROVISIONAL_` prefix;
the convention is documented at the top of `constants/rendering.ts`.

---

## 7. Import-boundary extension (P4d)

The 10 Capitalist Tree rules (GDD §16) enforce a one-way data flow:

```
                apps/web  ──► React/Next/DOM
                    │
                    ▼
                rendering  ─► DOM types only (HTMLCanvasElement)
                    │
                    ▼
                simulation  ─► pure TS, no DOM, no framework
                    │
                    ▼
                  shared   ◄── content (species, fertilizers, markets)
```

Core packages (simulation, shared, rendering) MUST NOT import UI / framework
code. The web app is the only place that touches `next` / `react` /
`react-dom` / `zustand` / `idb`. P4d extends the existing
`packages/simulation/test/import-boundary.test.ts` (which scans only the
simulation package) to cover all three core packages.

### Runtime test

`tests/import-boundaries.test.ts` scans `packages/{simulation,shared,rendering}/src/**/*.ts`
for forbidden specifiers:

- `next`, `next/**`
- `react`, `react/**`
- `react-dom`, `react-dom/**`
- `@reduxjs/**`
- `zustand`, `zustand/**`
- `idb`, `idb/**`
- `@/*` (web app alias)
- relative climbs into `apps/` (any depth — `(\.\.\/)+apps\/...`)

Detection uses regex over the import specifier. Comments are NOT flagged —
the regex requires the `import` keyword.

The per-package test at `packages/simulation/test/import-boundary.test.ts`
remains in place (preserves the P0–P3 contract); this root-level test extends
coverage to shared + rendering.

### ESLint rule

`eslint.config.mjs` adds `no-restricted-imports` (built-in ESLint rule, scoped
via the `files` array to the three core packages' src dirs). We use the
built-in `no-restricted-imports` rather than `eslint-plugin-import`'s
`no-restricted-paths` because:

1. They're functionally equivalent for banning bare specifiers + glob patterns.
2. The built-in rule requires no extra plugin dependency.
3. The runtime test at `tests/import-boundaries.test.ts` is the comprehensive
   backstop (regex-based file scan); the ESLint rule is the fast-feedback
   layer during development.

The rule bans the same specifiers as the runtime test. A violation is an
ESLint error (not a warning) — the build / CI fails.

### Rendering package's DOM-types exception

The rendering package IS allowed to import DOM *types* — its tsconfig has
`"lib": ["ES2022", "DOM", "DOM.Iterable"]` so `CanvasTreeRenderer` can use
`HTMLCanvasElement` + `CanvasRenderingContext2D`. What it must NOT do is
import a framework that takes ownership of the DOM (React/Next/etc.) — the
React wrapper (`TreeView.tsx`) lives in `apps/web/components/tree/`, not in
the rendering package. This keeps the renderer backend-agnostic: a future
Vue/Svelte/native-DOM consumer can swap the wrapper without touching the
renderer.

---

## 8. Dev demo page

Route: `/dev/tree-render-demo` (file: `apps/web/app/dev/tree-render-demo/page.tsx`).

A developer playground that exposes every scrubbable parameter the renderer
reacts to:

- **Tree**: age, height, trunk diameter, branch development, foliage density,
  foliage health, damage severity, alive/dead toggle.
- **Environment**: season, time-of-day, weather condition, weather intensity,
  soil condition, soil contamination, pollution, CO2 concentration,
  biodiversity.
- **Cosmetic**: currency visual (leaf-dollar / gold-leaf / euro-leaf).

The page builds `TreeRenderData` + `EnvironmentRenderData` FIXTURES directly
(no simulation state) — the shape matches what `buildTreeRenderData` /
`buildEnvironmentRenderData` produce from real sim state, but the values are
sliders / preset buttons, not engine output. The simulation itself still
owns all biological + economic decisions; this page just feeds the renderer
hand-crafted snapshots to exercise its visual range.

### Presets (28 named scenes)

Buttons at the top of the page flip between visually distinct scenes:
sapling variants, mature variants (per-season × per-time-of-day), stress /
damage variants (drought, heat wave, severe storm, frost + wind, dead
stump), environment variants (high CO2 haze, contaminated soil, healthy
soil, strong wind, snow coverage, dusk glow, dawn colors), currency
cosmetics (gold leaf, euro leaf, leaf dollar), and biodiversity variants.

### Decoupled frame rate

The canvas redraws at the browser's native frame rate against the latest
snapshots — branch sway + weather particles animate independently of how
often you move a slider. The simulation would feed this component once per
engine step; here we feed it directly from React state.

---

## 9. Testing

### `CanvasTreeRenderer` (P4b)

`packages/rendering/tests/canvas-tree-renderer.test.ts` — 56 tests covering
interface conformance, no-throw rendering for representative tree + environment
states, resize/dispose semantics, mock-canvas-context snapshot assertions,
determinism, and rule 6 (render never mutates inputs).

### `TreeRenderData` / `EnvironmentRenderData` mapping (P4a)

`packages/rendering/tests/tree-render-data.test.ts` (39 tests) +
`packages/rendering/tests/environment-render-data.test.ts`.

### React wrapper (P4d)

`apps/web/components/tree/TreeView.test.tsx` — 7 smoke tests under
`happy-dom` (per-file env override):

- Mounts without throwing + renders a `<canvas>` element.
- Renders with `role="img"` + `aria-label` for accessibility.
- Applies explicit width/height props to the canvas backing store.
- Applies a className to the canvas wrapper.
- Cleans up its `requestAnimationFrame` handle on unmount (verified via spy).
- Does not throw when re-rendered with new tree/environment props.
- Does not throw when width/height props change.

`happy-dom` returns `null` from `canvas.getContext('2d')` (it doesn't
implement a real 2D context), so the renderer's null-context no-op code path
is exercised — the same path a real browser takes if the canvas context is
lost.

### Import boundaries (P0 + P4d)

- `packages/simulation/test/import-boundary.test.ts` — scans
  `packages/simulation/src` (P0 baseline).
- `tests/import-boundaries.test.ts` — scans `packages/{simulation,shared,rendering}/src`
  (P4d extension).

---

## 10. R items (provisional → resolved tracking)

| R-item | Description | Status |
|-------|-------------|--------|
| R-P4-1 | Canvas-vs-SVG backend choice | **Decided (Canvas)** — see §4. |
| R-P4-2 | `TreeViewProps` contract | **Decided** — declared in P4a (`types.ts`), implemented in P4d. |
| R-P4-3 | Currency cosmetics hot-swap API | **Decided** — `renderer.setCurrency(c)` (no recreation). |
| R-P4-4 | Import-boundary extension to shared + rendering | **Decided** — runtime test + ESLint rule, see §7. |
| R-P4-5 | Dev demo page for visual QA | **Decided** — `/dev/tree-render-demo`, see §8. |
| R-P4-6 | Provisional constant promotion workflow | **Open** — convention documented in `constants/rendering.ts` header; first promotion will land a sibling `decided.ts`. |
| R-P4-7 | WebGL backend for multi-tree scenes | **Open** — future phase; interface supports it via `createTreeRenderer({ kind: 'webgl' })`. |
| R-P4-8 | Screen-reader text fallback for the canvas | **Open** — P4d ships a static `aria-label`; a dynamic state description ("Mature summer oak, full canopy, no damage") is a future a11y task. |
| R-P4-9 | Currency cosmetic ownership model | **Decided** — cosmetics live in `packages/rendering/src/currency-visuals.ts`, NOT in `packages/content` (rule 5 + rule 6). |
| R-P4-10 | Animation time-clamp policy | **Decided** — `dt` is clamped to 250 ms so a long tab-suspend doesn't cause a single huge advance (Treeview.tsx). |
