import { NextRequest, NextResponse } from 'next/server';
import CaptionExtractor from '@/scripts/carousel/CaptionExtractor';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { videoId, startTime, endTime, removeFillers = true } = body;

    if (!videoId) {
      return NextResponse.json(
        { error: 'Missing required field: videoId' },
        { status: 400 }
      );
    }

    const extractor = new CaptionExtractor();
    await extractor.init();

    try {
      const result = await extractor.transcribeVideo(videoId, {
        startTime: startTime ?? null,
        endTime: endTime ?? null,
        removeFillers,
      });
      return NextResponse.json({ success: true, ...result });
    } finally {
      await extractor.close();
    }
  } catch (error) {
    console.error('Error transcribing video:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to transcribe video' },
      { status: 500 }
    );
  }
}
