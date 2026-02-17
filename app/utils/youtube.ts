export function extractVideoId(urlOrId: string): string | null {
  if (!urlOrId) return null;
  
  // If it's already just an ID (11 characters, alphanumeric with dashes/underscores)
  if (/^[a-zA-Z0-9_-]{11}$/.test(urlOrId.trim())) {
    return urlOrId.trim();
  }
  
  // Try to extract from various YouTube URL formats
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/watch\?.*v=([a-zA-Z0-9_-]{11})/,
  ];
  
  for (const pattern of patterns) {
    const match = urlOrId.match(pattern);
    if (match && match[1]) {
      return match[1];
    }
  }
  
  return null;
}

export function timeToSeconds(time: string): number {
  const parts = time.split(':').map(p => parseInt(p, 10) || 0);
  
  if (parts.length === 3) {
    // H:M:S
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  } else if (parts.length === 2) {
    // M:S
    return parts[0] * 60 + parts[1];
  } else if (parts.length === 1) {
    // S
    return parts[0];
  }
  
  return 0;
}

export function secondsToTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

export async function getVideoTitle(videoId: string): Promise<string | null> {
  try {
    // Use oEmbed API to get video title
    const response = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`);
    if (!response.ok) return null;
    
    const data = await response.json();
    return data.title || null;
  } catch (error) {
    console.error('Error fetching video title:', error);
    return null;
  }
}
