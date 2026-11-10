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
 * The RNG state is persisted on GameState.rngState (a `[number, number,
 * number, number]` tuple) so the position survives save/load.
 */

/** Serializable RNG state. Mirrors `RngState` in @capitalist-tree/shared. */
export type RngState = [number, number, number, number];

const MASK32 = 0xffffffff;

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

  static fromState(state: RngState): Rng {
    return new Rng(
      state[0] >>> 0,
      state[1] >>> 0,
      state[2] >>> 0,
      state[3] >>> 0,
    );
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
      this.a & MASK32,
      this.b & MASK32,
      this.c & MASK32,
      this.d & MASK32,
    ];
  }
  /**
   * Fork a sub-stream for a named consumer (e.g. a system id).
   *
   * The child's sequence is independent of the parent's subsequent draws —
   * the parent advances by exactly one draw to seed the fork, so two forks
   * with different names produce independent sequences, and the same
   * (parentState, name) pair always yields the same child sequence.
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
    // Consume one draw to advance the parent, then derive a seed.
    const parentDraw = this.next();
    const nameHash = cyrb53(name);
    // Mix: parent's live state + the name hash + the just-drawn value.
    const seed =
      (Math.imul(this.a ^ nameHash, 0x9e3779b9) ^
        Math.imul(this.b ^ (parentDraw * 4294967296) | 0, 0x85ebca6b) ^
        this.c ^
        this.d) >>>
      0;
    return Rng.fromSeed(seed || 1);
  }
}
