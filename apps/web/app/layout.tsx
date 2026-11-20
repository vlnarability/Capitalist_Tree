import type { Metadata } from 'next';
import './globals.css';
import { ErrorBoundary } from '../components/common/index.js';
import { ConcurrentTabGate } from '../components/common/ConcurrentTabGate';

export const metadata: Metadata = {
  title: 'The Capitalist Tree',
  description: 'P0 Foundation — simulation clock, speed control, save/load.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen font-sans">
        {/* P11 (W21 / RV5-F4): concurrent-tab gate. Acquires an exclusive Web
            Lock so a second tab is blocked from mounting the game (protecting
            the save from a two-tabs-clobber race). Renders the children only
            when this tab holds the lock (or when navigator.locks is
            unavailable — graceful fallback). BLOCK approach (review later). */}
        <ConcurrentTabGate>
          {/* P11-F (GAP-34): top-level error boundary. Catches uncaught render
              errors anywhere in the app tree and shows a recoverable fallback
              (reload rehydrates from IndexedDB) instead of a blank page. */}
          <ErrorBoundary>{children}</ErrorBoundary>
        </ConcurrentTabGate>
      </body>
    </html>
  );
}
