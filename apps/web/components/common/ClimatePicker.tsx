/**
 * ClimatePicker — GAP-17 (DR-11) Phase 4: the climate + species selection modal.
 *
 * Launched from the New Game button. The player picks a Köppen climate zone
 * (catalog grouped by class: Tropical / Arid / Temperate / Continental / Polar),
 * then a tree species native to that zone (`findSpeciesByKoppenCode` — the
 * "right tree for the right climate" query). Each climate entry shows its
 * realistic profile (Köppen code + name, exemplar region from the description,
 * seasonal temp range, annual precipitation + pattern, seasonality, frost/heat
 * risk, treeSuitabilityNote) + its native species list. EF (no trees) is
 * clearly marked unplayable-for-trees.
 *
 * An optional Highland elevation slider (0–4000 m) overlays the lapse-rate
 * modifier (`applyHighlandModifier`, 6.5 °C/km) on the selected zone with a
 * LIVE preview of the adjusted seasonal temperatures + which native species
 * survive the shifted climate. The elevation is persisted as
 * `config.elevationM` + wired into the WeatherSystem, so a highland game is
 * genuinely colder at altitude (not a cosmetic preview).
 *
 * Rule 6 (TDD §15.1): the picker writes nothing to the store itself — it calls
 * `onSubmit({ climateId, speciesId, elevationM })` and the caller routes that
 * through `loop.newGame(config)`. The default remains Dfb + White Oak.
 *
 * §7 UX rule: "the climate must not lie to the player" — a hostile climate
 * shows a struggling tree in play (Phase 3 wiring), + the picker's survival
 * preview makes the hostility visible up front.
 */
'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type ReactElement,
} from 'react';
import {
  ALL_CLIMATES,
  findSpeciesByKoppenCode,
  applyHighlandModifier,
  HIGHLAND_LAPSE_RATE_C_PER_KM,
} from '@capitalist-tree/content';
import type { ClimateBaseline, TreeSpecies } from '@capitalist-tree/shared';
import { DEFAULT_GAME_CONFIG, computeSpeciesClimateSuitability } from '@capitalist-tree/simulation';
import { Button } from './Button';

// ----------------------------------------------------------------------------
// Pure helpers.
// ----------------------------------------------------------------------------

/** Köppen classes in display order (H is the highland modifier, not a group). */
const CLASS_ORDER = ['A', 'B', 'C', 'D', 'E'] as const;
type KoppenClass = (typeof CLASS_ORDER)[number];

const CLASS_LABEL: Readonly<Record<KoppenClass, string>> = Object.freeze({
  A: 'Tropical',
  B: 'Arid',
  C: 'Temperate',
  D: 'Continental',
  E: 'Polar',
});

const SEASONS = ['spring', 'summer', 'autumn', 'winter'] as const;

/** Group the climate catalog by Köppen class, in display order. Pure. */
function groupByClass(
  climates: readonly ClimateBaseline[],
): ReadonlyArray<readonly [KoppenClass, readonly ClimateBaseline[]]> {
  return CLASS_ORDER.map((cls) => [
    cls,
    climates.filter((c) => c.koppenClass === cls),
  ] as const);
}

/** Round a temperature to 1 decimal, guarding NaN. Pure. */
function fmtTemp(c: number): string {
  return Number.isFinite(c) ? `${c.toFixed(1)}°C` : '—';
}

/**
 * Does a species survive a (possibly highland-adjusted) climate? It tolerates
 * the coldest month (winter ≥ minimum) AND the hottest (summer ≤ maximum).
 * Pure — used for the highland live preview's survival badges.
 */
function speciesSurvives(species: TreeSpecies, climate: ClimateBaseline): boolean {
  const winter = climate.seasonalBaseTemp.winter;
  const summer = climate.seasonalBaseTemp.summer;
  return winter >= species.temperatureRange.minimum && summer <= species.temperatureRange.maximum;
}

// ----------------------------------------------------------------------------
// Selection type.
// ----------------------------------------------------------------------------

export interface ClimatePickerSelection {
  readonly climateId: string;
  readonly speciesId: string;
  readonly elevationM: number;
}

export interface ClimatePickerProps {
  /** Whether the modal is open. */
  readonly open: boolean;
  /** Dismiss without starting (Escape / Cancel / backdrop). */
  readonly onClose: () => void;
  /** Start the game with the selection. */
  readonly onSubmit: (selection: ClimatePickerSelection) => void;
}

// ----------------------------------------------------------------------------
// Sub-components (pure render of a climate card + a species card).
// ----------------------------------------------------------------------------

