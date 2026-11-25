#!/usr/bin/env python3
"""
W62 species generator — hand-authors the 25 factory species as explicit
TreeSpecies objects (replacing the makeSpecies factory calls in the 5 biome
files) with values computed via the factory's allometric formulas (so the
output is balance-identical to the current factory output) + authored
biological comments.

The gold standard is white-oak.ts / eastern-hemlock.ts (full explicit objects
with per-field biological reasoning). This script emits the same shape for the
25 biome species, making them first-class, individually-tunable, documented
content rather than factory-homogenized output.

Run: python3 scripts/w62-species-generator.py
Output: overwrites the 5 biome .ts files in packages/content/src/species/.
"""
import os
from textwrap import dedent

ROOT = os.path.join(os.path.dirname(__file__), '..', 'packages', 'content', 'src', 'species')

# --- form defaults (mirror make-species.ts FORM_DEFAULTS) ---
FORM_DEFAULTS = {
    'broadleaf': dict(heightDiameterSplit=0.4, maxSlendernessRatio=40, trunkDiameterDivisor=18,
                      rootDevelopmentRate=0.02, photosynthesisRate=1.0, leafAreaPerLeaf=0.005, leafEnergyCost=2,
                      saplingHeight=0.5, saplingTrunkDiameter=0.01, saplingLeafCapacity=200,
                      saplingRootDevelopment=0.15, saplingAbsorption=0.3, saplingReserveCapacity=120,
                      saplingWaterCapacity=50, saplingEnergyReserves=120),
    'conifer': dict(heightDiameterSplit=0.55, maxSlendernessRatio=50, trunkDiameterDivisor=30,
                    rootDevelopmentRate=0.015, photosynthesisRate=0.8, leafAreaPerLeaf=0.002, leafEnergyCost=1.5,
                    saplingHeight=0.4, saplingTrunkDiameter=0.008, saplingLeafCapacity=150,
                    saplingRootDevelopment=0.12, saplingAbsorption=0.25, saplingReserveCapacity=100,
                    saplingWaterCapacity=40, saplingEnergyReserves=100),
    'palm': dict(heightDiameterSplit=0.7, maxSlendernessRatio=70, trunkDiameterDivisor=55,
                 rootDevelopmentRate=0.018, photosynthesisRate=1.1, leafAreaPerLeaf=0.008, leafEnergyCost=3,
                 saplingHeight=0.6, saplingTrunkDiameter=0.015, saplingLeafCapacity=80,
                 saplingRootDevelopment=0.1, saplingAbsorption=0.2, saplingReserveCapacity=80,
                 saplingWaterCapacity=60, saplingEnergyReserves=80),
}

DAYS_PER_YEAR = 120

def round2(n):
    return round(n, 2)

def round1(n):
    return round(n, 1)

def compute(s):
    """Apply the makeSpecies allometric formulas to a species essence → full fields."""
    form = s.get('form') or ('broadleaf' if s['deciduous'] else 'conifer')
    d = FORM_DEFAULTS[form]
    maxH = s['maximumHeight']
    maxTrunkDiameter = s.get('maximumTrunkDiameter', round2(maxH / d['trunkDiameterDivisor']))
    maxBranchDev = round(maxH * 4)
    reserveCapacity = s.get('reserveCapacity', round(maxH * 40))
    waterRequirement = s.get('waterRequirement', round(maxH * 2))
    nutrientRequirement = dict(
        nitrogen=max(1, round(maxH * 0.2)),
        phosphorus=max(0.5, round1(maxH * 0.08)),
        potassium=max(1, round(maxH * 0.16)),
    )
    saplingHeight = min(d['saplingHeight'], maxH * 0.5)
    saplingTrunkDiameter = min(d['saplingTrunkDiameter'], round2(maxTrunkDiameter * 0.1))
    matureAgeDays = round(s['matureAgeYears'] * DAYS_PER_YEAR)
    return dict(
        form=form,
        maxTrunkDiameter=maxTrunkDiameter,
        maxBranchDev=maxBranchDev,
        reserveCapacity=reserveCapacity,
        waterRequirement=waterRequirement,
        nutrientRequirement=nutrientRequirement,
        saplingHeight=saplingHeight,
        saplingTrunkDiameter=saplingTrunkDiameter,
        matureAgeDays=matureAgeDays,
        heightDiameterSplit=s.get('heightDiameterSplit', d['heightDiameterSplit']),
        maxSlendernessRatio=s.get('maxSlendernessRatio', d['maxSlendernessRatio']),
        rootDevelopmentRate=d['rootDevelopmentRate'],
        photosynthesisRate=s.get('photosynthesisRate', d['photosynthesisRate']),
        leafAreaPerLeaf=s.get('leafAreaPerLeaf', d['leafAreaPerLeaf']),
        leafEnergyCost=s.get('leafEnergyCost', d['leafEnergyCost']),
        saplingLeafCapacity=d['saplingLeafCapacity'],
        saplingRootDevelopment=d['saplingRootDevelopment'],
        saplingAbsorption=d['saplingAbsorption'],
        saplingReserveCapacity=d['saplingReserveCapacity'],
        saplingWaterCapacity=d['saplingWaterCapacity'],
        saplingEnergyReserves=d['saplingEnergyReserves'],
    )

