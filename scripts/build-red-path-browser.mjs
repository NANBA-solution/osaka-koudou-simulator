#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let s = readFileSync(join(root, 'scripts/red-path-core.mjs'), 'utf8');
s = s.replace(/\/\*\*[\s\S]*?\*\//, '');
s = s.replace(/^export function /gm, 'function ');
s = s.replace(/^export /gm, '');
s = `/* 🔴→🔴 ピン間BFS — red-path-core.mjs と同期 (自動生成) */\nconst RedPath = (function () {\n'use strict';\n${s}\nreturn { extractPinToPinPath, extractPathFromRgba };\n})();\nif (typeof window !== 'undefined') window.RedPath = RedPath;\n`;
writeFileSync(join(root, 'scripts/red-path-browser.js'), s);
console.log('scripts/red-path-browser.js updated');
