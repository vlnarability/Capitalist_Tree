# Decision Record — Capitalist Tree

Formal record of the design + architectural decisions resolving the open
questions in `docs/reviews/MASTER-REVIEW.md` §8. These decisions were adopted
on 2026-11-17 + are the standard against which future architectural decisions
are evaluated.

The game is a **single-player, persistent, real-time simulation with
deterministic, independently testable systems + player-directed economic +
environmental consequences.** Every decision below reinforces that shape.

| # | Topic | Decision | Resolves §8 Q | Status |
|---|---|---|---|---|
| DR-1 | Balance targets | Provisional real-time targets; tune through simulation | #1 | Adopted (targets provisional) |
| DR-2 | Multiplayer | Single-player only | #2 | Adopted (final) |
| DR-3 | Monetization | Cosmetic-only | #3 | Adopted (final) |
| DR-4 | Tree biology | Independent height + diameter growth | #4 | Adopted (final) |
| DR-5 | Regional model | Player-driven outcomes + autonomous background processes | #5 | Adopted (final) |
| DR-6 | RNG forks | Non-root-consuming forks, versioned for save compatibility | #6 | Adopted (migration-gated) |
| DR-7 | Zod 4 | Upgrade now | #7 | Adopted (in flight) |
| DR-8 | Objectives | Persist + Objectives panel (P11) | #8 | Adopted (persistence + panel done; enrichments future) |
| DR-9 | HIGH findings | Build regression tests; don't delay confirmed fixes | #9 | Adopted |

Only **DR-1's numerical targets** remain explicitly provisional — they need
simulation data before they can be considered final. All other decisions are
final direction.

---

## DR-1: Balance targets (provisional)

**Resolves §8 #1.** Establishes explicit gameplay targets measured in
real-world elapsed time (the game clock runs 1:1 with real time).

| Metric | Initial target | Design intent |
|---|---|---|
| Financial independence | 30–60 days | A reasonably engaged player can escape basic financial survival within the first couple of months. |
| Death from severe neglect | 6–12 months | A neglected tree is recoverable for a meaningful period, but not indefinitely. |
| Ecological collapse under sustained extreme exploitation | 2–4 years | Environmental destruction is a long-term consequence, not an immediate punishment. |
| Ecological recovery | 1–5+ years | Recovery should generally take longer than causing damage. |

These are **initial tuning targets, not hard-coded guarantees.** They are
provisional pending simulation data.

**Mortality differentiation.** Three distinct mortality scenarios must be
modeled + tuned independently:

- **Neglect** — gradual deterioration, with opportunities to intervene.
- **Aggressive harvesting** — potentially fatal within a growing season for a
  young tree, but not necessarily for a mature tree.
- **Repeated overharvesting** — progressive reserve depletion, eventually
  resulting in death.

**Ecological collapse differentiation.** A region can become severely degraded
well before the global ecosystem reaches collapse. Regional degradation +
global collapse are separate thresholds, not a single scalar.

**Implication for P12-C.** The design-promise bot (P12-C) must run the
extractive-vs-sustainable-vs-balanced comparison at 5/25/100yr AND verify the
above real-time targets hold (financial independence ≤ 60d, neglect death ≥
6mo, collapse ≥ 2yr under sustained exploitation, recovery ≥ 1yr). All
`@provisional` rate constants (growth, mortality, market scarcity,
environmental recovery) are tuned against these targets.

**Status:** Adopted — targets provisional. Replaces the GDD §17 "Environmental
recovery timescales" + "Detailed photosynthesis and energy allocation
equations" open items with concrete measured goals.

---

## DR-2: Multiplayer scope (final)

**Resolves §8 #2.** Single-player only. Do not build multiplayer into the
current architecture.

The game concept is fundamentally a persistent individual simulation.
Multiplayer introduces substantial additional complexity —
server-authoritative simulation, shared world state + synchronization,
concurrent transactions, conflict resolution, account authentication +
ownership, anti-cheat + economic integrity, server-side persistence + time
authority. There is no demonstrated gameplay requirement that justifies those
costs yet.

