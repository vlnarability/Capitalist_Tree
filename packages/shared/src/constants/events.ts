/**
 * EventSystem provisional constants (P10a — TDD §6.4 Event Scheduling, TDD
 * line 200 EventSystem; GDD §10 Environment and Climate, §148-152 influence
 * over regional/global markets/governments/regulations, §404-408 monetary
 * authority; TDD Milestone 9: Regional environments, Governments, Monetary
 * policy, Global markets, Climate feedback, Global objectives).
 *
 * Every value here corresponds to (or stands in for) an unresolved design
 * decision listed in GDD §17. They live in a dedicated file so tuning is
 * localized to one place. The EventSystem (P10b) imports these via
 * `@capitalist-tree/shared` — never use magic numbers inside the system.
 *
 * CONVENTION: `PROVISIONAL_EVENT_*` / `PROVISIONAL_GOVERNMENT_*` /
 * `PROVISIONAL_MONETARY_*` / `PROVISIONAL_REGIONAL_*` /
 * `PROVISIONAL_SPECIES_*` prefix and a `// PROVISIONAL (GDD §17: <item>)`
 * comment pointing at the GDD entry the value resolves. When a value is
 * promoted from "provisional" to "decided" via playtesting, move it to a
 * sibling `decided.ts` and drop the prefix.
 */

// ---------------------------------------------------------------------------
// Event scheduler cadence + random-event probability (TDD §6.4)
// ---------------------------------------------------------------------------

// PROVISIONAL (GDD §17: Regional simulation granularity)
//
// How often (in simulation ticks) the EventSystem scheduler checks the
// scheduled queue for due events + rolls random events. One tick = one
// simulation step (PROVISIONAL_SIMULATION_STEP_SECONDS = 60 sim seconds =
// 1 in-game minute). A check every 60 ticks ≈ once per in-game hour, which
// keeps the scheduler cheap while being responsive enough for events whose
// durations are measured in ticks. PROVISIONAL — final cadence depends on
// playtesting how often events should be visible.
export const PROVISIONAL_EVENT_CHECK_INTERVAL_TICKS = 60;

// PROVISIONAL (GDD §17: Regional simulation granularity)
//
// Base probability per scheduler check that a random event is rolled (before
// eligibility weighting against regional/global conditions). 0.02 ≈ a 2%
// chance per check; with a check each in-game hour this averages roughly one
// random-event roll per ~2 in-game days. The EventSystem multiplies this by
// each eligible EventDefinition's `probabilityWeight` and by regional
// vulnerability tags to pick a specific event. PROVISIONAL — final frequency
// depends on playtesting.
export const PROVISIONAL_EVENT_BASE_PROBABILITY = 0.02;

// PROVISIONAL (GDD §17: Environmental recovery timescales)
//
// How much global degradation amplifies event severity. The EventSystem (P10b)
// scales a drawn severity band by `(1 + degradation * this)` where
// `degradation` is a 0-1 composite of inverted ecosystem resilience, inverted
// biodiversity, and pollution load — so a collapsing world fires more
// `severe`/`catastrophic` events (GDD §10.3 feedback). 1.0 means degradation
// can at most double the effective severity magnitude. PROVISIONAL.
export const PROVISIONAL_EVENT_SEVERITY_SCALING = 1.0;

// PROVISIONAL (GDD §17: Environmental recovery timescales)
//
// Fraction of damage a region recovers per simulation day once the damaging
// event has ended (GDD §10.3 — recovery is possible but costly). 0.01 ≈ 1%
// of the gap-to-baseline recovered per sim day, so a region knocked 0.3 below
// its soil-health baseline takes ~30 sim days to fully recover absent new
// damage. Irreversible losses (species extinction once biodiversity crosses
// PROVISIONAL_SPECIES_EXTINCTION_THRESHOLD) do NOT recover. PROVISIONAL —
// final timescale depends on playtesting.
export const PROVISIONAL_EVENT_RECOVERY_RATE = 0.01;

// ---------------------------------------------------------------------------
// Government + monetary policy cadence (GDD §148-152, §404-408; Milestone 9)
// ---------------------------------------------------------------------------

// PROVISIONAL (GDD §17: Currency issuance mechanics and monetary policy)
//
// How often (in simulation days) the EventSystem re-evaluates government
// policy (environmental regulations / carbon tax / subsidies) against
// aggregated environmental + economic conditions. 30 sim days ≈ one season,
// so policy reacts on a seasonal cadence. Player `set-government-policy`
// actions can override at any time. PROVISIONAL — final cadence depends on
// playtesting how reactive government should be.
export const PROVISIONAL_GOVERNMENT_POLICY_INTERVAL_DAYS = 30;

