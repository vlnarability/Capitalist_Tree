/**
 * InfoHint tests (GAP-35 — GDD §13.3 advanced-view explanations).
 *
 * Covers the tooltip disclosure contract:
 *   - Renders the "?" trigger; the tooltip is absent until interacted with.
 *   - Focus (keyboard) reveals the tooltip + links it via aria-describedby.
 *   - Blur hides it.
 *   - Click toggles it.
 *   - Escape hides it.
 *
 * Environment: happy-dom.
 */
// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, render, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { InfoHint } from '../../../components/common/InfoHint';

afterEach(() => {
  cleanup();
});

describe('InfoHint (GAP-35)', () => {
  it('renders the trigger + no tooltip initially', () => {
    const { queryByTestId, getByTestId } = render(
      <InfoHint label="Explain X" explanation="The relationship is Y." />,
    );
    expect(getByTestId('info-hint-trigger')).toBeInTheDocument();
    expect(queryByTestId('info-hint-tooltip')).toBeNull();
  });

  it('reveals the tooltip on focus + links via aria-describedby', () => {
    const { getByTestId } = render(
      <InfoHint label="Explain X" explanation="The relationship is Y." />,
    );
    const trigger = getByTestId('info-hint-trigger');
    fireEvent.focus(trigger);
    const tooltip = getByTestId('info-hint-tooltip');
    expect(tooltip).toBeInTheDocument();
    expect(tooltip.textContent).toBe('The relationship is Y.');
    expect(trigger.getAttribute('aria-describedby')).toBe(tooltip.getAttribute('id'));
  });

  it('hides the tooltip on blur', () => {
    const { getByTestId, queryByTestId } = render(
      <InfoHint label="Explain X" explanation="The relationship is Y." />,
    );
    const trigger = getByTestId('info-hint-trigger');
    fireEvent.focus(trigger);
    expect(getByTestId('info-hint-tooltip')).toBeInTheDocument();
    fireEvent.blur(trigger);
    expect(queryByTestId('info-hint-tooltip')).toBeNull();
  });

  it('toggles the tooltip on click', () => {
    const { getByTestId, queryByTestId } = render(
      <InfoHint label="Explain X" explanation="The relationship is Y." />,
    );
    const trigger = getByTestId('info-hint-trigger');
    fireEvent.click(trigger);
    expect(getByTestId('info-hint-tooltip')).toBeInTheDocument();
    fireEvent.click(trigger);
    expect(queryByTestId('info-hint-tooltip')).toBeNull();
  });

  it('hides the tooltip on Escape', () => {
    const { getByTestId, queryByTestId } = render(
      <InfoHint label="Explain X" explanation="The relationship is Y." />,
    );
    const trigger = getByTestId('info-hint-trigger');
    fireEvent.focus(trigger);
    expect(getByTestId('info-hint-tooltip')).toBeInTheDocument();
    fireEvent.keyDown(trigger, { key: 'Escape' });
    expect(queryByTestId('info-hint-tooltip')).toBeNull();
  });

  it('the trigger exposes the label as aria-label', () => {
    const { getByTestId } = render(
      <InfoHint label="Explain photosynthesis" explanation="..." />,
    );
    expect(getByTestId('info-hint-trigger').getAttribute('aria-label')).toBe(
      'Explain photosynthesis',
    );
  });
});
