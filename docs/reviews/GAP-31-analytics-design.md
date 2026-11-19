# GAP-31 — Analytics: local-only, on-device (design)

**Status:** design (DR-13). Approved as a **design-direction GAP** (per user
direction); implementation tasks move to the development roadmap. This design
closes GAP-31's "needs a sink decision" gap.

## Decision

**GAP-31 will use local-only, on-device analytics.** Events, aggregated
simulation metrics, performance measurements, and caught errors are persisted
locally and exposed through an in-game observability panel. **No external
analytics service, endpoint, account, or third-party telemetry SDK will be
introduced.** Analytics must remain **non-blocking and independent of simulation
execution** — if IndexedDB writes fail, gameplay continues.

This matches the local-first architecture (DR-2: single-player, no server, no
accounts). The game has no backend to phone home to, and on-device observability
gives the development + balancing signal needed for playtesting without any
consent or external-transmission overhead.

## 1. Event destination

All analytics events remain on the player's device.

- Persist events and aggregated metrics in **IndexedDB**.
- Provide an **in-game developer/observability panel**.
- No external analytics endpoints.
- No analytics accounts or third-party SDKs.
- No transmission of player data.

## 2. What to collect — four categories

| Category | Examples |
| --- | --- |
| **Gameplay** | Tree planted, leaves harvested, tree matured, tree died, objective completed |
| **Simulation** | Growth rates, mortality, environmental indicators, economic transactions |
| **Performance** | Tick duration, ticks processed, frame performance, offline simulation duration |
| **Errors** | Caught exceptions, ErrorBoundary events, failed migrations, save/load failures |

Event data is **structured and versioned** so the shape can evolve without
breaking historical records or exports:

```ts
interface AnalyticsEvent {
  id: string;
  schemaVersion: number;
  timestamp: number;          // wall-clock ms
  simulationTime: number;     // in-sim time (ms or tick count — see §4)
  category: "gameplay" | "simulation" | "performance" | "error";
  event: string;
  data?: Record<string, unknown>;
}
```

## 3. Event history vs aggregated metrics — do not retain every tick

Recording every simulation tick as an analytics event would create unnecessary
storage growth, particularly during long-running or accelerated (offline)
simulations. Instead:

- **Record meaningful gameplay events individually** (tree planted, died,
  objective completed, save loaded).
- **Aggregate recurring simulation metrics periodically** (e.g. a tree-growth
  summary every N ticks or every sim-day — height/diameter/health snapshot —
  rather than every incremental change).
- **Sample performance measurements** (tick duration sampled on a schedule, not
  every tick; frame FPS sampled).
- **Record errors when they occur** (these are rare + high-signal — keep them
  all).
- **Provide configurable retention and clear/reset controls** (§7).

This keeps storage bounded + the signal high. The aggregation cadence is a
tuning parameter (default: a growth summary every sim-day; performance sampled
every ~60 ticks), configurable in the observability panel.

## 4. Architecture — analytics independent of the simulation engine

The simulation never depends on analytics succeeding. The data flows one way:

```
Simulation Engine
       |
       v
   Event Emitter        (sim calls emitter.emit(name, data) — fire-and-forget;
       |                  the sim never awaits the collector)
       v
 Analytics Collector     (subscribes to the emitter; shapes + versions events;
       |                  drops/samples per §3)
       |
       +----> IndexedDB           (persisted on-device; write failures are
       |                          caught + swallowed — gameplay continues)
       |
       +----> Observability Panel (apps/web — reads the store for display)
       |
       +----> JSON Export          (diagnostics download)
```

**Boundaries:**

- The simulation imports only the **event-emitter interface** (a thin, sync,
  fire-and-forget `emit(name, data?)`), never the collector or the store. The
  emitter is a no-op if no collector is attached (e.g. in unit tests).
- The collector owns the schema-versioning, the aggregation/sampling policy
  (§3), and the IndexedDB writes. Writes are wrapped in try/catch (or
  `.catch(() => {})`) — a full IndexedDB failure degrades only analytics, not the
  sim.
