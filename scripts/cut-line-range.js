#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const docPath = path.join(__dirname, '..', 'public', 'edit', 'transcript.doc.txt');
const jsonPath = path.join(__dirname, '..', 'public', 'edit', 'transcript.json');

// Parse line range from arguments
const startLine = parseInt(process.argv[2]) || 780;
const endLine = parseInt(process.argv[3]) || 1211;

const lines = fs.readFileSync(docPath, 'utf8').split('\n');
const segPattern = /^(-?)\[([0-9]+)\]/;

let firstSeg = null;
let lastSeg = null;

// Find segment range in line range (0-indexed, so subtract 1)
for (let i = startLine - 1; i < endLine && i < lines.length; i++) {
  const match = lines[i].match(segPattern);
  if (match) {
    const segId = parseInt(match[2]);
    if (firstSeg === null) firstSeg = segId;
    lastSeg = segId;
  }
}

console.log(`Lines ${startLine}-${endLine} contain segments: [${firstSeg}] to [${lastSeg}]`);

const t = JSON.parse(fs.readFileSync(jsonPath));
const inRange = t.segments.filter(s => s.id >= firstSeg && s.id <= lastSeg);
const alreadyCut = inRange.filter(s => s.cut).length;
const notCut = inRange.filter(s => s.cut === false);

console.log('Already cut:', alreadyCut);
console.log('Need to cut:', notCut.length);
console.log('\nMarking segments for cutting...\n');

// Apply cuts
let doc = fs.readFileSync(docPath, 'utf8');
notCut.forEach(seg => {
  const pattern = '[' + seg.id + ']  ';
  const replacement = '-[' + seg.id + ']  ';
  doc = doc.split(pattern).join(replacement);
});

fs.writeFileSync(docPath, doc);
console.log('✓ Marked ' + notCut.length + ' segments to be cut');
console.log('  Segment range: [' + firstSeg + '] to [' + lastSeg + ']');
console.log('  Run: npm run transcript:merge');
