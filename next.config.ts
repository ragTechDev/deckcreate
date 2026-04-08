import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  serverExternalPackages: [
    'pdfkit',
    'fontkit',
    'puppeteer',
    'puppeteer-core',
    'puppeteer-extra',
    'puppeteer-extra-plugin',
    'puppeteer-extra-plugin-stealth',
    '@sparticuz/chromium-min',
    'clone-deep',
    'merge-deep',
    'is-plain-object',
    'sharp',
    'fs-extra',
  ],
  turbopack: {
    root: path.resolve(__dirname),
  },
};

export default nextConfig;