def fmt_num(n):
    # match TS number formatting: integers without trailing .0, 1-dec as needed
    if isinstance(n, float) and n.is_integer():
        return str(int(n))
    return str(n)

def qstr(s):
    """Quote a string for TS — double quotes if it contains an apostrophe."""
    if "'" in s:
        return f'"{s}"'
    return f"'{s}'"

def emit_species(s, f):
    """Emit one hand-authored TreeSpecies object as TS."""
    tmin, topt, tmax = s['temperatureRange']
    n = f['nutrientRequirement']
    form_label = f['form']
    doc = s['doc'].rstrip()
    # matureAgeDays expression as years*120 when clean
    mad = f['matureAgeDays']
    mad_expr = f"{s['matureAgeYears']} * 120" if mad == s['matureAgeYears'] * DAYS_PER_YEAR else str(mad)
    out = []
    doc_lines = doc.split('\n')
    out.append(f"/** {doc_lines[0]}")
    for line in doc_lines[1:]:
        out.append(f" * {line}" if line else " *")
    out.append(" *")
    out.append(" * Every constant is `@provisional` per GDD §17 (\"detailed photosynthesis")
    out.append(" * and energy allocation equations\"); values derive from the makeSpecies")
    out.append(" * allometric formulas + are tunable in playtesting.")
    out.append(" */")
    out.append(f"export const {s['const']}: TreeSpecies = {{")
    out.append(f"  id: {qstr(s['id'])},")
    out.append(f"  name: {qstr(s['name'])},")
    out.append(f"  scientificName: {qstr(s['scientificName'])},")
    out.append(f"  deciduous: {'true' if s['deciduous'] else 'false'},")
    out.append(f"  nativeKoppenCodes: {str(s['nativeKoppenCodes'])},")
    out.append("")
    out.append(f"  growthRate: {fmt_num(s['growthRate'])},")
    out.append(f"  matureAgeDays: {mad_expr}, // {mad} days")
    out.append(f"  maximumHeight: {fmt_num(s['maximumHeight'])},")
    out.append(f"  maximumTrunkDiameter: {fmt_num(f['maxTrunkDiameter'])}, // {s['maximumHeight']}/{FORM_DEFAULTS[form_label]['trunkDiameterDivisor']} ({form_label} divisor)")
    out.append(f"  maximumBranchDevelopment: {f['maxBranchDev']},")
    out.append(f"  heightDiameterSplit: {fmt_num(f['heightDiameterSplit'])}, // {form_label} default")
    out.append(f"  maxSlendernessRatio: {fmt_num(f['maxSlendernessRatio'])},")
    out.append(f"  rootDevelopmentRate: {fmt_num(f['rootDevelopmentRate'])}, // {form_label} default")
    out.append(f"  reserveCapacity: {f['reserveCapacity']},")
    out.append(f"  waterRequirement: {f['waterRequirement']},")
    out.append(f"  nutrientRequirement: {{ nitrogen: {fmt_num(n['nitrogen'])}, phosphorus: {fmt_num(n['phosphorus'])}, potassium: {fmt_num(n['potassium'])} }},")
    out.append(f"  temperatureRange: {{ minimum: {tmin}, optimum: {topt}, maximum: {tmax} }},")
    out.append(f"  photosynthesisRate: {fmt_num(f['photosynthesisRate'])}, // {form_label} default")
    out.append(f"  leafAreaPerLeaf: {fmt_num(f['leafAreaPerLeaf'])}, // {form_label} default")
    out.append("  leafDenominationMinor: PROVISIONAL_BIOLOGY_DEFAULT_LEAF_DENOMINATION_MINOR,")
    out.append(f"  leafEnergyCost: {fmt_num(f['leafEnergyCost'])}, // {form_label} default")
    out.append("  maximumHarvestFraction: PROVISIONAL_BIOLOGY_DEFAULT_MAX_HARVEST_FRACTION,")
    out.append("")
    out.append("  initial: {")
    out.append(f"    height: {fmt_num(f['saplingHeight'])},")
    out.append(f"    trunkDiameter: {fmt_num(f['saplingTrunkDiameter'])},")
    out.append("    branchDevelopment: 0,")
    out.append(f"    leafCapacity: {f['saplingLeafCapacity']},")
    out.append(f"    rootDevelopment: {fmt_num(f['saplingRootDevelopment'])},")
    out.append(f"    absorptionCapacity: {fmt_num(f['saplingAbsorption'])},")
    out.append(f"    reserveCapacity: {f['saplingReserveCapacity']},")
    out.append(f"    waterCapacity: {f['saplingWaterCapacity']},")
    out.append(f"    waterStored: {f['saplingWaterCapacity']},")
    out.append(f"    energyReserves: {f['saplingEnergyReserves']},")
    out.append(f"    nutrients: {{ nitrogen: {fmt_num(n['nitrogen'])}, phosphorus: {fmt_num(n['phosphorus'])}, potassium: {fmt_num(n['potassium'])} }},")
    out.append("  },")
    out.append("};")
    return "\n".join(out)

