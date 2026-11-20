/**
 * WelcomePanel tests (GAP-33 — first-time tutorial).
 *
 * Covers the localStorage-backed visibility contract:
 *   - Renders the modal when not yet dismissed (no localStorage flag).
 *   - The Get Started click dismisses (modal unmounts) + persists to localStorage.
 *   - Once persisted, a fresh render does not show the modal.
 *
 * Environment: happy-dom (provides localStorage).
 */
// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { cleanup, render, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { WelcomePanel } from '../../../components/common/WelcomePanel';

const WELCOME_KEY = 'ct-welcome-dismissed';

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  cleanup();
});

describe('WelcomePanel (GAP-33)', () => {
  it('renders the modal when not yet dismissed', () => {
    const { getByTestId } = render(<WelcomePanel />);
    expect(getByTestId('welcome-panel')).toBeInTheDocument();
    expect(getByTestId('welcome-panel-title').textContent).toBe(
      'Welcome to The Capitalist Tree',
    );
    // Five core-loop tips rendered.
    for (let i = 0; i < 5; i++) {
      expect(getByTestId(`welcome-panel-tip-${i}`)).toBeInTheDocument();
    }
  });

  it('Get Started dismisses the modal + persists to localStorage', () => {
    const { getByTestId, queryByTestId } = render(<WelcomePanel />);
    fireEvent.click(getByTestId('welcome-panel-start'));
    expect(queryByTestId('welcome-panel')).toBeNull();
    expect(localStorage.getItem(WELCOME_KEY)).toBe('1');
  });

  it('does not render the modal once localStorage says dismissed', () => {
    localStorage.setItem(WELCOME_KEY, '1');
    const { queryByTestId } = render(<WelcomePanel />);
    expect(queryByTestId('welcome-panel')).toBeNull();
  });

  it('Escape dismisses the modal + persists', () => {
    const { queryByTestId } = render(<WelcomePanel />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(queryByTestId('welcome-panel')).toBeNull();
    expect(localStorage.getItem(WELCOME_KEY)).toBe('1');
  });
});
