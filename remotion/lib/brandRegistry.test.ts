import { getBrandOverlays } from './brandRegistry';

// Mock overlay components — we test registry key mapping, not rendering
jest.mock('../components/overlays/keywords', () => ({
  AwardsOverlay: jest.fn(),
  CodingOverlay: jest.fn(),
  EngineeringOverlay: jest.fn(),
  AIOverlay: jest.fn(),
  InfrastructureOverlay: jest.fn(),
  PracticeOverlay: jest.fn(),
  RoleOverlay: jest.fn(),
  LanguageOverlay: jest.fn(),
  FrameworkOverlay: jest.fn(),
  EducationOverlay: jest.fn(),
  RagtechOverlay: jest.fn(),
}));

const RAGTECH_OVERLAY_KEYS = [
  'AwardsOverlay',
  'CodingOverlay',
  'EngineeringOverlay',
  'AIOverlay',
  'InfrastructureOverlay',
  'PracticeOverlay',
  'RoleOverlay',
  'LanguageOverlay',
  'FrameworkOverlay',
  'EducationOverlay',
  'RagtechOverlay',
];

describe('getBrandOverlays', () => {
  it('returns all ragtech overlay keys for brandId ragtech', () => {
    const overlays = getBrandOverlays('ragtech');
    for (const key of RAGTECH_OVERLAY_KEYS) {
      expect(overlays).toHaveProperty(key);
      expect(typeof overlays[key]).toBe('function');
    }
  });

  it('returns empty object for unknown brandId', () => {
    expect(getBrandOverlays('unknown-brand')).toEqual({});
    expect(getBrandOverlays('')).toEqual({});
  });

  it('ragtech overlay count matches expected set', () => {
    const overlays = getBrandOverlays('ragtech');
    expect(Object.keys(overlays)).toHaveLength(RAGTECH_OVERLAY_KEYS.length);
  });
});
