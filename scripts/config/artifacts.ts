import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

export const ARTIFACTS_DIR = '.ragtech/artifacts';

/**
 * Stores content as an artifact and returns the hash.
 * @param content - The content to store (string or Buffer)
 * @param ext - Optional file extension with leading dot (e.g., '.mp4', '.txt')
 * @param baseDir - Base directory for artifacts (defaults to process.cwd())
 * @returns The full SHA-256 hash as the artifact identifier
 */
export function storeArtifact(content: string | Buffer, ext?: string, baseDir: string = process.cwd()): string {
  // Compute SHA-256 hash
  const hash = crypto.createHash('sha256').update(content).digest('hex');
  
  // Normalize extension to ensure leading dot
  const normalizedExt = ext && !ext.startsWith('.') ? `.${ext}` : ext;
  
  // Create artifacts directory if it doesn't exist
  const artifactsDir = path.join(baseDir, ARTIFACTS_DIR);
  if (!fs.existsSync(artifactsDir)) {
    fs.mkdirSync(artifactsDir, { recursive: true });
  }
  
  // Write artifact file if it doesn't already exist
  // Deduplication is keyed on (content, ext) - same content with different extensions creates separate files
  const filename = normalizedExt ? `${hash}${normalizedExt}` : hash;
  const artifactPath = path.join(artifactsDir, filename);
  if (!fs.existsSync(artifactPath)) {
    fs.writeFileSync(artifactPath, content);
  }
  
  return hash;
}

/**
 * Resolves the full path to an artifact file.
 * @param hash - The artifact hash
 * @param ext - Optional file extension with leading dot
 * @param baseDir - Base directory for artifacts (defaults to process.cwd())
 * @returns The full path to the artifact file
 */
export function resolveArtifactPath(hash: string, ext?: string, baseDir: string = process.cwd()): string {
  // Normalize extension to ensure leading dot
  const normalizedExt = ext && !ext.startsWith('.') ? `.${ext}` : ext;
  const filename = normalizedExt ? `${hash}${normalizedExt}` : hash;
  return path.join(baseDir, ARTIFACTS_DIR, filename);
}
