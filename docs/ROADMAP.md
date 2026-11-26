# Roadmap — wrap-up plan (audit 2026-11-25)

A forward-tracking roadmap derived from a full audit of the W52–W79 plan
against the actual codebase, git history, and review docs. Items are marked
`[x]` (confirmed shipped) or `[ ]` (open). **This doc is updated as changes
are confirmed in code** — see the changelog at the bottom.

Last updated: 2026-11-25

---

## ⚠️ Numbering collision — read first

The codebase's **shipped commits** use W-numbers offset ~1 from this plan, **and**
the codebase `W77`–`W81` is a separate death-investigation hotfix stream (the
25yr-death arc ending in `W81`/`fcbf69a`), **not** the roadmap's `W77`–`W79`.
Match by *description*, not number:

| Roadmap item | Shipped as | Commit |
|---|---|---|
| W52 notification bridge | W25/W31 | `69a1f1b` / `68a3211` |
| W53 perform-labor | (codebase "W54") | `a6f7f37` |
| W54 Settings panel | (codebase "W55") | `7e5cb9c` |
| W55 canvas aria-label | (codebase "W56") | `1aa393e` |
| W56 WCAG 2.1 AA | (codebase "W57") | `7eba9ef` |
| W57 design-promise bot 5yr | (codebase "W58") | `1eb55c1` / `e603ebb` |
| roadmap W77/W78/W79 | ≠ codebase W77–W81 (death arc) | — |

---

## Already shipped — no action

- [x] **W52** notification bridge (R-P5d-6) — `event-to-notification.ts:50`,
      wired in `game-store.ts:544` + `:577`. Shipped W25/W31.
- [x] **W53** perform-labor + LaborControls panel — `actions.ts:269`,
      `LaborControls.tsx`, `personal.ts:117`. Commit `a6f7f37`.
- [x] **W54** Settings panel (mute/locale/motion/theme) — `SettingsModal.tsx`,
      mounted `page.tsx:81`. Commit `7e5cb9c`.
- [x] **W55** canvas live aria-label (RV6-7) — `TreeView.tsx:390` dynamic +
      `:416` aria-live region. Commit `1aa393e`.
- [x] **W56** WCAG 2.1 AA audit + remediation — `ui.md:637-646` all 8 criteria
      ✅, contrast suite. Commit `7eba9ef`.
- [x] **W57** design-promise bot — 5yr leg: all 4 scenarios PASS, DR-1 fully
      verified (`DECISIONS.md:243`). Commit `1eb55c1`/`e603ebb`.
- [x] **W57** — 25yr leg (sustainable+balanced): `_w77-long-horizon.test.ts`,
      trees alive at 25yr post-W81. Commits `fcbf69a`/`798224f`.
- [x] Bug A (event flood) — H1 `a48ceee`. Bug B (inert expenses) — W46
      `c419eb1`. Bug C (zero-issuance) — H2 `df28ec2`. W81 25yr death —
      `fcbf69a`.

---

## Real remaining gaps (23)

### 🔴 Phase A — Launch gates + quick wins

- [x] **W72** concurrent-tab re-review (DR-10). **DONE 2026-11-25** — BLOCK
      retained for launch (data-loss risk > UX friction; no telemetry pre-launch;
      post-launch revisit criterion set in DR-10).
- [x] **W57** 100yr extrapolation. **DONE 2026-11-25** —
      `_w57-long-horizon-100yr.test.ts` (env-configurable via `DR1_HORIZON_YEARS`,
      default 100yr, ~45min full run); smoke-tested at 1yr (27s, report
      well-formed); excluded from default suite (run on demand). 5yr DR-1 ✓,
      25yr ✓, 100yr runner shipped. Full 100yr run is on-demand (~45min,
      exceeds the sandbox 10-min command limit).
- [x] **W60** trait-effects `default:` skip → throw on unknown trait
      (`trait-effects.ts:274`). **DONE 2026-11-25** — `default:` now throws for a
      defined-but-unwired trait id (unknown ids still skipped by the
      `getTraitById` guard); +`trait-effects-w60.test.ts` (2 tests).
- [x] **W77** sub-step remainder carry, RV1-3 (`simulation.ts:207`).
      **DONE 2026-11-25** — non-defect: the consumer (`use-engine-game.ts:77-80`)
      already carries the fractional remainder in a fixed-timestep accumulator
      (`accumulator -= consumedSeconds`). The `advance`-layer floor is correct
      (preserves purity / splittability). RV1-3 clarified in MASTER-REVIEW; no
      code change.
