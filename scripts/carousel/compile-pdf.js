#!/usr/bin/env node
/**
 * DeckCreate — Carousel PDF Compiler
 * Usage: npm run carousel:pdf -- --carousel <id>
 *
 * Compiles generated carousel slides into a single PDF.
 */

import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import CarouselGenerator from './CarouselGenerator.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cwd = path.join(__dirname, '..', '..');

async function compilePdf(carouselId) {
  const carouselDir = path.join(cwd, 'public', 'carousel', carouselId);
  const configPath = path.join(carouselDir, 'carousel-config.json');

  if (!await fs.pathExists(configPath)) {
    console.error(`✗ Config not found: ${configPath}`);
    console.error('Run carousel:wizard first to generate slides.');
    process.exit(1);
  }

  const config = await fs.readJson(configPath);
  const outputDir = path.join(cwd, 'public', 'output', config.name);

  if (!await fs.pathExists(outputDir)) {
    console.error(`✗ Output directory not found: ${outputDir}`);
    console.error('Run carousel:wizard first to generate slides.');
    process.exit(1);
  }

  // Count regular slides (exclude CTA slide from count)
  const slideFiles = await fs.readdir(outputDir).then(files =>
    files.filter(f => f.startsWith('slide-') && f.endsWith('.png') && !f.includes('cta'))
  );

  if (slideFiles.length === 0) {
    console.error('✗ No slides found to compile');
    process.exit(1);
  }

  console.log(`📄 Compiling PDF for ${carouselId}...`);
  console.log(`   Found ${slideFiles.length} slides + CTA`);

  const generator = new CarouselGenerator(config);
  generator.outputDir = outputDir;

  try {
    await generator.generatePdf(slideFiles.length);
    console.log(`✓ PDF compiled successfully`);
  } catch (error) {
    console.error(`✗ PDF compilation failed: ${error.message}`);
    process.exit(1);
  }
}

// CLI entry point
const args = process.argv.slice(2);
let carouselId = null;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--carousel' && args[i + 1]) {
    carouselId = args[i + 1];
    i++;
  }
}

// If no carousel ID provided, try to auto-detect from existing carousels
if (!carouselId) {
  const carouselDir = path.join(cwd, 'public', 'carousel');
  if (await fs.pathExists(carouselDir)) {
    const entries = await fs.readdir(carouselDir, { withFileTypes: true });
    const carousels = entries.filter(e => e.isDirectory()).map(e => e.name);

    if (carousels.length === 1) {
      carouselId = carousels[0];
      console.log(`Auto-detected carousel: ${carouselId}`);
    } else if (carousels.length > 1) {
      console.log('Multiple carousels found. Please specify one with --carousel <id>');
      console.log('Available carousels:');
      carousels.forEach(id => console.log(`  - ${id}`));
      process.exit(1);
    } else {
      console.error('No carousels found. Run carousel:wizard first.');
      process.exit(1);
    }
  } else {
    console.error('Carousel directory not found. Run carousel:wizard first.');
    process.exit(1);
  }
}

compilePdf(carouselId);
