#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const docPath = path.join(__dirname, '..', 'public', 'edit', 'transcript.doc.txt');
let doc = fs.readFileSync(docPath, 'utf8');
const lines = doc.split('\n');
const segmentPattern = /^(-?)\[([0-9]+)\]\s+(.+)$/;

const segments = [];
lines.forEach((line, lineIdx) => {
  const match = line.match(segmentPattern);
  if (match) {
    segments.push({
      lineIdx,
      cut: match[1] === '-',
      id: parseInt(match[2]),
      text: match[3].trim().toLowerCase()
    });
  }
});

const toCut = new Set();
for (let i = 0; i < segments.length - 1; i++) {
  if (segments[i].cut) continue;
  
  let repeatCount = 0;
  let j = i + 1;
  
  while (j < segments.length && segments[j].text === segments[i].text && segments[j].cut === false) {
    repeatCount++;
    toCut.add(segments[j].id);  // Cut duplicates, keep first
    j++;
  }
  
  if (repeatCount > 0) {
    console.log('Cutting repetition: [' + segments[i].id + '] "' + segments[i].text.substring(0, 30) + '" → keeping first, cutting ' + repeatCount + ' duplicates');
  }
}

console.log('\nTotal segments to cut: ' + toCut.size);
console.log('Applying cuts...\n');

// Apply cuts by adding minus signs
let modified = doc;
toCut.forEach(id => {
  const pattern = '[' + id + ']  ';
  const replacement = '-[' + id + ']  ';
  modified = modified.split(pattern).join(replacement);
});

fs.writeFileSync(docPath, modified);
console.log('✓ Applied cuts to ' + toCut.size + ' duplicate segments');
console.log('  Run: npm run transcript:merge');
