import type { Metadata } from 'next';
import './globals.css';
import { ErrorBoundary } from '../components/common/index.js';

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
        {/* P11-F (GAP-34): top-level error boundary. Catches uncaught render
            errors anywhere in the app tree and shows a recoverable fallback
            (reload rehydrates from IndexedDB) instead of a blank page. */}
        <ErrorBoundary>{children}</ErrorBoundary>
      </body>
    </html>
  );
}
