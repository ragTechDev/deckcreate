import React from 'react';
import { render } from '@testing-library/react';

const mockUseCurrentFrame = jest.fn(() => 0);

jest.mock('remotion', () => ({
  useCurrentFrame: () => mockUseCurrentFrame(),
  interpolate: jest.fn(() => 0),
  AbsoluteFill: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  staticFile: (path: string) => `/static/${path}`,
  Audio: ({ src }: { src?: string }) => <span data-testid="audio" data-src={src} />,
  Sequence: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import { Transition } from './Transition';

describe('Transition', () => {
  beforeEach(() => {
    mockUseCurrentFrame.mockReturnValue(0);
  });

  it('renders nothing when frame is before startFrame', () => {
    mockUseCurrentFrame.mockReturnValue(10);
    const { container } = render(<Transition startFrame={30} durationInFrames={30} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when frame is after the transition window', () => {
    mockUseCurrentFrame.mockReturnValue(61);
    const { container } = render(<Transition startFrame={30} durationInFrames={30} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders content during the transition window', () => {
    mockUseCurrentFrame.mockReturnValue(45);
    const { container } = render(<Transition startFrame={30} durationInFrames={30} />);
    expect(container.firstChild).not.toBeNull();
  });

  it('uses a local static path for the whoosh sound, not an external URL', () => {
    mockUseCurrentFrame.mockReturnValue(45);
    const { getByTestId } = render(<Transition startFrame={30} durationInFrames={30} />);
    const audio = getByTestId('audio');
    expect(audio.dataset.src).toContain('sounds/whoosh.wav');
    expect(audio.dataset.src).not.toMatch(/^https?:\/\//);
  });

  it('renders without throwing at the boundary frame', () => {
    mockUseCurrentFrame.mockReturnValue(30);
    expect(() => render(<Transition startFrame={30} durationInFrames={30} />)).not.toThrow();
  });
});
