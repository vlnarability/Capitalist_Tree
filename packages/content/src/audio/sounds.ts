/**
 * Sound definitions (W68 — audio variety: 1 ambient + 3 SFX).
 *
 * W68 ships exactly four sounds (GDD §17 / ROADMAP W68):
 *   - 1 ambient: `ambient:forest` — a looping forest ambiance (wind + birds).
 *   - 3 SFX (NO weather/harvest/seasonal sounds — those are deferred):
 *     - `sfx:purchase` — buy/transaction chime (buy-tool, purchase).
 *     - `sfx:notify`   — info notification chime (success notifications).
 *     - `sfx:error`    — warning/error buzz (warning notifications).
 *
 * `asset` is a placeholder path — the actual audio files are a future asset
 * concern (P4d / asset pipeline). `volume` is provisional per GDD §17.
 */
import type { SoundDefinition } from './index.js';

/** Ambient: forest ambiance loop (wind + birds). Loops at a low volume. */
export const FOREST_AMBIENT: SoundDefinition = Object.freeze({
  id: 'ambient:forest',
  kind: 'ambient',
  name: 'Forest Ambience',
  asset: '/audio/ambient-forest.ogg',
  loop: true,
  volume: 0.4,
});

/** SFX: purchase/transaction chime — buy-tool, market purchase. */
export const PURCHASE_SFX: SoundDefinition = Object.freeze({
  id: 'sfx:purchase',
  kind: 'sfx',
  name: 'Purchase Chime',
  asset: '/audio/sfx-purchase.ogg',
  loop: false,
  volume: 0.7,
});

/** SFX: info notification chime — success notifications (e.g. tree-cut-down). */
export const NOTIFY_SFX: SoundDefinition = Object.freeze({
  id: 'sfx:notify',
  kind: 'sfx',
  name: 'Notify Chime',
  asset: '/audio/sfx-notify.ogg',
  loop: false,
  volume: 0.6,
});

/** SFX: warning/error buzz — warning notifications (e.g. no-axe, cut-dead-tree). */
export const ERROR_SFX: SoundDefinition = Object.freeze({
  id: 'sfx:error',
  kind: 'sfx',
  name: 'Error Buzz',
  asset: '/audio/sfx-error.ogg',
  loop: false,
  volume: 0.7,
});
