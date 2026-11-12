/**
 * Plain-language description helpers (P5c — GDD §13.3 Advanced View).
 *
 * The advanced view (GDD §13.3) "should explain relationships, not merely
 * display more numbers." These pure helpers translate Liebig factors, energy
 * allocation splits, soil metrics, etc. into the short, plain-language
 * sentences shown alongside the numbers in the BiologyPanel /
 * EnvironmentPanel. They mirror the philosophy of `lib/format/tree.ts` and
 * `lib/format/weather.ts`: the simulation owns the numeric values; the web
 * app owns the wording. The helpers never touch the engine, never mutate
 * inputs, never read the DOM (rule 6 + purity).
 *
 * Specifically:
 *
 *   - {@link describeLimitingFactor} — picks the Liebig-minimum factor from
 *     a set of named factors (light, temperature, water, CO2, nutrients,
 *     leaf health) and returns a sentence explaining *why* photosynthesis
 *     is constrained. This is the headline relationship GDD §13.3 calls
 *     out: "why is photosynthesis low? → water stress is the limiting
 *     factor".
 *   - {@link describeEnergyBalance} — explains whether production is
 *     covering maintenance, drawing down reserves, or building surplus.
 *   - {@link describeNutrientStatus} — N / P / K relative to species
 *     requirement, with the limiting nutrient called out (Liebig again).
 *   - {@link describeSoilWaterBalance} — soil moisture relative to
 *     capacity (waterlogging / healthy / dry / drought).
 *   - {@link describePollution} — contamination + emissions shorthand.
 *   - {@link describeHarvestRecommendation} — compares the requested
 *     harvest amount against the sustainable estimate from
 *     `estimateSustainableHarvest` (P1) and returns a guidance sentence.
 *   - {@link describeTransactionCategory} — human-readable labels for the
 *     `TransactionRecord.category` field (purchase / expense / issuance /
 *     sink / transfer).
 *
 * Every function is total — bad inputs (NaN, missing fields) produce a
 * neutral fallback sentence so the dashboard never crashes on a transient
 * bad value.
 */
import type { TransactionRecord } from '@capitalist-tree/shared';

// ----------------------------------------------------------------------------
// Liebig limiting factor — the headline "why is X low?" relationship.
// ----------------------------------------------------------------------------

/**
 * Named Liebig factor — the inputs to the photosynthesis Liebig minimum.
 * Maps 1:1 to the factors computed by the simulation's `photosynthesis.ts`
 * (lightFactor, temperatureFactor, waterFactor, co2Factor, nutrientFactor,
 * leafHealth).
 */
export interface LiebigFactors {
  /** Light availability [0,1] (day vs night). */
  readonly light: number;
  /** Temperature suitability [0,1] (species' min/opt/max triangle). */
  readonly temperature: number;
  /** Water availability [0,1] (stored water vs daily need). */
  readonly water: number;
  /** CO2 saturation [0,1] (ambient / saturation ppm). */
  readonly co2: number;
  /** Nutrient Liebig [0,1] (min of N/P/K ratios vs species requirement). */
  readonly nutrients: number;
  /** Leaf health [0,1] (1 - stress). */
  readonly leafHealth: number;
}

/** Plain-language label for each factor (lowercase, used mid-sentence). */
const FACTOR_LABELS: Readonly<Record<keyof LiebigFactors, string>> = Object.freeze({
  light: 'light',
  temperature: 'temperature',
  water: 'water',
  co2: 'CO\u2082',
  nutrients: 'soil nutrients',
  leafHealth: 'leaf health',
});

/**
 * Internal: which factor is the Liebig minimum, and what's its value?
 * Returns `null` if no factor is finite (defensive — never crash the
 * dashboard on a transient bad value).
 */
function pickMinimumFactor(
  factors: LiebigFactors,
): { name: keyof LiebigFactors; value: number } | null {
  const entries = (Object.keys(FACTOR_LABELS) as readonly (keyof LiebigFactors)[])
    .map((name) => ({ name, value: factors[name] }))
    .filter((e) => Number.isFinite(e.value));
  if (entries.length === 0) return null;
  let min = entries[0]!;
  for (const e of entries) {
    if (e.value < min.value) min = e;
  }
  return min;
}

