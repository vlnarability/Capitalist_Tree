/**
 * GAP-31 (DR-13) — IndexedDB-backed analytics store (browser).
 *
 * A SEPARATE database (`capitalist-tree-analytics`) from the save DB
 * (`capitalist-tree`) so analytics storage can never risk the save blob (design
 * §4: "analytics storage never risks the save blob"). If this store's quota is
 * exhausted, only analytics is dropped — saves are unaffected.
 *
 * Implements `AnalyticsStore` from `@capitalist-tree/analytics`. All methods
 * catch storage failures + return a safe default (false / [] / 0) so an
 * analytics failure never propagates to the sim (design §4: "a full IndexedDB
 * failure degrades only analytics, not the sim").
 *
 * Retention: when `count()` exceeds `maxEvents` (default 5000), the oldest
 * events (lowest timestamp) are evicted. This is O(n) but only runs when over
 * cap, so the steady-state put is a single `db.put`.
 */
import { type IDBPDatabase, openDB } from 'idb';
import type {
  AnalyticsEvent,
  AnalyticsEventCategory,
  AnalyticsQuery,
  AnalyticsStore,
} from '@capitalist-tree/analytics';

const DB_NAME = 'capitalist-tree-analytics';
const DB_VERSION = 1;
const STORE_EVENTS = 'events';
const DEFAULT_MAX_EVENTS = 5000;

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDB(): Promise<IDBPDatabase> {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('IndexedDB is not available in this environment'));
  }
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_EVENTS)) {
          // keyPath 'id' — the analytics event id. No autoIncrement (the
          // collector generates ids).
          db.createObjectStore(STORE_EVENTS, { keyPath: 'id' });
        }
      },
    });
  }
  return dbPromise;
}

export class IndexedDbAnalyticsStore implements AnalyticsStore {
  constructor(private readonly maxEvents: number = DEFAULT_MAX_EVENTS) {}

  async put(event: AnalyticsEvent): Promise<boolean> {
    try {
      const db = await getDB();
      await db.put(STORE_EVENTS, event);
      await this.evictIfOverCap(db);
      return true;
    } catch {
      // IndexedDB unavailable / quota exhausted / etc. — drop silently.
      return false;
    }
  }

  async query(q?: AnalyticsQuery): Promise<AnalyticsEvent[]> {
    try {
      const db = await getDB();
      const all = (await db.getAll(STORE_EVENTS)) as AnalyticsEvent[];
      let result = all;
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
    } catch {
      return [];
    }
  }

  async count(category?: AnalyticsEventCategory): Promise<number> {
    try {
      const db = await getDB();
      if (category === undefined) {
        return await db.count(STORE_EVENTS);
      }
      const all = (await db.getAll(STORE_EVENTS)) as AnalyticsEvent[];
      return all.filter((e) => e.category === category).length;
    } catch {
      return 0;
    }
  }

  async clear(): Promise<void> {
    try {
      const db = await getDB();
      await db.clear(STORE_EVENTS);
    } catch {
      // swallow — clear is best-effort
    }
  }

  /** Evict the oldest events (lowest timestamp) when over the cap. */
  private async evictIfOverCap(db: IDBPDatabase): Promise<void> {
    const total = await db.count(STORE_EVENTS);
    if (total <= this.maxEvents) return;
    const excess = total - this.maxEvents;
    const all = (await db.getAll(STORE_EVENTS)) as AnalyticsEvent[];
    // oldest first
    all.sort((a, b) => a.timestamp - b.timestamp);
    const toDelete = all.slice(0, excess);
    const tx = db.transaction(STORE_EVENTS, 'readwrite');
    for (const ev of toDelete) {
      await tx.store.delete(ev.id);
    }
    await tx.done;
  }

  /** Evict events older than `maxAgeMs` (wall-clock `timestamp`). Returns the
   *  count evicted. Best-effort — swallowed on failure (returns 0). */
  async prune(maxAgeMs: number): Promise<number> {
    try {
      const db = await getDB();
      const cutoff = Date.now() - maxAgeMs;
      const all = (await db.getAll(STORE_EVENTS)) as AnalyticsEvent[];
      const old = all.filter((e) => e.timestamp < cutoff);
      if (old.length === 0) return 0;
      const tx = db.transaction(STORE_EVENTS, 'readwrite');
      for (const ev of old) {
        await tx.store.delete(ev.id);
      }
      await tx.done;
      return old.length;
    } catch {
      return 0;
    }
  }
}

/**
 * Factory: returns an IndexedDbAnalyticsStore in the browser, or null in SSR /
 * Node (where IndexedDB is undefined). Mirrors `createBrowserStorage` for the
 * save system.
 */
export function createBrowserAnalyticsStore(): AnalyticsStore | null {
  if (typeof indexedDB === 'undefined') return null;
  return new IndexedDbAnalyticsStore();
}
