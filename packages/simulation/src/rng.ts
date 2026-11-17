/**
 * Seeded deterministic RNG (sfc32 + splitmix32 seeder).
 *
 * sfc32 (https://github.com/bryc/code/blob/master/js/rng/sfc32.js) is a
 * fast, statistically good 32-bit PRNG with a 128-bit state. We seed it via
 * splitmix32 so a single 32-bit seed expands to the four 32-bit state words
 * sfc32 expects.
 *
 * Determinism contract (TDD §18.3):
 *   - `Rng.fromSeed(s)` always produces the same sequence.
 *   - `getState()` + `Rng.fromState(state)` is identity-preserving: the next
 *     draw after a save/load equals the next draw had there been no save/load.
 *   - `fork(name)` produces a child RNG whose sequence is independent of the
 *     parent's subsequent draws. The fork is deterministic given the parent's
 *     current state and the name.
 *
 * DR-6 (docs/reviews/DECISIONS.md) — fork versioning. The fork behavior is
 * versioned so changing it does not silently alter existing saves' sequences:
 *   - v1 (legacy): `fork()` consumes one root draw to seed the child
 *     (root-consuming). Adding a fork shifts every subsequent root draw.
 *   - v2 (current): `fork()` derives the child seed from the parent's CURRENT
 *     state without advancing it (non-root-consuming). Adding a fork does not
 *     shift the parent's sequence — so adding a weather calculation cannot
 *     change mortality outcomes simply by consuming extra random values.
 * New sims initialize at v2; legacy saves migrate in at v1 (their sequence is
 * preserved exactly). The version is carried on `GameState.rngVersion` and
 * threaded through `Rng.fromState(state, forkVersion)`.
 *
 * The RNG state is persisted on GameState.rngState (a `[number, number,
 * number, number]` tuple) so the position survives save/load.
 */

/** Serializable RNG state. Mirrors `RngState` in @capitalist-tree/shared. */
export type RngState = [number, number, number, number];

/** DR-6: which `fork()` behavior an RNG instance uses. */
export type RngForkVersion = 1 | 2;

function rotl(n: number, k: number): number {
  return ((n << k) | (n >>> (32 - k))) >>> 0;
}

/** splitmix32 — used only to expand a single 32-bit seed into four words. */
function splitmix32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x9e3779b9) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 16), 0x21f0aaad);
    t = Math.imul(t ^ (t >>> 15), 0x735a2d97);
    return (t ^ (t >>> 15)) >>> 0;
  };
}

/**
 * cyrb53 hash — deterministic string -> 32-bit number. Used to derive a
 * sub-seed from a fork name.
 */
function cyrb53(str: string, seed = 0): number {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0) || 1; // never 0
}

/**
 * Seeded RNG.
 *
 * Construct via the static factories `fromSeed` and `fromState` — the
 * constructor is private to keep the state invariant (all four words are
 * masked to 32 bits).
 */
export class Rng {
  /**
   * DR-6: which `fork()` behavior this RNG uses. v1 = legacy root-consuming,
   * v2 = non-root-consuming. Defaults to v1 so a bare `Rng.fromSeed` (used by
   * the fork internals + tests) matches the legacy sequence unless a caller
   * explicitly opts into v2 via `Rng.fromState(state, 2)`.
   */
  public forkVersion: RngForkVersion = 1;

  private constructor(
    private a: number,
    private b: number,
    private c: number,
    private d: number,
  ) {}

  static fromSeed(seed: number): Rng {
    const exp = splitmix32(seed >>> 0);
    const a = exp();
    const b = exp();
    const c = exp();
    const d = exp();
    // sfc32 asks for a small "warm-up" — run 16 iterations to mix state.
    const r = new Rng(a, b, c, d);
    for (let i = 0; i < 16; i++) r.next();
    return r;
  }

  /**
   * Rebuild an RNG from a persisted state. `forkVersion` (DR-6) selects the
   * `fork()` behavior; it defaults to v1 so legacy call sites + tests that
   * don't pass it keep the historical sequence.
   */
  static fromState(state: RngState, forkVersion: RngForkVersion = 1): Rng {
    const r = new Rng(
      state[0] >>> 0,
      state[1] >>> 0,
      state[2] >>> 0,
      state[3] >>> 0,
    );
    r.forkVersion = forkVersion;
    return r;
  }

  /** Next float in [0, 1). */
  next(): number {
    const t = (((this.a + this.b) | 0) + this.d) | 0;
    this.d = (this.d + 1) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = rotl(this.c, 21);
    this.c = (this.c + t) | 0;
    return (t >>> 0) / 4294967296;
  }

  /** Integer in [min, max] inclusive. */
  nextInt(min: number, max: number): number {
    const range = max - min + 1;
    return min + Math.floor(this.next() * range);
  }

  getState(): RngState {
    return [
      this.a >>> 0,
      this.b >>> 0,
      this.c >>> 0,
      this.d >>> 0,
    ];
  }
  /**
   * Fork a sub-stream for a named consumer (e.g. a system id).
   *
   * DR-6 — the fork behavior is versioned on `this.forkVersion`:
   *   - v1 (legacy): the parent advances by exactly one draw to seed the fork
   *     (root-consuming). Two forks with different names produce independent
   *     sequences, and the same (parentState, name) pair always yields the
   *     same child sequence — BUT adding a new fork shifts every subsequent
   *     root draw, so adding a system can change unrelated outcomes.
   *   - v2 (current): the child seed is derived from the parent's CURRENT
   *     state (a, b, c, d) + the name hash WITHOUT advancing the parent. The
   *     parent's sequence is untouched — adding a fork cannot shift other
   *     systems' draws. Same (parentState, name) pair still yields the same
   *     child sequence.
   *
   * Use this to give each system its own deterministic sub-stream so a
   * system's draws don't shift other systems' sequences:
   *
   *   const weatherRng = rng.fork('weather');
   *   weatherRng.next(); // deterministic
   *
   * Note: if a system needs its sub-stream to survive save/load, it must
   * persist the child's state itself (e.g. on a sub-field of GameState).
   * The root RNG on GameState.rngState is shared by default.
   */
  fork(name: string): Rng {
    const nameHash = cyrb53(name);
    let seed: number;
    if (this.forkVersion === 1) {
      // Legacy v1: consume one draw to advance the parent, then mix it in.
      const parentDraw = this.next();
      seed =
        (Math.imul(this.a ^ nameHash, 0x9e3779b9) ^
          Math.imul(this.b ^ (parentDraw * 4294967296) | 0, 0x85ebca6b) ^
          this.c ^
          this.d) >>>
        0;
    } else {
      // v2 (DR-6): non-root-consuming — derive the seed from the parent's
      // CURRENT state + the name hash. No .next() call, so the parent's
      // sequence is unchanged by the act of forking.
      seed =
        (Math.imul(this.a ^ nameHash, 0x9e3779b9) ^
          Math.imul(this.b, 0x85ebca6b) ^
          Math.imul(this.c, 0xc2b2ae35) ^
          Math.imul(this.d, 0x27d4eb2f)) >>>
        0;
    }
    const child = Rng.fromSeed(seed || 1);
    // The child inherits the parent's fork version so a nested fork preserves
    // the same behavior.
    child.forkVersion = this.forkVersion;
    return child;
  }
}
