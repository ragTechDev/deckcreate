import React from 'react';
import { render } from '@testing-library/react';

const mockUseCurrentFrame = jest.fn(() => 0);

jest.mock('remotion', () => ({
  useCurrentFrame: () => mockUseCurrentFrame(),
  useVideoConfig: () => ({ fps: 60 }),
  AbsoluteFill: ({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) => (
    <div style={style}>{children}</div>
  ),
}));

import { LineCaptionOverlay } from './LineCaptionOverlay';
import type { CaptionLine } from '../types/lineCaptions';
import type { Brand } from '../types/brand';

const brand = {
  colors: {
    text: { primary: '#fff' },
    palette: ['#f00', '#0f0', '#00f'],
  },
  typography: {
    fontFamily: 'Nunito',
    weights: { black: 900 },
  },
} as unknown as Brand;

const lines: CaptionLine[] = [
  { id: 1, speaker: 'Natasha', text: 'this is the', startMs: 0, endMs: 500 },
  { id: 2, speaker: 'Natasha', text: 'first caption line', startMs: 500, endMs: 1000 },
];

describe('LineCaptionOverlay', () => {
  beforeEach(() => {
    mockUseCurrentFrame.mockReturnValue(0);
  });

  it('renders nothing when there are no lines', () => {
    mockUseCurrentFrame.mockReturnValue(0);
    const { container } = render(<LineCaptionOverlay lines={[]} brand={brand} />);
    expect(container.firstChild).toBeNull();
  });

  it('shows the first line during its time window', () => {
    mockUseCurrentFrame.mockReturnValue(0); // 0ms
    const { getByText } = render(<LineCaptionOverlay lines={lines} brand={brand} />);
    expect(getByText('this is the')).toBeTruthy();
  });

  it('switches to the second line once its window starts', () => {
    mockUseCurrentFrame.mockReturnValue(36); // 36/60 * 1000 = 600ms
    const { getByText, queryByText } = render(<LineCaptionOverlay lines={lines} brand={brand} />);
    expect(getByText('first caption line')).toBeTruthy();
    expect(queryByText('this is the')).toBeNull();
  });

  it('renders nothing after the last line ends', () => {
    mockUseCurrentFrame.mockReturnValue(120); // 2000ms
    const { container } = render(<LineCaptionOverlay lines={lines} brand={brand} />);
    expect(container.firstChild).toBeNull();
  });

  it('tints text by speaker using the brand palette when multiple speakers are present', () => {
    const multiSpeakerLines: CaptionLine[] = [
      { id: 1, speaker: 'Natasha', text: 'hey there', startMs: 0, endMs: 500 },
      { id: 2, speaker: 'Saloni', text: 'hi back', startMs: 500, endMs: 1000 },
    ];
    mockUseCurrentFrame.mockReturnValue(36); // 600ms → Saloni's line
    const { getByText } = render(<LineCaptionOverlay lines={multiSpeakerLines} brand={brand} />);
    const el = getByText('hi back');
    expect(el.style.color).not.toBe('');
  });
});
