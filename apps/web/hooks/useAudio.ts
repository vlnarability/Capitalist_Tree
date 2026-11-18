'use client';

/**
 * useAudio — ambient music + SFX playback (P13-C — GDD §13 UI).
 *
 * A small, SSR-safe audio manager. Loads the ambient music track from the
 * credits-managed assets (`/assets/audio/music-ambient.mp3`) into a looping
 * `<audio>` element kept in a ref, and exposes `playSfx(name)` to fire one-shot
 * sound effects (click / purchase / notification). A persisted mute toggle
 * (localStorage) gates both — browsers block autoplay until a user gesture, so
 * music starts muted-by-default and begins on the first `setMuted(false)` call
 * (which is a user gesture when wired to a button click).
 *
 * Rule 6 (rendering / UI reads state, never writes): the hook reads no store
 * state; it owns its own local mute flag + audio elements. It never touches
 * `simState`. SFX are triggered by UI event handlers (button clicks), not by
 * simulation events directly — keeping audio on the UI side of the boundary.
 *
 * Asset provenance: every file referenced here is listed in
 * `packages/content/src/credits` + `docs/credits.md` (CC0 / CC-BY).
 */
import { useCallback, useEffect, useRef, useState } from 'react';

/** The one-shot SFX slots, keyed by the asset file path. */
const SFX_FILES = {
  click: '/assets/audio/sfx-click.mp3',
  purchase: '/assets/audio/sfx-purchase.mp3',
  notification: '/assets/audio/sfx-notification.mp3',
} as const;

export type SfxName = keyof typeof SFX_FILES;

const MUSIC_FILE = '/assets/audio/music-ambient.mp3';
const MUTE_KEY = 'ct-audio-muted';

/** Read the persisted mute flag (defaults to true — muted until user opts in). */
function readMutedPref(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    return window.localStorage.getItem(MUTE_KEY) !== '0';
  } catch {
    return true;
  }
}

/**
 * Audio manager hook. Returns `[muted, setMuted, playSfx]`.
 *
 * - `muted` — whether audio is currently off (music paused, SFX silenced).
 * - `setMuted(next)` — toggle audio on/off. Calling `setMuted(false)` from a
 *   user-gesture handler (e.g. an onClick) satisfies the browser autoplay
 *   policy + starts the music.
 * - `playSfx(name)` — fire a one-shot SFX (no-op while muted or on SSR).
 */
export function useAudio(): readonly [
  muted: boolean,
  setMuted: (next: boolean) => void,
  playSfx: (name: SfxName) => void,
] {
  const [muted, setMutedState] = useState<boolean>(readMutedPref);
  const musicRef = useRef<HTMLAudioElement | null>(null);

  // Lazily create the ambient <audio> element on the client.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (musicRef.current) return;
    const el = new Audio(MUSIC_FILE);
    el.loop = true;
    el.volume = 0.4;
    el.preload = 'auto';
    musicRef.current = el;
  }, []);

  // Play / pause the ambient track when the mute flag flips.
  useEffect(() => {
    const el = musicRef.current;
    if (!el) return;
    if (muted) {
      el.pause();
    } else {
      // play() returns a promise; ignore rejection (autoplay blocked / no
      // user gesture yet) — the next setMuted(false) from a click will succeed.
      void el.play().catch(() => {});
    }
  }, [muted]);

  // Persist the mute flag.
  const setMuted = useCallback((next: boolean) => {
    setMutedState(next);
    try {
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(MUTE_KEY, next ? '1' : '0');
      }
    } catch {
      // localStorage unavailable — in-memory state still works.
    }
  }, []);

  const playSfx = useCallback(
    (name: SfxName) => {
      if (muted || typeof window === 'undefined') return;
      const file = SFX_FILES[name];
      if (!file) return;
      // One-shot: a fresh Audio each call lets overlapping SFX mix + avoids
      // the need to rewind a shared element.
      const el = new Audio(file);
      el.volume = 0.6;
      void el.play().catch(() => {});
    },
    [muted],
  );

  return [muted, setMuted, playSfx] as const;
}
