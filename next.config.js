/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: { allowedOrigins: ['*'] },
    // `exceljs` is a server-only Node package that we don't want webpack
    // bundling. It's loaded via Node's normal require() at runtime instead.
    // (`pdf-lib` is pure JS and bundles fine, so it's not listed here.)
    serverComponentsExternalPackages: ['exceljs'],
  },
  typescript: { ignoreBuildErrors: true },
  eslint: { ignoreDuringBuilds: true },
}

module.exports = nextConfig
