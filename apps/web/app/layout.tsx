import type { Metadata } from 'next';
import './globals.css';

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
      <body className="min-h-screen font-sans">{children}</body>
    </html>
  );
}
