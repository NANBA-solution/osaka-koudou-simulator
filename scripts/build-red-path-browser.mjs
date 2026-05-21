#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
function stripExports(src) {
  return src
    .replace(/\/\*\*[\s\S]*?\*\//g, '')
    .replace(/^export function /gm, 'function ')
    .replace(/^export /gm, '');
}
let s = stripExports(readFileSync(join(root, 'scripts/red-path-core.mjs'), 'utf8'));
s = s.replace(/function extractPathFromRgba[\s\S]*?^}/m, '');
let h = stripExports(readFileSync(join(root, 'scripts/hanna-up-path-core.mjs'), 'utf8'));
h = h.replace(/^import .*$/gm, '');
const entry = `
function extractPathFromRgba(data, w, h, opts) {
  opts = opts || {};
  if (opts.hannaUpRoute) {
    const r = extractHannaUpStroke(data, w, h);
    return r ? resampleChain(r.chain, w, h, opts.nPts || 220) : null;
  }
  if (opts.kanjoLoop || opts.kanjoSmooth) return extractKanjoLoopPath(data, w, h, opts);
  if (opts.markerPair || opts.hannaRoute) return extractMarkerPairPath(data, w, h, opts);
  return extractPinToPinPath(data, w, h, opts);
}
`;
s = `/* red-path-core + hanna-up-path-core (自動生成) */\nconst RedPath = (function () {\n'use strict';\n${s}\n${h}\n${entry}\nreturn { extractPinToPinPath, extractPathFromRgba, extractHannaUpStroke };\n})();\nif (typeof window !== 'undefined') window.RedPath = RedPath;\n`;
writeFileSync(join(root, 'scripts/red-path-browser.js'), s);
console.log('scripts/red-path-browser.js updated');
