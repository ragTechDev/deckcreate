import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  serverExternalPackages: [
    'pdfkit',
    'fontkit',
    'puppeteer',
    'sharp',
    'fs-extra',
  ],
  turbopack: {
    root: path.resolve(__dirname),
  },
};

export default nextConfig;
