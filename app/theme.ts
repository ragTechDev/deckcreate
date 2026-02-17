import { createTheme, MantineColorsTuple } from '@mantine/core';

const primary: MantineColorsTuple = [
  '#ffe9eb',
  '#ffd2d5',
  '#fda2a9',
  '#fc8b94',
  '#fb6f7a',
  '#fa5e6a',
  '#fa5562',
  '#df4451',
  '#c73a46',
  '#ae2d3a'
];

const secondary: MantineColorsTuple = [
  '#e7f9f8',
  '#d4efed',
  '#a2d4d1',
  '#8cc9c5',
  '#6fbfba',
  '#5cb9b4',
  '#4fb6b1',
  '#3da09b',
  '#2e8f8b',
  '#1a7d79'
];

const accent: MantineColorsTuple = [
  '#fffbeb',
  '#fff5d6',
  '#ffefae',
  '#ffe882',
  '#ffe25c',
  '#ffde43',
  '#ffdd35',
  '#e3c326',
  '#caad1b',
  '#af9509'
];

const brown: MantineColorsTuple = [
  '#f9f0ed',
  '#ede0da',
  '#d4a89a',
  '#c89684',
  '#be8570',
  '#b97a63',
  '#b8745d',
  '#a2634d',
  '#915843',
  '#7f4b38'
];

const brownDark: MantineColorsTuple = [
  '#f5ebe8',
  '#e5d5d0',
  '#c9a89d',
  '#b08976',
  '#9a6f57',
  '#8b5a49',
  '#85533f',
  '#724533',
  '#653d2d',
  '#563426'
];

export const theme = createTheme({
  colors: {
    primary,
    secondary,
    accent,
    brown,
    brownDark,
  },
  primaryColor: 'primary',
  fontFamily: 'Nunito, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial, sans-serif',
  headings: {
    fontFamily: 'Nunito, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial, sans-serif',
    fontWeight: '700',
  },
  defaultRadius: 'md',
  breakpoints: {
    xs: '36em',
    sm: '48em',
    md: '62em',
    lg: '75em',
    xl: '88em',
  },
});
