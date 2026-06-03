#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const docPath = process.argv[2] || path.join(__dirname, '..', 'public', 'edit', 'transcript.doc.txt');
const doc = fs.readFileSync(docPath, 'utf8');
const lines = doc.split('\n');
const segmentPattern = /^(-?)\[([0-9]+)\]\s+(.+)$/;

const segments = [];
lines.forEach(line => {
  const match = line.match(segmentPattern);
  if (match) {
    segments.push({
      cut: match[1] === '-',
      id: parseInt(match[2]),
      text: match[3].trim().toLowerCase()
    });
  }
});

const repetitions = [];
for (let i = 0; i < segments.length - 1; i++) {
  if (segments[i].cut) continue;
  
  let repeatCount = 1;
  let j = i + 1;
  
  while (j < segments.length && segments[j].text === segments[i].text && segments[j].cut === false) {
    repeatCount++;
    j++;
  }
  
  if (repeatCount >= 2) {
    repetitions.push({
      start: segments[i].id,
      end: segments[j - 1].id,
      count: repeatCount,
      text: segments[i].text
    });
    i = j - 1;
  }
}

console.log('Found ' + repetitions.length + ' repetition patterns:\n');
repetitions.slice(0, 50).forEach(r => {
  const displayText = r.text.length > 50 ? r.text.substring(0, 50) + '...' : r.text;
  console.log('[' + r.start + '-' + r.end + '] "' + displayText + '" x' + r.count);
});

if (repetitions.length > 50) {
  console.log('\n... and ' + (repetitions.length - 50) + ' more');
}

export { repetitions, segments };
