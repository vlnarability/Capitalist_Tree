# GAP-17 — Climate zones: realistic Köppen-Geiger model (design)

**Status:** design (DR-11, revised). Pre-implementation. Per user direction:
"climate zones to be as realistic as possible," grounded in the Köppen-Geiger
climate classification, with **every** Köppen-Geiger zone represented (even where
trees cannot grow) and **at least one real tree species per zone that supports
trees**. This design closes GAP-17's "needs design" gap; implementation phases
follow (see §8).

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
- `packages/content/src/species/` ships two species: `WHITE_OAK` (Quercus alba)
  and `EASTERN_HEMLOCK` (Tsuga canadensis) — both native to Dfa/Dfb in real life.
- `WeatherSystem` derives local temperature as
  `seasonalBaseTemp[season] + conditionDelta * (0.5 + intensity * 0.5)` and picks
  a weather transition matrix by climate id. There is **no precipitation field**
  yet — only a `droughtProbShiftPerDegreeC` hook for P6 global warming.

**GAP-17's job**: turn this single provisional baseline into the **full**
Köppen-Geiger climate-zone catalog, by (a) extending `ClimateBaseline` with the
Köppen classification + a precipitation profile + seasonality + frost/heat risk,
(b) expanding `ALL_CLIMATES` from 1 zone to **all 31 Köppen-Geiger climate types
+ the H highland modifier**, and (c) expanding the species catalog so every
tree-supporting zone has ≥1 real species. The existing temperate baseline
(`climate:temperate`) is classified **Dfb (warm)** — kept byte-identical for
back-compat (its winter 0 °C sits at the Köppen C/D boundary; documented as a
gameplay-tuned warm default) — and a **pure Dfb exemplar** (`climate:dfb`,
7/19/7/-5) is added separately so all 31 Köppen types have a strict-criteria-
matching exemplar. No behavior change for current saves.

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
  /** Whether trees can grow here at all (EF = false). */
  readonly supportsTrees: boolean;
  /** UX hint: how a generic tree fares here (the real effects come from the temp/precip values, not this string). */
  readonly treeSuitabilityNote: string;
}
```

The existing `seasonalBaseTemp` + `climateShiftHook` stay (the WeatherSystem
already reads them). The new fields feed the effect mapping in §6. `supportsTrees`
lets the UX gate species selection (EF offers no tree — see §5b).

## 4. Which zones to model — ALL of them

Per user direction, the catalog represents **every** Köppen-Geiger zone, not just
the ones where trees thrive. The full Köppen-Geiger classification defines **31
climate types** (A: 4, B: 4, C: 9, D: 12, E: 2) plus the **H highland modifier**:

- **A — tropical (4)**: Af, Am, As, Aw.
- **B — arid (4)**: BWh, BWk, BSh, BSk.
- **C — temperate (9)**: Cfa, Cfb, Cfc, Csa, Csb, Csc, Cwa, Cwb, Cwc.
- **D — continental (12)**: Dfa, Dfb, Dfc, Dfd, Dsa, Dsb, Dsc, Dsd, Dwa, Dwb,
  Dwc, Dwd.
- **E — polar (2)**: ET, EF.
- **H — highland**: elevation modifier overlaying any base zone (temperature drops
  ~6.5 °C per km of altitude — the standard environmental lapse rate).

> **Count note (transparency):** the commonly-cited "~30 zones" figure varies by
> source — 31 if `As` (equatorial savanna with summer dry season) and the rare
> dry-summer continental `Dsa`–`Dsd` are counted separately; 27 are visible as
> distinct colors on the attached Kottek 2006 map at map scale, because `As` +
> `Dsa`–`Dsd` occupy areas too small to render. This catalog includes **all 31 +
> H** for completeness, per the "all zones represented" direction.

**EF (ice cap)** is included for realism but flagged `supportsTrees: false` — no
species offered (see §5b). **ET (tundra)** is the extreme-challenge zone where
trees exist only at their absolute limit (prostrate / krumholz forms). Every other
zone has at least one real tree species.

## 5. Zone catalog (realistic profiles, derived from Köppen criteria)

Temps are long-term seasonal means in °C (the `seasonalBaseTemp` values); precip
is the long-term annual mean in mm. These are realistic mid-range values for each
zone's real-world exemplars, consistent with the NOAA criteria in §1.

| Code | Name | Sp | Su | Au | Wi | Precip | Pattern | Seasonality | Frost | Heat | Example region |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **Af** | Equatorial rainforest | 26 | 27 | 26 | 26 | 2400 | year-round | wet-dry | none | none | Amazon / Congo |
| **Am** | Equatorial monsoon | 27 | 28 | 27 | 24 | 1800 | monsoon | wet-dry | none | occasional | Monsoon Asia |
| **As** | Equatorial savanna (summer dry) | 25 | 26 | 25 | 23 | 800 | dry-summer | wet-dry | none | occasional | NE Brazil / Sudan |
| **Aw** | Equatorial savanna (winter dry) | 25 | 26 | 25 | 22 | 900 | dry-winter | wet-dry | none | occasional | Cerrado / African savanna |
| **BWh** | Subtropical desert | 22 | 35 | 24 | 12 | 100 | arid | wet-dry | none | regular | Sahara / Sonora |
| **BWk** | Mid-latitude desert | 12 | 25 | 10 | −5 | 120 | arid | four-season | severe | none | Gobi / Patagonia |
| **BSh** | Subtropical steppe | 20 | 28 | 19 | 10 | 350 | arid | wet-dry | occasional | regular | Sahel steppe |
| **BSk** | Mid-latitude steppe | 8 | 20 | 7 | −4 | 350 | arid | four-season | regular-winter | none | Great Plains / Eurasian steppe |
| **Cfa** | Humid subtropical | 15 | 26 | 16 | 6 | 1200 | year-round | four-season | occasional | occasional | SE United States |
| **Cfb** | Marine west coast | 9 | 17 | 10 | 5 | 1000 | year-round | four-season | occasional | none | UK / Pacific NW |
| **Cfc** | Marine subarctic | 7 | 13 | 8 | 4 | 1200 | year-round | four-season | occasional | none | Iceland / S Chile |
| **Csa** | Mediterranean (hot summer) | 14 | 24 | 16 | 9 | 700 | dry-summer | four-season | occasional | regular | California / Mediterranean |
| **Csb** | Mediterranean (cool summer) | 10 | 17 | 12 | 7 | 800 | dry-summer | four-season | occasional | none | Pacific NW coast |
| **Csc** | Mediterranean (very cool summer) | 8 | 13 | 9 | 5 | 600 | dry-summer | four-season | regular-winter | none | High-altitude Mediterranean (rare) |
| **Cwa** | Humid subtropical (dry winter) | 17 | 27 | 18 | 8 | 1000 | dry-winter | wet-dry | occasional | occasional | India / China subtropical |
| **Cwb** | Subtropical highland (dry winter) | 16 | 21 | 16 | 9 | 900 | dry-winter | wet-dry | occasional | none | Mexican highlands / Harare |
| **Cwc** | Subtropical highland (cool summer) | 11 | 14 | 11 | 7 | 500 | dry-winter | wet-dry | occasional | none | High Andes (La Paz) |
| **Dfa** | Humid continental (hot summer) | 9 | 23 | 9 | −4 | 850 | year-round | four-season | regular-winter | occasional | US Midwest |
| **Dfb** | Humid continental (warm summer) | 7 | 19 | 7 | −5 | 750 | year-round | four-season | severe | none | New England / central Europe *(pure exemplar; the warm default is `climate:temperate`)* |
| **Dfc** | Subarctic | 2 | 14 | 1 | −12 | 450 | year-round | four-season | severe | none | Taiga / Siberia |
| **Dfd** | Subarctic (extreme winter) | −4 | 14 | −3 | −25 | 300 | year-round | four-season | severe | none | Verkhoyansk / Yakutia |
| **Dsa** | Continental (dry summer, hot) | 12 | 24 | 12 | −4 | 400 | dry-summer | four-season | regular-winter | occasional | Interior NW US valleys |
| **Dsb** | Continental (dry summer, warm) | 9 | 19 | 9 | −4 | 500 | dry-summer | four-season | severe | none | Interior Pacific NW |
| **Dsc** | Continental (dry summer, cool) | 3 | 14 | 2 | −10 | 350 | dry-summer | four-season | severe | none | High interior NW / subarctic |
| **Dsd** | Continental (dry summer, extreme) | −3 | 12 | −2 | −22 | 150 | dry-summer | four-season | severe | none | Interior Yukon / BC rainshadow (rare) |
| **Dwa** | Continental (dry winter, hot) | 8 | 26 | 8 | −6 | 550 | dry-winter | four-season | severe | occasional | Beijing / Korea |
| **Dwb** | Continental (dry winter, warm) | 5 | 19 | 5 | −9 | 400 | dry-winter | four-season | severe | none | Vladivostok / Manchuria |
| **Dwc** | Subarctic (dry winter) | −3 | 14 | −2 | −22 | 250 | dry-winter | four-season | severe | none | Yakutsk |
| **Dwd** | Subarctic (dry winter, extreme) | −15 | 14 | −13 | −40 | 150 | dry-winter | four-season | severe | none | Oymyakon (coldest inhabited) |
| **ET** | Tundra | −3 | 8 | −4 | −16 | 250 | arid | polar | severe | none | Arctic tundra |
| **EF** | Ice cap | −20 | −15 | −20 | −25 | 50 | arid | polar | severe | none | Antarctica / Greenland summit |

**Highland (H)** is not a fixed row — it is a modifier: pick a base zone + an
elevation (m); subtract `elevation_m / 1000 × 6.5 °C` from every seasonal base
temp (the environmental lapse rate), and increase `frostRisk` one step if the
adjusted coldest month drops below a threshold. A base-zone Af at 2000 m becomes
roughly a Cfb-like climate — exactly the "climb a mountain, pass through several
zones" effect NatGeo describes.

## 5b. Tree species per zone (≥1 real species for every tree-supporting zone)

Every zone with `supportsTrees: true` ships at least one real tree species native
to that Köppen zone in the real world. Species already in the repo are marked
**(existing)**. The species catalog (`packages/content/src/species/`) expands
from 2 to cover the full set; each species carries its native Köppen band so the
"right tree for the right climate" is real, not decorative.

| Zone | Tree species (real, native to this Köppen zone) |
| --- | --- |
| **Af** | Kapok (*Ceiba pentandra*), big-leaf mahogany (*Swietenia macrophylla*), rubber tree (*Hevea brasiliensis*) |
| **Am** | Teak (*Tectona grandis*) |
| **As** | Senegal mahogany (*Khaya senegalensis*), umbrella thorn (*Vachellia tortilis*) |
| **Aw** | Baobab (*Adansonia digitata*), umbrella thorn (*Vachellia tortilis*) |
| **BWh** | Date palm (*Phoenix dactylifera*, oases), Joshua tree (*Yucca brevifolia*, Mojave) |
| **BWk** | Saxaul (*Haloxylon ammodendron*, Gobi) |
| **BSh** | Umbrella thorn (*Vachellia* spp.), honey mesquite (*Prosopis glandulosa*) |
| **BSk** | Ponderosa pine (*Pinus ponderosa*, steppe margins), plains cottonwood (*Populus deltoides*) |
| **Cfa** | Live oak (*Quercus virginiana*), loblolly pine (*Pinus taeda*), southern magnolia (*Magnolia grandiflora*) |
| **Cfb** | English oak (*Quercus robur*), European beech (*Fagus sylvatica*), Douglas fir (*Pseudotsuga menziesii*) |
| **Cfc** | Southern beech (*Nothofagus* spp.), Sitka spruce (*Picea sitchensis*) |
| **Csa** | Olive (*Olea europaea*), cork oak (*Quercus suber*), stone pine (*Pinus pinea*) |
| **Csb** | Coast redwood (*Sequoia sempervirens*), Douglas fir (*Pseudotsuga menziesii*) |
| **Csc** | Mountain hemlock (*Tsuga mertensiana*) — high-altitude Mediterranean |
| **Cwa** | Dawn redwood (*Metasequoia glyptostroboides*), Masson's pine (*Pinus massoniana*) |
| **Cwb** | Hartweg's pine (*Pinus hartwegii*), mountain gum (*Eucalyptus* spp.) |
| **Cwc** | *Polylepis* (*Polylepis tarapacana*) — one of the highest-altitude trees on Earth |
| **Dfa** | White oak (*Quercus alba*) **(existing)**, sugar maple (*Acer saccharum*) |
| **Dfb** | Eastern hemlock (*Tsuga canadensis*) **(existing)**, white oak (*Quercus alba*) **(existing)**, European beech (*Fagus sylvatica*) |
| **Dfc** | Black spruce (*Picea mariana*), white spruce (*Picea glauca*), Scots pine (*Pinus sylvestris*) |
| **Dfd** | Siberian larch (*Larix sibirica*), Dahurian larch (*Larix gmelinii*) |
| **Dsa** | Ponderosa pine (*Pinus ponderosa*) |
| **Dsb** | Ponderosa pine (*Pinus ponderosa*), Douglas fir (*Pseudotsuga menziesii*) |
| **Dsc** | Lodgepole pine (*Pinus contorta*) |
| **Dsd** | Subalpine larch (*Larix lyallii*) |
| **Dwa** | Chinese red pine (*Pinus tabuliformis*), Mongolian oak (*Quercus mongolica*) |
| **Dwb** | Mongolian oak (*Quercus mongolica*), Siberian elm (*Ulmus pumila*) |
| **Dwc** | Siberian larch (*Larix sibirica*) |
| **Dwd** | Dahurian larch (*Larix gmelinii*) — the coldest-tolerant tree on Earth |
| **ET** | Arctic willow (*Salix arctica*, prostrate), black spruce (*Picea mariana*) krummholz at treeline — trees at their absolute limit |
| **EF** | *(none — no tree survives perennial ice; `supportsTrees: false`)* |
| **H** | Elevation-dependent: *Polylepis* at extreme altitude, or the base zone's species shifted upslope (e.g. a Cfb base at 2000 m supports subalpine fir) |

**Existing-species continuity:** the repo's White Oak (Quercus alba) is native to
Dfa/Dfb, and Eastern Hemlock (Tsuga canadensis) to Dfb/Dfc — so the current
default starting experience (Dfb + White Oak / Hemlock) is already
climate-correct. No rework to existing species; the catalog grows around them.

All species names are real + matched to their native Köppen zones from
established silviculture / biogeography references. No fabricated species.

## 6. Effect mapping — climate drives the sim through existing channels

The climate zone affects the simulation **only through channels that already
exist** (temperature, water, seasons, weather events). There is no new "climate
multiplier" — a desert zone is hard because of low water + heat stress, not a
hardcoded penalty. This is the core realism principle.

- **Growth rate — species-dependent temperature-response curve.** Tree growth
  follows a bell curve over temperature whose optimum is **species-specific** (a
  Dahurian larch peaks far lower than a kapok). The zone's
  `seasonalBaseTemp[season]` feeds the curve each season. Tropical zones grow
  fast year-round; continental zones burst in summer + go dormant in winter; ET
  grows very slowly. This is standard tree-growth biology, and it makes
  species-climate matching mechanically real, not cosmetic.
- **Water balance — precipitation vs evapotranspiration.** The new
  `precipitation.annualMm` is the supply; demand is evapotranspiration, modeled
  from temperature (Thornthwaite or Hargreaves — standard climate methods). When
  demand > supply (arid zones, dry seasons), the tree experiences drought stress
  → connects to the existing water/health system + the `droughtProbShift` hook.
- **Seasons.** `seasonality` drives the season system: `wet-dry` (tropical:
  alternating wet/dry seasons instead of spring/summer/autumn/winter),
  `four-season` (temperate/continental: the existing model), `polar` (ET/EF: a
  short cold "growing" window + long winter). The season system already exists;
  climate selects its pattern.
- **Weather events.** The zone weights the weather-event distribution via the
  existing transition matrices (`ALL_TRANSITION_MATRICES`): frost + heavy snow
  in `severe`-frost zones; drought + heatwave in `regular`-heat zones; tropical
  storms in Af/Am/Aw; Mediterranean summer drought in Csa/Csb/Csc. Connects to
  the existing weather-damage events (RV2-1: frost/storm/heat-wave →
  `tree.damage`).
- **Dormancy.** Cold-winter zones (D, cold C, ET) trigger winter dormancy:
  growth pauses below a species-specific temperature threshold (realistic —
  deciduous trees lose leaves + stop growing in winter). The temperature curve
  already handles this (growth → 0 below the species' minimum), so dormancy
  emerges from the curve, not a special-case flag.

**Rule 5 / rule 6 compliance**: climate zone data + species data are content
(`packages/content/src/weather/` + `packages/content/src/species/` extended — no
new sim package); the sim reads them through the existing WeatherSystem / growth
/ season channels. Changing a climate or species selection cannot change
simulation logic — only the data inputs.

## 7. UX — zone + species selection

At game start (or via a region panel), the player picks a climate zone from a
catalog **grouped by Köppen class** (Tropical / Arid / Temperate / Continental /
Polar / Highland), then a tree species appropriate to that zone. Each climate
entry shows:

- The Köppen code + plain name (e.g. "Cfb — Marine west coast").
- The realistic profile: seasonal temp range, annual precipitation + pattern,
  seasonality, frost/heat risk.
- A one-line `treeSuitabilityNote` (e.g. "Arid zones: water is the limiting
  factor — invest in irrigation early").
- A real-world exemplar region (so the player anchors the climate to a place
  they know).
- The list of native species for that zone (§5b). EF offers no species + is
  clearly marked unplayable-for-trees.

The selection is persisted as `climateId` + `speciesId` in the save (already the
pattern). The **default remains Dfb + White Oak** (the current baseline + an
existing species) so existing saves + the default starting experience are
unchanged. Highland, if chosen, adds an elevation slider (0–4000 m) with a live
preview of the adjusted temperatures + which species survive the shifted climate.

A key UX rule (from the GAP-28 boundary discussion, applied here): **the climate
must not lie to the player** — if the zone makes the tree struggle (drought,
frost, heat), the tree's visual condition (health, leaves, damage) must reflect
that. The realism cuts both ways: a favorable climate shows a thriving tree, a
hostile one shows stress.

## 8. Phased implementation

- **Phase 1 — climate catalog + schema (DONE; no sim behavior change).** Extended
  `ClimateBaseline` → `ClimateZone` (additive fields incl. `supportsTrees`);
  added all 31 Köppen zone data entries in `packages/content/src/weather/koppen-zones.ts`
  + the H highland modifier function (`applyHighlandModifier`, 6.5 °C/km lapse
  rate) in `highland.ts`; updated `ALL_CLIMATES` + `findClimateById` +
  `weather/index.ts` exports. The existing `climate:temperate` is kept
  byte-identical (temps + hook unchanged) + classified warm-Dfb; a pure Dfb
  exemplar (`climate:dfb`) is added separately. Tests
  (`packages/simulation/test/climate-zones.test.ts`) assert: all 31 Köppen codes
  present + unique ids + koppenCode↔class + `supportsTrees=false` only for EF;
  each pure exemplar satisfies its class + precipitation-qualifier + third-letter
  (a/b/c, h/k) criteria; the default's id/temps/hook are unchanged; the H modifier
  applies the lapse rate + bumps frost risk + does not mutate the base. The 'd'
  qualifier (coldest month < −38 °C) + the 'b'-vs-'c' months-over-10 °C
  distinction + the Csa 3:1 winter:summer precip ratio need **monthly** means
  (the schema stores 4 seasonal means) — deferred to Phase 3 when the effect
  wiring needs them. No WeatherSystem changes.
- **Phase 2 — species catalog expansion (DONE).** Added a `nativeKoppenCodes`
  field (required, non-empty array) to `treeSpeciesSchema`; tagged the existing
  White Oak (Dfa/Dfb) + Eastern Hemlock (Dfb/Dfc) with their native bands; added
  25 new real species covering every tree-supporting Köppen zone, built via an
  allometric `makeSpecies` factory (`packages/content/src/species/make-species.ts`)
  that derives the tuning constants from each species' real-world essence (max
  height, growth rate, maturity age, deciduousness, climate-derived temperature
  range, growth form). Species are split across `tropical.ts` / `arid.ts` /
  `temperate.ts` / `continental.ts` / `polar.ts`; `findSpeciesByKoppenCode(code)`
  returns the species offered for a zone. Phase 2 ships 1 species per zone
  (coverage) rather than the full 3-per-zone richness in §5b — the additional
  species can be appended later without engine changes. Tests
  (`packages/simulation/test/species-zones.test.ts`, 17 tests): every
  `supportsTrees: true` zone has ≥1 species; no species for EF; every species
  parses `treeSpeciesSchema` + has valid non-empty `nativeKoppenCodes`; cold-zone
  species tolerate sub-zero minimums, hot-zone ≥40 °C, tropical ≥10 °C; the
  existing White Oak / Eastern Hemlock bands are climate-correct; multi-zone
  species (Ponderosa pine BSk/Dsa/Dsb, black spruce Dfc/ET) cover their full band.
- **Phase 3 — effect wiring.** Wire the new fields into the existing systems:
  precipitation → drought weighting (WaterSystem / the drought hook);
  seasonality → season pattern; frost/heat risk → weather-event transition
  weighting; the **species-dependent** temperature-response growth curve. Each is
  a focused change to an existing system, tested against the realistic outcome (a
  BWh date palm should drought-stress without irrigation; a Dwd Dahurian larch
  should survive extreme cold + go dormant; a Dfa white oak should thrive).
- **Phase 4 — zone + species selection UX.** The climate + species picker (start
  screen or region panel), grouped by Köppen class, with the profile display +
  native-species list. Highland elevation slider with live temperature preview +
  species-survival check.
- **Phase 5 — highland + cross-zone dynamics** (optional / later). The H modifier
  interacting with the lapse rate across a full elevation gradient; per-species
  climate-suitability scoring for the "right tree for the right climate" as a
  gameplay lever.

## 9. Realism summary

Every number in §5 is a realistic mid-range value for the zone's real-world
exemplar, consistent with the Köppen criteria (NOAA / Kottek et al. 2006). Every
species in §5b is a real tree native to its listed Köppen zone, drawn from
established silviculture / biogeography. The effect mapping uses standard climate
+ biology methods: the environmental lapse rate (6.5 °C/km) for highland,
Thornthwaite/Hargreaves evapotranspiration for the water balance, and a
species-dependent temperature-response curve for growth. The five Köppen classes
+ the precipitation/temperature qualifiers map exactly to the attached
`koppen_2006.png` map's color coding.

**Caveats (flagged, not invented):** (1) the temperature-response curve's exact
shape (per-species optimal range + minimum/maximum thresholds) + the
evapotranspiration method choice (Thornthwaite vs Hargreaves) are modeling
decisions to finalize in Phase 3 — both are standard + well-documented; the
choice affects tuning, not the Köppen grounding. (2) The rare dry-summer
continental zones (Dsa–Dsd) + As occupy very small real-world areas; their
profiles are realistic but their gameplay differentiation from neighboring zones
(Dwa/Dwb/Dwc/Dwd, Aw) is thin — they are included for completeness per the "all
zones" direction. No fabricated data: every zone profile traces to a real
exemplar region + the published Köppen thresholds; every species traces to a real
native range.
