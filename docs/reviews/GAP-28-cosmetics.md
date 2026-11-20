# GAP-28 — Cosmetic monetization ideas (DR-3: cosmetic-only)

**Status:** ideas list, pre-implementation. DR-3 (docs/reviews/DECISIONS.md)
constrains monetization to **cosmetic-only — nothing provides gameplay
advantage, no time-skip sales.** Every idea below is verified cosmetic: it
changes appearance / presentation / sound only, never a simulation value, rate,
or outcome.

> **Review note (DR-10 sibling):** the W21 concurrent-tab + this list are the
> last items before the remaining feature GAPs (GAP-17 climates, GAP-31
> analytics) which need design direction. This list is intentionally broad —
> pick a subset for a first cosmetic pack rather than building all of it.

---

## 1. Tree visuals — skins / variants

Changes the `TreeView` rendering only; biology values (height, diameter,
leaves, health) are untouched.

- **Seasonal foliage tints** — spring blossom, summer green, autumn gold, winter
  bare. Either a manual toggle or "follow the sim season" (cosmetic mirroring of
  the existing season state — no mechanic change).
- **Leaf-shape variants** — broadleaf, needle, serrated, heart-shaped.
- **Rare-material trees** — golden bark, crystalline leaves, bioluminescent
  (night glow). Pure palette/shader swaps.
- **Aged/weathered variants** — gnarled, mossy, wind-sculpted bark texture.
- **Holiday overlays** — winter lights, autumn wreath, spring garland (off by
  default; opt-in).

## 2. Currency cosmetics (extends the existing CurrencyVisual system)

`packages/rendering/currency-visuals.ts` already ships three (leaf-dollar,
gold-leaf, euro-leaf) + `CurrencyCosmeticPicker` is wired. This is the
lowest-effort cosmetic line — add visuals, the picker lists them automatically.

- **More banknote themes** — manuscript/illuminated, modern minimalist, ornate
  engraving, regional-historical styles.
- **Coin vs banknote vs leaf styles** — different physical forms for the same
  denomination values.
- **Animated currency** — a subtle shimmer/flip on the denomination render
  (respecting `reducedMotionOverride`).
- **Denomination artwork sets** — each denomination a different engraving (a
  gallery the player unlocks).

## 3. Environment / background skins

The scene around the tree. `docs/credits.md` notes the hero background is
already due for a re-review — this is the natural place to offer alternatives.

- **Time-of-day moods** — dawn, noon, golden hour, dusk, moonlit.
- **Weather moods** — misty, rainy, snowy, clear (cosmetic overlay; does NOT
  change the weather-system state).
- **Biome backdrops** — deep forest, meadow, riverbank, mountain ridge.
- **Atmospheric particles** — fireflies, pollen, drifting leaves, snow.

## 4. UI themes (panel color schemes + accents, not layout)

A theme system: a `ui.themeId` field + a Tailwind theme resolver. No layout or
information changes.

- **Dark / light / high-contrast** themes (high-contrast also serves
  accessibility).
- **Accent palettes** — forest green, autumn amber, ocean blue, royal purple.
- **Font choices** — serif manuscript, modern sans, rounded.
- **Panel texture/border styles** — parchment, carved wood, minimal flat.

## 5. Audio packs (ambient + music + SFX)

Extends `packages/content/src/audio` + the `useAudio` hook. All CC0/CC-BY
free-use (per the P13-C art/audio policy — no AI-generated audio).

- **Ambient soundscapes** — forest day, forest night, rain, ocean, wind.
- **Alternative music tracks** — different composers/moods (CC-BY from
  incompetech/OpenGameArt).
- **UI SFX packs** — different income "cha-ching", harvest rustle, button click
  timbres.
- **Per-event SFX skins** — a different chime for level-up / ending completion.

## 6. Particle effects / flourishes (visual only)

Render-layer flourishes; zero gameplay effect.

- **Leaf-fall animation** on harvest (the harvested leaves drift down).
- **Coin shower** on a large income event.
- **Sparkle/glow** on a level-up or business milestone.
- **Confetti** on ending achievement (pairs with GAP-36 EndingScreen).
- **Seasonal ambient particles** — snow, petals (overlaps §3).

## 7. Tree accessories / decorations

Non-gameplay decorations placed on/near the tree.