- The observability panel reads the store via a read-only query API; it never
  touches `simState` directly (rule 6: rendering/UI reads state, never writes the
  sim).

**Placement:** a new `packages/analytics` (the emitter interface, the collector,
the `AnalyticsEvent` schema, the aggregation policy) + an `AnalyticsPanel`
component in `apps/web/components/dev/`. The IndexedDB store reuses the existing
persistence wrapper (the save system already uses IndexedDB) under a separate
object store (e.g. `analytics-events`, `analytics-aggregates`) so analytics
storage never risks the save blob.

## 5. Observability panel

A developer-oriented panel (gated behind a dev toggle / not part of the default
player UI) with:

- **Event counts by category** (gameplay / simulation / performance / error).
- **Recent gameplay events** (the individual high-signal events from §3).
- **Tree health and growth metrics** (the periodic growth summaries).
- **Economic and environmental summaries** (aggregated sim metrics).
- **Simulation tick performance** (sampled tick duration + frame FPS).
- **Error history** (every caught exception, ErrorBoundary event, failed
  migration, save/load failure).
- **IndexedDB storage usage** (so the dev can see the analytics footprint + the
  effect of retention).
- **Export diagnostics as JSON** (a full dump for bug reports / balancing
  review).
- **Clear analytics history** (the reset control from §3).

This is useful for development and balancing, not just future product analytics.

## 6. Privacy and architecture boundaries

**Qualification:** local-only analytics avoids third-party transmission and the
need for an external analytics consent workflow. It does **not** automatically
eliminate every privacy obligation associated with the application. Keep
diagnostics local, avoid collecting unnecessary personal information, and
**provide a way to clear the data** (§5 + §7).

Concretely: the game has no accounts + no PII, so analytics is gameplay /
simulation / performance / error telemetry only — no user identifiers beyond an
opaque per-save id if needed for correlation. No personal information is
collected. The clear/reset control + JSON-export-then-delete flow gives the
player full control over the on-device data.

## 7. Retention and clear/reset

- **Configurable retention** — a maximum age (default e.g. 30 sim-days or N
  events) + a maximum storage ceiling; oldest records are evicted first.
- **Clear analytics history** — a one-click reset in the observability panel that
  wipes the analytics object stores (never touches the save blob).
- **Export-then-clear** — export the full diagnostics JSON, optionally clearing
  on success.

## 8. Future migration path (do not build now)

If the game is commercially released and cross-user analytics become necessary,
add an **optional external analytics adapter** behind the same emitter
interface. That would require a **separate decision** covering consent, data
minimization, retention, privacy disclosures, and hosting. **Do not build that
infrastructure now** — the local-only collector + the emitter abstraction are
sufficient for the prototype + leave the door open without committing to any
external service.

## 9. Implementation phasing (roadmap)

- **Phase 1 — emitter + schema + collector.** The `packages/analytics` event
  emitter interface, the versioned `AnalyticsEvent` schema, and the collector
  (subscribe, shape, sample, persist to a dedicated IndexedDB store). Sim
  fire-and-forget emit calls at the high-signal points (planted, harvested,
  matured, died, objective completed, save loaded). Tests: sim continues when the
  collector/IndexedDB is absent or throws.
- **Phase 2 — aggregation + sampling.** Periodic growth/sim summaries, sampled
  performance + frame metrics, error capture (wired to the existing
  ErrorBoundary). Retention + eviction.
- **Phase 3 — observability panel.** The `AnalyticsPanel` component: counts,
  recent events, growth/sim/perf summaries, error history, storage usage, JSON
  export, clear/reset.
- **Phase 4 — (deferred) external adapter** — only if a future commercial-release
  decision requires it.

## 10. Disposition

GAP-31 is **sufficiently designed to close as a design-direction GAP**.
Analytics will be local-only + on-device, persisted to IndexedDB + exposed
through an observability panel, non-blocking + independent of the simulation
engine, with no external service / endpoint / account / third-party SDK.
Implementation moves to the development roadmap (§9); no external analytics
infrastructure will be built now.
