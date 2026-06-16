import React from 'react';
import { render } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { Header } from './Header';

jest.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: null, logout: jest.fn() }),
}));

function renderWithMantine(ui: React.ReactElement) {
  return render(<MantineProvider>{ui}</MantineProvider>);
}

describe('Header', () => {
  it('renders without crashing', () => {
    expect(() => renderWithMantine(<Header />)).not.toThrow();
  });

  it('does not contain a nav link to /auto-carousel', () => {
    const { container } = renderWithMantine(<Header />);
    const links = container.querySelectorAll('a[href="/auto-carousel"]');
    expect(links).toHaveLength(0);
  });
});