/**
 * Explain the photosynthesis-limiting relationship in plain language.
 *
 * Returns a short sentence identifying the Liebig-minimum factor and a
 * qualitative descriptor of how severely it's limiting. The caller passes
 * the Liebig factors computed by the simulation's `photosynthesis.ts`
 * (re-derived here from `simState` so the helper stays pure — no sim
 * import).
 *
 *   - All factors ≥ 0.9 → "All growth factors are near optimum…"
 *   - Minimum factor < 0.9 → "<Factor> is the limiting factor (low/moderate)."
 *
 * Example: `{ water: 0.18, light: 1.0, … }` →
 *   `"Water is the limiting factor at 18% of full availability."`
 */
export function describeLimitingFactor(factors: LiebigFactors): string {
  const min = pickMinimumFactor(factors);
  if (!min) return 'Growth factors unavailable.';
  const pct = Math.round(min.value * 100);
  // All-factors-near-optimum is the headline case where there's no
  // bottleneck to call out. Below 90% we name the bottleneck explicitly.
  if (min.value >= 0.9) {
    return 'All growth factors are near optimum — photosynthesis is at full rate.';
  }
  const label = FACTOR_LABELS[min.name];
  const severity = min.value < 0.3 ? 'critical' : min.value < 0.6 ? 'low' : 'moderate';
  // Capitalise the first letter of the factor name so the sentence starts
  // with a capital letter (e.g. "Water" not "water").
  const cap = label.charAt(0).toUpperCase() + label.slice(1);
  return (
    `${cap} is the limiting factor — photosynthesis runs at ${pct}% of full ` +
    `rate (${severity} availability). Increasing other inputs will not help ` +
    `until this bottleneck is relieved (Liebig's Law of the Minimum).`
  );
}

// ----------------------------------------------------------------------------
// Energy balance — production vs maintenance.
// ----------------------------------------------------------------------------

/**
 * Plain-language summary of the production/maintenance balance.
 *
 *   - `production > maintenance * 1.05` → surplus ("…building reserves / growth")
 *   - `production` within ±5% of `maintenance` → steady state
 *   - `production < maintenance * 0.95` → deficit ("…drawing on reserves")
 *
 * Deficit cases explain the consequence: the tree is burning its reserve
 * buffer to stay alive; prolonged deficit will deplete reserves and raise
 * mortality risk (GDD §5.6).
 */
export function describeEnergyBalance(
  productionPerDay: number,
  maintenancePerDay: number,
  reserveDrawPerDay: number,
): string {
  if (
    !Number.isFinite(productionPerDay) ||
    !Number.isFinite(maintenancePerDay) ||
    !Number.isFinite(reserveDrawPerDay)
  ) {
    return 'Energy balance unavailable.';
  }
  const ratio = maintenancePerDay > 0 ? productionPerDay / maintenancePerDay : 1;
  if (ratio >= 1.05) {
    return (
      `Production exceeds maintenance by ~${Math.round((ratio - 1) * 100)}% — ` +
      'the surplus is split across root, trunk, branch, and leaf growth; ' +
      'any remainder is banked in reserves.'
    );
  }
  if (ratio >= 0.95) {
    return (
      'Production and maintenance are roughly balanced — the tree is ' +
      'maintaining itself but not growing meaningfully.'
    );
  }
  const drawPct = Math.round((reserveDrawPerDay / Math.max(1, maintenancePerDay)) * 100);
  return (
    `Production covers only ~${Math.round(ratio * 100)}% of maintenance — ` +
    `the deficit (${drawPct}% of maintenance) is drawn from reserves. ` +
    'Prolonged deficit depletes reserves and raises mortality risk.'
  );
}

// ----------------------------------------------------------------------------
// Nutrient status — N/P/K relative to requirement, with limiting nutrient.
// ----------------------------------------------------------------------------

/** Plain-language label for each nutrient. */
export type NutrientKey = 'nitrogen' | 'phosphorus' | 'potassium';

const NUTRIENT_LABELS: Readonly<Record<NutrientKey, string>> = Object.freeze({
  nitrogen: 'Nitrogen (N)',
  phosphorus: 'Phosphorus (P)',
  potassium: 'Potassium (K)',
});

const NUTRIENT_SHORT: Readonly<Record<NutrientKey, string>> = Object.freeze({
  nitrogen: 'N',
  phosphorus: 'P',
  potassium: 'K',
});

