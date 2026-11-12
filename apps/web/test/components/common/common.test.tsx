/**
 * Tests for `components/common` primitives (P5b).
 *
 * Smoke + behavior coverage under happy-dom (these are React components
 * using JSX + DOM globals via the testing-library render path).
 *
 *   - `Panel` renders title + hint + body; applies the tone's border class.
 *   - `Button` renders label + forwards onClick; applies tone classes; can
 *     be disabled; renders icon when provided.
 *   - `Stat` renders label + value; applies tone's text class.
 *   - `ProgressBar` renders a progressbar with the correct aria-* attrs +
 *     width style derived from the value; clamps NaN + values > 1.
 */
// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, render, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { Panel } from '../../../components/common/Panel';
import { Button } from '../../../components/common/Button';
import { Stat } from '../../../components/common/Stat';
import { ProgressBar } from '../../../components/common/ProgressBar';

describe('Panel (P5b common)', () => {
  afterEach(() => cleanup());

  it('renders the title + children', () => {
    const { getByText } = render(
      <Panel title="Money">
        <span>$500.00</span>
      </Panel>,
    );
    expect(getByText('Money')).toBeInTheDocument();
    expect(getByText('$500.00')).toBeInTheDocument();
  });

  it('renders the icon + hint when provided', () => {
    const { getByText } = render(
      <Panel title="Weather" icon="☀" hint="12:00">
        <span>Sunny, 18°C</span>
      </Panel>,
    );
    expect(getByText('☀')).toBeInTheDocument();
    expect(getByText('12:00')).toBeInTheDocument();
  });

  it('applies the tone border class (emerald)', () => {
    const { container } = render(
      <Panel title="Tree" tone="emerald">
        <span>body</span>
      </Panel>,
    );
    const section = container.querySelector('section');
    expect(section?.className).toContain('border-emerald-800/60');
  });

  it('omits the header when no title is provided', () => {
    const { container } = render(
      <Panel>
        <span>body</span>
      </Panel>,
    );
    expect(container.querySelector('header')).toBeNull();
  });
});

describe('Button (P5b common)', () => {
  afterEach(() => cleanup());

  it('renders children + invokes onClick', () => {
    const onClick = vi.fn();
    const { getByText } = render(<Button onClick={onClick}>Save</Button>);
    fireEvent.click(getByText('Save'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('applies the active tone classes', () => {
    const { getByText } = render(<Button tone="active">1x</Button>);
    const btn = getByText('1x');
    expect(btn.className).toContain('border-emerald-500');
    expect(btn.className).toContain('bg-emerald-500/10');
  });

  it('applies the warning tone classes', () => {
    const { getByText } = render(<Button tone="warning">Pause</Button>);
    expect(getByText('Pause').className).toContain('border-amber-500');
  });

  it('renders an icon when provided', () => {
    const { getByText } = render(<Button icon="⏸">Pause</Button>);
    expect(getByText('⏸')).toBeInTheDocument();
  });

  it('does NOT invoke onClick when disabled', () => {
    const onClick = vi.fn();
    const { getByText } = render(
      <Button onClick={onClick} disabled>
        Disabled
      </Button>,
    );
    fireEvent.click(getByText('Disabled'));
    expect(onClick).not.toHaveBeenCalled();
  });

  it('forwards the type attribute (defaults to "button")', () => {
    const { getByText } = render(<Button>Default</Button>);
    expect(getByText('Default').tagName).toBe('BUTTON');
    expect((getByText('Default') as HTMLButtonElement).type).toBe('button');
  });
});

describe('Stat (P5b common)', () => {
  afterEach(() => cleanup());

  it('renders label + value', () => {
    const { getByText } = render(<Stat label="Soil Health" value="82%" />);
    expect(getByText('Soil Health')).toBeInTheDocument();
    expect(getByText('82%')).toBeInTheDocument();
  });

  it('renders the sub-value when provided', () => {
    const { getByText } = render(
      <Stat label="Money" value="$500.00" sub="After monthly expenses" />,
    );
    expect(getByText('After monthly expenses')).toBeInTheDocument();
  });

  it('applies the tone text class (emerald)', () => {
    const { getByText } = render(<Stat label="Tier" value="Healthy" tone="emerald" />);
    expect(getByText('Healthy').className).toContain('text-emerald-300');
  });

  it('applies slate tone by default', () => {
    const { getByText } = render(<Stat label="Cash" value="$0" />);
    expect(getByText('$0').className).toContain('text-slate-100');
  });
});

describe('ProgressBar (P5b common)', () => {
  afterEach(() => cleanup());

  it('renders role="progressbar" with aria-* attributes', () => {
    const { container } = render(<ProgressBar value={0.5} label="Soil Health" />);
    const bar = container.querySelector('[role="progressbar"]');
    expect(bar).not.toBeNull();
    expect(bar).toHaveAttribute('aria-label', 'Soil Health');
    expect(bar).toHaveAttribute('aria-valuenow', '50');
    expect(bar).toHaveAttribute('aria-valuemin', '0');
    expect(bar).toHaveAttribute('aria-valuemax', '100');
  });

  it('renders the filled portion width derived from the value', () => {
    const { container } = render(<ProgressBar value={0.82} label="Soil" />);
    const fill = container.querySelector('[role="progressbar"] > div');
    expect(fill).not.toBeNull();
    expect(fill?.getAttribute('style')).toContain('width: 82%');
  });

  it('clamps values > 1 to 100%', () => {
    const { container } = render(<ProgressBar value={1.5} label="X" />);
    const fill = container.querySelector('[role="progressbar"] > div');
    expect(fill?.getAttribute('style')).toContain('width: 100%');
  });

  it('clamps negative values to 0%', () => {
    const { container } = render(<ProgressBar value={-0.5} label="X" />);
    const fill = container.querySelector('[role="progressbar"] > div');
    expect(fill?.getAttribute('style')).toContain('width: 0%');
  });

  it('clamps NaN to 0% (defensive — no crash)', () => {
    const { container } = render(<ProgressBar value={Number.NaN} label="X" />);
    const fill = container.querySelector('[role="progressbar"] > div');
    expect(fill?.getAttribute('style')).toContain('width: 0%');
  });

  it('applies the tone fill class (emerald)', () => {
    const { container } = render(
      <ProgressBar value={0.5} label="X" tone="emerald" />,
    );
    const fill = container.querySelector('[role="progressbar"] > div');
    expect(fill?.className).toContain('bg-emerald-500');
  });
});
