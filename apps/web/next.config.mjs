/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Transpile workspace packages so the dev server can read their TS source.
  transpilePackages: ['@capitalist-tree/shared', '@capitalist-tree/simulation'],
  experimental: {
    // Workspace packages are TS source; external-resolver makes next treat
    // them as part of the app rather than pre-built node_modules.
    externalDir: true,
  },
};

export default nextConfig;
