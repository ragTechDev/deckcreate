import { getBrandOverlays } from './brandRegistry';

// Mock overlay components — we test registry key mapping, not rendering
jest.mock('../components/overlays/keywords', () => ({
  RagtechOverlay: jest.fn(),
}));

const RAGTECH_OVERLAY_KEYS = [
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
