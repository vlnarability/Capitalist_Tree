/**
 * HeadlessAudioPlayer — a no-op AudioPlayer for tests + SSR (W68).
 *
 * The real player (Web Audio API) lives in the future UI (P4d React wrapper).
 * This stub implements the same `AudioPlayer` interface so consumer code paths
 * work unchanged in non-visual contexts (vitest unit tests, server-side
 * rendering, headless screenshots). It records every `play` / `stop` /
 * `stopAll` call so tests can assert which sounds were requested, in what
 * order, without a real audio device.
 *
 * The player does NOT validate `soundId` against the registry — the sim
 * emits only valid ids, + the real player's validation is a UI concern. This
 * keeps the stub dependency-free.
 */
export type AudioPlayerOp = 'play' | 'stop' | 'stopAll';

/** A recorded AudioPlayer call (for test inspection). */
export interface AudioPlayerCall {
  readonly op: AudioPlayerOp;
  readonly soundId?: string;
  readonly timestamp: number;
}

/**
 * AudioPlayer interface — the contract the future UI implements (via Web
 * Audio API) + the headless stub satisfies. `play` starts a sound (ambient
 * loops, sfx one-shot); `stop` stops one sound; `stopAll` stops everything.
 */
export interface AudioPlayer {
  play(soundId: string): void;
  stop(soundId: string): void;
  stopAll(): void;
  dispose(): void;
  readonly disposed: boolean;
}

/**
 * Headless AudioPlayer implementation (W68). Records calls + tracks the set of
 * "playing" sounds; never produces real audio. Safe to call after dispose
 * (no-op).
 */
export class HeadlessAudioPlayer implements AudioPlayer {
  private _disposed = false;
  private readonly _calls: AudioPlayerCall[] = [];
  private readonly _playing: Set<string> = new Set();

  play(soundId: string): void {
    if (this._disposed) return;
    this._calls.push({ op: 'play', soundId, timestamp: Date.now() });
    this._playing.add(soundId);
  }

  stop(soundId: string): void {
    if (this._disposed) return;
    this._calls.push({ op: 'stop', soundId, timestamp: Date.now() });
    this._playing.delete(soundId);
  }

  stopAll(): void {
    if (this._disposed) return;
    this._calls.push({ op: 'stopAll', timestamp: Date.now() });
    this._playing.clear();
  }

  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    this._playing.clear();
  }

  get disposed(): boolean {
    return this._disposed;
  }

  // --- Headless-specific inspection API (not part of AudioPlayer) ---

  /** All recorded calls, in order (for test inspection). */
  get calls(): readonly AudioPlayerCall[] {
    return this._calls;
  }

  /** Sound ids currently "playing" (started, not yet stopped). */
  get playing(): readonly string[] {
    return [...this._playing];
  }
}
