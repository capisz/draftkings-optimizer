const path = require("path");

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Pin the workspace root so a stray lockfile higher up the tree doesn't
  // confuse Next's file-tracing on build/deploy.
  outputFileTracingRoot: __dirname,
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
};

module.exports = nextConfig;
