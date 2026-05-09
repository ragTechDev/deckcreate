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

// Mock next/image so components render without Next.js image optimisation
jest.mock('next/image', () => ({
  __esModule: true,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  default: ({ src, alt, ...rest }: any) =>
    // biome-ignore lint: test mock intentionally uses img
    Object.assign(document.createElement('img'), { src, alt, ...rest }),
}));
