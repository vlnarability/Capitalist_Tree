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
- [ ] **W57** 100yr extrapolation. 5yr DR-1 verified ✓, 25yr ✓; 100yr runner
      missing (~23min/scenario detached). Not DR-1-required (`DECISIONS.md:245`)
      but closes P12-C scope. Effort M.
- [ ] **W60** trait-effects `default:` skip → throw on unknown trait
      (`trait-effects.ts:274`). Effort S.
- [ ] **W77** sub-step remainder carry, RV1-3 (`simulation.ts:207`
      `Math.floor` discards fractional tick). Effort S.
- [ ] **W76** mark RV5-F8 RESOLVED in MASTER-REVIEW (v0→v1 stub exists,
      `defaults.ts:84`; v0 documented unsupported in `simulation.md:558`).
      Effort XS.
- [ ] **W79** doc staleness sweep — `progression.md:858` + `ui.md:13-23`
      confirmed stale vs HEAD. Effort S.
- [ ] **W78** diagnose `biology-system.test.ts` hang (DR-4/DR-6, pre-existing).
      Effort S-M.

### 🟡 Phase B — Core sim tightening (now unblocked: W57 5yr validates constants)

- [ ] **W73** promote `@provisional` constants → shared config
      (`regional.ts`/`climate.ts`/`markets.ts`/`objectives.ts`). Effort M.
- [ ] **W58** wire `inflationTarget`/`moneySupplyGrowth` into authority
      issuance cadence (fields exist `event-system.ts:404`, display-only;
      `authority.ts` never reads them). Effort M.
- [ ] **W74** objectives richer persistence (schema stores only `ObjectiveId[]`,
      `event-system.ts:518`; add timestamp/category/rewards). Effort M.

### 🔵 Phase C — Content/depth big lifts (not launch-gates, parallelizable)

- [ ] **W62** hand-author 25 species (only White Oak + Hemlock hand-tuned;
      25 are factory `make-species.ts`). Effort L.
- [ ] **W63** species/seasonal art assets (6/12 slots, `credits.md:85`; needs
      W62 first). Effort L.
- [ ] **W68** audio variety (1 ambient + 3 SFX; no weather/harvest/seasonal).
      Effort M.
- [ ] **W69** i18n deeper strings + locales (en/zh-CN/es, UI chrome only).
      Effort M.
- [ ] **W67** cosmetic catalog + Packs 2-N (Pack 1 done `1b7a0d1`; catalog
      infra + Packs 2-N unimplemented). Effort L.
- [ ] **W66** palm render type (declared `types.ts:55`, no renderer branch,
      P6+ tropics). Effort S-M.
- [ ] **W64** SVG renderer (`renderer-factory.ts:49` throws "future phase").
      Effort L — deferrable.
- [ ] **W65** WebGL renderer (`renderer-factory.ts:54` throws "future phase").
      Effort L — deferrable.

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