- **Lanterns, birdhouses, swings, signposts** — placeable cosmetic props.
- **Seasonal decorations** — holiday lights, wreaths, ribbons.
- **Wildlife visitors** — a bird, squirrel, or butterfly that perches on the
  tree (cosmetic; no fauna simulation).

## 8. Ending commemorations (cosmetic framing of completions)

Pairs with GAP-36 endings + the persisted `eventState.objectives.completed`.

- **Trophy case / badge wall** — a visual showcase of completed endings.
- **Shareable ending cards** — a generated image/card for a completed ending
  (exportable PNG).
- **Special tree frame/border** for a tree that achieved an ending.

## 9. Notifications / toast styling

- **Toast designs** — minimal, ornate, themed variants of the NotificationsPanel.
- **Notification sound pairing** — covered by §5 audio packs.

---

## Explicitly NOT allowed (per DR-3 — no gameplay advantage)

These are the boundary lines; if an idea drifts into any of these, it is
out-of-scope:

- **Faster growth / shorter timers / time-skips** — DR-3 forbids time-skip
  sales explicitly.
- **Bonus income / extra starting resources / business discounts** — any
  economic advantage.
- **Exclusive objectives or endings** — paywalled gameplay content is a
  gameplay advantage (everyone can pursue all six endings free).
- **Extra automation slots / policy slots / business slots** — capacity is a
  gameplay advantage.
- **Reduced save throttling / exclusive save slots** — borderline; extra save
  slots are a convenience, but tying them to payment is a pay-to-convenience
  pattern DR-3's spirit discourages. Flag for sign-off if ever proposed.
- **Anything that changes a simulation value, rate, threshold, or outcome.**

---

## Implementation surface (which systems each line touches)

| Cosmetic line | Touches |
| --- | --- |
| Tree visuals / accessories / particles | `packages/rendering` (renderer + visual data) + `apps/web` `TreeView` |
| Currency cosmetics | `packages/rendering/currency-visuals.ts` (already exists) |
| Environment / background skins | `packages/rendering` + the scene/background layer |
| UI themes | `apps/web` (Tailwind config + a `ui.themeId` store field) |
| Audio packs | `packages/content/src/audio` (exists) + `useAudio` hook |
| Ending commemorations | `packages/content/src/endings` (exists) + a trophy component |
| Notifications styling | `apps/web` `NotificationsPanel` |

**Recommended first pack (lowest effort, highest visibility):** currency
cosmetics (§2 — the system + picker already exist; adding visuals is mechanical)
+ one UI theme (§4) + one ambient audio track (§5). That is a coherent, cheap
first cosmetic release that exercises the full cosmetic pipeline without
touching the simulation.

---

## Approved direction (DR-12)

The user approved GAP-28 as a **design direction** (implementation tasks remain
open; focus stays on GAP-17). The approved direction, recorded faithfully from
the user's guidance:

### First pack — The Forest Collection

Cosmetic-only, no simulation dependencies. Exercises three separate cosmetic
systems without touching any game mechanics.

- **Currency — Botanical Engraving**: ornate engraved banknotes, botanical
  illustrations, leaf-pattern borders, alternative denomination designs.
- **UI — Woodland**: forest-green surfaces, warm amber accents, readable
  typography, restrained natural textures.
- **Audio — Forest Morning**: birdsong, light wind, leaves moving, subtle
  environmental ambience.

**Default experience stays attractive.** The default currency + UI remain
visually attractive on their own; the purchasable options are **alternatives,
not upgrades** to the default experience.

### A. Cosmetic IDs, not cosmetic properties embedded in simulation

Store player selections as references — never import cosmetics into the
simulation package.

```ts
interface CosmeticState {
  selectedTreeSkinId: string;
  selectedCurrencyThemeId: string;
  selectedEnvironmentThemeId: string;
  selectedUiThemeId: string;
  selectedAudioPackId: string;
  ownedCosmeticIds: string[];
}
```

```
Simulation                Rendering / UI
    |                         |
    +-- Tree biology          +-- Cosmetic Catalog
    +-- Economy               +-- Tree skins
    +-- Environment           +-- Currency themes
    +-- Automation            +-- Background themes
    +-- Progression           +-- UI themes
                             +-- Audio packs
                             +-- Particles
```

**Guarantee:** changing cosmetic selections cannot change simulation outcomes.

### B. Catalog

Every cosmetic has a stable ID, category, name, description, asset references,
unlock method, and accessibility metadata where relevant.

