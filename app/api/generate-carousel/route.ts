import { NextRequest, NextResponse } from 'next/server';

import CarouselGenerator from '@/scripts/CarouselGenerator';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, videoId, showLogo, slides, ctaSlide } = body;

    if (!name || !videoId || !slides || slides.length === 0) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    const config = {
      name,
      videoId,
      showLogo: showLogo !== false,
      slides,
      returnBase64: true, // Flag to return base64 instead of saving to disk
    };

    const generator = new CarouselGenerator(config);
    
    await generator.init();
    const result = await generator.generateCarousel();

    // Generate CTA slide if configured
    if (ctaSlide) {
      const ctaResult = await generator.generateCtaSlide(ctaSlide, slides.length + 1);
      result.push(ctaResult);
    }

    await generator.close();

    return NextResponse.json({
      success: true,
      slides: result,
    });
  } catch (error) {
    console.error('Error generating carousel:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to generate carousel' },
      { status: 500 }
    );
  }
}