/**
 * Describe the soil's nutrient status relative to the species' requirement.
 * Calls out the scarcest nutrient (Liebig's Law again) so the player knows
 * which fertilizer to add. Excess of one nutrient cannot compensate for a
 * deficit in another (GDD §5.2, §8.2).
 *
 * @returns `{ summary, limiting }` — a one-line summary + the nutrient key
 *   that's the bottleneck (or `null` if all are sufficient).
 */
export function describeNutrientStatus(
  nutrients: { nitrogen: number; phosphorus: number; potassium: number },
  requirement: { nitrogen: number; phosphorus: number; potassium: number },
): { summary: string; limiting: NutrientKey | null } {
  const keys: readonly NutrientKey[] = ['nitrogen', 'phosphorus', 'potassium'];
  const ratios = keys.map((k) => ({
    key: k,
    ratio: requirement[k] > 0 ? nutrients[k] / requirement[k] : 1,
  }));
  const limiting = ratios.reduce((a, b) => (b.ratio < a.ratio ? b : a));
  const limitingClamped = Math.max(0, Math.min(1, limiting.ratio));
  if (limitingClamped >= 1) {
    return {
      summary:
        'All macronutrients meet the species requirement — nutrient ' +
        'availability is not a bottleneck (Liebig factor = 1.0).',
      limiting: null,
    };
  }
  const pct = Math.round(limitingClamped * 100);
  const label = NUTRIENT_LABELS[limiting.key];
  return {
    summary:
      `${label} is the limiting nutrient at ${pct}% of the species ` +
      'requirement. Other nutrients cannot compensate — adding more P or K ' +
      `will not raise photosynthesis until ${NUTRIENT_SHORT[limiting.key]} is restored.`,
    limiting: limiting.key,
  };
}

// ----------------------------------------------------------------------------
// Soil water balance.
// ----------------------------------------------------------------------------

/**
 * Describe the soil water balance in plain language.
 *
 *   - fraction >= 0.95 → waterlogging / runoff risk
 *   - fraction >= 0.6 → healthy soil moisture
 *   - fraction >= 0.25 → getting dry
 *   - fraction < 0.25 → critically dry (drought stress)
 */
export function describeSoilWaterBalance(
  soilWater: number,
  capacity: number,
): { summary: string; tone: 'sky' | 'emerald' | 'amber' | 'rose' | 'slate' } {
  if (!Number.isFinite(soilWater) || !Number.isFinite(capacity) || capacity <= 0) {
    return { summary: 'Soil water balance unavailable.', tone: 'slate' };
  }
  const frac = Math.max(0, Math.min(1, soilWater / capacity));
  if (frac >= 0.95) {
    return {
      summary:
        'Soil is at capacity — additional water runs off (wasted and may ' +
        'leach nutrients).',
      tone: 'sky',
    };
  }
  if (frac >= 0.6) {
    return {
      summary: 'Soil moisture is healthy — water uptake is unrestricted.',
      tone: 'emerald',
    };
  }
  if (frac >= 0.25) {
    return {
      summary:
        'Soil is getting dry — water factor is starting to limit ' +
        'photosynthesis. Irrigate soon.',
      tone: 'amber',
    };
  }
  return {
    summary:
      'Soil is critically dry — water stress is the dominant biology ' +
      'limit. Tree reserves are being drawn down.',
    tone: 'rose',
  };
}

// ----------------------------------------------------------------------------
// Pollution + emissions.
// ----------------------------------------------------------------------------

/**
 * Describe contamination + emissions in plain language. Contamination is a
 * soil-health input (GDD §8.3); emissions drive long-term CO2 + temperature
 * drift. Both are reported qualitatively so the player notices without
 * needing to read a number.
 *
 *   - contamination == 0 → 'Soil is clean.'
 *   - contamination > 0 → 'Soil contamination present — reduces soil health.'
 *   - emissions > 0 → adds note about CO2/temperature drift.
 */
export function describePollution(contamination: number, emissions: number): string {
  const parts: string[] = [];
  if (!Number.isFinite(contamination) || contamination <= 0) {
    parts.push('Soil is clean — no contamination detected.');
  } else if (contamination < 1) {
    parts.push('Soil contamination is mild — modest soil-health impact.');
  } else {
    parts.push(
      'Soil contamination is elevated — reduce over-application of ' +
        'fertilizer to allow recovery.',
    );
  }
  if (Number.isFinite(emissions) && emissions > 0) {
    parts.push(
      `Emissions are positive (${emissions.toFixed(2)} units/tick) — driving ` +
        'long-term CO\u2082 rise and warming.',
    );
  }
  return parts.join(' ');
}

