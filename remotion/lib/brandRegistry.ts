import React from 'react';
import {
  AwardsOverlay,
  CodingOverlay,
  EngineeringOverlay,
  AIOverlay,
  InfrastructureOverlay,
  PracticeOverlay,
  RoleOverlay,
  LanguageOverlay,
  FrameworkOverlay,
  EducationOverlay,
  RagtechOverlay,
} from '../components/overlays/keywords';

// When a brand's overlay files are moved to brands/{brandId}/components/, replace
// the direct imports above with: require(`../../brands/${brandId}/components`).default
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getBrandOverlays(brandId: string): Record<string, React.FC<any>> {
  if (brandId === 'ragtech') {
    return {
      AwardsOverlay,
      CodingOverlay,
      EngineeringOverlay,
      AIOverlay,
      InfrastructureOverlay,
      PracticeOverlay,
      RoleOverlay,
      LanguageOverlay,
      FrameworkOverlay,
      EducationOverlay,
      RagtechOverlay,
    };
  }
  return {};
}
