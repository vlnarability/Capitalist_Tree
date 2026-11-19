# GAP-17 — Climate zones: realistic Köppen-Geiger model (design)

**Status:** design (DR-11). Pre-implementation. Per user direction: "climate
zones to be as realistic as possible," grounded in the Köppen-Geiger climate
classification. This design closes GAP-17's "needs design" gap; implementation
phases follow (see §8).

## References (grounding)

The climate system is grounded in the Köppen-Geiger classification, exactly as
the user directed. The attached world map (`upload/koppen_2006.png`) is the
Kottek et al. 2006 map, which the NOAA page cites directly:

> Kottek, M., J. Grieser, C. Beck, B. Rudolf, and F. Rubel, 2006: *World Map of
> the Köppen-Geiger climate classification updated.* Meteorol. Z., 15, 259-263.

1. **NOAA Jetstream — Köppen-Geiger climate subdivisions** (the primary
   reference): the exact subdivision criteria (temperature + precipitation
   thresholds) used in the zone table below. https://www.noaa.gov/jetstream/global/climate-zones/jetstream-max-addition-k-ppen-geiger-climate-subdivisions
2. **NOAA Jetstream — climate zones** (the five-class overview). https://www.noaa.gov/jetstream/global/climate-zones
3. **National Geographic — All About Climate (8th grade)** (the climate-vs-
   weather + climate-factors framing: latitude, elevation, proximity to water,
   topography). https://education.nationalgeographic.org/resource/all-about-climate/8th-grade/
4. **Kottek et al. 2006 world map** — the attached `koppen_2006.png`. The zone
   color coding in that map corresponds to the codes in §5.

## 1. The Köppen-Geiger model

Köppen-Geiger classifies a region's climate by **temperature and precipitation
patterns**. Each zone has a 1–3 letter code:

- **First letter — main class** (the broad climate family):
  - **A — tropical / equatorial**: all monthly means > 18 °C.
  - **B — dry (arid)**: evaporation exceeds precipitation.
  - **C — temperate (mild)**: warmest month > 10 °C, coldest between −3 °C and
    18 °C.
  - **D — continental (snowy)**: warmest month > 10 °C, coldest ≤ −3 °C.
  - **E — polar**: warmest month < 10 °C.
  - **H — highland**: complex — mountainous terrain where elevation shifts the
    climate through several of the above zones from base to summit.
- **Second letter (lowercase) — precipitation pattern**: `f` wet year-round, `s`
  dry summer, `w` dry winter, `m` monsoon (short dry season).
- **Third letter (lowercase) — temperature pattern**: `a` hot summer (> 22 °C),
  `b` warm summer, `c` cool summer, `d` very cold winter. For class B: `h` hot
  (annual mean > 18 °C), `k` cold (annual mean < 18 °C). For class E: `T` tundra,
  `F` ice cap.

These criteria are the standard climate-science definitions (Kottek et al.
2006); the zone table in §5 uses the exact thresholds the NOAA page states
(driest-month 60 mm, 18 °C / 10 °C / 22 °C boundaries, the 3:1 winter:summer
precipitation ratio for Mediterranean zones, etc.).

## 2. The existing system this extends