- [x] **W76** mark RV5-F8 RESOLVED in MASTER-REVIEW (v0→v1 stub exists,
      `defaults.ts:84`; v0 documented unsupported in `simulation.md:558`).
      **DONE 2026-11-25** — RV5-F8 row marked RESOLVED (v0-unsupported was
      already documented in `simulation.md` + `defaults.ts:85`).
- [x] **W79** doc staleness sweep — `progression.md:858` + `ui.md:13-23`.
      **DONE 2026-11-25** — fixed both confirmed-stale sections: progression.md
      R-P9-2 ("trait-effects wiring deferred" → DONE W9/W32, verified
      `biology-system.ts:132`); ui.md P5d phase status ("This phase" → Shipped).
      Broader doc-vs-HEAD sweep remains ongoing (lower priority).
- [x] **W78** diagnose `biology-system.test.ts` hang (DR-4/DR-6, pre-existing).
      **DONE 2026-11-25** — hang no longer reproduces: 23/23 tests pass in ~22s.
      Root cause was the structural-growth runaway that W80/W81 capped (5yr
      plateau); the long-run invariant tests now complete bounded. DR-4/DR-6 hang
      mentions updated in DECISIONS.md (3 sites).

### 🟡 Phase B — Core sim tightening (now unblocked: W57 5yr validates constants)

