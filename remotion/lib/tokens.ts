import type { Token } from '../types/transcript';

/**
 * Returns true if a token represents a spoken word, not punctuation or a special
 * marker token from Whisper.
 */
export function isSpokenToken(t: Token): boolean {
  const trimmed = t.text.trim();
  if (trimmed === '' || /_[A-Z]+_/.test(trimmed)) {
    return false;
  }
  // Filter out tokens that are only punctuation or Whisper's '??' artifacts
  if (/^[.,?_\s]*$/.test(trimmed.replace(/ /g, ''))) {
    return false;
  }
  return true;
}
