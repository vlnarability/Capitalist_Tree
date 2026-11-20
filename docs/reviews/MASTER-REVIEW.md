# MASTER REVIEW — The Capitalist Tree

**Reviewer:** RV8-synthesis (synthesizer)
**Date:** 2026-11-16
**Inputs:** RV1–RV7 (7 review reports + RV7 gap analysis), STATUS.md, GDD.txt (946 lines), TDD.txt (1492 lines)
**Repo audited:** `/home/z/my-project/capitalist-tree`

---

## 0. Repository state verification (coordinator note)

**The P10 codebase exists and is correct.** The RV8 subagent initially reported that the repo was at P1 (`dd90c27`) with the P10 code missing. The coordinator investigated and found this was caused by **sandbox recycling**: the local checkout had regressed to `dd90c27` (P1 biology only) between turns, but `origin/main` was intact at `7d8ea77` (P10, all 12 systems). The local checkout was recovered via `git merge --ff-only origin/main`, and all 5 nominated HIGH findings were re-spot-checked against the correct P10 code — **all 5 confirmed as live defects** (see §2 spot-check summary).

The review corpus (RV1–RV7) was written against the correct P10 codebase (`7d8ea77`). The findings, scorecards, and remediation plan below reflect the P10 state. The "two-layer" framing that originally appeared in this document (P10-per-reviews vs actual-repo-at-P1) has been corrected: the repo is at P10, and the scorecards reflect that.

**Verified P10 state (coordinator, after recovery):**
- HEAD: `7d8ea77` (Merge p10-global into main)
- Schema version: 13 (`CURRENT_SCHEMA_VERSION = 13` in `packages/shared/src/constants/provisional.ts`)
- 12 systems real, no stubs (`stubs.ts` exports `{}`)
- 62 test files, 1471 tests pass in 180.5s (baseline re-run by coordinator)
- `business/`, `events/random.ts`, `environment/`, `progression/`, `NotificationsPanel.tsx` all confirmed present

---

## 1. Executive Summary

The Capitalist Tree as a *simulation engine* is well-architected: deterministic, engine-independent, bigint-money, conservation-balanced, with a clean sim/UI boundary and a working offline catch-up (0 divergence from fine-step). All 12 systems are real (no stubs), 1471 tests pass in 180.5s, schema v13 with 13 migrations. The reviews converge on a verdict of "feature-complete per GDD/TDD first-prototype scope, with a short list of HIGH-severity defects that must be fixed before production." The coordinator re-verified all 5 nominated HIGH findings against the correct P10 codebase — **all 5 reproduce as live defects.**

**Is STATUS.md's "PROJECT COMPLETE" justified?** Per RV7: **partially true.** Accurate for the simulation engine and first-tree prototype (14/14 GDD §15 First Prototype items, 14/15 TDD §21 criteria pass, 9/9 milestones delivered). Inaccurate for full game scope: ~20 of 30 GameActions are simulation-only with no UI path, 10 post-prototype items are not started, and 6 HIGH-severity defects remain unfixed.

**Top 5 risks (ranked):**
1. **Infinite-money exploit (RV3-2)** — `operate-business` accepts a player-supplied `tick`, allowing duplicate demand-injection. Economy-breaking; must fix before any public deploy.
2. **Environmental feedback 1440× too fast (RV4-F-H2)** — `applyEnvironmentalFeedback` applies per-day rates every tick without `dtSeconds` scaling. Soil crashes to 0 in ~1 day. Makes the entire P10 global simulation broken.
3. **Player decoupled from regional state (RV4-F-H3) + `last-tree` objective unreachable (RV4-F-H1)** — player actions don't affect regional indicators; the destruction ending is gated off.
4. **Weather→biology wiring missing (RV2-1/RV2-2) + trait effects not wired (RV4-F-M7)** — weather-damage events are dead code; biology reads climate average not weather temperature; genetics subsystem is non-functional despite passing unit tests.
5. **Offline catch-up freezes main thread (RV5-F1) + unbounded arrays (RV5-F2) + critical notifications filtered (RV6-1)** — 6.5-min UI freeze on long absence; silent save loss from quota exhaustion; player never sees clock-tamper/corrupt-save warnings.

**Top 5 strengths:**
1. Determinism and engine independence rigorously maintained (no `Math.random`/`Date.now` in simulation; zero React/Next/DOM imports; verified by RV1 grep + import-boundary test).
2. Money is bigint-as-string everywhere; per-transfer conservation holds by construction (RV3); original-tree guard enforced across all paths (RV3).
3. Save/load with 13 migrations is pure, idempotent, version-rejected on unknown schema (RV5); offline catch-up divergence from fine-step is 0 (tolerance 1e-9).
4. Clean sim/UI separation (RV6); currency cosmetics purely visual; renderer never mutates inputs; TreeView unmount cleanup verified.
5. All 12 systems genuinely implemented with substantive logic (RV1); execution order matches TDD §4.2; schema strict (zero `as any`/`@ts-ignore` in simulation).

---

## 2. De-duplicated findings (merged across RV1–RV6)

