import { staticFile } from 'remotion';

/**
 * Returns a promise that loads both Nunito variable font faces
 * (normal + italic) and registers them with the document.
 * Call this inside a useEffect paired with delayRender/continueRender.
 */
export function loadNunito(): Promise<void> {
  const faces = [
    new FontFace('Nunito', `url(${staticFile('fonts/Nunito-VariableFont_wght.ttf')}) format('truetype')`, {
      weight: '100 900',
      style:  'normal',
    }),
    new FontFace('Nunito', `url(${staticFile('fonts/Nunito-Italic-VariableFont_wght.ttf')}) format('truetype')`, {
      weight: '100 900',
      style:  'italic',
    }),
  ];
  return Promise.all(faces.map(f => f.load()))
    .then(loaded => loaded.forEach(f => document.fonts.add(f)))
    .catch(err => console.warn('Nunito font load failed:', err));
}