# ---------------------------------------------------------------------------
# The 25 species' essence + authored biological doc.
# ---------------------------------------------------------------------------
TEMPERATE = [
    dict(const='LIVE_OAK', id='species:live-oak', name='Live Oak', scientificName='Quercus virginiana',
         deciduous=False, form='broadleaf', nativeKoppenCodes=['Cfa'], maximumHeight=20, growthRate=0.45, matureAgeYears=100,
         temperatureRange=(5, 22, 38),
         doc="Live Oak (Quercus virginiana) — Cfa humid subtropical. Evergreen broadleaf that\nkeeps its leaves year-round (contrast: the deciduous White Oak of Dfa/Dfb). Famous\nfor a broad, spreading canopy + exceptional longevity (200+ years). Dense, durable\nwood. Slower-growing than White Oak despite the warmer climate — the evergreen\nhabit trades peak growth rate for year-round photosynthesis."),
    dict(const='ENGLISH_OAK', id='species:english-oak', name='English Oak', scientificName='Quercus robur',
         deciduous=True, nativeKoppenCodes=['Cfb'], maximumHeight=35, growthRate=0.5, matureAgeYears=150,
         temperatureRange=(0, 18, 35),
         doc="English Oak (Quercus robur) — Cfb marine west coast. Deciduous broadleaf, a close\nOld-World cousin of White Oak (also Quercus) but taller (to 35 m) + more cold-\ntolerant (minimum 0 °C vs White Oak's 5 °C). Long-lived (150+ years to maturity);\nthe iconic oak of European forests. Same girth-heavy build as White Oak."),
    dict(const='SOUTHERN_BEECH', id='species:southern-beech', name='Southern Beech', scientificName='Nothofagus spp.',
         deciduous=False, form='broadleaf', nativeKoppenCodes=['Cfc'], maximumHeight=30, growthRate=0.5, matureAgeYears=120,
         temperatureRange=(2, 14, 28),
         doc="Southern Beech (Nothofagus spp.) — Cfc marine subarctic. Evergreen broadleaf of\nthe cool, oceanic southern hemisphere (New Zealand, Patagonia). A Gondwanan relic\ngenus — contrasts the northern oaks/pines. Cold-summer tolerant (optimum 14 °C);\ngrows to 30 m where the climate allows."),
    dict(const='OLIVE', id='species:olive', name='Olive', scientificName='Olea europaea',
         deciduous=False, form='broadleaf', nativeKoppenCodes=['Csa'], maximumHeight=12, growthRate=0.35, matureAgeYears=80,
         temperatureRange=(5, 20, 38),
         doc="Olive (Olea europaea) — Csa Mediterranean (hot summer). Evergreen, famously\ndrought-tolerant small tree (to 12 m). Slow-growing (0.35) + exceptionally\nlong-lived (some specimens are 1000+ years). Leathery leaves + a deep root system\nadapt it to the long summer dry season. The small, dense canopy contrasts the\nbroad oaks."),
    dict(const='COAST_REDWOOD', id='species:coast-redwood', name='Coast Redwood', scientificName='Sequoia sempervirens',
         deciduous=False, form='conifer', nativeKoppenCodes=['Csb'], maximumHeight=80, growthRate=0.7, matureAgeYears=200,
         temperatureRange=(2, 16, 30),
         doc="Coast Redwood (Sequoia sempervirens) — Csb Mediterranean (cool summer). The\ntallest tree species on Earth (to 80 m +). Evergreen conifer of the Pacific fog-\nbelt; fast-growing for a conifer (0.7). The extreme height makes the maturity\nmechanic span the longest horizon of any species (200 years). Height-focused\nconifer build."),
    dict(const='MOUNTAIN_HEMLOCK', id='species:mountain-hemlock', name='Mountain Hemlock', scientificName='Tsuga mertensiana',
         deciduous=False, form='conifer', nativeKoppenCodes=['Csc'], maximumHeight=25, growthRate=0.35, matureAgeYears=150,
         temperatureRange=(-2, 12, 25),
         doc="Mountain Hemlock (Tsuga mertensiana) — Csc Mediterranean (very cool summer). High-\naltitude conifer of the Pacific Northwest; a close relative of Eastern Hemlock\nbut adapted to high, snowy montane climates (minimum -2 °C). Slender, slow-\ngrowing (0.35), long-lived. Carries large, heavy cones relative to its size."),
    dict(const='DAWN_REDWOOD', id='species:dawn-redwood', name='Dawn Redwood', scientificName='Metasequoia glyptostroboides',
         deciduous=True, form='conifer', nativeKoppenCodes=['Cwa'], maximumHeight=40, growthRate=0.8, matureAgeYears=80,
         temperatureRange=(-5, 20, 35),
         doc="Dawn Redwood (Metasequoia glyptostroboides) — Cwa subtropical (dry winter). A rare\nDECIDUOUS conifer — sheds its needles each winter (one of few such species, like\nthe larches). Fast-growing (0.8) + reaches 40 m. A living fossil (described from\nfossils before living trees were found). The deciduous-conifer contrast exercises\nboth seasonal + form branches."),
    dict(const='HARTWEGS_PINE', id='species:hartwegs-pine', name="Hartweg's Pine", scientificName='Pinus hartwegii',
         deciduous=False, form='conifer', nativeKoppenCodes=['Cwb'], maximumHeight=20, growthRate=0.3, matureAgeYears=120,
         temperatureRange=(-2, 14, 25),
         doc="Hartweg's Pine (Pinus hartwegii) — Cwb subtropical highland (dry winter). High-\naltitude pine of the Mexican volcanics; one of the highest-elevation pines. Slow-\ngrowing (0.3), short (to 20 m), cold-tolerant. Forms the treeline on its native\npeaks. Stout conifer build for the harsh highland climate."),
    dict(const='POLYLEPIS', id='species:polylepis', name='Polylepis', scientificName='Polylepis tarapacana',
         deciduous=False, form='broadleaf', nativeKoppenCodes=['Cwc'], maximumHeight=5, growthRate=0.15, matureAgeYears=200,
         temperatureRange=(-3, 10, 20), maxSlendernessRatio=20,
         doc="Polylepis (Polylepis tarapacana) — Cwc subtropical highland (cool summer). One of\nthe highest-altitude trees on Earth (to ~5200 m in the Andes). Stunted, gnarled,\nprostrate at the extreme altitude (max 5 m). Extremely slow (0.15) + very long-\nlived (200+ years to maturity). The low maxSlendernessRatio (20) reflects the\nstout, low-spreading high-altitude form."),
]

