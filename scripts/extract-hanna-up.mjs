#!/usr/bin/env node
/**
 * 阪奈上り：Apple Maps 赤線ストローク中心を追跡 → hanna_up
 */
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import jpeg from 'jpeg-js';
import { extractHannaUpStroke, resampleChain } from './hanna-up-path-core.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function writeDebugSvg(chain, w, h, outPath) {
  const pts = chain.map((p) => `${p.x},${p.y}`).join(' ');
  const svg = `<?xml version="1.0"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <image href="../assets/hanna-up-map.png" width="${w}" height="${h}" opacity="0.85"/>
  <polyline points="${pts}" fill="none" stroke="#00e5ff" stroke-width="3" stroke-linecap="round"/>
</svg>`;
  writeFileSync(outPath, svg);
}

const file = join(root, 'assets/hanna-up-map.png');
const img = jpeg.decode(readFileSync(file), { useTArray: true });
const { width: w, height: h, data } = img;

const result = extractHannaUpStroke(data, w, h);
if (!result?.chain?.length) {
  console.error('赤線ストローク追跡失敗');
  process.exit(1);
}

writeDebugSvg(result.chain, w, h, join(root, 'scripts/hanna-up-debug.svg'));

const path = resampleChain(result.chain, w, h, 220);
if (!path?.length) {
  console.error('リサンプル失敗');
  process.exit(1);
}

const paths = JSON.parse(readFileSync(join(root, 'scripts/extracted-paths.json'), 'utf8'));
paths.hanna_up = path;
writeFileSync(join(root, 'scripts/extracted-paths.json'), JSON.stringify(paths, null, 2));

console.log('hanna_up:', path.length, 'pts', `chain=${result.chain.length}`);
console.log('S', path[0], 'F', path[path.length - 1]);
console.log('debug: scripts/hanna-up-debug.svg');
