// Jest setup file for tests
import fs from 'fs-extra';
import path from 'path';

// Mock console methods to reduce noise in tests
global.console = {
  ...console,
  log: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

// Mock fetch globally for YouTube API tests
global.fetch = jest.fn();

// Setup test directories
beforeAll(async () => {
  const testOutputDir = path.join(process.cwd(), 'test-output');
  await fs.ensureDir(testOutputDir);
});

// Cleanup after tests
afterAll(async () => {
  const testOutputDir = path.join(process.cwd(), 'test-output');
  if (await fs.pathExists(testOutputDir)) {
    await fs.remove(testOutputDir);
  }
});

// Mock Buffer for image processing tests
global.Buffer = Buffer;

// Mock sharp for image processing (avoid actual image processing in tests)
jest.mock('sharp', () => {
  const mockSharp = jest.fn(() => ({
    resize: jest.fn().mockReturnThis(),
    png: jest.fn().mockReturnThis(),
    toBuffer: jest.fn().mockResolvedValue(Buffer.from('mock-image-data')),
    composite: jest.fn().mockReturnThis(),
    metadata: jest.fn().mockResolvedValue({ width: 1080, height: 1080 })
  }));
  
  mockSharp.constructor = jest.fn(() => mockSharp());
  return mockSharp;
});

// Mock puppeteer to avoid actual browser launching
jest.mock('puppeteer-extra', () => ({
  launch: jest.fn().mockResolvedValue({
    newPage: jest.fn().mockResolvedValue({
      setUserAgent: jest.fn(),
      setViewport: jest.fn(),
      setExtraHTTPHeaders: jest.fn(),
      goto: jest.fn(),
      waitForSelector: jest.fn(),
      click: jest.fn(),
      evaluate: jest.fn(),
      close: jest.fn(),
      $: jest.fn()
    }),
    close: jest.fn()
  }),
  use: jest.fn()
}), { virtual: true });

jest.mock('puppeteer-extra-plugin-stealth', () => ({
  __esModule: true,
  default: jest.fn()
}), { virtual: true });
