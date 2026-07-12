import React from 'react';
import { render } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { Header } from './Header';

function renderHeader() {
  return render(
    <MantineProvider>
      <Header />
    </MantineProvider>
  );
}

describe('Header nav links', () => {
  it('renders without throwing', () => {
    expect(() => renderHeader()).not.toThrow();
  });

  it('includes the renamed /get-youtube-captions route', () => {
    const { container } = renderHeader();
    expect(container.querySelector('a[href="/get-youtube-captions"]')).not.toBeNull();
  });

  it('does not link to the old /transcribe route', () => {
    const { container } = renderHeader();
    expect(container.querySelector('a[href="/transcribe"]')).toBeNull();
  });

  it('does not link to /login', () => {
    const { container } = renderHeader();
    expect(container.querySelector('a[href="/login"]')).toBeNull();
  });
});
