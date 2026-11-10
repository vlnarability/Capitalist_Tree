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
    await db.put(STORE_SAVES, env);
    await db.put(STORE_META, state.metadata.saveId, META_ACTIVE_KEY);
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
