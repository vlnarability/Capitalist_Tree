# The Capitalist Tree

A long-form simulation game where a single player cultivates a money-bearing
tree through decades of biological, economic, and environmental cycles. The
tree grows, photosynthesizes, endures weather and seasons, produces harvestable
currency foliage, and is shaped by the player's choices — extractive,
sustainable, or balanced — against a backdrop of regional climate, markets,
business growth, and policy. Every rule runs in a deterministic, pure-TS
simulation engine; the Next.js web app is a thin presentation layer.

> **Status:** All 12 simulation systems are implemented (P0–P10). The
> `p11-remediation` branch applies the review-driven fix-first + hardening
> pass (W1–W30) and wires the remaining midgame/endgame actions to the UI
> (P11-E). See `docs/reviews/STATUS.md` for the build state and
> `docs/reviews/MASTER-REVIEW.md` §6–§7 for the remediation plan.

---

## Quick start

Requires Node ≥ 20 and pnpm 12.18+.

```bash
pnpm install          # install all workspace deps
pnpm --filter web dev # start the Next.js dev server (http://localhost:3000)
```

Run the full test suite:

```bash
pnpm test             # vitest run across all packages (NODE_OPTIONS bumps heap to 4GB)
pnpm typecheck        # tsc --noEmit across all packages
pnpm lint             # eslint
```

Web-only commands:

```bash
pnpm --filter web dev          # dev server
pnpm --filter web build        # production build
pnpm --filter web test:e2e     # Playwright smoke suite
```

---

## Architecture

The repo is a pnpm monorepo with a strict one-way data flow (enforced by
`tests/import-boundaries.test.ts`, TDD §3):

```
simulation ─► shared ◄─ rendering ─► apps/web (React/Next/DOM)
                  ▲
                  │
               content
```

- **`packages/shared`** — Zod schemas, constants, migrations, serialization.
  The frozen contract every other package depends on. No framework deps.
- **`packages/simulation`** — the pure-TS engine: 12 systems (time, weather,
  biology, resources, harvest, economy, personal, business, automation,
  environment, progression, events), RNG, offline catch-up, actions. No UI,
  no DOM, no framework. Deterministic given (state, config, seed).
- **`packages/content`** — data-driven game content: species, fertilizers,
  equipment, businesses, markets, weather climates/matrices, events,
  progression (research/traits/achievements), monetary policy.
- **`packages/rendering`** — headless canvas renderer + render-data
  transforms (tree, environment, currency visuals). Pure — produces draw
  data, does not touch the DOM.
- **`apps/web`** — Next.js 16 app (App Router, React 19, Tailwind, Zustand
  store, IndexedDB persistence, Web Worker offline catch-up). The only
  place that touches next/react/react-dom/idb.

The engine is testable independently of Next.js (TDD §21 #14) —
`packages/simulation/test/` runs under vitest with no browser.

### The 12-system pipeline

Each `engine.advance(state, seconds)` runs every system once per
`PROVISIONAL_SIMULATION_STEP_SECONDS` (60 sim seconds) tick, in slot order:

| # | System | Phase | Role |
|---|---|---|---|
| 1 | TimeSystem | P0 | clock, day/season/timeOfDay |
| 2 | WeatherSystem | P2 | Markov condition, temperature, damage |
| 3 | BiologySystem | P1 | photosynthesis, energy, growth, stress, death |
| 4 | ResourceSystem | P2 | soil water/nutrients, derived soil health |
| 5 | HarvestSystem | P1 | foliage → currency, defoliation damage |
| 6 | EconomySystem | P3 | currency, wages, markets, ledger |
| 7 | PersonalSystem | P3 | expenses, well-being |
| 8 | BusinessSystem | P8 | markets, supply chain, growth pressure |
| 9 | AutomationSystem | P6 | scheduled actions, equipment |
| 10 | EnvironmentSystem | P7 | climate, atmosphere, biodiversity, feedback |
| 11 | ProgressionSystem | P9 | research, genetics, achievements, prestige |
| 12 | EventSystem | P10 | global/climate/market/objective events |

Systems are pure: each `execute(state, ctx)` returns a new state, never
mutates its input. Per-system purity is pinned by
`packages/simulation/test/systems-purity.test.ts` (W19). Per-tick cost is
gated by `packages/simulation/test/perf-gate.test.ts` (W29).

### Determinism

The engine is deterministic: identical (seed, config, inputs) → identical
state and event stream. This is pinned at the acceptance level by
`tests/determinism-acceptance.test.ts` (TDD §21 #15), which verifies same-seed
equality, save/load round-trip equivalence, splittability, and seed-perturbation
sanity over a full 12-system run.

---

## Documentation

- **`docs/GDD.txt`** — Game Design Document (source of truth for design).
- **`docs/TDD.txt`** — Technical Design Document (architecture, constraints,
  acceptance criteria).
- **`docs/reviews/MASTER-REVIEW.md`** — consolidated review + remediation plan
  (RV1–RV6 synthesis, §6 prioritized work items, §7 phase prompts).
- **`docs/reviews/STATUS.md`** — build state + phase history.
- **`docs/<domain>.md`** — per-domain implementation notes (biology, economy,
  environment, global, business, progression, simulation, resources-weather,
  offline-automation, rendering, ui).

---

## Testing

- **Unit/integration:** vitest across `packages/**/test/` and `apps/web/test/`.
- **Acceptance:** `tests/determinism-acceptance.test.ts` (TDD §21 #15),
  `tests/import-boundaries.test.ts` (TDD §3 data-flow contract).
- **E2E:** `apps/web/e2e/smoke.spec.ts` (Playwright).
- **Perf gate:** `packages/simulation/test/perf-gate.test.ts` (CI regression
  guard on per-tick cost).

The simulation package has no browser dependency — `pnpm --filter
@capitalist-tree/simulation exec vitest run` runs the full engine suite
headlessly.

---

## License

See the repository for license terms. Source documents (`docs/GDD.txt`,
`docs/TDD.txt`) are the authoritative design sources.
