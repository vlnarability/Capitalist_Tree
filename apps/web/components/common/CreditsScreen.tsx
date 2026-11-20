/**
 * CreditsScreen — renders the art + audio credits (P13-C — GDD §13 UI).
 *
 * Lists every external asset wired into the build (from
 * `@capitalist-tree/content` `CREDITS`), with its slot, title, author, license,
 * + a link to the source page. CC-BY attribution lines are rendered separately
 * so they're visible at a glance. Purely presentational — reads the static
 * `CREDITS` const, no store subscription, no engine calls (rule 6).
 *
 * Driven by `packages/content/src/credits` so adding an asset there automatically
 * appears here + on the Credits screen.
 */
import type { ReactElement } from 'react';
import { CREDITS, ATTRIBUTION_LINES } from '@capitalist-tree/content';

/** A small license badge — colour-coded by license type. */
function LicenseBadge({ license }: { license: 'CC0' | 'CC-BY' | 'CC-BY-SA' }): ReactElement {
  const tone =
    license === 'CC0'
      ? 'bg-emerald-900/60 text-emerald-300 ring-emerald-700'
      : license === 'CC-BY'
        ? 'bg-sky-900/60 text-sky-300 ring-sky-700'
        : 'bg-amber-900/60 text-amber-300 ring-amber-700';
  return (
    <span
      className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold ring-1 ${tone}`}
    >
      {license}
    </span>
  );
}

/**
 * Render the credits screen. Pure presentational component.
 *
 * @example
 *   <CreditsScreen />
 */
export function CreditsScreen(): ReactElement {
  const art = CREDITS.filter((c) => c.category === 'art');
  const audio = CREDITS.filter((c) => c.category === 'audio');

  return (
    <section className="flex flex-col gap-4 rounded-lg border border-slate-800 bg-slate-900/60 p-4">
      <header className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold text-slate-100">Credits — Artwork &amp; Audio</h2>
        <p className="text-xs text-slate-400">
          All artwork + audio is from free, public-domain, or free-use sources (CC0 / CC-BY).
          No AI-generated art. Full provenance + license verification in{' '}
          <code className="text-slate-300">docs/credits.md</code>.
        </p>
      </header>

      <div className="flex flex-col gap-3">
        <h3 className="text-xs uppercase tracking-wider text-slate-500">Artwork</h3>
        <ul className="flex flex-col gap-2">
          {art.map((c) => (
            <li key={c.file} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm">
              <span className="font-medium text-slate-200">{c.slot}</span>
              <span className="text-slate-400">— {c.title}</span>
              <span className="text-slate-500">by {c.author}</span>
              <LicenseBadge license={c.license} />
              <a
                href={c.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[11px] text-sky-400 hover:text-sky-300 underline-offset-2 hover:underline"
              >
                source
              </a>
            </li>
          ))}
        </ul>
      </div>

      <div className="flex flex-col gap-3">
        <h3 className="text-xs uppercase tracking-wider text-slate-500">Audio</h3>
        <ul className="flex flex-col gap-2">
          {audio.map((c) => (
            <li key={c.file} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm">
              <span className="font-medium text-slate-200">{c.slot}</span>
              <span className="text-slate-400">— {c.title}</span>
              <span className="text-slate-500">by {c.author}</span>
              <LicenseBadge license={c.license} />
              <a
                href={c.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[11px] text-sky-400 hover:text-sky-300 underline-offset-2 hover:underline"
              >
                source
              </a>
            </li>
          ))}
        </ul>
      </div>

      {ATTRIBUTION_LINES.length > 0 ? (
        <div className="flex flex-col gap-1 rounded border border-slate-800 bg-slate-950/40 p-3">
          <h3 className="text-xs uppercase tracking-wider text-slate-500">
            Attribution (required by license)
          </h3>
          <ul className="flex flex-col gap-1 text-xs text-slate-300">
            {ATTRIBUTION_LINES.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