Keep the simulation deterministic + independent of the browser, but do not
introduce multiplayer infrastructure preemptively. **If multiplayer becomes a
real requirement, treat it as a separate architectural project** (it would
rework persistence + authority for server-authoritative economy).

**Status:** Adopted — final. Closes GDD §17 "Multiplayer or single-player
scope." Removes P13-D's multiplayer work item from the roadmap.

---

## DR-3: Monetization model (final)

**Resolves §8 #3.** Cosmetic-only monetization. The GDD principle that
purchases must not provide gameplay advantages remains.

**Sellable (cosmetic):**
- Alternative banknote + leaf appearances.
- Tree bark, foliage, + seasonal visual styles.
- Environmental visual themes.
- UI themes + presentation options.
- Cosmetic tree variations.
- Decorative items that do not affect simulation outcomes.

**Not sellable (gameplay-affecting):**
- Faster growth.
- Increased harvesting yields.
- Reduced operating costs.
- Environmental recovery boosts.
- Additional production capacity.
- Exclusive genetic advantages.
- Convenience features that materially reduce gameplay friction.

**Time skips are explicitly excluded** from sale. The game's central theme is
the relationship between time, growth, + exploitation; selling ways to bypass
those systems would undermine that theme.

**Status:** Adopted — final. Closes GDD §17 "Final monetization model."
Constrains P13-D: no gameplay-affecting monetization, no time-skip sales.

---

## DR-4: Tree biology — independent height + diameter growth (final)

**Resolves §8 #4.** Height + girth must be independently represented biological
dimensions. A tree's height + trunk diameter are related but not
interchangeable.

- A tree can grow taller while adding relatively little trunk diameter.
- A tree can increase trunk diameter without substantial height growth.
- Environmental conditions + species genetics influence the relationship.
- Age + maturity change allocation priorities.

The simulation must model **height growth + diameter growth separately**, with
species-specific allocation rules + allometric constraints.

**Do not add a second species until this schema is corrected.** For the initial
release, one fully implemented White Oak is preferable to several species that
share an inaccurate biological model.

**Implication for P12-A.** P12-A (2nd species, GAP-16) is **re-sequenced**:
the height/diameter independence refactor is now a prerequisite (P12-A-pre),
+ the 2nd species follows only after the schema is corrected. The current
coupled height/diameter model (RV2-3: no `heightGrowth` bucket) is the blocker.

