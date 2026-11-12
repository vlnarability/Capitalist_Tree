/**
 * Common components barrel (P5b).
 *
 * Re-exports the presentational primitives used by the dashboard +
 * main page. Each component is pure (no store subscription, no engine
 * calls) so the dashboard composition stays declarative.
 */
export { Panel, type PanelProps } from './Panel';
export { Button, type ButtonProps, type ButtonTone } from './Button';
export { Stat, type StatProps } from './Stat';
export { ProgressBar, type ProgressBarProps } from './ProgressBar';
