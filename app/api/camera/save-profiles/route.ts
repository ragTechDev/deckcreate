import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs-extra';
import path from 'path';

export async function POST(req: NextRequest) {
  try {
    const profiles = await req.json();
    const dest = req.nextUrl.searchParams.get('dest');
    const outputPath = dest === 'shorts'
      ? path.join(process.cwd(), 'public', 'shorts', 'camera-profiles.json')
      : path.join(process.cwd(), 'public', 'camera', 'camera-profiles.json');
    await fs.ensureDir(path.dirname(outputPath));
    await fs.writeJson(outputPath, profiles, { spaces: 2 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