CONTINENTAL = [
    dict(const='BLACK_SPRUCE', id='species:black-spruce', name='Black Spruce', scientificName='Picea mariana',
         deciduous=False, form='conifer', nativeKoppenCodes=['Dfc', 'ET'], maximumHeight=20, growthRate=0.3, matureAgeYears=100,
         temperatureRange=(-5, 15, 28),
         doc="Black Spruce (Picea mariana) — Dfc + ET. The boreal conifer of the North American\ntaiga; also forms krummholz (stunted prostrate mats) at the Arctic treeline. Small\n(to 20 m), slow-growing (0.3), cold-hardy (minimum -5 °C). Tolerates the wet,\nacidic, permafrost soils of the boreal lowlands. The other treeline form besides\nArctic Willow."),
    dict(const='SIBERIAN_LARCH', id='species:siberian-larch', name='Siberian Larch', scientificName='Larix sibirica',
         deciduous=True, form='conifer', nativeKoppenCodes=['Dfd', 'Dwc'], maximumHeight=30, growthRate=0.4, matureAgeYears=120,
         temperatureRange=(-10, 15, 28),
         doc="Siberian Larch (Larix sibirica) — Dfd + Dwc. Deciduous conifer of the cold\ncontinental interior of Eurasia; sheds its needles for the extreme winter (a\ndeciduous habit is an adaptation to the deep-freeze continental climate — it\navoids winter desiccation + transpiration loss). Grows to 30 m; cold-tolerant to\n-10 °C. The most widely planted larch in northern forestry."),
    dict(const='DAHURIAN_LARCH', id='species:dahurian-larch', name='Dahurian Larch', scientificName='Larix gmelinii',
         deciduous=True, form='conifer', nativeKoppenCodes=['Dfd', 'Dwd'], maximumHeight=25, growthRate=0.3, matureAgeYears=120,
         temperatureRange=(-15, 14, 25),
         doc="Dahurian Larch (Larix gmelinii) — Dfd + Dwd. The coldest-tolerant tree species on\nEarth — it forms the world's northernmost treeline in northern Siberia. Deciduous\nconifer (like Siberian Larch) but more cold-hardy (minimum -15 °C). Slow-growing\n(0.3); the extreme cold tolerance makes it the defining species of the coldest\ncontinental climates."),
    dict(const='LODGEPOLE_PINE', id='species:lodgepole-pine', name='Lodgepole Pine', scientificName='Pinus contorta',
         deciduous=False, form='conifer', nativeKoppenCodes=['Dsc'], maximumHeight=25, growthRate=0.45, matureAgeYears=100,
         temperatureRange=(-8, 14, 28),
         doc="Lodgepole Pine (Pinus contorta) — Dsc. Continental dry-summer (cool) conifer of\nthe North American interior; named for its use as tipi poles. A pioneer species\nthat colonizes after fire (serotinous cones release seed on heating). Moderate\ngrowth (0.45), cold-tolerant (-8 °C), straight + slender — the height-focused\nconifer build suits its tall, narrow form."),
    dict(const='SUBALPINE_LARCH', id='species:subalpine-larch', name='Subalpine Larch', scientificName='Larix lyallii',
         deciduous=True, form='conifer', nativeKoppenCodes=['Dsd'], maximumHeight=15, growthRate=0.2, matureAgeYears=150,
         temperatureRange=(-10, 12, 22),
         doc="Subalpine Larch (Larix lyallii) — Dsd. Deciduous conifer of the high continental\ninteriors of the North American Rockies. Stunted at altitude (to 15 m), slow-\ngrowing (0.2), long-lived (150+ years). Golden autumn needles make it a flagship\nspecies of the high subalpine. Cold-tolerant to -10 °C; deciduous for winter\navoidance."),
    dict(const='CHINESE_RED_PINE', id='species:chinese-red-pine', name='Chinese Red Pine', scientificName='Pinus tabuliformis',
         deciduous=False, form='conifer', nativeKoppenCodes=['Dwa'], maximumHeight=25, growthRate=0.5, matureAgeYears=100,
         temperatureRange=(-8, 16, 32),
         doc="Chinese Red Pine (Pinus tabuliformis) — Dwa. Continental dry-winter (hot summer)\nconifer of East Asia; the lowland pine of northern China. Moderate growth (0.5),\ncold-tolerant (-8 °C) + heat-tolerant (maximum 32 °C) — spans a wide temperature\nrange reflecting the hot-summer / cold-winter continental climate. The flat-\ntopped canopy gives its species epithet."),
    dict(const='MONGOLIAN_OAK', id='species:mongolian-oak', name='Mongolian Oak', scientificName='Quercus mongolica',
         deciduous=True, nativeKoppenCodes=['Dwa', 'Dwb'], maximumHeight=25, growthRate=0.4, matureAgeYears=120,
         temperatureRange=(-10, 16, 30),
         doc="Mongolian Oak (Quercus mongolica) — Dwa + Dwb. Deciduous broadleaf of East Asian\ncontinental forests; the cold-tolerant oak (minimum -10 °C, far hardier than\nWhite Oak). A third Quercus (with White + English Oak) — same girth-heavy build\nbut adapted to the deep-freece continental winters. Slow-growing (0.4); the\ndeciduous habit handles the cold winter."),
]

