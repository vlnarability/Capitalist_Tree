/**
 * Credits data (P13-C) — the structured list of every external art + audio
 * asset wired into the build, consumed by the in-game Credits screen
 * (apps/web/components/CreditsScreen) + rendered from `docs/credits.md`.
 *
 * License policy (docs/credits.md): prefer CC0 (no attribution); allow CC-BY /
 * CC-BY-SA with the required attribution line recorded here; never NC / ND /
 * AI-generated / emoji-as-art. Every asset below was verified free-use at the
 * source page (license tag opened) on 2026-11-18.
 *
 * Files live under `apps/web/public/assets/`; the `file` field is the path
 * relative to the public root, so a consumer renders `<img src={file}>` /
 * `new Audio(file)` directly.
 */
export type AssetLicense = 'CC0' | 'CC-BY' | 'CC-BY-SA';

export type AssetCategory = 'art' | 'audio';

export interface CreditEntry {
  /** What this asset is used for in the game (e.g. "Ambient music"). */
  slot: string;
  /** Art or audio. */
  category: AssetCategory;
  /** Path under the public root (e.g. "/assets/audio/music-ambient.mp3"). */
  file: string;
  /** Asset title at the source. */
  title: string;
  /** Author / rights holder. */
  author: string;
  /** Source page URL (the page where the license + file were verified). */
  sourceUrl: string;
  /** License id. */
  license: AssetLicense;
  /** Required attribution text (CC-BY etc.); empty for CC0. */
  attribution: string;
}

export const CREDITS: readonly CreditEntry[] = [
  {
    slot: 'Hero / title background',
    category: 'art',
    file: '/assets/images/hero-background.jpg',
    title: 'Bevouliin Tree in Mist Game Background',
    author: 'bevouliin.com',
    sourceUrl: 'https://opengameart.org/content/bevouliin-tree-in-mist-game-background',
    license: 'CC0',
    attribution: '',
  },
  {
    slot: 'Tree / canopy fallback art',
    category: 'art',
    file: '/assets/images/tree-fallback.png',
    title: 'A Tree',
    author: 'airockstar',
    sourceUrl: 'https://opengameart.org/content/a-tree',
    license: 'CC0',
    attribution: '',
  },
  {
    slot: 'Ambient background music',
    category: 'audio',
    file: '/assets/audio/music-ambient.mp3',
    title: 'The Forest and the Trees',
    author: 'Kevin MacLeod (incompetech.com)',
    sourceUrl:
      'https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1100766&Search=Search',
    license: 'CC-BY',
    attribution:
      'Music: "The Forest and the Trees" by Kevin MacLeod (incompetech.com) — licensed under CC-BY 4.0.',
  },
  {
    slot: 'SFX — UI click',
    category: 'audio',
    file: '/assets/audio/sfx-click.mp3',
    title: 'Button Click Sound Effect (CC0)',
    author: 'qubodup',
    sourceUrl: 'https://opengameart.org/content/button-click-sound-effect-cc0public-domain',
    license: 'CC0',
    attribution: '',
  },
  {
    slot: 'SFX — purchase / transaction',
    category: 'audio',
    file: '/assets/audio/sfx-purchase.mp3',
    title: 'SoundPack01 — Upper01',
    author: 'WobbleBoxx Workshop (wobbleboxx)',
    sourceUrl: 'https://opengameart.org/content/level-up-power-up-coin-get-13-sounds',
    license: 'CC0',
    attribution: '',
  },
  {
    slot: 'SFX — notification',
    category: 'audio',
    file: '/assets/audio/sfx-notification.mp3',
    title: 'SoundPack01 — Rise01',
    author: 'WobbleBoxx Workshop (wobbleboxx)',
    sourceUrl: 'https://opengameart.org/content/level-up-power-up-coin-get-13-sounds',
    license: 'CC0',
    attribution: '',
  },
];

/** Attribution lines that must appear on the Credits screen (CC-BY etc.). */
export const ATTRIBUTION_LINES: readonly string[] = CREDITS.filter(
  (c) => c.attribution.length > 0,
).map((c) => c.attribution);