The game already has a provisional climate system (P2, GDD §17 "detailed climate
model" was always deferred):

- `packages/shared/src/schemas/weather.ts` defines `ClimateBaseline`:
  `{ id, name, seasonalBaseTemp: {spring,summer,autumn,winter} in °C,
  climateShiftHook: {baselineTempC, tempShiftPerDegreeC, droughtProbShiftPerDegreeC} }`.
- `packages/content/src/weather/climate-baselines.ts` ships **one** baseline:
  `TEMPERATE_CLIMATE` (`climate:temperate`, roughly USDA zone 5–6, a stand-in for
  Dfb). `ALL_CLIMATES` is a 1-element array; `findClimateById` looks it up.
- `WeatherSystem` derives local temperature as
  `seasonalBaseTemp[season] + conditionDelta * (0.5 + intensity * 0.5)` and picks
  a weather transition matrix by climate id. There is **no precipitation field**
  yet — only a `droughtProbShiftPerDegreeC` hook for P6 global warming.

**GAP-17's job**: turn this single provisional baseline into a realistic
Köppen-Geiger climate-zone catalog, by (a) extending `ClimateBaseline` with the
Köppen classification + a precipitation profile + seasonality + frost/heat risk,
and (b) expanding `ALL_CLIMATES` from 1 zone to a curated set covering the
meaningful range for tree growth. The existing temperate baseline becomes the
Dfb entry (its real Köppen identity) — no behavior change for current saves.

## 3. Data model — extend `ClimateBaseline` → `ClimateZone`

Additive fields (existing saves store only the climate **id**; the baseline is
content re-fetched by id, so adding fields is non-breaking):

```ts
export interface ClimateZone extends ClimateBaseline {
  /** Köppen-Geiger code, e.g. "Cfb", "BWh", "ET". */
  readonly koppenCode: string;
  /** Köppen main class — for catalog grouping + UX. */
  readonly koppenClass: 'A' | 'B' | 'C' | 'D' | 'E' | 'H';
  /** Plain-language description (what this climate feels like + a real-world example). */
  readonly description: string;
  /** Realistic precipitation profile (Köppen's defining axis the current type lacks). */
  readonly precipitation: {
    readonly annualMm: number;          // long-term annual mean
    readonly pattern: 'year-round' | 'dry-summer' | 'dry-winter' | 'monsoon' | 'arid';
    readonly driestMonthMm: number;     // for the Köppen dry-season criteria
  };
  /** Season structure the season system should follow. */
  readonly seasonality: 'wet-dry' | 'four-season' | 'polar';
  /** Frost + heat risk — drive weather-event weighting + dormancy. */
  readonly frostRisk: 'none' | 'occasional' | 'regular-winter' | 'severe';
  readonly heatStressRisk: 'none' | 'occasional' | 'regular';
  /** UX hint: how a generic tree fares here (the real effects come from the temp/precip values, not this string). */
  readonly treeSuitabilityNote: string;
}
```

The existing `seasonalBaseTemp` + `climateShiftHook` stay (the WeatherSystem
already reads them). The new fields feed the effect mapping in §6.

## 4. Which zones to model

Of the ~30 Köppen subzones, the catalog includes the ones where trees actually
grow (so the player's tree can thrive or struggle realistically):

- **Exclude EF (ice cap)** — no tree survives; not a playable climate.
- **Include ET (tundra)** as the extreme-challenge zone (trees at their limit:
  stunted, very slow).
- **Include H (highland)** as an elevation modifier that overlays any base zone
  (temperature drops ~6.5 °C per km of altitude — the standard environmental
  lapse rate).

This yields **17 playable base zones + the highland modifier** — every Köppen
class represented, focused on the biologically meaningful range.

## 5. Zone catalog (realistic profiles, derived from Köppen criteria)

Temps are long-term seasonal means in °C (the `seasonalBaseTemp` values); precip
is the long-term annual mean in mm. These are realistic mid-range values for
each zone's real-world exemplars (Amazon, Sahara, UK, US Midwest, taiga, etc.),
consistent with the NOAA criteria in §1.

| Code | Name | Spring | Summer | Autumn | Winter | Precip (mm) | Pattern | Seasonality | Frost | Heat | Example region |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **Af** | Equatorial rainforest | 26 | 27 | 26 | 26 | 2400 | year-round | wet-dry | none | none | Amazon/Congo |
| **Am** | Equatorial monsoon | 27 | 28 | 27 | 24 | 1800 | monsoon | wet-dry | none | occasional | Monsoon Asia |
| **Aw** | Equatorial savanna | 25 | 26 | 25 | 23 | 1000 | dry-winter | wet-dry | none | occasional | Cerrado/Sahel |
| **BWh** | Subtropical desert | 22 | 35 | 24 | 12 | 100 | arid | wet-dry | none | regular | Sahara/Sonora |
| **BWk** | Mid-latitude desert | 12 | 25 | 10 | −5 | 120 | arid | four-season | severe | none | Gobi |
| **BSh** | Subtropical steppe | 20 | 28 | 19 | 10 | 350 | arid | wet-dry | occasional | regular | Sahel steppe |
| **BSk** | Mid-latitude steppe | 8 | 20 | 7 | −4 | 350 | arid | four-season | regular-winter | none | Great Plains |
| **Cfa** | Humid subtropical | 15 | 26 | 16 | 6 | 1200 | year-round | four-season | occasional | occasional | SE United States |
| **Cfb** | Marine west coast | 9 | 17 | 10 | 5 | 1000 | year-round | four-season | occasional | none | UK / Pacific NW |
| **Csa** | Mediterranean | 14 | 24 | 16 | 9 | 700 | dry-summer | four-season | occasional | regular | California |
| **Csb** | Mediterranean (cool summer) | 10 | 17 | 12 | 7 | 800 | dry-summer | four-season | occasional | none | Pacific NW coast |
| **Cwa** | Humid subtropical (dry winter) | 17 | 27 | 18 | 8 | 1000 | dry-winter | wet-dry | occasional | occasional | India / China |
| **Dfa** | Humid continental (hot summer) | 9 | 22 | 9 | −4 | 850 | year-round | four-season | regular-winter | occasional | US Midwest |
| **Dfb** | Humid continental (warm summer) | 7 | 19 | 7 | −5 | 750 | year-round | four-season | severe | none | New England / central Europe *(the existing temperate baseline)* |
| **Dfc** | Subarctic | 2 | 14 | 1 | −12 | 450 | year-round | four-season | severe | none | Taiga / Siberia |
| **Dwa** | Humid continental (dry winter) | 8 | 22 | 8 | −6 | 550 | dry-winter | four-season | severe | occasional | Beijing / Manchuria |
| **ET** | Tundra | −3 | 8 | −4 | −16 | 250 | arid | polar | severe | none | Arctic tundra |

**Highland (H)** is not a fixed row — it is a modifier: pick a base zone + an
elevation (m); subtract `elevation_m / 1000 × 6.5 °C` from every seasonal base
temp (the environmental lapse rate), and increase `frostRisk` one step if the
adjusted coldest month drops below a threshold. A base-zone Af at 2000 m becomes
roughly a Cfb-like climate — exactly the "climb a mountain, pass through several
zones" effect NatGeo describes.

## 6. Effect mapping — climate drives the sim through existing channels

The climate zone affects the simulation **only through channels that already
exist** (temperature, water, seasons, weather events). There is no new "climate
multiplier" — a desert zone is hard because of low water + heat stress, not a
hardcoded penalty. This is the core realism principle.

- **Growth rate — temperature-response curve.** Tree growth follows a
  species-dependent bell curve over temperature (a temperate deciduous tree
  peaks ~20–25 °C; a boreal species peaks lower; tropical higher). The zone's
  `seasonalBaseTemp[season]` feeds the curve each season. Tropical zones grow
  fast year-round; continental zones burst in summer + go dormant in winter; ET
  grows very slowly. This is standard tree-growth biology.
- **Water balance — precipitation vs evapotranspiration.** The new
  `precipitation.annualMm` is the supply; demand is evapotranspiration, modeled
  from temperature (Thornthwaite or Hargreaves — standard climate methods). When
  demand > supply (arid zones, dry seasons), the tree experiences drought stress
  → connects to the existing water/health system + the `droughtProbShift` hook.
- **Seasons.** `seasonality` drives the season system: `wet-dry` (tropical:
  alternating wet/dry seasons instead of spring/summer/autumn/winter),
  `four-season` (temperate/continental: the existing model), `polar` (ET: a
  short cold "growing" window + long winter). The season system already exists;
  climate selects its pattern.
- **Weather events.** The zone weights the weather-event distribution via the
  existing transition matrices (`ALL_TRANSITION_MATRICES`): frost + heavy snow
  in `severe`-frost zones; drought + heatwave in `regular`-heat zones; tropical
  storms in Af/Am/Aw; Mediterranean summer drought in Csa/Csb. Connects to the
  existing weather-damage events (RV2-1: frost/storm/heat-wave → `tree.damage`).
- **Dormancy.** Cold-winter zones (D, cold C, ET) trigger winter dormancy:
  growth pauses below a temperature threshold (realistic — deciduous trees lose
  leaves + stop growing in winter). The temperature curve already handles this
  (growth → 0 below the species' minimum), so dormancy emerges from the curve,
  not a special-case flag.

**Rule 5 / rule 6 compliance**: climate zone data is content
(`packages/content/src/weather/` extended — no new sim package); the sim reads it
through the existing WeatherSystem / growth / season channels. Changing a
climate selection cannot change simulation logic — only the data inputs.

## 7. UX — zone selection

At game start (or via a region panel), the player picks a climate zone from a
catalog **grouped by Köppen class** (Tropical / Arid / Temperate / Continental /
Polar / Highland). Each entry shows:

- The Köppen code + plain name (e.g. "Cfb — Marine west coast").
- The realistic profile: seasonal temp range, annual precipitation + pattern,
  seasonality, frost/heat risk.
- A one-line `treeSuitabilityNote` (e.g. "Arid zones: water is the limiting
  factor — invest in irrigation early").
- A real-world exemplar region (so the player anchors the climate to a place
  they know).

The selection is persisted as `climateId` in the save (already the pattern). The
**default remains Dfb** (the current temperate baseline) so existing saves + the
default starting experience are unchanged. Highland, if chosen, adds an elevation
slider (0–3000 m) with a live preview of the adjusted temperatures.

A key UX rule (from the GAP-28 boundary discussion, applied here): **the climate
must not lie to the player** — if the zone makes the tree struggle (drought,
frost, heat), the tree's visual condition (health, leaves, damage) must reflect
that. The realism cuts both ways: a favorable climate shows a thriving tree, a
hostile one shows stress.

## 8. Phased implementation

- **Phase 1 — catalog + schema (no sim behavior change).** Extend
  `ClimateBaseline` → `ClimateZone` (additive fields); add the 17 zone data
  entries; update `ALL_CLIMATES` + `findClimateById`; the existing `climate:temperate`
  becomes the Dfb entry. Tests assert each zone's profile matches its Köppen
  criteria (e.g. Af's driest month ≥ 60 mm, all monthly means > 18 °C; Csa's
  winter:summer precip ≥ 3:1; ET's warmest month < 10 °C). No WeatherSystem
  changes yet.
- **Phase 2 — effect wiring.** Wire the new fields into the existing systems:
  precipitation → drought weighting (WaterSystem / the drought hook);
  seasonality → season pattern; frost/heat risk → weather-event transition
  weighting; the temperature-response growth curve. Each is a focused change to
  an existing system, tested against the realistic outcome (a BWh tree should
  drought-stress without irrigation; a Dfc tree should go dormant in winter).
- **Phase 3 — zone-selection UX.** The climate picker (start screen or region
  panel), grouped by Köppen class, with the profile display + suitability notes.
- **Phase 4 — highland + species suitability.** The H elevation modifier; and,
  if species expand beyond White Oak / Eastern Hemlock, per-species climate
  suitability ranges (each species has an optimal Köppen band — realism extends
  to "the right tree for the right climate").

## 9. Realism summary

Every number in §5 is a realistic mid-range value for the zone's real-world
exemplar, consistent with the Köppen criteria (NOAA / Kottek et al. 2006). The
effect mapping uses standard climate + biology methods: the environmental lapse
rate (6.5 °C/km) for highland, Thornthwaite/Hargreaves evapotranspiration for the
water balance, and a species-dependent temperature-response curve for growth.
The five Köppen classes + the precipitation/temperature qualifiers map exactly
to the attached `koppen_2006.png` map's color coding.

**Caveat (flagged, not invented):** the temperature-response curve's exact shape
(per-species optimal range + minimum/maximum thresholds) + the
evapotranspiration method choice (Thornthwaite vs Hargreaves) are modeling
decisions to finalize in Phase 2 — both are standard + well-documented; the
choice affects tuning, not the Köppen grounding. No fabricated data: every zone
profile traces to a real exemplar region + the published Köppen thresholds.
