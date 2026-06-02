/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: { allowedOrigins: ['*'] },
    // Tell Next.js not to bundle these — they're server-only Node packages
    // that ship resources (e.g. pdfkit's .afm font files) which the webpack
    // bundler can't follow. With this set, they get loaded via Node's
    // normal require() at runtime instead.
    serverComponentsExternalPackages: ['pdfkit', 'exceljs'],
  },
  typescript: { ignoreBuildErrors: true },
  eslint: { ignoreDuringBuilds: true },
}

module.exports = nextConfig