```ts
interface CosmeticDefinition {
  id: string;
  category:
    | "tree"
    | "currency"
    | "environment"
    | "ui"
    | "audio"
    | "particle"
    | "decoration"
    | "ending";
  name: string;
  description: string;
  unlock:
    | { type: "default" }
    | { type: "achievement"; achievementId: string }
    | { type: "free"; packId: string }
    | { type: "purchase"; productId: string };
  assets: Record<string, string>;
}
```

**No real storefront / payment / entitlement verification at this stage.** The
catalog supports the *concept* of paid cosmetics without actually processing
purchases.

### C. UI themes — accessibility is free, not monetized

- Default theme: free.
- Dark and light themes: free.
- **High contrast: free** (an accessibility option, not a premium cosmetic).
- Reduced motion: free system setting.
- Font scaling and readability: free.
- Decorative textures and alternate palettes: potentially cosmetic content.

### D. Audio packs — independent controls

Separate volume controls for: **music**, **ambient sounds**, **sound effects**.
Audio packs replace or supplement sound assets — they do not affect event timing
or simulation behavior. CC0 and CC-BY assets are appropriate for a prototype,
but **verify the exact license and attribution requirements for each individual
asset before distribution** — the licensing of an entire collection must not be
assumed to apply to every file.

### E. Reduced motion — global

The existing `reducedMotionOverride` governs **all** cosmetic animation systems:
currency shimmer, falling leaves, coin showers, sparkles, confetti, wildlife
movement, animated backgrounds, UI transitions. Where appropriate, reduced-motion
mode **replaces animations with static visual indicators** rather than simply
disabling feedback.

### Boundary guardrails — tightened

A few cosmetic features have potential indirect gameplay implications if
implemented carelessly:

| Feature | Potential problem | Guardrail |
| --- | --- | --- |
| Seasonal foliage tint | Could imply actual tree season or health | Separate actual biological rendering from optional artistic overlays |
| Weather mood | Could imply rain/water effects | Cosmetic weather must never alter water, growth, or environmental values |
| Wildlife visitors | Could be mistaken for simulated fauna | Clearly distinguish decorative wildlife from ecosystem indicators |
| Currency animation | Could obscure income or denomination readability | Keep animation brief, optional, and non-blocking |
| UI fonts | Could reduce readability | Maintain minimum legibility and accessibility |
| Backgrounds | Could obscure important environmental state | Preserve visibility of indicators and tree condition |
| Tree accessories | Could obscure trunk, canopy, or growth | Use anchors; prevent accessories from hiding meaningful visual information |
| Ending cards | Could reveal player information if shared | Allow preview and export without automatically sharing anything |

**Core rule:** the visual representation of the simulated tree must never lie to
the player. A cosmetic can stylize the tree, but it must not hide whether the
tree is unhealthy, depleted, dying, or dead — the tree's condition is a core part
of the game's feedback.

### Recommended implementation order

- **Phase 1 — Cosmetic infrastructure.** Catalog + stable IDs; ownership/unlock
  tracking; selection persistence; cosmetic settings panel; ensure cosmetics are
  completely disconnected from simulation state.
- **Phase 2 — First cosmetic pack.** 3 additional currency visuals; 1 UI theme;
  1 ambient audio track; preview + selection support; reduced-motion + audio
  controls.
- **Phase 3 — Free cosmetic unlocks.** Cosmetics unlocked through achievements +
  endings; tree skins tied to milestones; ending trophy display; additional
  currency themes.
- **Phase 4 — Premium cosmetics (only if commercially released).** Optional
  cosmetic packs; no gameplay advantage; no paywalled objectives/endings/
  progression/accessibility; no purchase requirement for the game's core visual
  identity.

### GAP-28 disposition

Approved as a design-direction GAP. Cosmetic monetization will be strictly
appearance-, presentation-, and sound-based, implemented through a catalog system
independent of the simulation engine. The initial implementation focuses on
currency visuals, UI themes, and audio. Accessibility features and core visual
feedback remain free. Paid cosmetics will not be implemented until the cosmetic
pipeline has been established and validated. The Forest Collection is a good first
test because it validates the entire cosmetic pipeline (rendering, UI, audio,
persistence, selection, ownership) without requiring any new gameplay mechanics.
**GAP-28 is sufficiently designed to close as a design-direction GAP;
implementation tasks remain open.**
