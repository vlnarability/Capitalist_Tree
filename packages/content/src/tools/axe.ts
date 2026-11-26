/**
 * Axe tool definition (W-axe — player-purchased hand tool for cutting down the
 * original tree).
 *
 * Unlike equipment (sprinklers, harvesters — scheduled automation that spawns
 * an AutomationState), the axe is a one-shot hand tool: the player buys it
 * once (a sink transfer to the authority), it sits in `state.inventory.items`
 * as `{ resourceId: 'tool:axe', quantity: 1 }`, and gating the
 * `cut-down-tree` action on its ownership is the only read. It is reusable
 * across tree generations (not consumed on a cut) — the player owns the axe
 * permanently once bought.
 *
 * PROVISIONAL per GDD §17 (tool cost/economy balance). Cost is bigint minor
 * currency units serialized as string (TDD §10.1).
 */
import type { ToolDefinition } from './index.js';

/** The canonical axe tool id — also the inventory resourceId. */
export const AXE_TOOL_ID = 'tool:axe';

export const AXE: ToolDefinition = Object.freeze({
  id: AXE_TOOL_ID,
  name: 'Axe',
  description:
    'A steel felling axe. Buy it once, then use the cut-down-tree action to fell the original tree for timber — killing the tree, maxing out exploitation, and yielding sellable wood. Reusable across generations.',
  cost: '2000', // 20.00 currency (2000 minor) — affordable early-game.
});
