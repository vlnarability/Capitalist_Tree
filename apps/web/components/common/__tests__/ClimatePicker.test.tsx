/**
 * Tests for the ClimatePicker (GAP-17 / DR-11 — Phase 4).
 *
 * Covers:
 *   - Returns null when `open` is false.
 *   - Renders the catalog grouped by Köppen class, with the warm-Dfb default
 *     (`climate:temperate`) selected initially + White Oak as the species.
 *   - Selecting a climate updates the profile + filters the species list to
 *     the zone's natives (BWh → date palm).
 *   - EF (no trees) shows the unplayable notice + disables Start.
 *   - Selecting a species + Start calls onSubmit with the selection.
 *   - The highland elevation slider shows a live temp-preview + the submit
 *     carries elevationM.
 *
 * Environment: happy-dom. The picker is props-driven (no store), so the test
 * renders it directly with onSubmit/onClose mocks.
 */
// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, render, fireEvent, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { ClimatePicker, type ClimatePickerSelection } from '../ClimatePicker';

function setup(overrides: Partial<{ open: boolean; onClose: ReturnType<typeof vi.fn>; onSubmit: ReturnType<typeof vi.fn> }> = {}) {
  const onClose = overrides.onClose ?? vi.fn();
  const onSubmit = overrides.onSubmit ?? vi.fn();
  const result = render(
    <ClimatePicker
      open={overrides.open ?? true}
      onClose={onClose}
      onSubmit={onSubmit}
    />,
  );
  return { ...result, onClose, onSubmit };
}

afterEach(() => cleanup());

