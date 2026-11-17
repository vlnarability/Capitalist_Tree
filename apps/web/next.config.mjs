/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Transpile workspace packages so the dev server can read their TS source.
  transpilePackages: [
    '@capitalist-tree/shared',
    '@capitalist-tree/simulation',
    '@capitalist-tree/content',
    '@capitalist-tree/rendering',
  ],
  webpack: (config) => {
    // Workspace packages are authored in TypeScript ESM and use `.js`
    // extension imports (Node ESM convention). Webpack needs to be told
    // that those `.js` specifiers should also resolve to `.ts`/`.tsx` files.
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias ?? {}),
      '.js': ['.ts', '.tsx', '.js'],
      '.mjs': ['.mts', '.ts', '.mjs', '.js'],
    };
    return config;
  },
  experimental: {
    externalDir: true,
  },
  // P11 (W30 / GAP-38): security headers. Closes the missing-headers gap
  // (X-Content-Type-Options, X-Frame-Options, CSP) noted in the review. The
  // CSP is permissive enough for Next.js (inline styles/scripts + eval for
  // dev, blob: for the canvas renderer + Web Worker) while blocking
  // external scripts/object/embed/connect-src by default.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-XSS-Protection', value: '1; mode=block' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              // Next.js inline styles + the canvas renderer need style-src.
              "style-src 'self' 'unsafe-inline'",
              // Next.js inline scripts (hydration) + the Web Worker blob.
              "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:",
              // Canvas rendering produces blob: images.
              "img-src 'self' data: blob:",
              // Web Worker spawn via blob: URL.
              "worker-src 'self' blob:",
              "connect-src 'self'",
              "font-src 'self'",
              "object-src 'none'",
              "base-uri 'self'",
              "frame-ancestors 'none'",
            ].join('; '),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