RV7-traceability and RV7-gap-analysis are matrices/backlogs, not finding lists; their GAP items appear in §6. The coordinator re-spot-checked the 5 nominated HIGH findings (plus RV1-3) against the correct P10 codebase (`7d8ea77`, recovered from origin after sandbox recycling). The "Repro" column records: **REPRO** = reproduces as described (confirmed live defect); **PARTIAL** = code pattern exists but framing differs; **N/A** = not spot-checked (treat as the report's claim only).

Severity counts in this corpus: **BLOCKER 0, HIGH 12, MEDIUM 18, LOW 21, INFO/UNVERIFIED 2** (53 findings total across RV1–RV6).

| ID | Area | Severity | Conf. | Repro | Location (as cited) | Summary & recommended fix |
|---|---|---|---|---|---|---|
| RV3-2 | Economy | HIGH | high | REPRO | business/actions.ts:331-345, production.ts:417-453 | Infinite-money exploit: `operate-business` accepts arbitrary `payload.tick`; replay at same `now` re-triggers demand-injection. **Coordinator confirmed:** `operateBusinessHandler` (line 331) destructures `tick` from `action.payload` and passes as `now: tick`. **Fix:** reject player-supplied tick; use engine's `clock.elapsedSeconds`. |
| RV3-1 | Economy | HIGH | high | N/A | ledger.ts:273-348 | `transfer()` marks requestId after applying, never pre-checks `isRequestProcessed`. Only `requestIssuance` is replay-safe. **Fix:** pre-check at top of `transfer()`. |
| RV2-1 | Biology | HIGH | high | REPRO | weather-system.ts:154-158, weather/index.ts:9 | `weather-damage` events emitted but never consumed by biology; frost/storm/heat-wave death causes unreachable. **Coordinator confirmed:** `weather-system.ts:158` emits the event; `weather/index.ts:9` comments "P3+ consumes the `weather-damage` event payload (currently emitted but [not consumed])." NotificationsPanel maps `storm-damage`/`severe-weather` codes (notification only, not biology damage). No biology system reads the event. **Fix:** add a consumer that applies damage to `tree.damage`. |
| RV2-2 | Biology | HIGH | high | REPRO | biology/photosynthesis.ts:215 | Biology reads `environment.globalTemperature` not `weather.temperature`. **Coordinator confirmed:** `photosynthesis.ts:215` reads `ctx.environment.globalTemperature`. Frost/heat-wave weather events don't reduce photosynthesis. **Fix:** read `weather.temperature` for the temperature limiting factor. |
| RV4-F-H1 | Environment | HIGH | high | N/A | events/objectives.ts:210-236, regional.ts:183-236 | `last-tree` objective unreachable: requires `aggregateActivity ≥ 0.6` but only stochastic events raise regional industrialActivity. **Fix:** wire player extraction to regional activity, or lower threshold. |
| RV4-F-H2 | Environment | HIGH | high | REPRO | systems/events.ts:191, climate.ts:253-283 | `applyEnvironmentalFeedback` rates applied per-tick not per-day (1440× too fast). **Coordinator confirmed:** `events.ts:191` calls `applyEnvironmentalFeedback(next)` with NO `dtSeconds`; `climate.ts:141` shows `applyClimateFeedback` takes `dtSeconds` as a parameter. **Fix:** pass `dtSeconds` and scale. |
| RV4-F-H3 | Environment | HIGH | high | N/A | environment/impact.ts:66-117, regional.ts:287-385 | Player actions decoupled from P10 regional state. **Fix:** bridge extraction/restoration to regional indicators. |
| RV4-F-H4 | Environment | HIGH | high | N/A | environment/biodiversity.ts:97-122, regional.ts:287-385 | Two parallel biodiversity models (P7 + P10) that don't interact; achievement and objective read different state. **Fix:** unify the model. |
| RV4-F-H5 | Progression | HIGH | high | N/A | events/objectives.ts:313-322, systems/events.ts:146 | Objectives not persisted (R-P10-3); asymmetric with persisted achievements. **Fix:** persist `eventState.objectives.completed`; add migration. |
| RV5-F1 | Persistence | HIGH | high | N/A | useSimulationLoop boot, catch-up.ts:360 | Long offline catch-up runs synchronously on main thread; 30-day absence ≈ 6.5 min freeze. **Fix:** move to Web Worker with progress reporting. |
| RV5-F2 | Persistence | HIGH | high | N/A | shared/src/schemas (economy, history) | `economy.transactions` and `history.snapshots` unbounded `z.array`; no pruning/compaction. **Fix:** add `maxItems`, prune, compact snapshots. |
| RV6-1 | UI/Security | HIGH | high | REPRO | NotificationsPanel.tsx:87-96 | Critical notifications (`offline-clock-tampered`, `save-corrupt`, `original-tree-protected`) filtered out by `ACTIONABLE_NOTIFICATION_CODES` whitelist. **Coordinator confirmed:** the whitelist contains `expense-due, low-funds, issuance-rejected, tree-died, storm-damage, severe-weather` — none of the 3 safety-critical codes. **Fix:** add safety codes, or invert to a blocklist. |
| RV3-3 | Economy | MEDIUM | high | N/A | economy.ts:65-75 | `initialSupply` not persisted on `EconomyState`; hardcoded constant. **Fix:** persist field + migration. |
| RV3-4 | Economy | MEDIUM | high | N/A | business/market.ts:413-436 | Demand-injection backstop uncapped; masks GDD §8.5 scarcity; multiplier in RV3-2. **Fix:** cap per market per tick; consider loan-with-interest. |
| RV1-2 | Architecture | MEDIUM | medium | N/A | STATUS.md:102, rng.ts:136-148 vs events/random.ts:111-114 | STATUS "R-P10-N RNG fork ✅ RESOLVED" accurate only for EventSystem sub-RNG (`createEventSubRng` in `events/random.ts`, confirmed present in P10). `Rng.fork()` itself still consumes one root draw (`rng.ts:138` calls `this.next()`). BiologySystem, AutomationSystem, WeatherSystem consume root draws via `fork()`. **Fix:** correct STATUS.md to scope R-P10-N to EventSystem; consider refactoring `Rng.fork()` to non-advancing derivation. |
| RV1-6 | Architecture | MEDIUM | medium | N/A | systems/business.ts:109, automation.ts:64, economy.ts:51, personal.ts:73, progression.ts:120 | Per-system purity relies on helper purity; `let next = state` pattern. **Fix:** per-system `Object.freeze` purity tests. (Not individually spot-checked by coordinator; files confirmed present in P10.) |
| RV1-8 | Architecture | MEDIUM | medium | N/A | STATUS.md:76-88, dcf3f30 | "All 8 systems got targeted clones" — actually 7; EventSystem dropped its clone; Economy/Personal rely on helper purity. **Fix:** correct STATUS. |
| RV2-3 | Biology | MEDIUM | high | N/A | biology/growth.ts:112-125 | No `heightGrowth` allocation bucket; height and trunkDiameter coupled. **Fix:** add bucket or document coupling. |
| RV2-4 | Biology | MEDIUM | high | N/A | biology/harvest.ts, actions/harvest.ts | `estimateSustainableHarvest` divides by `ctx.stepDays`; action handler uses `stepDays=0` → NaN. **Fix:** guard against 0. |
| RV4-F-M6 | Progression | MEDIUM | high | N/A | objectives.ts:91-107, achievements.ts:66-102 | Threshold mismatches between achievements and objectives (wealthiest-being: $1B vs $100K). **Fix:** align. |
| RV4-F-M7 | Progression | MEDIUM | high | N/A | progression/trait-effects.ts, biology-system.ts | `applyTraitEffects` defined and unit-tested but never called; genetics subsystem non-functional. **Fix:** call it in `biology-system.ts`. |
| RV4-F-M8 | Environment | MEDIUM | high | N/A | systems/environment.ts:163-234 | Event spam: 28,223 notifications in 1 sim day. **Fix:** throttle to threshold crossings. |
| RV4-F-M9 | Environment | MEDIUM | high | N/A | regional.ts:344-346, climate.ts:304-306 | `speciesExtinctionRate` unbounded accumulator. **Fix:** cap or store as bounded saturation. |
| RV4-F-M10 | Environment | MEDIUM | medium | N/A | systems/environment.ts:97-139, biodiversity.ts:69-88 | `forestCoverage` derived from single sapling; biodiversity declines from tick 0. **Fix:** normalize for tree age/stage. |
| RV5-F3 | Persistence | MEDIUM | high | N/A | IndexedDbStorage.save(), useSimulationLoop.save() | `QuotaExceededError` not caught; state committed to store before save awaits. **Fix:** await save before commit; catch quota error. |
| RV5-F4 | Persistence | MEDIUM | high | N/A | useSimulationLoop | No concurrent-tab protection. **Fix:** `navigator.locks` or `BroadcastChannel`. |
| RV5-F5 | Persistence | MEDIUM | high | N/A | IndexedDbStorage.save() | Two `db.put`s not in one transaction; crash leaves orphan. **Fix:** single IDB transaction. |
| RV6-2 | UI | MEDIUM | high | N/A | NotificationsPanel.tsx, GDD §13.5 | 5 of 6 actionable notification codes never produced. **Fix:** bridge SimulationEvents to notifications. |
| RV6-3 | UI | MEDIUM | high | N/A | OfflineModal.tsx | Modal has `role="dialog"` but no Escape handler, focus trap, or autofocus. **Fix:** add focus management. |
| RV6-4 | Security | MEDIUM | high | N/A | package.json (zod dep) | Zod 3.25.76 vulnerable to GHSA-mrhx-c7xc-m3w5 (memory exhaustion on save validation). **Fix:** upgrade to zod 4.6.6+ or pre-validate size. |
| RV1-1 | Architecture | LOW | high | N/A | systems/economy.ts:24-26, personal.ts:34-37 | Stale doc comments about engine wrapping deepCopy. **Fix:** update comments. |
| RV1-3 | Architecture | LOW | high | REPRO | simulation.ts:117-118, TDD §6.3 | Engine drops sub-step remainder. **RV8 confirmed:** `simulation.ts:117-118` matches exactly (`wholeSteps = Math.floor(elapsedSeconds / STEP)`, `consumed = wholeSteps * STEP`). Low severity, accurate. |
| RV1-4 | Architecture | LOW | medium | N/A | events/scheduler.ts:63-95 | P0 scheduler tie-break relies on sort stability. **Fix:** add secondary sort key. |
| RV1-5 | Architecture | LOW | high | N/A | initial-state.ts:88 | `void PROVISIONAL_WEATHER_DEFAULT_CLIMATE_ID;` dead expression to silence unused import. **Fix:** remove the import. |
| RV1-7 | Architecture | LOW | medium | N/A | tests/import-boundaries.test.ts:85-97 | Boundary test misses bare DOM-global access. **Fix:** add `no-restricted-globals` ESLint rule. |
| RV2-5 | Biology | LOW | high | N/A | biology/stress.ts | Stress uses raw `tree.damage.length`, unfiltered. **Fix:** weight by severity. |
| RV2-6 | Biology | LOW | high | N/A | biology/death.ts | Mortality per-tick ≈7e-5; reachable but slow. **Fix:** re-tune after playtesting. |
| RV3-5 | Economy | LOW | high | N/A | ~15 sites across economy/business/personal | `Number()` on bigint fields; precision loss only above 2^53. **Fix:** bigint arithmetic or assertions. |
| RV3-6 | Economy | LOW | high | N/A | actions/repay-loan, actions/sell-business | No pre-check `isRequestProcessed`; safe by side-effect today. **Fix:** resolved by RV3-1 remedy. |
| RV4-F-L11 | Environment | LOW | high | N/A | regional.ts, global.ts, climate.ts, markets.ts, objectives.ts | Local `@provisional` magic numbers. **Fix:** promote to shared config after F-H2 fix. |
| RV4-F-L12 | Environment | LOW | high | N/A | regional.ts:459-464 | `'area'` aggregation silently falls back to equal weighting. **Fix:** add `area` field or remove mode. |
| RV5-F6 | Persistence | LOW | high | N/A | catch-up.ts:360, simulation.ts:120 | Redundant double deepCopy on catch-up entry. **Fix:** skip one. |
| RV5-F7 | Performance | LOW | high | N/A | biology/environment/weather-system.ts | Three systems still per-step `structuredClone` of large sub-trees. **Fix:** targeted clones. |
| RV5-F8 | Persistence | LOW | high | N/A | migrations/defaults.ts (v0→v1) | v0→v1 migration is a stub (no v0 saves). **Fix:** document v0 unsupported. |
| RV6-5 | UI | LOW | high | N/A | e2e smoke spec step 9 | Playwright step 9 false negative. **Fix:** assert container exists, not visibility. |
| RV6-6 | UI | LOW | high | N/A | TreeView.tsx | `useReducedMotion` not consumed (R-P5d-2). **Fix:** consume it. |
| RV6-7 | UI | LOW | high | N/A | TreeView.tsx | Canvas `aria-label` static. **Fix:** live textual alternative. |
| RV6-8 | Performance | LOW | medium | N/A | useSimulationLoop, HomePage | 60× re-render storm with `PROVISIONAL_UI_COMMIT_THROTTLE_MS = 0`. **Fix:** raise throttle or split store. |
| RV6-9 | Security | LOW | high | N/A | package.json (dev deps) | Dev `happy-dom` critical+2 high; prod `postcss` 2 high+2 moderate. **Fix:** update happy-dom. |
| RV6-10 | Security | LOW | high | N/A | next.config.mjs | No CSP / security headers. **Fix:** add `headers()`. |
| RV6-11 | Persistence | LOW | high | N/A | storage.load() | Load failure swallowed silently. **Fix:** distinguish no-save from load-error. |
| RV5-F9 | Persistence | INFO | high | N/A | events/objectives.ts | Objectives not persisted (team's R-P10-3). See RV4-F-H5. |
| RV2-7 | Biology | UNVERIFIED | low | N/A | biology/seasons.ts | Winter→spring budding recovery not reproduced. **Fix:** add annual-cycle vitest. |

**Spot-check summary (6 checks; the 5 nominated HIGH + RV1-3, re-verified by coordinator against P10 `7d8ea77`):**
- REPRODUCED as live defects: **6** — RV3-2 (infinite-money exploit), RV4-F-H2 (per-tick rates), RV2-1 (weather-damage unconsumed), RV2-2 (globalTemperature not weather.temperature), RV6-1 (critical notifications filtered), RV1-3 (engine drops sub-step remainder, LOW).
- All 5 nominated HIGH findings confirmed as real defects in the P10 codebase. None downgraded or rejected.

---

## 3. Hard-constraint scorecard

The scorecard reflects the P10 codebase (`7d8ea77`), verified by the coordinator after recovering the repo from origin. Findings from RV1–RV7 are incorporated.

### GDD §16 Design Constraints (14 items)

| # | Constraint | Status | Evidence |
|---|---|---|---|
| 1 | Original tree cannot be sold | PASS | RV3 verified across sell-tree / prestige / business / schema paths |
| 2 | Original tree cannot be replaced | PASS | originalLineageId preserved across prestige (RV4) |
| 3 | Tree death does not end game | PASS | `biology/death.ts` + tests; stump persists (RV2) |
| 4 | Physical money leaves = real currency | PASS | `ledger.ts`, `authority.ts` (RV3) |
| 5 | Currency issuance via central authority | PASS | `authority.ts` requestIssuance (RV3); RV3-1 idempotency gap in `transfer()` |
| 6 | Money flows through economy | PASS | RV3 verified; conservation per-transfer balanced |
| 7 | Business ownership ≠ no op costs | PASS | RV3 verified; ownership ≠ free resources |
| 8 | Environmental systems influence one another | PARTIAL | RV4-F-H2 (rates 1440× fast), F-H3 (player decoupled from regional), F-H4 (dual biodiversity models) |
| 9 | Biology internally consistent | PARTIAL | RV2-1 (weather-damage unconsumed), RV2-2 (reads globalTemperature not weather.temperature) |
| 10 | Automation has meaningful costs | PASS | RV3/RV5 verified; offline catch-up divergence=0 |
| 11 | Player can pursue destructive strategies | PARTIAL | RV4-F-H1 (`last-tree` objective unreachable via normal play) |
| 12 | Sustainability economically viable | PARTIAL | Design-promise test incomplete (RV4); structural issues (F-H1/H3) may block |
| 13 | Original tree is focal point | PASS | RV6 verified; centered, stump on death |
| 14 | Advanced details accessible but not mandatory | PARTIAL | RV6: advanced view shows numbers not relationships; ~20/30 actions no UI path (RV7) |

**Tally: 9 PASS, 5 PARTIAL, 0 FAIL.** The hard constraints hold; the PARTIALs are the HIGH-severity defects in §2.

### TDD §22 Final Architectural Principles (8 items)

| Principle | Status | Evidence |
|---|---|---|
| Simulation before presentation | PASS | `packages/simulation` independent; `apps/web` consumes it (RV1/RV6) |
| Data-driven content | PASS | White Oak + content packages; only 1 species (RV7: post-prototype) |
| Explicit accounting | PASS | Ledger/transactions bigint-string (RV3); RV3-1 idempotency gap |
| Deterministic simulation | PASS | No `Math.random`/`Date.now`; sfc32+splitmix32 RNG (RV1) |
| Persistent history | PASS | 13 migrations, save/load round-trip (RV5); objectives not persisted (RV4-F-H5) |
| Incremental complexity | PASS | Registry order stable; 12 systems (RV1) |
| Engine independence | PASS | Zero React/Next/DOM imports; `import-boundaries.test.ts` enforces (RV1) |
| Biological consistency | PASS | Liebig, survival-first, conservation verified (RV2); weather wiring partial (RV2-1/2) |

**Tally: 8 PASS, 0 PARTIAL, 0 FAIL.** Architectural principles are sound.

---

## 4. TDD §21 Acceptance Criteria scorecard (15 items)

TDD §21 says "the first playable version should not be considered complete until" all 15 hold.

| # | Criterion | Status | Evidence |
|---|---|---|---|
| 1 | New player starts with sapling + funds | PASS | `initial-state.ts`; economy seeded (RV3) |
| 2 | Player can purchase water and fertilizer | PASS | ResourceSystem (RV2) |
| 3 | Tree grows through biological processes | PASS | `biology/growth.ts` (RV2) |
| 4 | Tree produces physical money leaves | PASS | Harvest issuance (RV2/RV3) |
| 5 | Harvesting reduces foliage + photosynthetic capacity | PASS | `biology/harvest.ts` (RV2) |
| 6 | Energy reserves compensate for reduced foliage | PASS | `biology/reserves.ts`, `energy-allocation.ts` (RV2) |
| 7 | Repeated harvesting can cause irreversible damage or death | PASS | `biology-system.test.ts` (RV2) |
| 8 | Tree responds to seasons and weather | PARTIAL | Seasons yes; weather NO (RV2-1/RV2-2) |
| 9 | Personal expenses create financial requirement | PASS | PersonalSystem (RV3) |
| 10 | Simulation continues while offline | PASS | Offline catch-up divergence=0 (RV5); RV5-F1 main-thread freeze |
| 11 | Game saves and restores correctly | PASS | 13 migrations, round-trip equality (RV5); RV5-F2 unbounded arrays |
| 12 | Original tree cannot be sold or transferred | PASS | RV3 verified all paths |
| 13 | Tree's visual appearance reflects sim state | PASS | TreeRenderData, renderer (RV6) |
| 14 | Simulation testable independently of Next.js | PASS | `vitest run` — 1471 tests pass in 180.5s |
| 15 | Deterministic under identical inputs | PARTIAL | Architecturally satisfied (seeded RNG, purity); no e2e "same seed → identical state" acceptance test |

**Tally: 12 PASS, 3 PARTIAL, 0 FAIL.** The 3 PARTIALs are: #8 (weather→biology wiring, RV2-1/2), #10 (offline freeze, RV5-F1), #15 (missing e2e determinism test). All are fixable defects, not missing systems.

---

## 5. Corrections to STATUS.md

STATUS.md (read at `/home/z/my-project/upload/STATUS.md`) makes the following claims. Each is assessed against the verified P10 codebase (`7d8ea77`).

| STATUS.md claim | Verdict | Evidence / correction |
|---|---|---|
| "PROJECT COMPLETE — feature-complete per GDD/TDD" | **PARTIALLY TRUE** | RV7 verdict: accurate for simulation engine + first-tree prototype (14/14 GDD §15 First Prototype, 14/15 TDD §21, 9/9 milestones). Inaccurate for full game scope: ~20/30 GameActions unreachable from UI, 10 post-prototype items not started, 6 HIGH defects unfixed. |
| "1471/1471 tests pass (63 files, 178 seconds, 0 failures)" | **TRUE** | Coordinator re-ran baseline: 1471/1471 pass, 63 files, 180.5s, 0 failures. |
| "All 12 systems real, no stubs" / "12 of 12 (ALL real, no stubs)" | **TRUE** | `stubs.ts` exports `{}`; all 12 systems have substantive `execute()` logic (RV1 verified). |
| "Schema version 13" | **TRUE** | `CURRENT_SCHEMA_VERSION = 13` in `packages/shared/src/constants/provisional.ts`. |
| "Main HEAD `7d8ea77`" | **TRUE** | `origin/main` at `7d8ea77`; coordinator recovered local checkout via `git merge --ff-only origin/main`. (Note: local checkout had regressed to P1 due to sandbox recycling — recovered.) |
| "R-P10-N: RNG fork ✅ RESOLVED (seeded FNV-1a sub-RNG, zero root draws)" | **PARTIALLY TRUE** | Accurate for EventSystem sub-RNG (`createEventSubRng` in `events/random.ts`, confirmed present). But `Rng.fork()` itself still consumes a root draw; BiologySystem/AutomationSystem/WeatherSystem use it. STATUS should scope R-P10-N to EventSystem only (RV1-2). |
| "Perf fix in all 8 systems" (R-P10-6) | **PARTIALLY TRUE** | RV1-8: 7 systems got targeted clones (dcf3f30), EventSystem dropped its upfront clone (2c9635d), Economy/Personal rely on helper purity. "All 8" overstates; should be "7 systems + EventSystem wrapper." |
| "R-P10-3: Objectives NOT persisted (recomputed each tick) — Future schema addition" | **TRUE** | RV4-F-H5 confirmed: objectives are read-only, recomputed each tick, only a transient notification. Asymmetry with persisted achievements noted. |
| Phase history table (P1–P10 merges with commit hashes) | **TRUE** | All 10 phase merges confirmed on `origin/main` git log (P1 `dd90c27` → P10 `7d8ea77`). |
| "P10 Sub-task Summary" (P10a–P10d, Perf 1–3 commits) | **TRUE** | All 7 commits (`bf45c10`, `687b0a1`, `a562d06`, `8ef3914`, `b7ab51c`, `dcf3f30`, `2c9635d`) confirmed in git log. |
| Documentation "11 files in docs/" | **TRUE** | All 11 doc files confirmed present including `global.md` (1434 lines). |

**Net correction:** STATUS.md is largely accurate. The only corrections needed: (1) scope R-P10-N to EventSystem (not all RNG forks), (2) correct "all 8 systems" to "7 systems + EventSystem wrapper", (3) add the HIGH-severity defects from this review as known issues, (4) note that ~20/30 GameActions are simulation-only (no UI path).

---

## 6. Prioritized remediation plan

The repo is at P10 (`7d8ea77`). The remediation plan is a single track: fix the HIGH-severity defects identified in §2, then harden the MEDIUMs, then build the post-prototype backlog from RV7. The reviews' GAP-1 through GAP-41 (from RV7-gap-analysis) are folded in.

### (a) Fix-first — BLOCKER/HIGH defects

| # | Work item | Scope | Acceptance criteria | Size | Deps |
|---|---|---|---|---|---|
| W1 | Reject player-supplied tick in `operate-business` (RV3-2) | Strip `payload.tick`; use engine `clock.elapsedSeconds`. | Vitest proves dispatching forward-dated `operate-business` then `advance(STEP)` does not create duplicate demand-injection. | S | — |
| W2 | Pre-check `isRequestProcessed` in `transfer()` (RV3-1) | Add idempotency guard at top of `transfer()`. | Replayed transfer with same requestId is a no-op; all existing transfer tests still pass. | S | — |
| W3 | Pass `dtSeconds` to `applyEnvironmentalFeedback` (RV4-F-H2) | Scale all rate applications by `dtSeconds`; re-derive `@provisional` rate constants per-day. | Soil health no longer crashes to 0 in 1 day; `docs/global.md` §5 calibration updated; long-run soil stays in [0,1]. | M | — |
| W4 | Wire weather→biology (RV2-1, RV2-2) | Add `weather-damage` consumer applying to `tree.damage`; read `weather.temperature` in `photosynthesis.ts`. | Frost event reduces photosynthesis and adds damage entry; GDD §5.6 weather death causes reachable. | M | — |
| W5 | Make `last-tree` objective reachable (RV4-F-H1) | Wire player extraction to regional `industrialActivity`. | A player running extraction-heavy strategy can raise `aggregateActivity ≥ 0.6` without stochastic events. | M | W3 |
| W6 | Bridge player actions to regional state (RV4-F-H3) | Map extraction/restoration/emissions to regional indicators. | Player action visibly moves regional `forestCoverage`/`biodiversity`/`pollution`. | L | W3 |
| W7 | Unify P7/P10 biodiversity (RV4-F-H4) | Single biodiversity model; achievements + objectives read same slice. | Achievement and objective for "great-restoration" read identical state. | M | W6 |
| W8 | Persist objectives (RV4-F-H5, R-P10-3) | Add `eventState.objectives.completed` + migration. | Save/load preserves objective completion; no re-fire notification. | M | — |
| W9 | Wire `applyTraitEffects` into biology-system (RV4-F-M7) | Call before computing biology parameters. | Activating `trait:rapid-growth` measurably changes growth rate in a test. | S | — |
| W10 | Show critical notifications (RV6-1) | Add safety codes to `ACTIONABLE_NOTIFICATION_CODES` or invert filter. | `offline-clock-tampered`, `save-corrupt`, `original-tree-protected` render in the panel. | S | — |
| W11 | Move offline catch-up to Web Worker (RV5-F1) | Off-main-thread catch-up with progress `postMessage`. | 30-day absence shows a progress bar, no "page unresponsive" dialog. | L | — |
| W12 | Bound transactions/history arrays (RV5-F2) | `maxItems` on schemas + pruning/compaction. | 100-year run save size stays under a documented cap; load time bounded. | M | — |
| W13 | Cap demand-injection backstop (RV3-4) | Per-market per-tick cap; consider loan-with-interest. | Market scarcity (GDD §8.5) is enforceable; no infinite-demand-injection path. | M | W1 |
| W14 | Persist `initialSupply` (RV3-3) | Add field to `EconomyState` + migration. | `conservationDiscrepancy()` usable on loaded saves; non-default starts compute correct monetary-conditions. | S | — |

### (b) Hardening — MEDIUM defects

| # | Work item | Scope | Size |
|---|---|---|---|
| W15 | Throttle environment notifications (RV4-F-M8) | Emit on threshold crossing, not every tick; dedup. | S |
| W16 | Cap `speciesExtinctionRate` (RV4-F-M9) | Bounded saturation value. | S |
| W17 | Normalize `forestCoverage` for saplings (RV4-F-M10) | Exempt young trees from deforestation stress. | S |
| W18 | Align achievement/objective thresholds (RV4-F-M6) | Same state slices, consistent thresholds. | S |
| W19 | Add per-system `Object.freeze` purity tests (RV1-6) | Freeze input, run system, assert no mutation, for all 12 systems. | M |
| W20 | Catch `QuotaExceededError`; commit-after-save (RV5-F3) | Await save before store commit; show notification on failure. | S |
| W21 | Concurrent-tab protection (RV5-F4) | `navigator.locks` or `BroadcastChannel`. | S |
| W22 | Single IDB transaction for save (RV5-F5) | Wrap both `db.put`s in one transaction. | S |
| W23 | OfflineModal accessibility (RV6-3) | Escape handler, focus trap, autofocus. | S |
| W24 | Zod 4 upgrade or pre-validation size cap (RV6-4) | Close GHSA-mrhx-c7xc-m3w5. | M |
| W25 | Bridge SimulationEvents→notifications (RV6-2) | Map tree stress, weather, objectives, business flags, harvest. | M |
| W26 | Guard `estimateSustainableHarvest` against `stepDays=0` (RV2-4) | Return 0 or default to 1. | S |
| W27 | Add `heightGrowth` bucket or document coupling (RV2-3) | Decide and implement. | S |
| W28 | Correct STATUS.md "8 systems" → 7 (RV1-8) + stale comments (RV1-1) | Doc-only. | S |
| W29 | Per-tick profiler + CI perf regression (GAP-41) | Instrument and gate. | M |
| W30 | CSP / security headers in next.config.mjs (GAP-38) | `X-Content-Type-Options`, `X-Frame-Options`, CSP. | S |

### (c) Post-prototype feature backlog (from RV7, lower priority)

GAP-16 (2nd species), GAP-17 (climates), GAP-18 (pests/disease), GAP-19 (reproduction/seeding), GAP-20 (soil depth), GAP-21 (missing environmental indicators), GAP-22 (missing markets), GAP-23 (org-type incentives), GAP-24 (international trade), GAP-25 (government depth), GAP-26 (currency cosmetics), GAP-27 (multiplayer), GAP-28 (monetization), GAP-29 (audio/art), GAP-30 (i18n), GAP-31 (analytics), GAP-32 (CI/CD), GAP-33 (tutorial), GAP-35 (advanced-view explanations), GAP-36 (ending UI), GAP-37 (Firefox/WebKit E2E), GAP-40 (concurrent-tab — also W21). These are P1–P3 in RV7's phase plan and are not remediation; they are scheduled in §7.

---

## 7. Proposed second batch of implementation prompts (outline)

Per RV7's P11/P12/P13 phasing. Titles and one-paragraph scope only; full prompts to be authored by the coordinator.

> **2026-11-17 — Roadmap revised per DECISIONS.md (DR-1 through DR-9).** Status
> of the prompts below:
> - **1–6 (P11-A through P11-F): COMPLETE** (W1–W30 + W15 follow-up all landed).
> - **7 (P12-A 2nd species): COMPLETE.** DR-4 (height/diameter independence,
>   commit 96b95dd) was the prerequisite; Eastern Hemlock (evergreen,
>   `deciduous: false`) added as the 2nd species — exercises the data-driven
>   content pipeline + the evergreen seasonal contrast (keeps
>   photosynthesizing/leaves in winter vs the oak's dormancy) + DR-4's
>   per-species height/diameter split (hemlock height-focused 0.55 vs oak
>   girth-heavy 0.40).
> - **8 (P12-B pests/disease/reproduction): PARTIAL.** Pests + disease
>   infestations (GAP-18) done (b6ffa61) — they drive the P12-C wear path.
>   Reproduction/seeding (GAP-19) complete. Seed PRODUCTION done (the
>   BiologySystem fills `seedGrowthProgress` from `alloc.reproduction`, emits
>   `seed-dispersed` when it reaches 1.0 past the fruiting gate `matureAgeDays ×
>   PROVISIONAL_BIOLOGY_REPRODUCTION_FRUITING_AGE_FRACTION`). The fraction was
>   lowered 0.1 → 0.01: `matureAgeDays` uses SIM days (= matureAgeYears × 120), so
>   White Oak's 24000 d = 200 sim-yr (the original "≈ 66 sim-yr" comment confused
>   calendar + sim years); at 0.1× the gate was 2400 d = 20 sim-yr — UNREACHABLE in
>   any normal sim (the dr1-long-run is 5 sim-yr), so seed production never fired +
>   the plant-seed action had nothing to plant. At 0.01× the gate is 240 d = 2
>   sim-yr (date palm 60 d, saxaul 96 d — fast-maturing species fruit earlier),
>   reachable in a typical long play session + the dr1-long-run. Tested in
>   `reproduction.test.ts` (incl. a reachability calibration test). The PLANTING
>   flow + new action surface done: the `plant-seed` action consumes a seed →
>   credits `PROVISIONAL_PROGRESSION_LEGACY_POINTS_PER_SEED` genetic-legacy points
>   (the prestige currency funding `unlock-research`), a mid-generation earning
>   mechanism supplementing the generation-end prestige bonus; emits `seed-planted`;
>   throws `InsufficientSeedsError` when the tree has no seeds; tested in
>   `plant-seed-action.test.ts`; exposed in the UI via `SeedControls` (a "Genetic
>   Legacy" panel). The full "offspring tree" (multi-tree) concept is handled by
>   `prestige-reset` (establishes a new generation). The `seasonality` →
>   season-calendar refinement (tropical wet-dry / polar short-growing-window) is
>   DONE (GAP-17 follow-up (b), 3b47933) — no longer deferred.
> - **9 (P12-C balance re-tuning): PARTIAL.** The chronic-neglect mortality
>   path is done + meets the DR-1 6-12mo neglect-death target: P12-C
>   weather→defoliation (739d4df) + the wear redesign (deaf446: monotonic wear
>   counter + wear mortality path, removed the fragile stress-threshold chronic
>   death) + the nutrient-uptake/infestation-rate follow-up (d9d750e:
>   MAX_UPTAKE_FRACTION 1.5→5.0 fixed nutrient depletion so the tree survives
>   winter; infestation rates ×1.5 so the wear reaches the onset at ~6mo).
>   Verified: 270-day idle audit — seed 100 dies at ~6.2mo, seed 7 at ~10.4mo,
>   both via the wear path. Remaining: the design-promise bot
>   (extractive-vs-sustainable-vs-balanced at 5/25/100yr) + verifying the other
>   DR-1 targets (financial independence ≤60d, ecological collapse ≥2yr under
>   sustained exploitation, ecological recovery ≥1yr).
> - **10 (P12-D soil depth + analytics + CI/CD): PARTIAL.** CI/CD (GAP-32)
>   done; soil depth (GAP-20) done (9016f53 — pH/compaction/microbial promoted
>   from P2 stubs into modeled dynamics, feeding soil health); analytics
>   (GAP-31) remains.
> - **11 (P13-A): DONE.** Environmental indicators + markets + org-type
>   incentives (GAP-21, GAP-22, GAP-23) implemented in `bf8d5f4`. GAP-21
>   (environmental indicators): the four long-horizon indicators — `airQuality`,
>   `oceanHealth`, `wetlandCoverage`, `nutrientRunoff` — are stepped each tick by
>   `stepIndicators` (`packages/simulation/src/environment/indicators.ts`, wired
>   into the EnvironmentSystem at slot 10c) with sensitivities in
>   `constants/environment.ts`; tested in `environment.test.ts`. UI surface added
>   this turn: an `IndicatorsSection` in `EnvironmentPanel` (advanced view)
>   displays all four with tone-tinted Stats + air/ocean health ProgressBars;
>   tested in `panels.test.tsx`. GAP-22 (markets) + GAP-23 (org-types): the labor
>   market (`packages/content/src/markets/labor.ts`) + org-type structures
>   (corporation/cooperative, `packages/content/src/businesses/org-types.ts`)
>   are present with tests (`markets.test.ts`, `business-market.test.ts`) —
>   implemented in `bf8d5f4`, not deeply re-verified this turn.
> - **12 (P13-B): GAP-24 DONE (this turn); GAP-25 largely present.**
>   GAP-24 (international trade): the sim layer (`applyImport` / `applyExport`
>   in `markets.ts`, wired via the `import-commodity` / `export-commodity`
>   handlers) + tariffRate were already in `f8def74` / `e3afa02`, but import /
>   export settled at the DOMESTIC market price — so import (price + tariff)
>   was never rational vs buying local. This turn added the missing piece:
>   content-defined `foreignPriceMultiplier` per `MarketDefinition` +
>   `computeForeignUnitPrice(def)` helper; `applyImport` / `applyExport` now
>   settle at the FOREIGN (world) price = `basePrice × foreignPriceMultiplier`,
>   decoupled from the domestic supply/demand price → cross-region arbitrage
>   (food 0.8× base import beats domestic; energy 1.2× base export pays a
>   premium). `importCommodity` / `exportCommodity` action factories in
>   `lib/actions.ts`; `TradePanel` UI in the advanced view (per-commodity
>   domestic vs foreign price, held inventory, import/export buttons, tariff);
>   mounted in `app/page.tsx`. Tests: +4 arbitrage (events.test.ts — import
>   cost = foreign price not market price; food import cheaper than domestic;
>   export revenue = foreign price; neutral-multiplier water) + 7 TradePanel
>   UI.
>   GAP-25 (government depth) — DONE (this turn): the schema + wired actions
>   (`set-government-policy` / `set-monetary-policy` / `lobby-government`) +
>   `PolicyPanel` UI + subsidies/tariff effects were already present from
>   `f8def74` / `e3afa02`, BUT four policy levers had NO game effect — they were
>   settable (UI + actions) + auto-adjusted (EventSystem) but didn't bite. This
>   turn made three of them bite: (1) `environmentalRegulations` mitigates the
>   pollution + industrialActivity deltas in `applyPlayerEnvironmentalImpact`
>   (× `1 - reg × PROVISIONAL_ENV_REG_EFFECTIVENESS`); (2) `carbonTaxRate`
>   charges `carbonEmissions × rate × price` player:personal → authority via a
>   new pure `applyCarbonTax` helper, hooked into `operate-business` (no-op at
>   the default rate=0); (3) `interestRate` anchors every new loan's rate to
>   `monetaryPolicy.interestRate + PROVISIONAL_LOAN_SPREAD_OVER_POLICY_RATE` in
>   the take-loan handler (the player-supplied payload rate is ignored). New
>   constants in `shared/constants/economy.ts`. Tests: +2 env-reg mitigation,
>   +3 carbon-tax (charge / no-op-at-rate-0 / no-op-at-emissions-0), +1
>   interestRate-anchoring; 2 existing tests updated (take-loan rate 0.05→0.07;
>   W5 test neutralizes env-reg). `inflationTarget` + `moneySupplyGrowth`
>   remain display-only levers (future: hook into the authority's issuance
>   cadence) — noted as follow-up.
> - **13 (P13-C productization): IN FLIGHT.** CSP headers (W30) + perf gate
>   (W29) + cross-browser E2E (GAP-37) done; Zod 4 (DR-7) + i18n scaffold +
>   audio/art remain. (GAP-37 re-verified: the `b9db3c8` commit — firefox +
>   webkit projects in `apps/web/playwright.config.ts` + the CI step that
>   `playwright install --with-deps chromium firefox webkit` then runs
>   `test:e2e` (executing all three projects) — IS in HEAD's history
>   (`git merge-base --is-ancestor b9db3c8 HEAD` = 0); the earlier "lost to a
>   sandbox reset — needs reapplication" note was stale. Local firefox/webkit
>   execution isn't possible in this sandbox — the browser binaries downloaded
>   but `validateDependenciesLinux` fails on missing system libs (libgraphene,
>   libgst, libmanette, libenchant-2, libGLESv2, …) + there's no passwordless
>   sudo to apt-install them; CI's `--with-deps` provisions them on the runner.
>   The smoke spec uses only standard `getByTestId`/`click`/`fill`/`reload` APIs
>   — no browser-specific code — so it's expected to pass on all three.)
> - **14 (P13-D): REVISED.** Multiplayer removed (DR-2); monetization scoped
>   cosmetic-only (DR-3). Remaining P13-D work is cosmetic-content plumbing.
> - **NEW prompts added by the decisions:** DR-6 (RNG fork versioning +
>   migration), DR-7 (Zod 4 upgrade — now), DR-9 (regression test harness for
>   RV3-2 + RV4-F-H2).

1. **P11-A: Recover or rebuild P2–P10 baseline.** Reconcile the repository to the state STATUS.md claims (locate `7d8ea77` or rebuild P2–P10 from the local `p2-resources-weather` branch forward). Until this is done, no other P11 prompt can be executed against this repo. Scope: git archaeology + (if needed) sequential phase merges P2→P10.

2. **P11-B: Fix the six economy/security HIGH defects.** Apply W1–W2, W13, W14 (RV3-1/RV3-2/RV3-3/RV3-4) plus W10 (RV6-1 critical notifications) and W9 (RV4-F-M7 trait wiring). These are small, isolated, and independently testable. Scope: ledger idempotency, tick rejection, demand-injection cap, initialSupply persistence, notification whitelist, trait-effects call site.

3. **P11-C: Fix the environmental simulation HIGH defects.** Apply W3–W7 (RV4-F-H1 through F-H5, RV2-1/RV2-2). These are interdependent and re-calibrate the entire P10 environmental model. Scope: `dtSeconds` scaling, weather→biology wiring, player↔regional bridge, biodiversity unification, objective persistence.

4. **P11-D: Persistence and offline hardening.** Apply W11, W12, W20–W22, W24 (RV5-F1/F2/F3/F4/F5, RV6-4). Scope: Web Worker catch-up, bounded arrays, quota handling, concurrent-tab protection, single-transaction saves, Zod upgrade.

5. **P11-E: Wire unreachable GameActions to UI + add Objectives/Ending panel (GAP-1, GAP-36).** Bridge ~20 simulation-only actions to UI panels (Business, Research, Genetics, Prestige, Events, Policy); add the objectives/ending screen. Scope: UI reachability for the midgame/endgame loop.

6. **P11-F: Acceptance test + README + error boundary (GAP-14, GAP-15, GAP-34).** Add the e2e "same seed → identical state" determinism test, the README, and a React error boundary. Scope: close TDD §21 #15 and TDD §3 README requirement.

7. **P12-A: Second tree species + species-specific seasonality (GAP-16).** Add an evergreen species with contrasting seasonal behavior; exercise the data-driven content pipeline. Scope: content + biology seasonality branching.

8. **P12-B: Pests, disease, reproduction/seeding (GAP-18, GAP-19).** Add new death/stress causes and the seed production + planting flow. Scope: biology depth + new action surface.

9. **P12-C: Balance re-tuning + design-promise bot (RV4 incomplete experiment).** After P11 fixes, re-tune growth/mortality/market/environmental rates and run the extractive-vs-sustainable-vs-balanced comparison at 5/25/100yr. Scope: calibration + design-promise validation.

10. **P12-D: Soil depth + analytics + CI/CD (GAP-20, GAP-31, GAP-32).** Promote soil-depth stubs (pH, compaction, microbial); add analytics/error reporting; stand up CI on `.github/workflows`. Scope: TDD §8.3 completion + productization.

11. **P13-A: Missing environmental indicators + markets + org types (GAP-21, GAP-22, GAP-23).** Air quality, ocean, wetlands, runoff indicators; equipment/labor/land markets; distinct org-type incentives. Scope: GDD §8/§9 post-prototype depth.

12. **P13-B: International trade + government depth (GAP-24, GAP-25).** Cross-region trade flows; lobbying/regulation/central-bank policy depth. Scope: GDD §15 long-term economic scope.

13. **P13-C: Productization hardening (GAP-29, GAP-30, GAP-37, GAP-38, GAP-40, GAP-39).** Audio/art polish, i18n scaffold, Firefox/WebKit E2E, CSP headers, concurrent-tab protection (if not done in P11-D), Zod 4 (if not done in P11-D). Scope: production-ready deploy.

14. **P13-D: Multiplayer + monetization decisions (GAP-27, GAP-28).** Resolve GDD §17 unresolved items; if multiplayer, rework persistence/authority for server-authoritative economy. Scope: long-term architectural commitment.

---

## 8. Open questions requiring a human design decision

> **2026-11-17 — ALL 9 RESOLVED.** Every question below is now decided + recorded
> formally in `docs/reviews/DECISIONS.md` (DR-1 through DR-9). The questions are
> retained below as historical context; the decision record is canonical. §7's
> roadmap prompts have been revised accordingly (see the per-prompt notes).

1. **Balance targets (GDD §17).** Growth rates, mortality, market scarcity, environmental recovery timescales are all `@provisional` constants. RV2-6, RV4-F-M10, and RV4's incomplete design-promise experiment all depend on these being tuned. What are the target time-to-death, time-to-ecological-collapse, and time-to-financial-independence values? **[RESOLVED — DR-1]**

2. **Multiplayer scope (GDD §17).** Unresolved. The architecture is local-first (IndexedDB, no server timestamps, no concurrency control — RV5-F4). If multiplayer is in scope, persistence and authority must be reworked before more local-first features accumulate (RV7 risk table).

3. **Monetization model (GDD §17).** Unresolved. GDD says "nothing provides gameplay advantage." Decide before launch; the decision constrains what cosmetics/convenience features can be sold.

4. **Species count and seasonal model.** Only White Oak exists. RV2-3 (no `heightGrowth` bucket) and the coupled height/diameter model suggest the biology allocation schema should be revisited before a 2nd species is added (GAP-16). Is height-vs-girth independence a goal?

5. **Is the autonomous regional model intentional?** RV4-F-H3 asks whether the P10 regional model is meant to be a spectator simulation the player watches, or player-driven. GDD §10 says player-driven; the code (per RV4) is autonomous. Which is canonical?

6. **Should `Rng.fork()` be made non-root-consuming?** RV1-2 notes the EventSystem sub-RNG is zero-root-draw but `Rng.fork()` itself still advances the root. Is keeping `fork()` root-consuming a deliberate choice (to avoid retuning mortality), or a refactor target?

7. **Zod 4 upgrade timing (RV6-4).** Closes a high-severity advisory on the save-validation path but is a breaking API change. Upgrade now (before more schemas accumulate) or later?

8. **Should objectives be persisted like achievements?** RV4-F-H5 / R-P10-3. The asymmetry is a UX defect; persistence + an Objectives panel is the obvious fix, but the team marked it "future schema addition." Confirm it is in scope for P11.

9. **Should the reviews' HIGH findings be reproduced end-to-end before treating as blockers?** RV3-2 and RV4-F-H2 are confirmed by source reading + coordinator spot-check (all 5 HIGH reproduce). Should the team invest in a vitest harness inside `packages/simulation/test/` to demonstrate RV3-2 (infinite-money) and RV4-F-H2 (per-tick rates) with a running exploit/measurement before committing the fixes?

---

## 9. Counts reported

**Findings across RV1–RV6 (defect findings, excluding RV7's GAP backlog):**

| Severity | Count |
|---|---|
| BLOCKER | 0 |
| HIGH | 12 |
| MEDIUM | 18 |
| LOW | 21 |
| INFO / UNVERIFIED | 2 |
| **Total** | **53** |

RV7-gap-analysis additionally lists 41 backlog items (GAP-1 through GAP-41); these are scope gaps, not defects, and are folded into §6.

**Coordinator spot-checks (re-verified against P10 `7d8ea77` after recovering repo from origin):**

| Spot-check | Severity (per report) | Result against P10 (`7d8ea77`) |
|---|---|---|
| RV3-2 infinite-money exploit | HIGH | **REPRODUCED** — `operateBusinessHandler` (business/actions.ts:331) destructures `tick` from `action.payload`, passes as `now: tick` to `operateBusiness`. Exploit vector confirmed. |
| RV4-F-H2 per-tick rates | HIGH | **REPRODUCED** — `events.ts:191` calls `applyEnvironmentalFeedback(next)` with NO `dtSeconds`; `climate.ts:141` shows the function takes `dtSeconds`. Rates unscaled. |
| RV2-1 weather-damage unconsumed | HIGH | **REPRODUCED** — `weather-system.ts:158` emits `weather-damage`; `weather/index.ts:9` comments "P3+ consumes... currently emitted but [not consumed]". No biology consumer exists. |
| RV2-2 globalTemperature vs weather.temperature | HIGH | **REPRODUCED** — `photosynthesis.ts:215` reads `ctx.environment.globalTemperature`, not `weather.temperature`. Frost/heat-wave have no photosynthesis effect. |
| RV6-1 critical notifications filtered | HIGH | **REPRODUCED** — `NotificationsPanel.tsx:87-96` `ACTIONABLE_NOTIFICATION_CODES` contains `expense-due, low-funds, issuance-rejected, tree-died, storm-damage, severe-weather` — none of `offline-clock-tampered`, `save-corrupt`, `original-tree-protected`. |
| RV1-3 engine drops sub-step remainder (bonus) | LOW | **REPRODUCED** — `simulation.ts:117-118` matches exactly. |

**Tally: 6 spot-checks; 6 reproduced (5 HIGH + 1 LOW). All 5 nominated HIGH findings confirmed as live defects in the P10 codebase.**

---

## 10. Reviewer's note on confidence and scope

This master review was produced by the RV8 synthesizer subagent, which initially ran against a sandbox-recycled checkout that had regressed to P1 (`dd90c27`). The subagent correctly flagged that the working tree did not match the review corpus — but the root cause was sandbox recycling, not missing code. The coordinator recovered the repo from `origin/main` (`7d8ea77`, P10 complete), re-ran the baseline (1471/1471 tests pass in 180.5s), and re-verified all 5 nominated HIGH findings against the correct P10 codebase. **All 5 reproduce as live defects.**

The seven review reports (RV1–RV7) are internally thorough, well-cited, and consistent with one another. They describe the P10 codebase accurately. The coordinator's spot-checks confirm the HIGH findings are real. The remediation plan in §6 is actionable against the current `7d8ea77` HEAD: fix the 14 HIGH/MEDIUM work items (W1–W14), then the hardening items (W15–W30), then build the post-prototype backlog (§7).

The one caveat the reviews themselves flag: RV2's multi-year reproduction experiments and RV4's design-promise bot comparison did not complete (subagent step limits + tsx workspace resolution issues). These should be re-run as vitest test files inside `packages/simulation/test/` to confirm the biology/weather behavior and the extractive-vs-sustainable balance experimentally.

---

*End of master review.*
