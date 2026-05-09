import fs from 'fs';
import path from 'path';
import os from 'os';
import { storeArtifact, resolveArtifactPath, ARTIFACTS_DIR } from '../../scripts/config/artifacts';

describe('Artifact Storage Integration', () => {
  let tempDir: string;
  let testArtifactsDir: string;
  
  beforeEach(() => {
    // Create a temporary directory for testing
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'artifacts-test-'));
    testArtifactsDir = path.join(tempDir, ARTIFACTS_DIR);
  });
  
  afterEach(() => {
    // Clean up temp directory after each test
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('storeArtifact', () => {
    test('should store string content and return full hash', () => {
      const content = 'Hello, World!';
      const hash = storeArtifact(content, undefined, tempDir);
      
      expect(hash).toMatch(/^[a-f0-9]{64}$/); // 64 character hex string (full SHA-256)
      expect(fs.existsSync(path.join(testArtifactsDir, hash))).toBe(true);
      
      const storedContent = fs.readFileSync(path.join(testArtifactsDir, hash), 'utf-8');
      expect(storedContent).toBe(content);
    });

    test('should store content with extension', () => {
      const content = 'Hello, World!';
      const hash = storeArtifact(content, '.txt', tempDir);
      
      expect(hash).toMatch(/^[a-f0-9]{64}$/); // 64 character hex string
      expect(fs.existsSync(path.join(testArtifactsDir, `${hash}.txt`))).toBe(true);
      
      const storedContent = fs.readFileSync(path.join(testArtifactsDir, `${hash}.txt`), 'utf-8');
      expect(storedContent).toBe(content);
    });

    test('should store Buffer content and return hash', () => {
      const content = Buffer.from([0x48, 0x65, 0x6c, 0x6c, 0x6f]); // "Hello" in bytes
      const hash = storeArtifact(content, undefined, tempDir);
      
      expect(hash).toMatch(/^[a-f0-9]{64}$/); // 64 character hex string
      expect(fs.existsSync(path.join(testArtifactsDir, hash))).toBe(true);
      
      const storedContent = fs.readFileSync(path.join(testArtifactsDir, hash));
      expect(storedContent).toEqual(content);
    });

    test('should return same hash for identical content', () => {
      const content = 'Identical content';
      const hash1 = storeArtifact(content, undefined, tempDir);
      const hash2 = storeArtifact(content, undefined, tempDir);
      
      expect(hash1).toBe(hash2);
    });

    test('should return same hash for identical Buffer content', () => {
      const content = Buffer.from([0x01, 0x02, 0x03, 0x04]);
      const hash1 = storeArtifact(content, undefined, tempDir);
      const hash2 = storeArtifact(content, undefined, tempDir);
      
      expect(hash1).toBe(hash2);
    });

    test('should return different hashes for different content', () => {
      const content1 = 'Content A';
      const content2 = 'Content B';
      const hash1 = storeArtifact(content1, undefined, tempDir);
      const hash2 = storeArtifact(content2, undefined, tempDir);
      
      expect(hash1).not.toBe(hash2);
    });

    test('should not create duplicate files for identical content', () => {
      const content = 'Duplicate test content';
      const hash = storeArtifact(content, undefined, tempDir);
      
      // Store the same content again
      const hash2 = storeArtifact(content, undefined, tempDir);
      
      expect(hash).toBe(hash2);
      
      // Verify only one file exists
      const files = fs.readdirSync(testArtifactsDir);
      expect(files).toHaveLength(1);
      expect(files[0]).toBe(hash);
    });

    test('should not create duplicate files for identical content with extension', () => {
      const content = 'Duplicate test content';
      const hash = storeArtifact(content, '.txt', tempDir);
      
      // Store the same content again
      const hash2 = storeArtifact(content, '.txt', tempDir);
      
      expect(hash).toBe(hash2);
      
      // Verify only one file exists
      const files = fs.readdirSync(testArtifactsDir);
      expect(files).toHaveLength(1);
      expect(files[0]).toBe(`${hash}.txt`);
    });

    test('should create artifacts directory if it does not exist', () => {
      const content = 'Directory creation test';
      
      // Ensure directory doesn't exist
      expect(fs.existsSync(testArtifactsDir)).toBe(false);
      
      const hash = storeArtifact(content, undefined, tempDir);
      
      expect(fs.existsSync(testArtifactsDir)).toBe(true);
      expect(fs.existsSync(path.join(testArtifactsDir, hash))).toBe(true);
    });
  });

  describe('resolveArtifactPath', () => {
    test('should return correct artifact path without extension', () => {
      const hash = 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';
      const resolvedPath = resolveArtifactPath(hash, undefined, tempDir);
      
      expect(resolvedPath).toBe(path.join(testArtifactsDir, hash));
    });

    test('should return correct artifact path with extension', () => {
      const hash = 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';
      const resolvedPath = resolveArtifactPath(hash, '.mp4', tempDir);
      
      expect(resolvedPath).toBe(path.join(testArtifactsDir, `${hash}.mp4`));
    });
  });

  describe('Integration with extensions', () => {
    test('should handle different extensions for same content', () => {
      const content = 'Same content, different extensions';
      const hash1 = storeArtifact(content, '.txt', tempDir);
      const hash2 = storeArtifact(content, '.mp4', tempDir);
      
      // Same content should have same hash regardless of extension
      expect(hash1).toBe(hash2);
      
      // But files should have different extensions
      expect(fs.existsSync(path.join(testArtifactsDir, `${hash1}.txt`))).toBe(true);
      expect(fs.existsSync(path.join(testArtifactsDir, `${hash2}.mp4`))).toBe(true);
    });

    test('should normalize extension without leading dot', () => {
      const content = 'Extension normalization test';
      const hash1 = storeArtifact(content, '.txt', tempDir);
      const hash2 = storeArtifact(content, 'txt', tempDir);
      
      // Same hash regardless of leading dot
      expect(hash1).toBe(hash2);
      
      // Both should create .txt files
      expect(fs.existsSync(path.join(testArtifactsDir, `${hash1}.txt`))).toBe(true);
      expect(fs.existsSync(path.join(testArtifactsDir, `${hash2}.txt`))).toBe(true);
      
      // Should not create file without extension
      expect(fs.existsSync(path.join(testArtifactsDir, hash1))).toBe(false);
    });

    test('should resolve paths with normalized extensions', () => {
      const hash = 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';
      
      const path1 = resolveArtifactPath(hash, '.txt', tempDir);
      const path2 = resolveArtifactPath(hash, 'txt', tempDir);
      
      // Both should resolve to same path with .txt extension
      expect(path1).toBe(path2);
      expect(path1).toBe(path.join(testArtifactsDir, `${hash}.txt`));
    });
  });
});