TROPICAL = [
    dict(const='KAPOK', id='species:kapok', name='Kapok', scientificName='Ceiba pentandra',
         deciduous=True, nativeKoppenCodes=['Af'], maximumHeight=60, growthRate=0.8, matureAgeYears=100,
         temperatureRange=(15, 28, 38),
         doc="Kapok (Ceiba pentandra) — Af equatorial rainforest. A rainforest EMERGENT — it\ntowers above the closed canopy (to 60 m) on a tall, buttressed trunk. Fast-\ngrowing (0.8) + deciduous in seasonal climates (drops leaves to emerge above\nthe canopy for pollination). Tropical broadleaf build; the great height makes it\nthe tallest broadleaf species."),
    dict(const='TEAK', id='species:teak', name='Teak', scientificName='Tectona grandis',
         deciduous=True, nativeKoppenCodes=['Am'], maximumHeight=40, growthRate=0.7, matureAgeYears=80,
         temperatureRange=(15, 27, 38),
         doc="Teak (Tectona grandis) — Am equatorial monsoon. Deciduous in the dry season; one\nof the world's most valuable timber trees (hard, durable, oily wood). Fast-\ngrowing (0.7), to 40 m. Tropical broadleaf build; the large, rough leaves shed\nfor the dry season. A flagship tropical-forestry species."),
    dict(const='SENEGAL_MAHOGANY', id='species:senegal-mahogany', name='Senegal Mahogany', scientificName='Khaya senegalensis',
         deciduous=True, nativeKoppenCodes=['As'], maximumHeight=30, growthRate=0.6, matureAgeYears=70,
         temperatureRange=(15, 27, 40),
         doc="Senegal Mahogany (Khaya senegalensis) — As tropical dry savanna. Semi-deciduous\nmahogany of the African dry tropics; a premium timber species. Moderate-fast\ngrowth (0.6), to 30 m, heat-tolerant (maximum 40 °C). Drought-tolerant for a\nmahogany — native to the savanna rather than closed rainforest."),
    dict(const='BAOBAB', id='species:baobab', name='Baobab', scientificName='Adansonia digitata',
         deciduous=True, nativeKoppenCodes=['Aw'], maximumHeight=25, growthRate=0.4, matureAgeYears=200,
         temperatureRange=(15, 27, 40), maximumTrunkDiameter=3, maxSlendernessRatio=12,
         doc="Baobab (Adansonia digitata) — Aw tropical savanna. The iconic savanna tree with a\nfamously massive, water-storing trunk (to 25 m tall but a trunk diameter of 3 m →\nmaxSlendernessRatio 12, the stoutest of any species). Deciduous in the long dry\nseason; extremely long-lived (1000+ years, 200 to maturity). Slow-growing (0.4).\nThe overridden trunk diameter + slenderness reflect the biology."),
]

