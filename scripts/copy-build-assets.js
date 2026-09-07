#!/usr/bin/env node

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const outputDirectory = path.join(projectRoot, 'dist', 'scripts');
const assetNames = [
  'cleanup-categories.js',
  'sync-categories-to-stores.js',
  'sync-master-skus-to-stores.js',
  'merge-store-15-duplicate-products.js',
  'merge-store-15-duplicate-brands.js',
  'normalize-barcode-whitespace.js',
  'strip-aim-barcode-prefix.js',
];

fs.mkdirSync(outputDirectory, { recursive: true });
for (const assetName of assetNames) {
  const sourceFile = path.join(__dirname, assetName);
  const outputFile = path.join(outputDirectory, assetName);
  fs.copyFileSync(sourceFile, outputFile);
  fs.chmodSync(outputFile, 0o755);
  console.log(`Copied script to ${path.relative(projectRoot, outputFile)}`);
}
