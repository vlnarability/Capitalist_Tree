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
