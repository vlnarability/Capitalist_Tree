/**
 * SettingsModal — centralized UI preferences (W55 — GDD §13.3 / R-P5d-1).
 *
 * Gathers the four scattered UI prefs into one surface:
 *   - **Audio mute** — on/off (lifted into `ui.muted` from `useAudio`'s local
 *     state so the panel + any future audio consumer agree).
 *   - **Locale** — en / zh-CN / es (the `setLocale` mutator already existed;
 *     W55 adds localStorage persistence).
 *   - **Reduced motion** — auto / on / off (the `setReducedMotionOverride`
 *     mutator already existed; W55 adds localStorage persistence).
 *   - **Theme** — auto / brutalist / neutral / floral (new `ui.themeOverride`
 *     field; `useAestheticTheme` honors it when not `'auto'`).
 *
 * Controlled modal (mirrors `ClimatePicker`'s `open` / `onClose` pattern).
 * Overlay + focus trap + Escape-to-close mirror `OfflineModal`. Returns `null`
 * when `!open`.
 *
 * Architecture:
 *   - Rule 6 (UI reads state, never writes): subscribes to the four `ui`
 *     slices + dispatches through the ergonomic mutators. `simState` is
 *     referentially unchanged by every control (rule 6).
 *   - TDD §16 selective UI updates: narrow selectors per slice.
 *   - WCAG 2.1 AA: `role="dialog"` + `aria-modal` + `aria-labelledby` + a
 *     focus trap (Tab cycles within the dialog) + Escape to close + autofocus
 *     on the Close button (mirrors OfflineModal's a11y pass).
 */
'use client';

import { useCallback, useEffect, useRef, type ReactElement } from 'react';
import {
  SUPPORTED_LOCALES,
  LOCALE_DISPLAY_NAMES,
  type Locale,
} from '@capitalist-tree/content';
import { useGameStore, type ThemeOverride } from '../../stores/game-store';
import { Button } from '../common/Button';

export interface SettingsModalProps {
  /** Whether the modal is open. Returns `null` when false. */
  readonly open: boolean;
  /** Closes the modal (called on Close button, Escape, or backdrop click). */
  readonly onClose: () => void;
}

/** Reduced-motion override options (label / value pairs). */
const REDUCED_MOTION_OPTIONS: readonly { readonly value: 'auto' | 'on' | 'off'; readonly label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'on', label: 'On' },
  { value: 'off', label: 'Off' },
];

/** Theme override options (label / value pairs). */
const THEME_OPTIONS: readonly { readonly value: ThemeOverride; readonly label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'brutalist', label: 'Brutalist' },
  { value: 'neutral', label: 'Neutral' },
  { value: 'floral', label: 'Floral' },
];

/**
 * Render a segmented picker (mirrors SpeedControls' idiom: a row of Buttons,
 * the selected one gets `tone="active"` + `aria-pressed`). Used for locale /
 * reduced-motion / theme pickers.
 */
function SegmentedPicker<T extends string>({
  options,
  value,
  onSelect,
  testId,
}: {
  readonly options: readonly { readonly value: T; readonly label: string }[];
  readonly value: T;
  readonly onSelect: (next: T) => void;
  readonly testId: string;
}): ReactElement {
  return (
    <div className="flex flex-wrap gap-1.5" data-testid={testId} role="group">
      {options.map((opt) => {
        const selected = opt.value === value;
        return (
          <Button
            key={opt.value}
            tone={selected ? 'active' : 'default'}
            aria-pressed={selected}
            onClick={() => onSelect(opt.value)}
            data-testid={`${testId}-${opt.value}`}
            className="min-w-[2.5rem] text-xs"
          >
            {opt.label}
          </Button>
        );
      })}
    </div>
  );
}

