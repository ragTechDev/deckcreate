import React from 'react';
import { render } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import Home from './page';

jest.mock('./components/Header', () => ({
  Header: () => null,
}));

jest.mock('./components/InstagramEmbed', () => ({
  InstagramEmbed: () => null,
}));

function renderWithMantine(ui: React.ReactElement) {
  return render(<MantineProvider>{ui}</MantineProvider>);
}

describe('Home (landing page)', () => {
  it('renders without crashing', () => {
    expect(() => renderWithMantine(<Home />)).not.toThrow();
  });

  it('does not contain a link to /auto-carousel', () => {
    const { container } = renderWithMantine(<Home />);
    const links = container.querySelectorAll('a[href="/auto-carousel"]');
    expect(links).toHaveLength(0);
  });
});
