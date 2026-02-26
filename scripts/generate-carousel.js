#!/usr/bin/env node

import fs from 'fs-extra';
import path from 'path';
import CarouselGenerator from './CarouselGenerator.js';

async function main() {
  const args = process.argv.slice(2);
  const isBulk = args.includes('--bulk');

  if (isBulk) {
    const bulkConfigPath = path.join(process.cwd(), 'carousel-bulk-config.json');

    if (!fs.existsSync(bulkConfigPath)) {
      console.error('❌ Error: carousel-bulk-config.json not found');
      console.log('Please create a carousel-bulk-config.json file in the project root.');
      process.exit(1);
    }

    const bulkConfig = await fs.readJson(bulkConfigPath);
    const { transcriptName, videoId, carousels, showLogo } = bulkConfig;

    console.log(`\n🎬 Bulk generating ${carousels.length} carousels from transcript: ${transcriptName}\n`);

    for (let i = 0; i < carousels.length; i++) {
      const carousel = carousels[i];
      const carouselFolderName = `${transcriptName}-carousel-${i + 1}`;
      
      const config = {
        name: carouselFolderName,
        videoId: videoId,
        slides: carousel.slides,
        showLogo: showLogo !== false
      };

      const generator = new CarouselGenerator(config);
      generator.outputDir = path.join(process.cwd(), 'public', 'output', carouselFolderName);

      try {
        console.log(`\n📁 Carousel ${i + 1}/${carousels.length}: ${carousel.name}`);
        console.log(`   ${carousel.description}`);
        await generator.init();
        await generator.generateCarousel();
      } catch (error) {
        console.error(`❌ Error generating carousel ${i + 1}:`, error);
      } finally {
        await generator.close();
      }
    }

    console.log(`\n✅ Bulk generation complete! Check public/output/ for ${carousels.length} carousel folders.\n`);

  } else {
    const configPath = path.join(process.cwd(), 'carousel-config.json');

    if (!fs.existsSync(configPath)) {
      console.error('❌ Error: carousel-config.json not found');
      console.log('Please create a carousel-config.json file in the project root.');
      console.log('\nExample format:');
      console.log(JSON.stringify({
        name: "my-carousel",
        videoId: "dQw4w9WgXcQ",
        showLogo: true,
        slides: [
          {
            topTimestamp: 10,
            bottomTimestamp: 15,
            topText: "First frame text",
            bottomText: "Second frame text"
          }
        ]
      }, null, 2));
      process.exit(1);
    }

    const config = await fs.readJson(configPath);
    const generator = new CarouselGenerator(config);

    try {
      await generator.init();
      await generator.generateCarousel();
    } catch (error) {
      console.error('❌ Error generating carousel:', error);
      process.exit(1);
    } finally {
      await generator.close();
    }
  }
}

// Check if running as main module (both for CommonJS and ES modules)
if (typeof require !== 'undefined' && require.main === module) {
  main();
} else if (typeof import.meta !== 'undefined' && import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export default main;