function ClimateCard({
  climate,
  selected,
  onSelect,
}: {
  climate: ClimateBaseline;
  selected: boolean;
  onSelect: () => void;
}): ReactElement {
  const isDefault = climate.id === DEFAULT_GAME_CONFIG.climateId;
  const winter = climate.seasonalBaseTemp.winter;
  const summer = climate.seasonalBaseTemp.summer;
  const nativeCount = findSpeciesByKoppenCode(climate.koppenCode).length;
  return (
    <button
      type="button"
      onClick={onSelect}
      data-testid={`climate-card-${climate.id}`}
      aria-pressed={selected}
      className={[
        'flex w-full flex-col gap-1 rounded border p-2 text-left transition-colors',
        selected
          ? 'border-emerald-500 bg-emerald-500/10'
          : 'border-slate-700 bg-slate-900 hover:border-slate-600 hover:bg-slate-800',
      ].join(' ')}
    >
      <span className="flex items-center gap-1.5">
        <span className="font-mono text-xs font-semibold text-sky-300">{climate.koppenCode}</span>
        <span className="text-sm font-medium text-slate-100">{climate.name}</span>
        {isDefault ? (
          <span className="ml-auto rounded bg-slate-700 px-1 text-[10px] uppercase tracking-wide text-slate-300">
            default
          </span>
        ) : null}
      </span>
      <span className="text-xs text-slate-400 tabular-nums">
        {fmtTemp(winter)} → {fmtTemp(summer)} · {climate.precipitation.annualMm} mm/yr
      </span>
      <span className="text-xs text-slate-500">
        {climate.supportsTrees
          ? `${nativeCount} native species`
          : 'No trees — unplayable'}
      </span>
    </button>
  );
}

function SpeciesCard({
  species,
  selected,
  survives,
  showSurvival,
  suitability,
  onSelect,
}: {
  species: TreeSpecies;
  selected: boolean;
  survives: boolean;
  showSurvival: boolean;
  /** GAP-17 Phase 5: 0-1 climate-suitability score (the "right tree" lever). */
  suitability: number;
  onSelect: () => void;
}): ReactElement {
  const r = species.temperatureRange;
  const fitPct = Math.round(suitability * 100);
  // The fit badge colour signals the lever: green ≥ 0.7, amber 0.4–0.7, rose < 0.4.
  const fitTone =
    suitability >= 0.7 ? 'text-emerald-300' : suitability >= 0.4 ? 'text-amber-300' : 'text-rose-300';
  return (
    <button
      type="button"
      onClick={onSelect}
      data-testid={`species-card-${species.id}`}
      aria-pressed={selected}
      className={[
        'flex w-full flex-col gap-1 rounded border p-2 text-left transition-colors',
        selected
          ? 'border-emerald-500 bg-emerald-500/10'
          : 'border-slate-700 bg-slate-900 hover:border-slate-600 hover:bg-slate-800',
      ].join(' ')}
    >
      <span className="flex items-center gap-1.5">
        <span className="text-sm font-medium text-slate-100">{species.name}</span>
        <span className={`ml-auto text-xs tabular-nums ${fitTone}`} data-testid={`species-fit-${species.id}`}>
          fit {fitPct}%
        </span>
        {showSurvival ? (
          <span className={`text-xs ${survives ? 'text-emerald-300' : 'text-rose-300'}`}>
            {survives ? '✓ survives' : '✗ won’t survive'}
          </span>
        ) : null}
      </span>
      {species.scientificName ? (
        <span className="text-xs italic text-slate-500">{species.scientificName}</span>
      ) : null}
      <span className="text-xs text-slate-400 tabular-nums">
        {species.deciduous ? 'Deciduous' : 'Evergreen'} · {fmtTemp(r.minimum)}–{fmtTemp(r.maximum)}
      </span>
    </button>
  );
}

// ----------------------------------------------------------------------------
// Modal.
// ----------------------------------------------------------------------------

/**
 * Render the ClimatePicker modal. Returns null when `open` is false. The
 * caller owns the `onSubmit`/`onClose` routing (rule 6 — no store writes here).
 */
