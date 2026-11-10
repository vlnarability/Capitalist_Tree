/**
 * Storage interface (TDD §14, P0 spec).
 *
 * The interface is testable with an in-memory implementation (provided here)
 * and a real IndexedDB implementation in apps/web. Both implementations
 * MUST:
 *
 *   - Validate on save and load via the Zod schemas.
 *   - Run migrations on load (transparency for older saves).
 *   - Raise typed errors for unknown schemaVersion or validation failures
 *     (NEVER silently discard a save).
 *
 * Implementations are expected to be async (IndexedDB is). The in-memory
 * impl is async for symmetry so callers don't need to special-case.
 */
import type { GameState } from '@capitalist-tree/shared';
import {
  envelope,
  deserialize,
  assertKnownSchemaVersion,
  UnknownSchemaVersionError,
  CURRENT_SCHEMA_VERSION,
  type SaveEnvelope,
} from '@capitalist-tree/shared';

export interface Storage {
  save(state: GameState): Promise<string>;
  load(): Promise<GameState | null>;
  listSaves(): Promise<readonly string[]>;
  deleteSave(id: string): Promise<boolean>;
  /** Validate a raw save object — runs migrations + Zod validation. */
  validate(raw: unknown): GameState;
}

/**
 * In-memory storage, used by tests and by the engine's own unit tests.
 *
 * Backed by a Map keyed by saveId. Persists the latest save as "active" so
 * `load()` returns it; `listSaves()` returns all stored saveIds.
 */
export class InMemoryStorage implements Storage {
  private readonly map = new Map<string, SaveEnvelope>();
  private activeId: string | null = null;

  async save(state: GameState): Promise<string> {
    const env = envelope(state);
    this.map.set(state.metadata.saveId, env);
    this.activeId = state.metadata.saveId;
    return state.metadata.saveId;
  }

  async load(): Promise<GameState | null> {
    if (!this.activeId) return null;
    const env = this.map.get(this.activeId);
    if (!env) return null;
    return this.validate(env);
  }

  async listSaves(): Promise<readonly string[]> {
    return [...this.map.keys()];
  }

  async deleteSave(id: string): Promise<boolean> {
    const had = this.map.delete(id);
    if (this.activeId === id) {
      this.activeId = null;
    }
    return had;
  }

  validate(raw: unknown): GameState {
    // First, check envelope shape so we can read schemaVersion safely.
    if (
      !raw ||
      typeof raw !== 'object' ||
      !('schemaVersion' in raw) ||
      !('state' in raw)
    ) {
      throw new UnknownSchemaVersionError(-1, [CURRENT_SCHEMA_VERSION]);
    }
    const env = raw as { schemaVersion: number; state: unknown };
    assertKnownSchemaVersion(env.schemaVersion);
    return deserialize(env);
  }
}