describe('ClimatePicker — open/close', () => {
  it('returns null (nothing rendered) when open is false', () => {
    const { container } = setup({ open: false });
    expect(container.firstChild).toBeNull();
  });

  it('renders the modal with the catalog + the default climate selected when open', () => {
    const { getByTestId, queryAllByTestId } = setup();
    expect(getByTestId('climate-picker')).toBeInTheDocument();
    // Default climate (warm-Dfb temperate) card is present + pressed.
    const defaultCard = getByTestId('climate-card-climate:temperate');
    expect(defaultCard).toHaveAttribute('aria-pressed', 'true');
    // At least one card from each Köppen class is present (A/B/C/D/E).
    expect(queryAllByTestId(/^climate-card-climate:/).length).toBeGreaterThanOrEqual(31);
    // The default species (White Oak) is the initial selection.
    expect(getByTestId('species-card-species:white-oak')).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('ClimatePicker — climate + species selection', () => {
  it('selecting BWh updates the profile + shows the date palm as a native species', () => {
    const { getByTestId } = setup();
    fireEvent.click(getByTestId('climate-card-climate:bwh'));
    // BWh is now the selected climate.
    expect(getByTestId('climate-card-climate:bwh')).toHaveAttribute('aria-pressed', 'true');
    expect(getByTestId('climate-card-climate:temperate')).toHaveAttribute('aria-pressed', 'false');
    // The date palm is native to BWh + is now offered (defaulting to selected).
    expect(getByTestId('species-card-species:date-palm')).toBeInTheDocument();
    expect(getByTestId('species-card-species:date-palm')).toHaveAttribute('aria-pressed', 'true');
    // The profile shows the BWh Köppen code.
    expect(getByTestId('climate-picker-profile').textContent).toContain('BWh');
  });

  it('Start calls onSubmit with the selected climateId + speciesId + elevationM 0', () => {
    const onSubmit = vi.fn();
    const { getByTestId } = setup({ onSubmit });
    fireEvent.click(getByTestId('climate-card-climate:bwh'));
    fireEvent.click(getByTestId('species-card-species:date-palm'));
    fireEvent.click(getByTestId('climate-picker-start'));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    const selection: ClimatePickerSelection = onSubmit.mock.calls[0]![0];
    expect(selection).toEqual({ climateId: 'climate:bwh', speciesId: 'species:date-palm', elevationM: 0 });
  });

  it('Cancel calls onClose without submitting', () => {
    const onClose = vi.fn();
    const onSubmit = vi.fn();
    const { getByTestId } = setup({ onClose, onSubmit });
    fireEvent.click(getByTestId('climate-picker-cancel'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('shows a climate-suitability fit badge on each species card (the right-tree lever)', () => {
    const { getByTestId } = setup();
    // Default: white oak in warm-Dfb temperate (native + good temp fit) → fit > 60%.
    const fitBadge = getByTestId('species-fit-species:white-oak');
    expect(fitBadge.textContent).toMatch(/fit \d+%/);
    const pct = parseInt(fitBadge.textContent!.match(/(\d+)%/)![1]!, 10);
    expect(pct).toBeGreaterThan(60);
    // The footer summary also carries the fit percentage.
    expect(getByTestId('climate-picker-footer-summary').textContent).toMatch(/fit \d+%/);
  });
});

describe('ClimatePicker — EF (no trees) is unplayable', () => {
  it('selecting EF shows the no-species notice + disables Start', () => {
    const { getByTestId, queryByTestId } = setup();
    fireEvent.click(getByTestId('climate-card-climate:ef'));
    // No species cards rendered for EF.
    expect(queryByTestId(/species-card-/)).toBeNull();
    // The unplayable notice is shown.
    expect(getByTestId('climate-picker-species').textContent).toContain('No tree species survives');
    // Start is disabled (can't start without a species).
    expect(getByTestId('climate-picker-start')).toBeDisabled();
  });
});

describe('ClimatePicker — highland elevation slider', () => {
  it('enabling highland + 2000 m shows the −13 °C preview + adjusted winter temp', () => {
    const { getByTestId } = setup();
    // Default climate: temperate (winter 0 °C).
    fireEvent.click(getByTestId('climate-picker-highland-toggle'));
    const slider = getByTestId('climate-picker-elevation-slider') as HTMLInputElement;
    fireEvent.change(slider, { target: { value: '2000' } });
    // The preview line shows the drop (2000 m × 6.5 °C/km = 13.0 °C).
    expect(getByTestId('climate-picker-highland-preview').textContent).toContain('−13.0°C');
    expect(getByTestId('climate-picker-highland-preview').textContent).toContain('2000 m');
    // The profile's winter temp is the adjusted value (0 − 13 = −13 °C).
    expect(getByTestId('climate-picker-profile').textContent).toContain('-13.0°C');
  });

  it('Start with highland enabled carries the elevationM in the submit payload', () => {
    const onSubmit = vi.fn();
    const { getByTestId } = setup({ onSubmit });
    fireEvent.click(getByTestId('climate-card-climate:temperate'));
    fireEvent.click(getByTestId('climate-picker-highland-toggle'));
    fireEvent.change(getByTestId('climate-picker-elevation-slider'), { target: { value: '1500' } });
    fireEvent.click(getByTestId('climate-picker-start'));
    const selection: ClimatePickerSelection = onSubmit.mock.calls[0]![0];
    expect(selection.climateId).toBe('climate:temperate');
    expect(selection.elevationM).toBe(1500);
  });

  it('highland disabled submits elevationM 0 even if the slider was moved', () => {
    const onSubmit = vi.fn();
    const { getByTestId } = setup({ onSubmit });
    // Enable, move the slider, then disable again.
    fireEvent.click(getByTestId('climate-picker-highland-toggle'));
    fireEvent.change(getByTestId('climate-picker-elevation-slider'), { target: { value: '3000' } });
    fireEvent.click(getByTestId('climate-picker-highland-toggle')); // toggle off
    fireEvent.click(getByTestId('climate-picker-start'));
    const selection: ClimatePickerSelection = onSubmit.mock.calls[0]![0];
    expect(selection.elevationM).toBe(0);
  });

  it('survival badges appear on species cards when highland is active', () => {
    const { getByTestId, getAllByText } = setup();
    // Temperate + White Oak: at 4000 m the winter drops to 0 − 26 = −26 °C,
    // below the White Oak's 0 °C minimum → "won't survive" badge shows.
    fireEvent.click(getByTestId('climate-picker-highland-toggle'));
    fireEvent.change(getByTestId('climate-picker-elevation-slider'), { target: { value: '4000' } });
    // At least one survival badge (✓ survives / ✗ won't survive) is rendered.
    // (The badge uses a curly apostrophe in "won't", so match on "survive".)
    const badges = getAllByText(/survive/);
    expect(badges.length).toBeGreaterThan(0);
  });
});
