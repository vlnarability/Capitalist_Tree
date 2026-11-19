/**
 * Common components barrel (P5b).
 *
 * Re-exports the presentational primitives used by the dashboard +
 * main page. Each component is pure (no store subscription, no engine
 * calls) so the dashboard composition stays declarative. The ErrorBoundary
 * (P11-F / GAP-34) is the one exception — it is a class component with
 * state, but it still makes no store/engine calls.
 */
export { Panel, type PanelProps } from './Panel';
export { Button, type ButtonProps, type ButtonTone } from './Button';
export { Stat, type StatProps } from './Stat';
export { ProgressBar, type ProgressBarProps } from './ProgressBar';
export { ErrorBoundary } from './ErrorBoundary';
export { ClimatePicker, type ClimatePickerProps, type ClimatePickerSelection } from './ClimatePicker';
