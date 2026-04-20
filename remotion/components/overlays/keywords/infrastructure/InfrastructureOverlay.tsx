import React from 'react';
import { TextOverlay, type TextOverlayProps } from '../../core';
import type { Brand } from '../../../../types/brand';

export type InfrastructureOverlayProps = Omit<TextOverlayProps, 'brand' | 'text' | 'subtext' | 'keyword' | 'accentColor'> & {
  brand: Brand;
  concept:
    | 'containerization' | 'servers' | 'data-center' | 'deployment'
    | 'tcp-ip' | 'http' | 'https' | 'api' | 'pipeline'
    | 'scalability' | 'optimization' | 'ports' | 'cloud';
};

const conceptMap: Record<string, { text: string; subtext: string }> = {
  containerization: { text: 'Containerization', subtext: 'Package & deploy' },
  servers:          { text: 'Servers',          subtext: 'The backbone' },
  'data-center':    { text: 'Data Center',      subtext: 'Compute infrastructure' },
  deployment:       { text: 'Deployment',       subtext: 'Ship to production' },
  'tcp-ip':         { text: 'TCP / IP',         subtext: 'Internet protocols' },
  http:             { text: 'HTTP',             subtext: 'Web protocol' },
  https:            { text: 'HTTPS',            subtext: 'Secure connections' },
  api:              { text: 'API',              subtext: 'Connect systems' },
  pipeline:         { text: 'Pipeline',         subtext: 'Data flows' },
  scalability:      { text: 'Scalability',      subtext: 'Grow without limits' },
  optimization:     { text: 'Optimization',     subtext: 'Maximum efficiency' },
  ports:            { text: 'Ports',            subtext: 'Network connections' },
  cloud:            { text: 'Cloud',            subtext: 'Distributed computing' },
};

export const InfrastructureOverlay: React.FC<InfrastructureOverlayProps> = ({ brand, concept, ...props }) => {
  const { text, subtext } = conceptMap[concept];
  return (
    <TextOverlay
      brand={brand}
      text={text}
      subtext={subtext}
      keyword="<infra />"
      accentColor={brand.colors.secondary}
      {...props}
    />
  );
};
