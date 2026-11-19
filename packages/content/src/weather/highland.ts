/**
 * Highland (H) climate modifier (GAP-17 / DR-11 — Phase 1).
 *
 * The Köppen H class is not a fixed zone — it is an elevation modifier that
 * overlays any base zone: temperature drops with altitude at the standard
 * environmental lapse rate (~6.5 °C per km), and frost risk increases as the
 * coldest month falls below 0 °C. A base-zone Af at 2000 m becomes roughly a
 * Cfb-like climate — the "climb a mountain, pass through several zones" effect
 * NatGeo describes.
 *
 * Phase 1 provides the transform + the lapse-rate constant only. The base-zone
 * + elevation selection UX ships in Phase 4.
 */
import type { ClimateZone } from '@capitalist-tree/shared';

/** Standard environmental lapse rate: temperature drops ~6.5 °C per km of altitude. */
export const HIGHLAND_LAPSE_RATE_C_PER_KM = 6.5;

const FROST_RISK_ORDER = ['none', 'occasional', 'regular-winter', 'severe'] as const;
type FrostRisk = (typeof FROST_RISK_ORDER)[number];

/**
 * Bump frost risk one step if the adjusted coldest-month temperature drops
 * below 0 °C; otherwise leave it. Saturates at 'severe'.
 */
function bumpFrostRisk(current: FrostRisk, adjustedWinterC: number): FrostRisk {
  if (adjustedWinterC >= 0) return current;
  const idx = FROST_RISK_ORDER.indexOf(current);
  if (idx < 0) return current;
  const bumped = FROST_RISK_ORDER[Math.min(idx + 1, FROST_RISK_ORDER.length - 1)];
  return bumped ?? current;
}

/**
 * Apply the highland elevation modifier to a base climate zone.
 *
 * Returns a NEW ClimateZone (the base is untouched) with every seasonal base
 * temperature reduced by `(elevationM / 1000) × 6.5 °C`, frost risk bumped one
 * step if the adjusted winter drops below 0 °C, `koppenClass` set to 'H' to
 * mark the result as highland-modified, and the description annotated with the
 * elevation. The base zone's Köppen code, precipitation, seasonality, heat
 * risk, + tree-suitability are preserved (H overlays the base; it does not
 * replace its identity).
 *
 * @param base The base climate zone (e.g. Cfb, Af).
 * @param elevationM Elevation in metres (≥ 0).
 */
export function applyHighlandModifier(base: ClimateZone, elevationM: number): ClimateZone {
  if (elevationM < 0) throw new Error(`elevation must be ≥ 0 (got ${elevationM})`);
  const drop = (elevationM / 1000) * HIGHLAND_LAPSE_RATE_C_PER_KM;
  const { spring, summer, autumn, winter } = base.seasonalBaseTemp;
  return {
    ...base,
    koppenClass: 'H',
    description: `${base.description} Highland modifier applied at ${Math.round(elevationM)} m — temperatures reduced by ${drop.toFixed(1)} °C (lapse rate ${HIGHLAND_LAPSE_RATE_C_PER_KM} °C/km).`,
    seasonalBaseTemp: {
      spring: spring - drop,
      summer: summer - drop,
      autumn: autumn - drop,
      winter: winter - drop,
    },
    frostRisk: bumpFrostRisk(base.frostRisk, winter - drop),
  };
}
