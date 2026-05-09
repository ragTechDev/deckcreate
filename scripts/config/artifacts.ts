import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

export const ARTIFACTS_DIR = '.ragtech/artifacts';

/**
 * Stores content as an artifact and returns the hash.
 * @param content - The content to store (string or Buffer)
 * @returns The SHA-256 hash (first 12 characters) as the artifact identifier
 */
export function storeArtifact(content: string | Buffer): string {
  // Compute SHA-256 hash
  const hash = crypto.createHash('sha256').update(content).digest('hex');
  const shortHash = hash.substring(0, 12);
  
  // Create artifacts directory if it doesn't exist
  const artifactsDir = path.join(process.cwd(), ARTIFACTS_DIR);
  if (!fs.existsSync(artifactsDir)) {
    fs.mkdirSync(artifactsDir, { recursive: true });
  }
  
  // Write artifact file if it doesn't already exist
  const artifactPath = path.join(artifactsDir, shortHash);
  if (!fs.existsSync(artifactPath)) {
    fs.writeFileSync(artifactPath, content);
  }
  
  return shortHash;
}

/**
 * Resolves the full path to an artifact file.
 * @param hash - The artifact hash (first 12 characters)
 * @returns The full path to the artifact file
 */
export function resolveArtifactPath(hash: string): string {
  return path.join(process.cwd(), ARTIFACTS_DIR, hash);
}