// ----------------------------------------------------------------------------
// Harvest recommendation.
// ----------------------------------------------------------------------------

/**
 * Compare the player's intended harvest amount against the sustainable
 * estimate (from `estimateSustainableHarvest` in P1's biology module).
 *
 * The estimate is a soft guideline (GDD §5.4 — "the game should expose an
 * estimated sustainable harvest level without forcing the player to follow
 * it"). This helper returns:
 *
 *   - requested <= estimate → 'within sustainable range'
 *   - requested within (estimate, estimate*2] → 'above sustainable'
 *   - requested > estimate*2 → 'well above sustainable — risk of stress'
 *   - estimate == 0 → 'no surplus available — harvesting will deplete reserves'
 */
export function describeHarvestRecommendation(
  requested: number,
  estimatePerDay: number,
): { summary: string; tone: 'emerald' | 'amber' | 'rose' | 'slate' } {
  if (!Number.isFinite(requested) || !Number.isFinite(estimatePerDay)) {
    return { summary: 'Harvest recommendation unavailable.', tone: 'slate' };
  }
  if (estimatePerDay <= 0) {
    return {
      summary:
        'No harvestable surplus is available — the tree is currently ' +
        'spending reserves on maintenance. Any harvest will deplete reserves ' +
        'and raise stress.',
      tone: 'rose',
    };
  }
  const ratio = requested / estimatePerDay;
  if (ratio <= 1.0) {
    return {
      summary:
        'Within the sustainable range — the tree can regrow this foliage ' +
        'from the daily production surplus.',
      tone: 'emerald',
    };
  }
  if (ratio <= 2.0) {
    return {
      summary:
        'Above the sustainable rate — the tree will dip into reserves to ' +
        'regrow this foliage. Fine occasionally; risky if repeated daily.',
      tone: 'amber',
    };
  }
  return {
    summary:
      'Well above the sustainable rate — repeated harvests at this level ' +
      'will deplete reserves, spike stress, and risk severe-defoliation ' +
      'damage records (GDD §5.6).',
    tone: 'rose',
  };
}

// ----------------------------------------------------------------------------
// Transaction category labels (for the TransactionsPanel).
// ----------------------------------------------------------------------------

const TRANSACTION_CATEGORY_LABELS: Readonly<Record<string, string>> = Object.freeze({
  issuance: 'Issuance',
  sink: 'Sink',
  transfer: 'Transfer',
  purchase: 'Purchase',
  expense: 'Expense',
  harvest: 'Harvest',
});

/**
 * Resolve a plain-language label for a `TransactionRecord.category`.
 * Returns the raw category string (title-cased) if unknown so the panel
 * never shows a blank cell on a future category.
 */
export function describeTransactionCategory(category: string): string {
  return TRANSACTION_CATEGORY_LABELS[category] ?? category.charAt(0).toUpperCase() + category.slice(1);
}

/**
 * Format a `TransactionRecord` as a single-line summary for the recent
 * transactions list. Shows category + amount + source→destination + sim
 * day (derived from `timestamp` seconds).
 *
 * Pure: takes the record, returns a string. Never throws on bad input —
 * falls back to a neutral summary.
 */
export function describeTransaction(t: TransactionRecord): string {
  const cat = describeTransactionCategory(t.category);
  const day = Math.floor((Number.isFinite(t.timestamp) ? t.timestamp : 0) / 86_400);
  const dest = t.destinationAccount || '—';
  const src = t.sourceAccount || '—';
  return `${cat} on Day ${day} · ${src} → ${dest}`;
}

// ----------------------------------------------------------------------------
// Tone helper — shared by the panels.
// ----------------------------------------------------------------------------

/**
 * The tone set used by the advanced panels. Mirrors `Tone` from
 * `lib/format/tree.ts` (the simplified view) but extends with `sky` and
 * `cyan` for water / weather tones the advanced panels surface.
 */
export type DescribeTone = 'emerald' | 'amber' | 'rose' | 'sky' | 'cyan' | 'slate';