export function SettingsModal({
  open,
  onClose,
}: SettingsModalProps): ReactElement | null {
  const muted = useGameStore((s) => s.ui.muted);
  const locale = useGameStore((s) => s.ui.locale);
  const reducedMotion = useGameStore((s) => s.ui.reducedMotionOverride);
  const themeOverride = useGameStore((s) => s.ui.themeOverride);
  const setMuted = useGameStore((s) => s.setMuted);
  const setLocale = useGameStore((s) => s.setLocale);
  const setReducedMotionOverride = useGameStore((s) => s.setReducedMotionOverride);
  const setTheme = useGameStore((s) => s.setTheme);

  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);

  // Autofocus the Close button on open + wire Escape / focus trap.
  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    closeRef.current?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const focusable = dialog.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  const onBackdropClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.target === e.currentTarget) onClose();
    },
    [onClose],
  );

  if (!open) return null;

  return (
    <div
      className="pointer-events-auto fixed inset-0 z-[60] flex items-center justify-center bg-parchment-2/70 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-modal-title"
      data-testid="settings-modal"
      onClick={onBackdropClick}
    >
      <div
        ref={dialogRef}
        className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-lg border border-ink bg-parchment p-6 shadow-2xl"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2
            id="settings-modal-title"
            className="text-lg font-serif italic text-ink"
            data-testid="settings-modal-title"
          >
            Settings
          </h2>
          <Button
            ref={closeRef}
            tone="default"
            onClick={onClose}
            aria-label="Close settings"
            data-testid="settings-modal-close"
            className="text-xs"
          >
            ✕
          </Button>
        </div>

        <div className="flex flex-col gap-5">
          {/* Audio mute — boolean toggle (mirrors AdvancedViewToggle). */}
          <section className="flex flex-col gap-1.5" data-testid="settings-section-audio">
            <span className="text-[10px] uppercase tracking-wider text-ink-soft">
              Audio
            </span>
            <div className="flex items-center justify-between">
              <span className="text-sm text-ink">Mute</span>
              <Button
                tone={muted ? 'warning' : 'active'}
                aria-pressed={!muted}
                onClick={() => setMuted(!muted)}
                data-testid="settings-mute-toggle"
                className="text-xs"
              >
                {muted ? 'Muted' : 'On'}
              </Button>
            </div>
          </section>

          {/* Locale — segmented picker (en / zh-CN / es). */}
          <section className="flex flex-col gap-1.5" data-testid="settings-section-locale">
            <span className="text-[10px] uppercase tracking-wider text-ink-soft">
              Language
            </span>
            <SegmentedPicker<Locale>
              options={SUPPORTED_LOCALES.map((l) => ({ value: l, label: LOCALE_DISPLAY_NAMES[l] ?? l }))}
              value={locale}
              onSelect={setLocale}
              testId="settings-locale"
            />
          </section>

          {/* Reduced motion — segmented picker (auto / on / off). */}
          <section className="flex flex-col gap-1.5" data-testid="settings-section-motion">
            <span className="text-[10px] uppercase tracking-wider text-ink-soft">
              Reduced motion
            </span>
            <SegmentedPicker<'auto' | 'on' | 'off'>
              options={REDUCED_MOTION_OPTIONS}
              value={reducedMotion}
              onSelect={setReducedMotionOverride}
              testId="settings-motion"
            />
            <p className="text-[11px] text-ink-soft">
              Auto follows your OS setting.
            </p>
          </section>

          {/* Theme — segmented picker (auto / brutalist / neutral / floral). */}
          <section className="flex flex-col gap-1.5" data-testid="settings-section-theme">
            <span className="text-[10px] uppercase tracking-wider text-ink-soft">
              Theme
            </span>
            <SegmentedPicker<ThemeOverride>
              options={THEME_OPTIONS}
              value={themeOverride}
              onSelect={setTheme}
              testId="settings-theme"
            />
            <p className="text-[11px] text-ink-soft">
              Auto follows your sustainability score. Override to lock a look.
            </p>
          </section>
        </div>

        <div className="mt-6 flex justify-end">
          <Button
            tone="active"
            onClick={onClose}
            data-testid="settings-modal-done"
          >
            Done
          </Button>
        </div>
      </div>
    </div>
  );
}
