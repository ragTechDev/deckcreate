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

export type Brand = {
  colors:     BrandColors;
  typography: BrandTypography;
  logo:       string;
  shape: {
    borderRadius:      number;
    borderRadiusSmall: number;
  };
};
