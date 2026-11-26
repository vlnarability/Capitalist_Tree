/**
 * W64/W65 — shared color + size helpers for the SVG + WebGL renderers.
 *
 * The Canvas renderer has its own (richer) color pipeline — stress-lerped
 * foliage (`foliageCondition` blends healthy→stressed), time-of-day sky
 * gradients (dawn/day/dusk/night), particle pools for weather. These are the
 * simpler base colors + leaf sizes the deferred backends (SVG W64, WebGL W65)
 * use. Kept here so the two new renderers don't duplicate the lookup.
 */
import type { SeasonalAppearance } from './types.js';
import {
  PROVISIONAL_RENDER_FOLIAGE_SPRING_COLOR,
  PROVISIONAL_RENDER_FOLIAGE_SUMMER_COLOR,
  PROVISIONAL_RENDER_FOLIAGE_AUTUMN_COLOR,
  PROVISIONAL_RENDER_FOLIAGE_WINTER_COLOR,
  PROVISIONAL_RENDER_TRUNK_COLOR,
  PROVISIONAL_RENDER_SKY_DAY_TOP,
  PROVISIONAL_RENDER_GRASS_COLOR,
  PROVISIONAL_RENDER_LEAF_TIER0_SIZE_PX,
  PROVISIONAL_RENDER_LEAF_TIER1_SIZE_PX,
  PROVISIONAL_RENDER_LEAF_TIER2_SIZE_PX,
} from './constants/rendering.js';

/** Trunk / branch stroke color (brown). */
export const TRUNK_COLOR = PROVISIONAL_RENDER_TRUNK_COLOR;
/** Sky background color (day blue). */
export const SKY_COLOR = PROVISIONAL_RENDER_SKY_DAY_TOP;
/** Ground color (grass green). */
export const GROUND_COLOR = PROVISIONAL_RENDER_GRASS_COLOR;

/**
 * Base foliage color for a seasonal appearance. No stress lerp (the deferred
 * backends paint the seasonal base; stress-blending is a Canvas-only refinement).
 */
export function seasonalFoliageColorHex(seasonal: SeasonalAppearance): string {
  switch (seasonal) {
    case 'spring-buds':
      return PROVISIONAL_RENDER_FOLIAGE_SPRING_COLOR;
    case 'summer-green':
      return PROVISIONAL_RENDER_FOLIAGE_SUMMER_COLOR;
    case 'autumn-color':
      return PROVISIONAL_RENDER_FOLIAGE_AUTUMN_COLOR;
    case 'winter-bare':
      return PROVISIONAL_RENDER_FOLIAGE_WINTER_COLOR;
  }
}

/**
 * Leaf radius (px) for a currency denomination tier. Mirrors the Canvas
 * renderer's `leafSizeForTier` so backends draw comparably sized leaves.
 */
export function leafSizeForTier(tier: number): number {
  switch (tier) {
    case 0:
      return PROVISIONAL_RENDER_LEAF_TIER0_SIZE_PX;
    case 1:
      return PROVISIONAL_RENDER_LEAF_TIER1_SIZE_PX;
    case 2:
      return PROVISIONAL_RENDER_LEAF_TIER2_SIZE_PX;
    default:
      return PROVISIONAL_RENDER_LEAF_TIER0_SIZE_PX;
  }
}
