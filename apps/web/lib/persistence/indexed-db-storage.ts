/**
 * IndexedDB-backed Storage implementation using `idb`.
 *
 * This is the browser implementation. Tests use the in-memory implementation
 * from `@capitalist-tree/simulation` directly.
 *
 * The store keeps one record per saveId in the `saves` object store. The
 * "active" save (the one `load()` returns) is tracked in a separate
 * `meta` store with key `activeSaveId`.
 */
import { type IDBPDatabase, openDB } from 'idb';
import type { GameState, SaveEnvelope } from '@capitalist-tree/shared';
import {
  envelope,
  deserialize,
  assertKnownSchemaVersion,
  CURRENT_SCHEMA_VERSION,
} from '@capitalist-tree/shared';
import type { Storage } from '@capitalist-tree/simulation';

// P11 (W20 / RV5-F3): typed error for browser storage quota exhaustion. The
// caller (useSimulationLoop) catches this + surfaces a notification instead
// of silently losing the save.
export class SaveQuotaExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SaveQuotaExceededError';
  }
}

/** Detect a browser QuotaExceededError (DOMException name OR legacy code). */
function isQuotaExceededError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  // Modern browsers: DOMException with name 'QuotaExceededError' (or
  // 'NS_ERROR_DOM_QUOTA_REACHED' on Firefox).
  const name = (err as { name?: string }).name;
  if (name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED') {
    return true;
  }
  // Legacy: DOMException code 1014 (quota exceeded).
  const code = (err as { code?: number }).code;
  return code === 1014;
}

const DB_NAME = 'capitalist-tree';
const DB_VERSION = 1;
const STORE_SAVES = 'saves';
const STORE_META = 'meta';
const META_ACTIVE_KEY = 'activeSaveId';

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDB(): Promise<IDBPDatabase> {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('IndexedDB is not available in this environment'));
  }
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_SAVES)) {
          db.createObjectStore(STORE_SAVES, { keyPath: 'state.metadata.saveId' });
        }
        if (!db.objectStoreNames.contains(STORE_META)) {
          db.createObjectStore(STORE_META);
        }
      },
    });
  }
  return dbPromise;
}

export class IndexedDbStorage implements Storage {
  async save(state: GameState): Promise<string> {
    const db = await getDB();
    const env = envelope(state);
    // P11 (W22 / RV5-F5): wrap BOTH puts in a single readwrite transaction
    // so the save + the active-key pointer are atomic. Pre-fix, two separate
    // db.put calls could leave the DB inconsistent if the first succeeded but
    // the second failed (the active pointer would reference a stale save).
    // P11 (W20 / RV5-F3): catch QuotaExceededError (browser storage full) +
    // re-throw a typed error so the caller can surface a notification instead
    // of silently losing the save.
    try {
      const tx = db.transaction([STORE_SAVES, STORE_META], 'readwrite');
      await tx.objectStore(STORE_SAVES).put(env);
      await tx.objectStore(STORE_META).put(state.metadata.saveId, META_ACTIVE_KEY);
      await tx.done;
    } catch (err) {
      if (isQuotaExceededError(err)) {
        throw new SaveQuotaExceededError(
          'Save failed: browser storage quota exceeded. Free up space or export your save.',
        );
      }
      throw err;
    }
    return state.metadata.saveId;
  }

  async load(): Promise<GameState | null> {
    const db = await getDB();
    const activeId = (await db.get(STORE_META, META_ACTIVE_KEY)) as string | undefined;
    if (!activeId) return null;
    const env = (await db.get(STORE_SAVES, activeId)) as SaveEnvelope | undefined;
    if (!env) return null;
    return this.validate(env);
  }

  async listSaves(): Promise<readonly string[]> {
    const db = await getDB();
    const all = (await db.getAllKeys(STORE_SAVES)) as string[];
    // The keyPath is `state.metadata.saveId`; idb returns the saveId values.
    return all;
  }

  async deleteSave(id: string): Promise<boolean> {
    const db = await getDB();
    const had = (await db.get(STORE_SAVES, id)) != null;
    await db.delete(STORE_SAVES, id);
    const activeId = (await db.get(STORE_META, META_ACTIVE_KEY)) as string | undefined;
    if (activeId === id) {
      await db.delete(STORE_META, META_ACTIVE_KEY);
    }
    return had;
  }

  validate(raw: unknown): GameState {
    if (
      !raw ||
      typeof raw !== 'object' ||
      !('schemaVersion' in raw) ||
      !('state' in raw)
    ) {
      throw new Error('Invalid save envelope: missing schemaVersion or state');
    }
    const env = raw as { schemaVersion: number; state: unknown };
    assertKnownSchemaVersion(env.schemaVersion);
    return deserialize(env);
  }
}

/**
 * Factory that picks an implementation appropriate for the runtime.
 * In the browser, returns IndexedDbStorage. In SSR/Node, returns null.
 */
export function createBrowserStorage(): Storage | null {
  if (typeof indexedDB === 'undefined') return null;
  return new IndexedDbStorage();
}

void CURRENT_SCHEMA_VERSION;
