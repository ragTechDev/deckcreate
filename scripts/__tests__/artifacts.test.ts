import fs from 'fs';
import path from 'path';
import { storeArtifact, resolveArtifactPath, ARTIFACTS_DIR } from '../config/artifacts';

describe('Artifact Storage', () => {
  const testArtifactsDir = path.join(process.cwd(), ARTIFACTS_DIR);
  
  beforeEach(() => {
    // Clean up test artifacts directory before each test
    if (fs.existsSync(testArtifactsDir)) {
      fs.rmSync(testArtifactsDir, { recursive: true, force: true });
    }
  });
  
  afterAll(() => {
    // Clean up test artifacts directory after all tests
    if (fs.existsSync(testArtifactsDir)) {
      fs.rmSync(testArtifactsDir, { recursive: true, force: true });
    }
  });

  describe('storeArtifact', () => {
    test('should store string content and return hash', () => {
      const content = 'Hello, World!';
      const hash = storeArtifact(content);
      
      expect(hash).toMatch(/^[a-f0-9]{12}$/); // 12 character hex string
      expect(fs.existsSync(path.join(testArtifactsDir, hash))).toBe(true);
      
      const storedContent = fs.readFileSync(path.join(testArtifactsDir, hash), 'utf-8');
      expect(storedContent).toBe(content);
    });

    test('should store Buffer content and return hash', () => {
      const content = Buffer.from([0x48, 0x65, 0x6c, 0x6c, 0x6f]); // "Hello" in bytes
      const hash = storeArtifact(content);
      
      expect(hash).toMatch(/^[a-f0-9]{12}$/); // 12 character hex string
      expect(fs.existsSync(path.join(testArtifactsDir, hash))).toBe(true);
      
      const storedContent = fs.readFileSync(path.join(testArtifactsDir, hash));
      expect(storedContent).toEqual(content);
    });

    test('should return same hash for identical content', () => {
      const content = 'Identical content';
      const hash1 = storeArtifact(content);
      const hash2 = storeArtifact(content);
      
      expect(hash1).toBe(hash2);
    });

    test('should return same hash for identical Buffer content', () => {
      const content = Buffer.from([0x01, 0x02, 0x03, 0x04]);
      const hash1 = storeArtifact(content);
      const hash2 = storeArtifact(content);
      
      expect(hash1).toBe(hash2);
    });

    test('should return different hashes for different content', () => {
      const content1 = 'Content A';
      const content2 = 'Content B';
      const hash1 = storeArtifact(content1);
      const hash2 = storeArtifact(content2);
      
      expect(hash1).not.toBe(hash2);
    });

    test('should not create duplicate files for identical content', () => {
      const content = 'Duplicate test content';
      const hash = storeArtifact(content);
      
      // Store the same content again
      const hash2 = storeArtifact(content);
      
      expect(hash).toBe(hash2);
      
      // Verify only one file exists
      const files = fs.readdirSync(testArtifactsDir);
      expect(files).toHaveLength(1);
      expect(files[0]).toBe(hash);
    });

    test('should create artifacts directory if it does not exist', () => {
      const content = 'Directory creation test';
      
      // Ensure directory doesn't exist
      expect(fs.existsSync(testArtifactsDir)).toBe(false);
      
      const hash = storeArtifact(content);
      
      expect(fs.existsSync(testArtifactsDir)).toBe(true);
      expect(fs.existsSync(path.join(testArtifactsDir, hash))).toBe(true);
    });
  });

  describe('resolveArtifactPath', () => {
    test('should return correct artifact path', () => {
      const hash = 'abcdef123456';
      const resolvedPath = resolveArtifactPath(hash);
      
      expect(resolvedPath).toBe(path.join(testArtifactsDir, hash));
    });
  });
});
