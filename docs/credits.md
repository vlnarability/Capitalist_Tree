# Credits — Artwork & Audio Sources

This page documents where every piece of external artwork and audio in
*Capitalist Tree* comes from, per the P13-C requirement that all art/audio be
free, public-domain, or otherwise free-use (no AI-generated art, no emoji
glyphs used as art). It is the source of truth for the in-game Credits screen.

**Status:** the source repositories below have been vetted for license + fit.
The specific asset picks (which exact file for which slot) are pending a
selection pass — the "Chosen assets" table at the bottom is filled in as each
asset is wired into the build.

---

## License policy

- **Preferred:** CC0 (public-domain dedication) — no attribution required,
  commercial use allowed. Used wherever possible so the credits stay simple.
- **Allowed:** CC-BY / CC-BY-SA / OGA-BY / GPL — attribution (and for -SA,
  share-alike) required. Each such asset's attribution line is recorded in the
  "Chosen assets" table with the exact credit text the license requires.
- **Never used:** NC (NonCommercial) or ND (NoDerivatives) assets, AI-generated
  imagery, emoji used as art.

---

## Source repositories vetted

| Source | URL | License | Verified | Use |
| --- | --- | --- | --- | --- |
| **Pixabay** | https://pixabay.com | Pixabay Content License (free for commercial use, no attribution required; no standalone resale) | License page opened 2026-11-18 | Background art, texture images, ambient music beds, SFX |
| **Freesound** | https://freesound.org | Per-sound: CC0, CC-BY, or CC-BY-NC (only CC0/CC-BY are usable here) | License confirmed via Wikipedia (Freesound) 2026-11-18 | Sound effects (harvest, purchase, notification, weather) |
| **OpenGameArt** | https://opengameart.org | Per-asset: CC0, CC-BY, CC-BY-SA, OGA-BY, GPL (NC/ND rejected by the site) | License confirmed via Wikipedia (OpenGameArt) 2026-11-18 | Game art (icons, tiles, UI elements), SFX |
| **Kevin MacLeod / Incompetech** | https://incompetech.com | CC-BY (attribution required; commercial use allowed with credit) | License confirmed via Wikipedia (Kevin MacLeod) 2026-11-18 | Background music (credit: "Music by Kevin MacLeod (incompetech.com), licensed CC-BY") |
| **Kenney** | https://kenney.nl/assets | Stated CC0 by the author; **license page not directly fetchable** — confirm per-asset on download | Asset categories opened 2026-11-18; license to re-verify per asset | UI elements, 2D/3D nature props (Mini Forest), skyboxes |
| **Wikimedia Commons** | https://commons.wikimedia.org | Per-file: public domain / CC-BY / CC-BY-SA (check each file's description page) | General knowledge — verify per file on use | Reference imagery, public-domain botanical/nature illustrations |

### Relevant Kenney category pages (for the asset pick)

- 2D (backgrounds, sprites, tiles): https://kenney.nl/assets/category:2D
- UI / interface (HUD, buttons, panels): https://kenney.nl/assets/tag:interface
- Audio (ambient/weather): https://kenney.nl/assets/category:Audio
- Textures (skyboxes, ground): https://kenney.nl/assets/category:Textures
- Mini Forest (3D nature props): https://kenney.nl/assets/mini-forest
- Skyboxes: https://kenney.nl/assets/skyboxes

---

## Art/audio needs (slots to fill)

| Slot | Description | Candidate sources |
| --- | --- | --- |
| App title / hero art | The main-menu hero image (a tree/forest tableau). | Pixabay (CC0 images), OpenGameArt (CC0 2D backgrounds), Wikimedia (PD botanical art) |
| Tree / canopy illustration | Fallback static art for the tree when the procedural canvas renderer is off. | OpenGameArt (CC0 plant sprites), Kenney Mini Forest (CC0 3D) |
| Business-type icons | One icon per business type (water-extraction, mine, sawmill, factory, farm, store, etc.). | Kenney (CC0 UI/icon packs), OpenGameArt (CC0 icons) |
| Weather icons | Sun / cloud / rain / storm / drought glyphs for the weather panel. | Kenney (CC0 UI), OpenGameArt (CC0 weather icons) |
| Market / commodity icons | Water, fertilizer, seeds, food, energy, equipment, labor, land. | Kenney (CC0 UI), OpenGameArt (CC0 icons) |
| UI panel / button textures | Panel backgrounds, button states (the shadcn/ui layer covers most; textures only if a themed skin is wanted). | Kenney (CC0 UI) |
| Ambient background music | A looping nature/forest ambient bed for the main game screen. | Pixabay (CC0 music), Kevin MacLeod (CC-BY), OpenGameArt (CC0 audio) |
| SFX — harvest leaves | A soft rustle / pluck on leaf harvest. | Freesound (CC0/CC-BY), OpenGameArt (CC0 SFX) |
| SFX — purchase / transaction | A coin / register sound on purchase + import/export. | Freesound (CC0/CC-BY), Kenney (CC0 audio) |
| SFX — notification | A chime for in-game notifications (events, thresholds). | Freesound (CC0/CC-BY) |
| SFX — weather change | A wind/rain swell on weather transitions. | Freesound (CC0/CC-BY), Pixabay (CC0 SFX) |
| SFX — UI click | A subtle click on button presses. | Kenney (CC0 audio), Freesound (CC0) |

---

## Chosen assets

*Each row records: the slot, the file (path under `apps/web/public`), the source
URL, the exact license, and the attribution text the license requires (empty for
CC0). All licenses verified at the source page on 2026-11-18.*

| Slot | File | Source URL | License | Attribution |
| --- | --- | --- | --- | --- |
| Hero / title background | `/assets/images/hero-background.jpg` | https://opengameart.org/content/bevouliin-tree-in-mist-game-background | CC0 | — |
| Tree / canopy fallback art | `/assets/images/tree-fallback.png` | https://opengameart.org/content/a-tree | CC0 | — |
| Ambient background music | `/assets/audio/music-ambient.mp3` | https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1100766 | CC-BY | Music: "The Forest and the Trees" by Kevin MacLeod (incompetech.com) — licensed CC-BY 4.0 |
| SFX — UI click | `/assets/audio/sfx-click.mp3` | https://opengameart.org/content/button-click-sound-effect-cc0public-domain | CC0 | — |
| SFX — purchase / transaction | `/assets/audio/sfx-purchase.mp3` | https://opengameart.org/content/level-up-power-up-coin-get-13-sounds | CC0 | — |
| SFX — notification | `/assets/audio/sfx-notification.mp3` | https://opengameart.org/content/level-up-power-up-coin-get-13-sounds | CC0 | — |

### Source-pivot note

The original recommendation was Kenney (art) + Pixabay (music) + Freesound
(SFX). From the build sandbox, **kenney.nl + pixabay.com return HTTP 403** and
**Freesound downloads require OAuth**, so the picks pivoted to **OpenGameArt
(CC0, direct downloads)** for art + SFX and **Kevin MacLeod / incompetech
(CC-BY, direct MP3)** for music. Kevin MacLeod's music carries a CC-BY
attribution requirement (recorded above); all other picks are CC0
(no attribution legally required, though the authors are credited on the
Credits screen as a courtesy).

---

## Attribution lines (to render on the in-game Credits screen)

_Appended here as CC-BY / CC-BY-SA assets are added, so the Credits screen has
a single canonical list to render. CC0 assets need no line here. Mirrored from
`packages/content/src/credits` `ATTRIBUTION_LINES`._

- Music: "The Forest and the Trees" by Kevin MacLeod (incompetech.com) — licensed under CC-BY 4.0.

