/**
 * GAP-31 (DR-13) — Analytics store interface + in-memory implementation.
 *
 * The store is the persistence target. The collector calls `put` per event;
 * the store owns retention (evicts oldest when over its `maxEvents` cap) so a
 * long-running game's analytics footprint stays bounded (design §3 / §7).
 *
 * `put` / `clear` MUST NOT throw — implementors catch storage failures + return
 * a boolean (false = dropped) so an analytics failure never propagates to the
 * sim. The browser implementation (`IndexedDbAnalyticsStore`, in apps/web) uses
 * a SEPARATE IndexedDB database so analytics storage can never risk the save
 * blob (design §4: "analytics storage never risks the save blob").
 */
import type {
  AnalyticsEvent,
  AnalyticsEventCategory,
  AnalyticsQuery,
} from './schema.js';

export interface AnalyticsStore {
  /** Persist one event. Returns false if dropped (quota / store unavailable).
   *  Must NOT throw. Implementations evict the oldest event when over cap. */
  put(event: AnalyticsEvent): Promise<boolean>;
  /** Query events, most-recent first. */
  query(q?: AnalyticsQuery): Promise<AnalyticsEvent[]>;
  /** Total count, optionally filtered by category. */
  count(category?: AnalyticsEventCategory): Promise<number>;
  /** Wipe all analytics records. Must NOT throw. */
  clear(): Promise<void>;
}

/**
 * In-memory store for tests + for environments without IndexedDB (SSR). Enforces
 * the `maxEvents` retention cap (default 5000) by evicting the oldest events.
 */
export class InMemoryAnalyticsStore implements AnalyticsStore {
  private events: AnalyticsEvent[] = [];

  constructor(private readonly maxEvents = 5000) {}

  async put(event: AnalyticsEvent): Promise<boolean> {
    this.events.push(event);
    if (this.events.length > this.maxEvents) {
      // Evict the oldest (lowest timestamp — events arrive in roughly
      // chronological order, but sort by timestamp to be safe).
      this.events.sort((a, b) => a.timestamp - b.timestamp);
      this.events.splice(0, this.events.length - this.maxEvents);
    }
    return true;
  }

  async query(q?: AnalyticsQuery): Promise<AnalyticsEvent[]> {
    let result = this.events.slice();
    const category = q?.category;
    if (category !== undefined) result = result.filter((e) => e.category === category);
    const event = q?.event;
    if (event !== undefined) result = result.filter((e) => e.event === event);
    const since = q?.since;
    if (since !== undefined) result = result.filter((e) => e.timestamp >= since);
    // most-recent first
    result.sort((a, b) => b.timestamp - a.timestamp);
    const limit = q?.limit;
    if (limit !== undefined) result = result.slice(0, limit);
    return result;
  }

  async count(category?: AnalyticsEventCategory): Promise<number> {
    if (category === undefined) return this.events.length;
    return this.events.filter((e) => e.category === category).length;
  }

  async clear(): Promise<void> {
    this.events = [];
  }
}