ARID = [
    dict(const='DATE_PALM', id='species:date-palm', name='Date Palm', scientificName='Phoenix dactylifera',
         deciduous=False, form='palm', nativeKoppenCodes=['BWh'], maximumHeight=21, growthRate=0.6, matureAgeYears=50,
         temperatureRange=(12, 32, 48),
         doc="Date Palm (Phoenix dactylifera) — BWh desert oasis palm. The only palm species;\nkept its fronds year-round (palms don't drop fronds like broadleaf). Extreme heat\ntolerance (maximum 48 °C, the highest of any species). An oasis tree — its deep\ntaproots reach groundwater. The palm form (heightDiameterSplit 0.7) gives the\nslender, unbranched trunk."),
    dict(const='SAXAUL', id='species:saxaul', name='Saxaul', scientificName='Haloxylon ammodendron',
         deciduous=True, nativeKoppenCodes=['BWk'], maximumHeight=7, growthRate=0.3, matureAgeYears=80,
         temperatureRange=(-5, 15, 35),
         doc="Saxaul (Haloxylon ammodendron) — BWk cold desert. A drought-deciduous shrub-tree\nof the cold Central Asian deserts (Gobi, Taklamakan). Small (to 7 m, the smallest\nbroadleaf tree besides prostrate Polylepis/Arctic Willow); cold-tolerant for a\ndesert species (minimum -5 °C). A desert halophyte; the deciduous habit + reduced\nleaves cut water loss."),
    dict(const='HONEY_MESQUITE', id='species:honey-mesquite', name='Honey Mesquite', scientificName='Prosopis glandulosa',
         deciduous=True, nativeKoppenCodes=['BSh'], maximumHeight=10, growthRate=0.4, matureAgeYears=50,
         temperatureRange=(5, 28, 45),
         doc="Honey Mesquite (Prosopis glandulosa) — BSh hot semi-arid steppe. Drought-deciduous\nshrubby tree of the North American SW; famous for a VERY deep taproot (to 50 m)\nthat reaches groundwater. Moderate growth (0.4), to 10 m, extreme heat tolerance\n(maximum 45 °C). Nitrogen-fixing — enriches the desert soil. Deciduous for the\ndry season."),
    dict(const='PONDEROSA_PINE', id='species:ponderosa-pine', name='Ponderosa Pine', scientificName='Pinus ponderosa',
         deciduous=False, form='conifer', nativeKoppenCodes=['BSk', 'Dsa', 'Dsb'], maximumHeight=50, growthRate=0.5, matureAgeYears=150,
         temperatureRange=(0, 18, 38),
         doc="Ponderosa Pine (Pinus ponderosa) — BSk + Dsa + Dsb. A drought-tolerant conifer of\nthe western North American steppe margins + dry montane interiors; spans three\nKöppen zones. One of the most widespread + tallest pines (to 50 m). Moderate-fast\ngrowth (0.5), long-lived (150+ years to maturity). The height-focused conifer\nbuild suits its tall, open-canopy form."),
]