**Status:** Adopted — implemented. Height + diameter now grow from
INDEPENDENT energy buckets (`EnergyAllocation.heightGrowth` vs `trunkGrowth`,
split per the species' `heightDiameterSplit`), resolving the RV2-3 coupling
(both were driven by `alloc.trunkGrowth`). An allometric constraint
(`species.maxSlendernessRatio`) caps height growth at
`trunkDiameter × maxSlendernessRatio` — a tree must add girth before it can
add height beyond the sustainable bound (the cap never shrinks an
already-slender tree; it halts further height growth until diameter catches
up). The total structural eu is unchanged from pre-DR-4, so the energy balance
(growth vs reserve) is preserved; only the height/diameter distribution is now
species-specific + independently controllable.

White Oak config: `heightDiameterSplit: 0.4` (girth-heavy — diameter gets 60%),
`maxSlendernessRatio: 40` (at the maxima 25m / 1.5m the ratio is ~16.7, so the
clamp only bites for unrealistic sapling shapes). Schema fields default to
0.5 / 50 for future species. No save migration: `EnergyAllocation` is a runtime
computation (not persisted) + the species config is code-only (looked up by id,
not stored in saves); `TreeState.structure` (height/trunkDiameter) is unchanged.

Verified: `biology.test.ts` 64/64 (incl. 5 new DR-4 tests — bucket split,
height-favoring vs diameter-favoring growth, allometric clamp halts an
already-slender tree without shrinking, well-proportioned sapling unaffected,
tree at the cap grows height only as diameter permits); full-repo typecheck
0 errors; 95 related-suite tests pass (energy-pool, business-growth-pressure,
economy-integration, progression-trait-effects, progression-genetics).
`biology-system.test.ts` hangs in this sandbox but the hang is pre-existing
(reproduces on the pre-DR-4 commit dba5b33) + unrelated to DR-4; a single
biology-system test runs + passes. P12-A (2nd species) is unblocked.

---

## DR-5: Regional model — player-driven + autonomous background (final)

**Resolves §8 #5.** The GDD is canonical: the player must have meaningful
influence over regional environmental outcomes. However, autonomous simulation
is still necessary — the world continues functioning when the player does
nothing.

Regional behavior is divided into two layers:

**Autonomous processes (background):**
- Weather + climate.
- Natural vegetation growth.
- Background pollution.
- Natural resource depletion.
- Population + ecosystem changes.
- Environmental recovery.

**Player-driven processes:**
- Industrial development.
- Land conversion + deforestation.
- Reforestation.
- Resource extraction.
- Pollution controls.
- Conservation + restoration.
- Regional investment.

The player can meaningfully change the trajectory of a region, but not
directly control every individual environmental event.

**Implication.** This resolves the apparent contradiction between GDD §10
(player-driven) + the P10 code (autonomous, per RV4-F-H3). The P10 player↔
regional bridges (W5/W6 — player extraction mapped to regional
`industrialActivity`, player actions move regional `forestCoverage`/
`biodiversity`/`pollution`) implement the player-driven layer; the autonomous
layer remains. No further architecture change required — the existing two-layer
split is canonical.

**Status:** Adopted — final. Closes GDD §17 "Regional simulation granularity"
+ resolves RV4-F-H3.

---

## DR-6: RNG forks — non-root-consuming, versioned (migration-gated)

**Resolves §8 #6.** Refactor toward non-root-consuming forks. A fork should
derive a deterministic independent RNG stream from the parent state + a stable
identifier, **without consuming the parent's next random value.**

This provides better isolation between simulation systems — adding a weather
calculation should not change mortality outcomes simply because it consumes
additional random values.

**Migration concern.** Changing the RNG implementation alters existing
simulation outcomes. The migration is gated:

1. **Preserve** the current implementation as a legacy RNG version.
2. **Introduce** a new version with non-root-consuming forks.
3. **Add deterministic tests** for both.
4. **Version the RNG behavior in save metadata** (`saveEnvelope.rngVersion` or
   equivalent).
5. **Use the new behavior for new simulations;** legacy saves keep their
   original RNG version so their random sequence does not silently change.

Do not silently change the random sequence for existing saves.

**Implication.** This is a refactor with a schema/migration component (new
save metadata field + a migration that stamps existing saves with the legacy
RNG version). It must not regress the determinism test (TDD §21 #15: same seed
→ identical state).

**Status:** Adopted — fully implemented (steps 1–5). The non-root-consuming v2
fork, the `Rng.forkVersion` field, the `GameState.rngVersion` schema field, the
v16→v17 migration (legacy saves → v1), the CURRENT_SCHEMA_VERSION bump (16→17),
deterministic tests for both v1 + v2, the per-tick root nonce (simulation.ts:
under v2 the root advances exactly one draw/tick independent of fork count, so
adding a fork cannot shift other systems' RNG-driven outcomes), + the switchover
of new sims to v2 are all in place. Legacy saves keep v1 (their sequence is
preserved exactly).

**Switchover complete — the "mortality regression" was a probe artifact.** An
earlier switchover attempt reported a systematic mortality regression (7/7
starved trees surviving 10+ days under v2, p ≈ 0.0004) + deferred the switchover.
Re-investigation found the probe imported `DAY` from `@capitalist-tree/shared`,
which does not export it — so `DAY` was `undefined`, `engine.advance(state,
undefined)` computed `wholeSteps = Math.floor(undefined / STEP) = NaN`, the step
loop ran **0 times**, + the tree was never advanced at all. The "survival" was
the unchanged input state. With the correct duration (`SECONDS_PER_DAY = 86400`),
v2 mortality works as designed: 4 of 5 seeds (7, 11, 42, 99) die within 10 days,
consistent with the ~77% expected death probability (0.05/day × defoliation +
reserves paths); only seed 3 survives 10 days (the unlucky tail). Seed 7 dies on
sim day 3 under v2.

The v2 RNG sequence differs from v1 (non-root-consuming forks + the nonce shift
per-tick fork sequences), so mortality **timing** differs — a starved tree dies
within ~3 days under v2 vs within 1 day under v1 (for the seeds calibrated to
each). This is the expected, intended RNG-sequence change from DR-6, not a
regression: the mortality *probability* (0.05/day) is unchanged; only the
*draw sequence* that realizes it differs.

Test recalibration for the v2 sequence:
  - The 3 "does NOT perturb mortality" tests (events/progression/environment)
    + the offline-catch-up mortality test used `crippled(3)` + a 1-day advance,
    calibrated to v1's sequence (seed 3 dies within 1 day under v1). Under v2,
    seed 3 survives ~10 days, so they now use `crippled(7)` (dies on day 3 under
    v2) + a 10-day advance (3 chunks for the catch-up test). The systems under
    test (Event/Progression/Environment) use hash-derived sub-RNGs or non-root-
    consuming forks, so they cannot perturb the BiologySystem's mortality
    sequence — the tree dies the same way with them present.
  - The 4 "persists the SAME root RNG" tests (business/environment/events/
    progression) do a manual one-step replay that previously did not apply the
    v2 per-tick nonce; they now mirror `runOneStep`'s `if (rng.forkVersion === 2)
    rng.next()` so the replayed root state matches the full engine's.

Verified: simulation suite 1008/1008 (excluding biology-system.test.ts, which
hangs pre-existingly on both v1 + v2 — unrelated); shared suite 63/63; full-repo
typecheck 0 errors. The v2 mechanism + switchover are regression-guarded by
`packages/simulation/test/rng.test.ts` (DR-6 fork-versioning describe block) +
the recalibrated mortality/root-RNG tests.

---

## DR-7: Zod 4 upgrade — now (in flight)

**Resolves §8 #7.** Upgrade now, before additional save schemas + validation
logic accumulate. The save-validation path is important enough that leaving a
high-severity advisory (GHSA-mrhx-c7xc-m3w5) unresolved is not justified simply
to avoid a breaking API change.

> Note: the advisory is **already mitigated** in P11-D via the pre-validation
> size/depth gate in `packages/shared/src/serialization/index.ts` (the
> "pre-validation size cap" alternative in W24). DR-7 goes further: eliminate
> the vulnerable zod 3.x entirely (defense in depth).

**Recommended sequence:**
1. Upgrade Zod (`zod@^4`).
2. Resolve API + type compatibility.
3. Run all existing validation tests.
4. Test loading older save versions (migrations).
5. Test malformed + partially corrupted saves.
6. Confirm migration behavior.

**Implication.** The codebase uses Zod-4-compatible APIs (`.default` 131×,
`.optional` 30×, `.nullable` 3×, `.refine`/`.superRefine` 3×, `.issues` for
error reading). The main risk is `z.enum`/`z.discriminatedUnion` API changes +
subtle parse-strictness shifts. The upgrade is scoped to `packages/shared` +
`packages/simulation` (the two packages that depend on zod).

**Status:** Adopted — in flight. The longer the project waits, the more
schemas + dependent code need migration.

---

## DR-8: Objectives — persist + Objectives panel (persistence + panel done)

**Resolves §8 #8.** Objectives should persist like achievements. The current
asymmetry (achievements persist, objectives don't) creates an inconsistent
experience — a player can make progress toward an objective but the game does
not reliably preserve that progress.

The objective system requires:
- Stable objective identifiers.
- Current progress.
- Completion status.
- Completion timestamp.
- Optional objective category.
- Optional rewards or unlocks.

An **Objectives panel** shows active, completed, + available objectives.

**Important distinction:** objectives should **not dictate how the player must
play.** They provide direction + recognition without turning the game into a
linear checklist. The open-ended nature of the game remains intact.

**Implication.** P11 already did W8 (persist `eventState.objectives.completed`
+ migration) + P11-E added the Objectives/Ending panel. DR-8 confirms this is
in scope for P11 + directs verification against the requirements above
(stable IDs, progress, completion status + timestamp, category, rewards,
panel for active/completed/available).

**Status:** Adopted — persistence verified (W8: `eventState.objectives.completed`
survives save/load, tested at `events-objectives.test.ts:209-247`) + the
ObjectivesPanel built (`apps/web/components/objectives/ObjectivesPanel.tsx`,
wired into `app/page.tsx`, shows all six GDD §12 objectives with live progress
+ Completed/In-Progress/Available status). The richer fields DR-8 lists —
per-objective completion timestamp, category, rewards/unlocks — remain future
work (the current schema persists `completed: ObjectiveId[]`; progress is
derived at runtime via `evaluateObjectives`, so it does not need persistence).

---

## DR-9: HIGH findings — regression tests, don't delay confirmed fixes

**Resolves §8 #9.** Build the Vitest reproduction harness, but do not make
reproducing every finding a prerequisite for fixing confirmed defects. The
findings are already supported by source inspection + coordinator verification
— that is sufficient to treat them as actionable.

Executable regression tests are important, especially for simulation defects.
Priority:

| Finding | Test requirement | Priority |
|---|---|---|
| RV3-2: infinite-money exploit | Reproduce the exploit + assert the corrected system cannot create money through the affected path. | Critical |
| RV4-F-H2: per-tick rates | Measure rates across different tick frequencies + verify equivalent elapsed-time results. | Critical |
| Other HIGH findings | Add targeted regression tests where behavior can be expressed as an invariant. | High |

The test harness lives inside `packages/simulation/test/`, as proposed.

**Per-tick test specifics:** test the same simulated elapsed time using
different tick sizes. A rate-based mechanic should not produce materially
different economic or biological outcomes merely because the simulation
processes more ticks.

**Infinite-money test specifics:** test the entire transaction path —
transfers, costs, + account consolidation. A test that only checks an isolated
function could miss the actual exploit.

Do not delay a straightforward security or economic fix just to build an
elaborate demonstration. **Write a failing regression test, fix the issue,
verify the test passes.**

**Implication.** RV3-2 + RV4-F-H2 were already FIXED in P11-B (W1) + P11-C
(W3). DR-9 directs adding the regression tests that would have caught them
(guard against regression). These tests assert the invariants the fixes
established.

**Status:** Adopted. The fixes are in; the regression tests are the remaining
deliverable.

---

## Architectural observation

These decisions establish a clear direction: **the game is a single-player,
persistent, real-time simulation with deterministic, independently testable
systems + player-directed economic + environmental consequences.** That is the
standard against which future architectural decisions are evaluated.

The only item kept explicitly provisional is the **numerical balance tuning in
DR-1.** Those values need simulation data before they can be considered final.

## Roadmap impact

These decisions are recorded here + used to update the development roadmap
(`docs/reviews/MASTER-REVIEW.md` §7). Summary of roadmap changes:

- **P12-A** (2nd species) re-sequenced: height/diameter independence refactor
  (DR-4) is now a prerequisite.
- **P12-C** (balance re-tuning) unblocked against DR-1's targets.
- **P13-D** multiplayer removed (DR-2); monetization scoped cosmetic-only (DR-3).
- **DR-6** (RNG fork versioning) + **DR-7** (Zod 4) + **DR-9** (regression
  tests) added as new implementation items.
- **DR-8** (objectives) confirmed in P11 scope — verify completeness.
