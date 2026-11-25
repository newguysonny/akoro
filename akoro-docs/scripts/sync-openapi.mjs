#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const source = path.resolve('../akoro-documentation/02-api/openapi.yaml');
const target = path.resolve('openapi/akoro.yaml');

if (!fs.existsSync(source)) {
  if (fs.existsSync(target)) {
    console.warn('Internal OpenAPI source not present (deploy root); using committed openapi/akoro.yaml.');
    process.exit(0);
  }
  console.error('OpenAPI source not found and no committed copy exists.');
  process.exit(1);
}

fs.mkdirSync(path.dirname(target), { recursive: true });
fs.copyFileSync(source, target);
console.log(`Synced ${source} -> ${target}`);
