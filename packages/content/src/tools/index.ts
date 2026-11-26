/**
 * Tools content registry (W-axe — player-purchased hand tools).
 *
 * Mirrors the equipment registry pattern (`packages/content/src/equipment/`)
 * but for one-shot hand tools (axe, future: pruning-saw, machete) that do NOT
 * spawn an AutomationState — they live in `state.inventory.items` and gate
 * player actions on ownership.
 *
 * Each tool is a pure data object; the `buy-tool` action handler
 * (`packages/simulation/src/economy/actions.ts`) looks up a definition via
 * `getToolById` to debit its cost + credit the inventory. Content authors add
 * new tools by appending to the per-tool arrays + the flat `TOOLS` union.
 *
 * PROVISIONAL per GDD §17 (tool cost/economy balance). Costs are bigint minor
 * currency units serialized as string (TDD §10.1).
 */
/** A purchasable hand tool definition (static content data). */
export interface ToolDefinition {
  /** Canonical tool id — also the inventory `resourceId` (e.g. `'tool:axe'`). */
  readonly id: string;
  /** Display name (UI / shop). */
  readonly name: string;
  /** Short description (UI / shop tooltip). */
  readonly description: string;
  /** One-time purchase price in bigint minor currency units (string). */
  readonly cost: string;
}

import { AXE } from './axe.js';

export { AXE, AXE_TOOL_ID } from './axe.js';

/** All known tools, flat. Add new tools here + export above. */
export const TOOLS: readonly ToolDefinition[] = Object.freeze([AXE]);

/**
 * Thrown when `getToolById` is asked for an unknown tool id. Mirrors the
 * `UnknownEquipmentError` / `UnknownMarketError` pattern.
 */
export class UnknownToolError extends Error {
  constructor(toolId: string) {
    super(`Unknown tool id "${toolId}". Known tools: ${TOOLS.map((t) => t.id).join(', ')}.`);
    this.name = 'UnknownToolError';
  }
}

/**
 * Canonical tool lookup. Returns the `ToolDefinition` for `toolId`, or throws
 * `UnknownToolError` if unknown.
 */
export function getToolById(toolId: string): ToolDefinition {
  const tool = TOOLS.find((t) => t.id === toolId);
  if (!tool) throw new UnknownToolError(toolId);
  return tool;
}
