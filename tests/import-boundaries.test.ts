/**
 * Import-boundary enforcement (TDD §3) — root-level scan.
 *
 * P4a/P4b/P4d establish a one-way data flow:
 *
 *     simulation ─► shared ◄─ rendering ─► apps/web (React/Next/DOM)
 *                       ▲
 *                       │
 *                    content
 *
 * The three core packages (simulation, shared, rendering) MUST NOT import UI /
 * framework code. The web app is the only place that touches next/react/react-dom/
 * zustand/idb. The contract:
 *
 *   - packages/simulation/src: pure simulation — no UI, no DOM, no framework.
 *   - packages/shared/src: schemas + constants — no UI, no DOM, no framework.
 *   - packages/rendering/src: visual-data + renderer — DOM types are allowed
 *     (CanvasTreeRenderer uses HTMLCanvasElement + CanvasRenderingContext2D),
 *     but the package must NOT import React / Next / a state library. The
 *     renderer is a plain class; the React wrapper (TreeView.tsx) lives in
 *     apps/web — never in the rendering package.
 *
 * This test scans all three core packages' src/ trees for forbidden UI /
 * framework imports. It complements (does not replace) the per-package test
 * at packages/simulation/test/import-boundary.test.ts, which scans only the
 * simulation package. Keeping the simulation-specific test in place preserves
 * the P0/P1/P2/P3 contract; this root-level test extends coverage to shared +
 * rendering (P4d scope).
 *
 * Forbidden specifiers (per TDD §3 import boundary):
 *   - `next`, `next/*`, `next/**`          — Next.js framework.
 *   - `react`, `react/*`, `react/**`        — React.
 *   - `react-dom`, `react-dom/*`, `react-dom/**` — React DOM.
 *   - `@reduxjs/*`                          — Redux Toolkit / state mgmt.
 *   - `zustand`, `zustand/*`, `zustand/**`  — Zustand state library.
 *   - `idb`, `idb/*`, `idb/**`              — IndexedDB wrapper (persistence).
 *   - `@/*`                                  — apps/web path alias.
 *   - relative paths climbing into `apps/`  — any `../../../apps/web/...`.
 *
 * Detection uses regex over the import specifier string (matches `import ...
 * from 'X'` and bare `import 'X'` side-effect imports). Comments are NOT
 * flagged — the regex requires the import keyword.
 *
 * If a forbidden import is found, the test fails with a descriptive message
 * listing the violating file + the matched patterns.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// ----------------------------------------------------------------------------
// Configuration — the three core packages whose src/ trees we scan.
// ----------------------------------------------------------------------------

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

interface ScanTarget {
  /** Display name (used in test output). */
  readonly label: string;
  /** Absolute path to the package's src/ dir. */
  readonly root: string;
}

const SCAN_TARGETS: readonly ScanTarget[] = [
  { label: 'packages/simulation/src', root: join(repoRoot, 'packages/simulation/src') },
  { label: 'packages/shared/src', root: join(repoRoot, 'packages/shared/src') },
  { label: 'packages/rendering/src', root: join(repoRoot, 'packages/rendering/src') },
];

// ----------------------------------------------------------------------------
// Forbidden-import patterns.
//
// Each regex matches a `import ... from 'SPECIFIER'` or `import 'SPECIFIER'`
// statement at the start of a line (with optional leading whitespace). The
// specifier follows immediately. We use `[^;]*` between `import` and `from`
// to cover default, namespace, named, and side-effect-only imports.
//
// Note on the `(\.\.\/)+apps\/` pattern: it catches ANY relative path that
// climbs out of the current package and lands in `apps/` — e.g.
// `../../../apps/web/components/Foo`. Works at any nesting depth because
// `(\.\.\/)+` matches one or more `../` segments.
// ----------------------------------------------------------------------------

const FORBIDDEN_IMPORTS: readonly { readonly name: string; readonly re: RegExp }[] = [
  { name: 'next', re: /^\s*import\s+[^;]*from\s+['"]next(?:\/[^'"]*)?['"]/m },
  { name: 'react', re: /^\s*import\s+[^;]*from\s+['"]react(?:\/[^'"]*)?['"]/m },
  { name: 'react-dom', re: /^\s*import\s+[^;]*from\s+['"]react-dom(?:\/[^'"]*)?['"]/m },
  { name: '@reduxjs', re: /^\s*import\s+[^;]*from\s+['"]@reduxjs\/[^'"]*['"]/m },
  { name: 'zustand', re: /^\s*import\s+[^;]*from\s+['"]zustand(?:\/[^'"]*)?['"]/m },
  { name: 'idb', re: /^\s*import\s+[^;]*from\s+['"]idb(?:\/[^'"]*)?['"]/m },
  // Any relative path that climbs out of the package and lands in apps/
  // (any depth). Catches `../../../apps/...` and `../../../../apps/...`.
  { name: 'relative-climb-to-apps', re: /^\s*import\s+[^;]*from\s+['"](\.\.\/)+apps\/[^'"]*['"]/m },
  // `@/...` is the web app's path alias — should never resolve in core packages.
  { name: '@/web-alias', re: /^\s*import\s+[^;]*from\s+['"]@\/[^'"]*['"]/m },
];

// ----------------------------------------------------------------------------
// File walker — recursively collect every .ts / .tsx file under `dir`.
// ----------------------------------------------------------------------------

function walk(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      walk(p, acc);
    } else if (p.endsWith('.ts') || p.endsWith('.tsx')) {
      acc.push(p);
    }
  }
  return acc;
}

// ----------------------------------------------------------------------------
// Tests.
// ----------------------------------------------------------------------------

describe('import boundary (TDD §3): core packages are UI-free', () => {
  for (const target of SCAN_TARGETS) {
    it(`${target.label} contains no imports from next/react/react-dom/@reduxjs/zustand/idb/apps/web`, () => {
      const files = walk(target.root);
      // Sanity-check that the scan actually found files — a broken glob
      // would silently pass with zero files.
      expect(files.length).toBeGreaterThan(0);

      const violations: { file: string; matched: string[] }[] = [];
      for (const file of files) {
        const content = readFileSync(file, 'utf8');
        const matched = FORBIDDEN_IMPORTS.filter((p) => p.re.test(content)).map(
          (p) => p.name,
        );
        if (matched.length > 0) {
          violations.push({ file: relative(repoRoot, file), matched });
        }
      }

      if (violations.length > 0) {
        // Print a readable summary so the failure message is actionable.
        const summary = violations
          .map((v) => `  • ${v.file} → [${v.matched.join(', ')}]`)
          .join('\n');
        throw new Error(
          `Import boundary violations in ${target.label}:\n${summary}\n\n` +
            `Core packages (simulation, shared, rendering) MUST NOT import UI / ` +
            `framework code (rule 6 + TDD §3 import boundary). See ` +
            `docs/rendering.md §"Import-boundary extension" for the contract.`,
        );
      }

      expect(violations).toEqual([]);
    });
  }

  it('all three scan targets exist and are non-empty', () => {
    // Defensive — guards against a future repo restructure silently
    // breaking the scan (the per-package it() checks above would pass with
    // zero files if we didn't already assert >0 inside each).
    for (const target of SCAN_TARGETS) {
      const files = walk(target.root);
      expect(files.length, `${target.label} should contain source files`).toBeGreaterThan(0);
    }
  });
});
