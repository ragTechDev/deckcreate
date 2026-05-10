export type BrandColors = {
  primary:    string;
  secondary:  string;
  accent:     string;
  background: string;
  surface:    string;
  text: {
    primary:   string;
    secondary: string;
    onPrimary: string;
  };
  palette: string[];
};

export type BrandTypography = {
  fontFamily:     string;
  fontSrc:        string;
  fontSrcItalic?: string;
  weights: {
    regular:   number;
    semiBold:  number;
    bold:      number;
    extraBold: number;
    black:     number;
  };
};

export type BrandHost = {
  name: string;
  avatar?: string;
  bio?: string;
  social?: {
    twitter?: string;
    linkedin?: string;
    website?: string;
  };
};

export type BrandMascot = {
  name: string;
  image?: string;
  description?: string;
};

export type Brand = {
  colors:     BrandColors;
  typography: BrandTypography;
  logo:       string;
  shape: {
    borderRadius:      number;
    borderRadiusSmall: number;
  };
  identity?: {
    name?: string;
    tagline?: string;
    description?: string;
  };
  hosts?: BrandHost[];
  mascot?: BrandMascot;
  audio?: {
    theme?: string;
    stinger?: string;
    background?: string;
  };
  background?: {
    image?: string;
    video?: string;
    pattern?: string;
  };
};
