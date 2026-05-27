import React from 'react';
import { render } from '@testing-library/react';
import { OverlayRenderer } from './OverlayRenderer';
import type { Brand } from '../types/brand';

// Mock remotion hooks used by OverlayRenderer
jest.mock('remotion', () => ({
  useVideoConfig: () => ({ fps: 60, width: 1920, height: 1080, durationInFrames: 3600 }),
  useCurrentFrame: () => 0,
  Sequence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  staticFile: (p: string) => `/public/${p}`,
}));

// Mock all overlay components imported directly by OverlayRenderer
jest.mock('./overlays/lower-thirds', () => ({
  ConceptExplainer: jest.fn(() => null),
  Callout: jest.fn(() => null),
  NameTitle: jest.fn(() => null),
  ChapterMarker: jest.fn(() => null),
  TermTypewriter: jest.fn(() => null),
}));
jest.mock('./overlays/lower-thirds/ConceptExplainer.short', () => ({
  ConceptExplainerShort: jest.fn(() => null),
}));
jest.mock('./overlays/lower-thirds/NameTitle.short', () => ({
  NameTitleShort: jest.fn(() => null),
}));
jest.mock('./overlays/ImageWindowOverlay', () => ({
  ImageWindowOverlay: jest.fn(() => null),
}));
jest.mock('./overlays/GifWindowOverlay', () => ({
  GifWindowOverlay: jest.fn(() => null),
}));
jest.mock('./overlays/GlobalSouthMap', () => ({
  GlobalSouthMap: jest.fn(() => null),
}));
jest.mock('./overlays/DataFlowAnimation', () => ({
  DataFlowAnimation: jest.fn(() => null),
}));
jest.mock('./overlays/keywords', () => ({
  RagtechOverlay: jest.fn(() => null),
}));
jest.mock('./overlays/FullscreenMediaOverlay', () => ({
  FullscreenMediaOverlay: jest.fn(() => null),
}));
// @remotion/gif uses Remotion internals that don't run in Jest — mock the whole package.
jest.mock('@remotion/gif', () => ({
  Gif: jest.fn(() => null),
}));

const mockBrand: Brand = {
  id: 'ragtech',
  colors: {
    primary: '#eebf89',
    secondary: '#9cd2d0',
    accent: '#ffa3a6',
    background: '#fff3c2',
    surface: '#1c1006',
    text: { primary: '#fff', secondary: '#b0b0cc', onPrimary: '#0f0f1a' },
    palette: [],
  },
  typography: {
    fontFamily: 'Nunito',
    fontSrc: '/fonts/Nunito.ttf',
    weights: { regular: 400, semiBold: 600, bold: 700, extraBold: 800, black: 900 },
  },
  logo: '/assets/logo.png',
  shape: { borderRadius: 12, borderRadiusSmall: 6 },
  identity: { name: 'RAG Tech', terminalPath: '~/ragtech', socialHandle: '@ragtechdev' },
  hosts: [],
  mascot: { enabled: false, name: 'Techybara', assets: {} },
  audio: { introOutroMusic: '/sounds/intro.mp3', backgroundMusic: '/sounds/bg.mp3' },
  background: { episodeGridAssets: [] },
};

const baseProps = {
  segments: [],
  brand: mockBrand,
  mainSections: [],
  hookSections: [],
  mainStartFrame: 0,
};

describe('OverlayRenderer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders null when there are no segments', () => {
    const { container } = render(<OverlayRenderer {...baseProps} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders null when all segments are cut', () => {
    const { container } = render(
      <OverlayRenderer
        {...baseProps}
        segments={[{
          id: 1, start: 0, end: 5, speaker: 'Natasha',
          text: 'hello', cut: true, tokens: [], cuts: [], graphics: [],
        }]}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it('passes isShortForm=true without crashing', () => {
    expect(() =>
      render(<OverlayRenderer {...baseProps} isShortForm />)
    ).not.toThrow();
  });
});
