import { NextRequest, NextResponse } from 'next/server';

const CaptionExtractor = require('@/scripts/CaptionExtractor');

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { videoId, topTimestamp, bottomTimestamp, removeFillers = true } = body;

    if (!videoId) {
      return NextResponse.json(
        { error: 'Missing required field: videoId' },
        { status: 400 }
      );
    }

    if (topTimestamp === undefined || bottomTimestamp === undefined) {
      return NextResponse.json(
        { error: 'Missing required fields: topTimestamp and bottomTimestamp' },
        { status: 400 }
      );
    }

    const extractor = new CaptionExtractor();
    await extractor.init();

    try {
      const { topCaption, bottomCaption } = await extractor.extractSlideCaptions(
        videoId,
        topTimestamp,
        bottomTimestamp,
        removeFillers
      );
      return NextResponse.json({ success: true, topCaption, bottomCaption });
    } finally {
      await extractor.close();
    }
  } catch (error) {
    console.error('Error extracting captions:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to extract captions' },
      { status: 500 }
    );
  }
}
