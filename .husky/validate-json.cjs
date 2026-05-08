#!/usr/bin/env node
// JSON syntax validator — called by lint-staged for staged *.json files
const fs = require('fs');
for (const file of process.argv.slice(2)) {
  try {
    JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    process.stderr.write(`✗ Invalid JSON: ${file}\n  ${e.message}\n`);
    process.exit(1);
  }
}