- [x] **W73** promote `@provisional` constants → shared config. **DONE 2026-11-25**
      — created `packages/shared/src/constants/decided.ts` (the promotion target
      per `provisional.ts`'s convention) + promoted 10 structural/foundational
      constants (`REAL_TO_SIM_SECONDS`, `SIMULATION_STEP_SECONDS`, the `SPEED_*`
      set, `DAYS_PER_SEASON`/`YEAR`) from `provisional.ts` → `decided.ts` (dropped
      the `PROVISIONAL_` prefix). Backward-compat aliases in `provisional.ts`
      re-export the old names → zero import-site breakage (~47 sites).
      Balance/economy constants stay provisional (need 100yr validation; W58
      wires inflation). Typecheck ✓ (shared+sim), 39 tests ✓.
- [x] **W58** wire `inflationTarget`/`moneySupplyGrowth` into authority issuance
      cadence. **DONE 2026-11-25** — added `deriveIssuancePolicy(state)` to
      `authority.ts` (reads `monetaryPolicy.inflationTarget` +
      `economy.inflationRate`; the authority now reads the fields — were
      display-only). Cooling fee = `max(0, inflation − target)`, **trust-gated**
      to a sane inflation range (the markets annualization is noisy — wild values
      → fee 0, preserving prior behavior) + capped at 10%. Implemented the
      previously-dead `issuanceFeeFraction` application in `requestIssuance`
      (seigniorage withheld; net transferred; fee=0 → no-op, preserves balance).
      `moneySupplyGrowth` read in a gated growable-maxTotal formula (W58b
      activates the cap pending 100yr validation). EconomySystem now derives the
      policy per-tick instead of the static `DEFAULT_ISSUANCE_POLICY`. +w58
      test (8 cases). Full sim suite 1244/1244 ✓.
- [x] **W74** objectives richer persistence. **DONE 2026-11-25** — added
      `eventState.objectives.details`: a `Record<id, { achievedAt, category,
      reward }>` populated on first achievement (parallel to the existing
      `completed: ObjectiveId[]`, which stays for backward compat — zero reader
      churn). Added `OBJECTIVE_METADATA` (category + reward per objective) +
      extracted `recordObjectiveAchievements` (pure writer, idempotent across
      re-crossings — first `achievedAt` preserved). Schema v18→v19 migration
      backfills `details: {}` for pre-W74 saves. +w74 test (7 cases) + 2
      migration tests. shared 73 ✓, sim 1251 ✓.

### 🔵 Phase C — Content/depth big lifts (not launch-gates, parallelizable)

- [x] **W62** hand-author 25 species. **DONE 2026-11-25** — replaced the 25
      factory `makeSpecies` calls across the 5 biome files (temperate 9,
      continental 7, tropical 4, arid 4, polar 1) with full hand-authored
      `TreeSpecies` objects (white-oak/eastern-hemlock gold-standard shape: every
      field explicit + per-species biological reasoning). Values derive from the
      factory's allometric formulas (balance-consistent) via a persisted generator
      script (`scripts/w62-species-generator.py`); species-specific overrides
      preserved (baobab's stout trunk, polylepis/arctic-willow low slenderness).
      Fixed the factory's evergreen-broadleaf form bug — live-oak, southern-beech,
      olive, polylepis were mis-classified as conifers; now correctly
      `form='broadleaf'` (a balance change for those 4 non-default species only;
      DR-1/100yr use white-oak, unaffected). Also fixed a pre-existing
      `SENEAGAL_MAHOGANY`→`SENEGAL_MAHOGANY` typo in the index. content typecheck
      ✓, species tests 31 ✓, sim suite 1234 ✓. Unblocks W63 (art assets).
- [x] **W63** species/seasonal art assets. **DONE 2026-11-26** — the procedural
      renderer's species silhouette system was scaffolded but hollow: `SPECIES_SHAPE_BY_ID`
      mapped only 2/27 species (proto-oak, white-oak) + `speciesShape` was cached
      but never drawn (every species rendered the same round canopy). W63 (a) extends
      `SPECIES_SHAPE_BY_ID` to all 27 hand-authored species (assigned by real-world
      form: broadleaf-round=oak/baobab, broadleaf-oval=beech/kapok, conical=spruce/
      hemlock/pine/redwood, columnar=lodgepole-pine, palm=date-palm) + (b) implements
      per-shape canopy geometry in `_buildStructure` via `canopyGeometryForShape`
      (disc/ellipse for round/oval/columnar, cone narrowing upward for conical,
      downward fan for palm) + branchDepth=0 for palms (trunk-only, fronds=leaf
      slots). The 4-season `SeasonalAppearance` system was already complete. +w63
      test (12 cases: coverage, all-5-shapes-used, assignments, render-smoke per
      shape). rendering typecheck ✓, rendering suite 127 ✓.
- [ ] **W68** audio variety (1 ambient + 3 SFX; no weather/harvest/seasonal).
      Effort M.
- [ ] **W69** i18n deeper strings + locales (en/zh-CN/es, UI chrome only).
      Effort M.
- [ ] **W67** cosmetic catalog + Packs 2-N (Pack 1 done `1b7a0d1`; catalog
      infra + Packs 2-N unimplemented). Effort L.
- [ ] **W66** palm render type (declared `types.ts:55`, no renderer branch,
      P6+ tropics). Effort S-M.
- [x] **W64** SVG renderer. **DONE 2026-11-26** — the factory threw "future
      phase" for `kind: 'svg'`. W64 ships `SvgTreeRenderer` (renders the tree as
      SVG markup — `<line>` branches, `<circle>` leaves, sky/ground rects — into a
      container's `innerHTML`; caches the layout by signature). To avoid per-backend
      layout drift, the canvas renderer's `_buildStructure` was extracted to a shared
      `tree-layout.ts` (`buildTreeLayout` + `treeStructureSignature` + `canopyGeometryForShape`)
      that Canvas / SVG / WebGL all consume; `render-colors.ts` holds the shared
      seasonal-foliage + leaf-size helpers. rendering typecheck ✓.
- [x] **W65** WebGL renderer. **DONE 2026-11-26** — the factory threw "future
      phase" for `kind: 'webgl'`. W65 ships `WebGlTreeRenderer` (a minimal shader
      program — vertex + fragment — that draws branches as `gl.LINES` + leaves as
      `gl.POINTS` against a sky-colored clear; lazy shader compile, cached
      layout/buffers, px→clip-space conversion). Every GL call is guarded against
      falsy returns (lost context / mock / compile failure → silent no-op, TDD §15.3).
      Shares `buildTreeLayout` with Canvas + SVG. +w64/w65 test (17 cases: interface,
      no-throw per shape, winter-bare, dead/stump, null-GL no-op, factory wiring).
      rendering 144 ✓.

### ⚪ Phase D — Deferred by design / post-launch — do NOT build now

- [ ] **W71** analytics external adapter (DR-13: only if commercial release).
- [ ] **W75** ProgressionSystem RNG fork (R-P9-1: lands when stochastic
      mechanics arrive; deterministic today).
- [ ] **W59** achievement real tracking (R-P9-5/6 deferred; proxies via
      `totalSinks`/`ecosystemResilience`).
- [ ] **W61** sell-tree non-original (P8+ multiple-trees; handler + error
      class exist, throws `TreeSaleNotImplementedError`; needs valuation model).
- [ ] **W70** per-tick profiler CI trend (profiler + perf-gate done
      `aa07f83`; CI trend/dashboard missing — observation-driven, post-launch).

---

## Launch-readiness verdict

With Phase A done, the only true launch-gate left is **W72's warn-vs-block
re-review decision** — W57's DR-1 targets already pass at 5yr
(`DECISIONS.md:245`). Everything in B/C/D is depth/polish, not gating.

---

## Changelog

- 2026-11-25 — initial audit + roadmap created.
- 2026-11-25 — W72 RESOLVED: concurrent-tab BLOCK retained for launch; DR-10
  re-reviewed with post-launch revisit criterion.
- 2026-11-25 — W60 RESOLVED: trait-effects `default:` now throws (loud failure
  for defined-but-unwired traits); +trait-effects-w60.test.ts.
- 2026-11-25 — W77 RESOLVED (by design): sub-step remainder already carried by
  the consumer's fixed-timestep accumulator; RV1-3 clarified as non-defect in
  MASTER-REVIEW (no code change — moving carry into `advance` would break purity).
- 2026-11-25 — W76 RESOLVED: RV5-F8 marked RESOLVED in MASTER-REVIEW (v0
  unsupported already documented in simulation.md + defaults.ts).
- 2026-11-25 — W79: corrected two confirmed-stale doc sections (progression.md
  R-P9-2 trait-effects wiring → DONE W9/W32; ui.md P5d phase status → Shipped).
- 2026-11-25 — W57 RESOLVED: 100yr long-horizon runner shipped
  (`_w57-long-horizon-100yr.test.ts`, env-configurable via `DR1_HORIZON_YEARS`,
  smoke-tested at 1yr); DECISIONS/MASTER-REVIEW updated (25yr+100yr runners now
  both exist). Full 100yr run is on-demand (~45min).
- 2026-11-25 — W78 RESOLVED: biology-system.test.ts hang no longer reproduces
  (23/23 in ~22s); root cause was the structural-growth runaway fixed by
  W80/W81; DECISIONS.md hang mentions updated (3 sites).
- 2026-11-25 — W73: created `decided.ts` + promoted 10 structural constants
  from `provisional.ts` (backward-compat aliases, zero import-site breakage);
  typecheck (shared+sim) + 39 tests ✓. Balance constants stay provisional.
- 2026-11-25 — W58: `deriveIssuancePolicy` wires `monetaryPolicy` into the
  authority (cooling fee ← inflationTarget, trust-gated + capped; moneySupplyGrowth
  ← growable cap formula, gated W58b); implemented the dead `issuanceFeeFraction`
  application; EconomySystem derives policy per-tick. Full sim suite 1244/1244 ✓.
- 2026-11-25 — W74: objectives richer persistence — `objectives.details`
  (achievedAt/category/reward) + `OBJECTIVE_METADATA` + `recordObjectiveAchievements`
  (pure writer); schema v18→v19 migration backfills `details: {}`. shared 73 ✓,
  sim 1251 ✓.

**Phase B complete (2026-11-25):** W73, W58, W74 all resolved. The core sim is
tightened — provisional structural constants promoted to `decided.ts`, the
monetary-policy levers wired into authority issuance, + objective completion
persists rich metadata. See the per-item checkboxes above.

- 2026-11-25 — W62: hand-authored the 25 factory species as full `TreeSpecies`
  objects (generator `scripts/w62-species-generator.py`, balance-consistent via
  the factory formulas); fixed the evergreen-broadleaf form bug + the
  SENEAGAL→SENEGAL typo. content typecheck ✓, species 31 ✓, sim 1251 ✓.
- 2026-11-26 — W63: species silhouettes — extended `SPECIES_SHAPE_BY_ID` to all
  27 species + implemented per-shape canopy geometry (`canopyGeometryForShape`:
  disc/cone/fan distributions; palm branchDepth=0). The shape was cached but not
  drawn before; now each species renders a distinct silhouette. rendering 127 ✓.
- 2026-11-26 — W64/W65: SVG + WebGL renderers — extracted the canvas layout to a
  shared `tree-layout.ts` (`buildTreeLayout` + `treeStructureSignature` +
  `canopyGeometryForShape`) + `render-colors.ts` so all three backends paint the
  same geometry; shipped `SvgTreeRenderer` (SVG markup into a container) +
  `WebGlTreeRenderer` (GL_LINES branches + GL_POINTS leaves, minimal shader
  program). The factory's svg/webgl cases no longer throw. rendering 144 ✓.

**Phase A complete (2026-11-25):** W72, W57, W60, W77, W76, W79, W78 all
resolved. The only true launch-gate (W72 warn-vs-block re-review) is decided —
BLOCK retained. See the per-item checkboxes above.