export function ClimatePicker({ open, onClose, onSubmit }: ClimatePickerProps): ReactElement | null {
  // Default to the warm-Dfb temperate zone + White Oak (the existing default).
  const [climateId, setClimateId] = useState<string>(DEFAULT_GAME_CONFIG.climateId);
  const [speciesId, setSpeciesId] = useState<string>(DEFAULT_GAME_CONFIG.speciesId);
  const [highlandEnabled, setHighlandEnabled] = useState<boolean>(false);
  const [elevationM, setElevationM] = useState<number>(0);

  const dialogRef = useRef<HTMLDivElement>(null);
  const startRef = useRef<HTMLButtonElement>(null);

  // Escape dismisses; autofocus the Start button when the modal opens.
  useEffect(() => {
    if (!open) return;
    startRef.current?.focus();
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'Tab') {
        const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        );
        if (!focusable || focusable.length === 0) return;
        const first = focusable[0]!;
        const last = focusable[focusable.length - 1]!;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const selectedClimate = useMemo(
    () => ALL_CLIMATES.find((c) => c.id === climateId),
    [climateId],
  );

  const nativeSpecies = useMemo<readonly TreeSpecies[]>(
    () => (selectedClimate ? findSpeciesByKoppenCode(selectedClimate.koppenCode) : []),
    [selectedClimate],
  );

  // The effective climate = base + highland modifier (lapse rate) when enabled.
  const effectiveClimate = useMemo<ClimateBaseline | null>(() => {
    if (!selectedClimate) return null;
    if (highlandEnabled && elevationM > 0) {
      return applyHighlandModifier(selectedClimate, elevationM);
    }
    return selectedClimate;
  }, [selectedClimate, highlandEnabled, elevationM]);

  // When the climate changes, reset the species to the first native one (or
  // clear it if the zone supports no trees). Keeps the selection valid.
  const onSelectClimate = useCallback((id: string) => {
    setClimateId(id);
    const next = ALL_CLIMATES.find((c) => c.id === id);
    const natives = next ? findSpeciesByKoppenCode(next.koppenCode) : [];
    setSpeciesId(natives.length > 0 ? natives[0]!.id : '');
  }, []);

  const onElevationChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const v = Number(e.target.value);
    setElevationM(Number.isFinite(v) ? Math.max(0, Math.min(4000, Math.round(v))) : 0);
  }, []);

  const canStart = selectedClimate !== undefined && speciesId !== '' && nativeSpecies.some((s) => s.id === speciesId);

  const onConfirm = useCallback(() => {
    if (!canStart) return;
    onSubmit({ climateId, speciesId, elevationM: highlandEnabled ? elevationM : 0 });
  }, [canStart, climateId, speciesId, highlandEnabled, elevationM, onSubmit]);

  if (!open || !selectedClimate || !effectiveClimate) return null;

  const grouped = groupByClass(ALL_CLIMATES);
  const drop = highlandEnabled && elevationM > 0 ? (elevationM / 1000) * HIGHLAND_LAPSE_RATE_C_PER_KM : 0;
  const selectedSpecies = nativeSpecies.find((s) => s.id === speciesId);

  return (
    <div
      className="pointer-events-auto fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="climate-picker-title"
      data-testid="climate-picker"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-lg border border-slate-700 bg-slate-900 p-6 shadow-2xl"
      >
        {/* Header. */}
        <header className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 id="climate-picker-title" className="text-lg font-semibold text-slate-100">
              Choose your climate + tree
            </h2>
            <p className="text-sm text-slate-400">
              The Köppen zone sets the weather, water, + temperature your tree faces. Pick a
              climate, then a species native to it.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded border border-slate-700 px-2 py-0.5 text-slate-400 hover:bg-slate-800"
            data-testid="climate-picker-close"
          >
            ✕
          </button>
        </header>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {/* Left: climate catalog grouped by class. */}
          <section className="flex flex-col gap-3" data-testid="climate-picker-catalog">
            {grouped.map(([cls, climates]) => (
              <div key={cls}>
                <h3 className="mb-1 text-xs uppercase tracking-wider text-slate-500">
                  {CLASS_LABEL[cls]} <span className="text-slate-600">({climates.length})</span>
                </h3>
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                  {climates.map((c) => (
                    <ClimateCard
                      key={c.id}
                      climate={c}
                      selected={c.id === climateId}
                      onSelect={() => onSelectClimate(c.id)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </section>

          {/* Right: selected climate profile + species + highland. */}
          <section className="flex flex-col gap-3">
            {/* Profile. */}
            <div className="rounded border border-slate-800 bg-slate-950/40 p-3" data-testid="climate-picker-profile">
              <div className="mb-1 flex items-center gap-2">
                <span className="font-mono text-sm font-semibold text-sky-300">
                  {selectedClimate.koppenCode}
                </span>
                <span className="text-sm font-medium text-slate-100">{selectedClimate.name}</span>
              </div>
              <p className="mb-2 text-xs text-slate-400">{selectedClimate.description}</p>
              <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs tabular-nums">
                <dt className="text-slate-500">Spring</dt>
                <dd className="text-slate-300">{fmtTemp(effectiveClimate.seasonalBaseTemp.spring)}</dd>
                <dt className="text-slate-500">Summer</dt>
                <dd className="text-slate-300">{fmtTemp(effectiveClimate.seasonalBaseTemp.summer)}</dd>
                <dt className="text-slate-500">Autumn</dt>
                <dd className="text-slate-300">{fmtTemp(effectiveClimate.seasonalBaseTemp.autumn)}</dd>
                <dt className="text-slate-500">Winter</dt>
                <dd className="text-slate-300">{fmtTemp(effectiveClimate.seasonalBaseTemp.winter)}</dd>
                <dt className="text-slate-500">Precipitation</dt>
                <dd className="text-slate-300">
                  {effectiveClimate.precipitation.annualMm} mm/yr ({effectiveClimate.precipitation.pattern})
                </dd>
                <dt className="text-slate-500">Seasonality</dt>
                <dd className="text-slate-300">{effectiveClimate.seasonality}</dd>
                <dt className="text-slate-500">Frost risk</dt>
                <dd className="text-slate-300">{effectiveClimate.frostRisk}</dd>
                <dt className="text-slate-500">Heat risk</dt>
                <dd className="text-slate-300">{effectiveClimate.heatStressRisk}</dd>
              </dl>
              <p className="mt-2 text-xs text-amber-200/90" data-testid="climate-picker-suitability">
                {effectiveClimate.treeSuitabilityNote}
              </p>
              {highlandEnabled && elevationM > 0 ? (
                <p className="mt-1 text-xs text-sky-300" data-testid="climate-picker-highland-preview">
                  Highland −{drop.toFixed(1)}°C at {elevationM} m (lapse rate {HIGHLAND_LAPSE_RATE_C_PER_KM} °C/km)
                  {effectiveClimate.frostRisk !== selectedClimate.frostRisk
                    ? ` · frost risk bumped to ${effectiveClimate.frostRisk}`
                    : ''}
                </p>
              ) : null}
            </div>

            {/* Species. */}
            <div data-testid="climate-picker-species">
              <h3 className="mb-1 text-xs uppercase tracking-wider text-slate-500">
                Native species {!selectedClimate.supportsTrees ? '(none — unplayable)' : `(${nativeSpecies.length})`}
              </h3>
              {nativeSpecies.length === 0 ? (
                <p className="rounded border border-rose-800/60 bg-rose-900/20 p-2 text-xs text-rose-300">
                  No tree species survives this climate. Choose another zone to start a game.
                </p>
              ) : (
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                  {nativeSpecies.map((s) => (
                    <SpeciesCard
                      key={s.id}
                      species={s}
                      selected={s.id === speciesId}
                      survives={speciesSurvives(s, effectiveClimate)}
                      showSurvival={highlandEnabled && elevationM > 0}
                      suitability={computeSpeciesClimateSuitability(s, effectiveClimate)}
                      onSelect={() => setSpeciesId(s.id)}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* Highland elevation slider. */}
            <div className="rounded border border-slate-800 bg-slate-950/40 p-3" data-testid="climate-picker-highland">
              <label className="flex items-center gap-2 text-sm text-slate-200">
                <input
                  type="checkbox"
                  checked={highlandEnabled}
                  onChange={(e) => setHighlandEnabled(e.target.checked)}
                  data-testid="climate-picker-highland-toggle"
                />
                Highland elevation modifier
              </label>
              {highlandEnabled ? (
                <div className="mt-2">
                  <div className="flex items-center justify-between text-xs text-slate-400 tabular-nums">
                    <span>Elevation</span>
                    <span data-testid="climate-picker-elevation-value">{elevationM} m</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={4000}
                    step={100}
                    value={elevationM}
                    onChange={onElevationChange}
                    className="mt-1 w-full"
                    data-testid="climate-picker-elevation-slider"
                  />
                  <p className="mt-1 text-xs text-slate-500">
                    Temperature drops {HIGHLAND_LAPSE_RATE_C_PER_KM} °C per km of altitude. The live
                    preview above shows the adjusted seasonal temps + which species survive.
                  </p>
                </div>
              ) : null}
            </div>
          </section>
        </div>

        {/* Footer. */}
        <footer className="mt-4 flex items-center justify-between gap-2 border-t border-slate-800 pt-3">
          <p className="text-xs text-slate-500" data-testid="climate-picker-footer-summary">
            {selectedSpecies
              ? `Starting: ${selectedClimate.koppenCode} — ${selectedSpecies.name} · fit ${Math.round(computeSpeciesClimateSuitability(selectedSpecies, effectiveClimate) * 100)}%`
              : 'Select a climate + species to start.'}
          </p>
          <div className="flex gap-2">
            <Button onClick={onClose} data-testid="climate-picker-cancel">
              Cancel
            </Button>
            <Button
              ref={startRef}
              tone="active"
              onClick={onConfirm}
              disabled={!canStart}
              data-testid="climate-picker-start"
            >
              🌱 Start Game
            </Button>
          </div>
        </footer>
      </div>
    </div>
  );
}
