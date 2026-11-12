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
};

export default nextConfig;
