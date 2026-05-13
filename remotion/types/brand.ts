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
  role: string;
  imgSrc: string;       // relative to brands/{brandId}/
  nameBgColor: string;
};

export type BrandMascot = {
  enabled: boolean;
  name: string;
  assets: {
    holdingMic?: string;
    teacher?: string;
    raisingHand?: string;
    holdingLaptop?: string;
    holdingLaptop2?: string;
    sparkleEyes?: string;
    [key: string]: string | undefined;
  };
};

export type Brand = {
  id:         string;
  colors:     BrandColors;
  typography: BrandTypography;
  logo:       string;
  shape: {
    borderRadius:      number;
    borderRadiusSmall: number;
  };

  // NEW: Identity
  identity: {
    name: string;            // 'RAG Tech'
    terminalPath: string;    // '~/ragtech'
    socialHandle: string;    // '@ragtechdev'
    website?: string;
  };

  // NEW: Team
  hosts: BrandHost[];

  // NEW: Mascot
  mascot: BrandMascot;

  // NEW: Media
  audio: {
    introOutroMusic: string;
    backgroundMusic: string;
    hookMusic?: string;
  };
  background: {
    episodeGridAssets: string[];
  };
};
