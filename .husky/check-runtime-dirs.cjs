#!/usr/bin/env node
'use strict';

/**
 * Checks that any new mkdirSync/mkdir calls in the diff target directories that
 * are already covered by .gitignore. Runtime-generated directories must never be
 * committed — but they frequently are when a new module creates one and .gitignore
 * is not updated in the same PR.
 *
 * Only inspects simple string-literal paths (single or double quoted). Template
 * literals and variable-based paths are skipped to avoid false positives.
 */

const { execSync } = require('child_process');
const fs = require('fs');

const gitignore = fs.existsSync('.gitignore') ? fs.readFileSync('.gitignore', 'utf8') : '';

let diff;
try {
  diff = execSync("git diff origin/main...HEAD -- '*.ts' '*.tsx' '*.js'", {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
} catch {
  // No origin/main yet (first push) or diff failed — skip
  process.exit(0);
}

const addedLines = diff.split('\n').filter(l => l.startsWith('+') && !l.startsWith('+++'));
const mkdirLines = addedLines.filter(l => /(mkdirSync|mkdir)\s*\(/.test(l));

const failures = [];
for (const line of mkdirLines) {
  const m = line.match(/(?:mkdirSync|mkdir)\s*\(\s*['"]([^'"]+)['"]/);
  if (!m) continue;

  const dir = m[1];
  // Skip absolute paths and dynamic values
  if (/^\/tmp|^\/var|\$\{|process\./.test(dir)) continue;

  const root = dir.replace(/^\.\//, '').split('/')[0];
  if (!root) continue;

  // Check if root directory (or its dotted variant) appears in .gitignore
  const escaped = root.replace(/\./g, '\\.');
  const covered = new RegExp('(^|\\n)/?' + escaped + '(/|$|\\n)').test(gitignore);
  if (!covered) {
    failures.push(`  mkdirSync('${dir}')  →  add '${root}/' to .gitignore`);
  }
}

if (failures.length > 0) {
  console.error('✗ New runtime directories not covered by .gitignore:');
  failures.forEach(f => console.error(f));
  console.error('  Runtime-generated directories must never be committed.');
  process.exit(1);
}