// PROVISIONAL (GDD §17: Currency issuance mechanics and monetary policy)
//
// How often (in simulation days) the EventSystem re-evaluates monetary policy
// (interest rate / inflation target / money-supply growth) against inflation
// + growth. 30 sim days ≈ one season — a typical central-bank decision cycle.
// Player `set-monetary-policy` actions can override at any time. PROVISIONAL.
export const PROVISIONAL_MONETARY_POLICY_INTERVAL_DAYS = 30;

// ---------------------------------------------------------------------------
// P13-B / GAP-25 — lobbying (GDD §3.3 "Influence governments + regulations")
//
// The `lobby-government` action debits a fixed cost from the player to the
// authority account (political spend) + nudges one policy lever by a bounded
// rate. The cost + rate are PROVISIONAL — tuned so lobbying is a meaningful
// but not dominant lever (a player can shift a field from 0 to 1 in ~20
// lobby actions = ~$2000, a mid-game expense).
// ---------------------------------------------------------------------------

/** Cost per `lobby-government` action, in bigint minor currency units ($100). */
export const PROVISIONAL_LOBBY_COST_MINOR = 10_000;
/** Per-action nudge on the target policy field (0.05 → 5 percentage points). */
export const PROVISIONAL_LOBBY_INFLUENCE_RATE = 0.05;

// ---------------------------------------------------------------------------
// Regional aggregation + irreversibility (GDD §10.1, §10.2, §10.3)
// ---------------------------------------------------------------------------

// PROVISIONAL (GDD §17: Regional simulation granularity)
//
// How regional indicators aggregate to the global `aggregatedIndicators`.
// `'population'` weights each region's contribution by its `population`
// (so a populous region's collapsing ecosystem weighs heavily on the global
// average — GDD §10.2 "A healthy global average must not conceal a collapsing
// local ecosystem"). The EventSystem (P10b) reads this to pick the weighting
// scheme; `'area'` is the alternative (weight by land area). PROVISIONAL —
// final scheme depends on playtesting which weighting best surfaces local
// collapse.
export const PROVISIONAL_REGIONAL_AGGREGATION_WEIGHTS = 'population' as 'population' | 'area';

// PROVISIONAL (GDD §17: Environmental recovery timescales)
//
// Biodiversity level (0-1) below which species loss becomes irreversible
// (GDD §10.3 — "Some losses, particularly species extinction, are irreversible
// within the current world"). Once a region's `biodiversity` drops below this
// threshold the EventSystem (P10b) ratchets `speciesExtinctionRate` up
// permanently (it does NOT recover with PROVISIONAL_EVENT_RECOVERY_RATE).
// 0.2 ≈ a fifth of pristine biodiversity — the point beyond which an
// ecosystem's collapse is self-reinforcing. PROVISIONAL — final threshold
// depends on playtesting.
export const PROVISIONAL_SPECIES_EXTINCTION_THRESHOLD = 0.2;

// ---------------------------------------------------------------------------
// P11 (W12 / RV5-F2): bounded event history. Pre-fix,
// `eventState.scheduler.history` grew unboundedly — every concluded event
// was appended permanently. A long run with frequent stochastic events
// could accumulate thousands of entries, bloating saves. The cap keeps the
// most recent N entries (tail); older entries are pruned when exceeded.
// ---------------------------------------------------------------------------

/** Max concluded-event history entries kept (most recent). @provisional. */
export const PROVISIONAL_EVENT_MAX_HISTORY = 1000;

// P11 (W16 / RV4-F-M9): saturation cap for `speciesExtinctionRate`. Pre-fix,
// the rate accumulated without bound in `evolveRegions` (every region below
// the extinction threshold added EXTINCTION_RATE × days per tick). Over a
// long run this could reach thousands, which is meaningless (extinction is
// already total at 1.0) and bloats the indicator. Capped at 1.0.
export const PROVISIONAL_EVENT_SPECIES_EXTINCTION_RATE_CAP = 1.0;

// ---------------------------------------------------------------------------
// P11 (W6 / RV4-F-H3): player→regional bridge. The player's land is modeled
// via P7 `world.environment` (single-block), but the P10 regional model
// (`eventState.global.regions`) has no player region reference. W6 designates
// the first seeded region (the most populous) as the player's "home region"
// — player extraction/restoration/emissions actions write environmental
// deltas there, which `evolveRegions` then propagates to pollution/soil/
// water/forest/biodiversity and `aggregateGlobalIndicators` rolls into the
// global averages. No schema migration needed (convention by id).
// ---------------------------------------------------------------------------

/** The region player actions affect (extraction/restoration/emissions). */
export const PLAYER_HOME_REGION_ID = 'region:temperate-lowlands';
