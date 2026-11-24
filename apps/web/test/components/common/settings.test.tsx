/**
 * Tests for SettingsModal (W55 — centralized UI preferences).
 *
 * Covers:
 *   - Returns null when `open` is false.
 *   - Renders the four sections (audio / locale / reduced-motion / theme)
 *     when open.
 *   - Mute toggle flips `ui.muted` + persists to localStorage.
 *   - Locale picker changes `ui.locale` + persists.
 *   - Reduced-motion picker changes `ui.reducedMotionOverride` + persists.
 *   - Theme picker changes `ui.themeOverride` + persists.
 *   - Close button + Done button + Escape close the modal.
 *   - Rule 6: `simState` reference is unchanged after a control change.
 *
 * Environment: happy-dom. Driven via the store mutators (mirrors
 * OfflineModal's test pattern).
 */
// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { cleanup, render, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { engine, DEFAULT_GAME_CONFIG } from '@capitalist-tree/simulation';
import {
  useGameStore,
  __resetGameStoreForTests,
} from '../../../stores/game-store';
import { SettingsModal } from '../../../components/common/SettingsModal';

describe('SettingsModal (W55) — centralized UI prefs', () => {
  beforeEach(() => {
    __resetGameStoreForTests();
    // Clear localStorage so each test starts clean.
    try {
      window.localStorage.clear();
    } catch {
      // ignore
    }
  });
  afterEach(() => cleanup());

  it('returns null when open is false', () => {
    const { container } = render(<SettingsModal open={false} onClose={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the four sections when open', () => {
    const { getByTestId } = render(<SettingsModal open={true} onClose={() => {}} />);
    expect(getByTestId('settings-modal')).toBeInTheDocument();
    expect(getByTestId('settings-modal-title').textContent ?? '').toMatch(/settings/i);
    expect(getByTestId('settings-section-audio')).toBeInTheDocument();
    expect(getByTestId('settings-section-locale')).toBeInTheDocument();
    expect(getByTestId('settings-section-motion')).toBeInTheDocument();
    expect(getByTestId('settings-section-theme')).toBeInTheDocument();
  });

  it('mute toggle flips ui.muted + persists to localStorage', () => {
    const { getByTestId } = render(<SettingsModal open={true} onClose={() => {}} />);
    // Default muted = true.
    expect(useGameStore.getState().ui.muted).toBe(true);
    fireEvent.click(getByTestId('settings-mute-toggle'));
    expect(useGameStore.getState().ui.muted).toBe(false);
    expect(window.localStorage.getItem('ct-audio-muted')).toBe('0');
  });

  it('locale picker changes ui.locale + persists', () => {
    const { getByTestId } = render(<SettingsModal open={true} onClose={() => {}} />);
    expect(useGameStore.getState().ui.locale).toBe('en');
    fireEvent.click(getByTestId('settings-locale-zh-CN'));
    expect(useGameStore.getState().ui.locale).toBe('zh-CN');
    expect(window.localStorage.getItem('ct-locale')).toBe('zh-CN');
  });

  it('reduced-motion picker changes ui.reducedMotionOverride + persists', () => {
    const { getByTestId } = render(<SettingsModal open={true} onClose={() => {}} />);
    expect(useGameStore.getState().ui.reducedMotionOverride).toBe('auto');
    fireEvent.click(getByTestId('settings-motion-on'));
    expect(useGameStore.getState().ui.reducedMotionOverride).toBe('on');
    expect(window.localStorage.getItem('ct-reduced-motion')).toBe('on');
  });

  it('theme picker changes ui.themeOverride + persists', () => {
    const { getByTestId } = render(<SettingsModal open={true} onClose={() => {}} />);
    expect(useGameStore.getState().ui.themeOverride).toBe('auto');
    fireEvent.click(getByTestId('settings-theme-floral'));
    expect(useGameStore.getState().ui.themeOverride).toBe('floral');
    expect(window.localStorage.getItem('ct-theme')).toBe('floral');
  });

  it('Close button calls onClose', () => {
    let closed = false;
    const { getByTestId } = render(
      <SettingsModal open={true} onClose={() => { closed = true; }} />,
    );
    fireEvent.click(getByTestId('settings-modal-close'));
    expect(closed).toBe(true);
  });

  it('Done button calls onClose', () => {
    let closed = false;
    const { getByTestId } = render(
      <SettingsModal open={true} onClose={() => { closed = true; }} />,
    );
    fireEvent.click(getByTestId('settings-modal-done'));
    expect(closed).toBe(true);
  });

  it('Escape closes the modal', () => {
    let closed = false;
    render(<SettingsModal open={true} onClose={() => { closed = true; }} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(closed).toBe(true);
  });

  it('rule 6: simState reference is unchanged after a control change', () => {
    // Publish a simState so we can assert its reference is untouched.
    const state = engine.initialize({ ...DEFAULT_GAME_CONFIG, createdAt: 1_700_000_000_000 });
    useGameStore.getState().commitSimState(state, []);
    const before = useGameStore.getState().simState;
    const { getByTestId } = render(<SettingsModal open={true} onClose={() => {}} />);
    fireEvent.click(getByTestId('settings-mute-toggle'));
    expect(useGameStore.getState().simState).toBe(before);
  });
});
