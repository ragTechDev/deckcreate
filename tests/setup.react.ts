import '@testing-library/jest-dom';

// Silence non-error console output in component tests.
// Use console.error freely in tests to debug — it still prints.
beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'info').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

// Mock Next.js router (used by many app/ components)
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}));

// Mock next/image — factory must not reference document (hoisted before jsdom)
jest.mock('next/image', () => ({
  __esModule: true,
  default: jest.fn(),
}));