POLAR = [
    dict(const='ARCTIC_WILLOW', id='species:arctic-willow', name='Arctic Willow', scientificName='Salix arctica',
         deciduous=True, nativeKoppenCodes=['ET'], maximumHeight=0.3, growthRate=0.1, matureAgeYears=50,
         temperatureRange=(-8, 8, 18), maxSlendernessRatio=25,
         doc="Arctic Willow (Salix arctica) — ET tundra. A prostrate deciduous shrub that barely\nqualifies as a tree — it creeps along the ground (maximum height 0.3 m, the\nsmallest of any species) to escape the Arctic wind. Extremely slow-growing (0.1,\nthe slowest — a response to the brief 6–8 week growing season + permafrost).\nCold-tolerant to -8 °C; the low maxSlendernessRatio (25) reflects the prostrate,\nlow-spreading form."),
]

FILES = [
    ('temperate.ts', 'Temperate (Köppen C) tree species — GAP-17 / DR-11 Phase 2 (W62 hand-authored).',
     'One real, native species per tree-supporting C-zone (Cfa, Cfb, Cfc, Csa, Csb, Csc, Cwa,\nCwb, Cwc). Mix of broadleaf + conifer, evergreen + deciduous, reflecting the mild-\nclimate diversity. The dawn redwood + coast redwood are notable (deciduous conifer\n+ tallest tree respectively). Each species is a hand-authored TreeSpecies object\n(W62) — values derive from the makeSpecies allometric formulas; the explicit form\nmakes them first-class, individually-tunable content.', TEMPERATE),
    ('continental.ts', 'Continental (Köppen D) tree species — GAP-17 / DR-11 Phase 2 (W62 hand-authored).',
     'One real, native species per tree-supporting D-zone not already covered by the existing\nWhite Oak (Dfa/Dfb) + Eastern Hemlock (Dfb/Dfc): Dfc (black spruce), Dfd/Dwc/Dwd\n(Siberian + Dahurian larch), Dsc (lodgepole pine), Dsd (subalpine larch), Dwa\n(Chinese red pine + Mongolian oak). The larches are deciduous conifers — a key\ncold-climate adaptation. Each species is a hand-authored TreeSpecies object (W62).', CONTINENTAL),
    ('tropical.ts', 'Tropical (Köppen A) tree species — GAP-17 / DR-11 Phase 2 (W62 hand-authored).',
     'One real, native species per tree-supporting A-zone (Af, Am, As, Aw). All are hot-\nclimate broadleaf species; kapok + teak + mahogany are rainforest/monsoon canopy\nspecies, baobab is the iconic savanna tree with a massively stout trunk. Each\nspecies is a hand-authored TreeSpecies object (W62) — the baobab overrides the\nbroadleaf trunk/slenderness defaults to reflect its water-storing trunk.', TROPICAL),
    ('arid.ts', 'Arid (Köppen B) tree species — GAP-17 / DR-11 Phase 2 (W62 hand-authored).',
     'One real, native species per tree-supporting B-zone (BWh, BWk, BSh, BSk — the last via\nPonderosa pine, which also covers Dsa/Dsb). Arid-zone trees are defined by water\nstress: the date palm is an oasis palm, saxaul + mesquite are drought-deciduous\ndryland species, ponderosa pine is a drought-tolerant conifer of steppe + dry\nmontane margins. Each species is a hand-authored TreeSpecies object (W62).', ARID),
    ('polar.ts', 'Polar (Köppen E) tree species — GAP-17 / DR-11 Phase 2 (W62 hand-authored).',
     'ET (tundra) is the only tree-supporting E-zone (EF — ice cap — has none: no tree\nsurvives perennial ice). Trees at the Arctic treeline are at their absolute limit —\nstunted, prostrate forms. The Arctic willow is a prostrate shrub that barely\nqualifies as a "tree"; black spruce krummholz (in continental.ts, native to Dfc +\nET) is the other treeline form. Each species is a hand-authored TreeSpecies\nobject (W62).', POLAR),
]

HEADER = """\
/**
 * {title}
 *
 * {body}
 *
 * Every constant is `@provisional` per GDD §17 ("detailed photosynthesis and
 * energy allocation equations"); values derive from the makeSpecies allometric
 * formulas (see make-species.ts) so they are balance-consistent with the prior
 * factory output, + are tunable in playtesting.
 */
import {{
  PROVISIONAL_BIOLOGY_DEFAULT_LEAF_DENOMINATION_MINOR,
  PROVISIONAL_BIOLOGY_DEFAULT_MAX_HARVEST_FRACTION,
  type TreeSpecies,
}} from '@capitalist-tree/shared';
"""

def main():
    for fname, title, body, species_list in FILES:
        parts = [HEADER.format(title=title, body=body)]
        for s in species_list:
            f = compute(s)
            parts.append(emit_species(s, f))
            parts.append('')  # blank line between species
        content = "\n".join(parts).rstrip() + "\n"
        path = os.path.join(ROOT, fname)
        with open(path, 'w') as fh:
            fh.write(content)
        print(f"wrote {path} ({len(species_list)} species, {len(content.splitlines())} lines)")

if __name__ == '__main__':
    main()
