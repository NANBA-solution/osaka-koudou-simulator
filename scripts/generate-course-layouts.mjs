#!/usr/bin/env node
/**
 * 公道コースのレイアウト図（白線・赤マーカー・チェッカー背景）
 * パス座標は地図と同じ UV (0–1) で出力しシミュレーターと一致させる
 */
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const paths = JSON.parse(readFileSync(join(root, 'scripts/extracted-paths.json'), 'utf8'));

const META = {
  shigisan: {
    title: '信貴山',
    landmarks: [
      { u: 0.2389, v: 0.833, label: 'S' },
      { u: 0.455, v: 0.395, label: '鳴川峠' },
      { u: 0.36, v: 0.755, label: '十三峠' },
      { u: 0.8161, v: 0.1533, label: 'F' }
    ]
  },
  saruyama: {
    title: '猿山',
    landmarks: [
      { u: 0.1036, v: 0.1895, label: 'S' },
      { u: 0.51, v: 0.47, label: '雲隣展望台' },
      { u: 0.46, v: 0.525, label: '箕面大滝' },
      { u: 0.585, v: 0.655, label: '風呂谷口' },
      { u: 0.7822, v: 0.7383, label: 'F' }
    ]
  },
  hanna: {
    title: '阪奈 府道8号',
    landmarks: [
      { u: 0.482, v: 0.4473, label: 'S' },
      { u: 0.595, v: 0.515, label: '中垣内' },
      { u: 0.718, v: 0.738, label: '南ループ' },
      { u: 0.84, v: 0.534, label: '府道8号' },
      { u: 0.8609, v: 0.3647, label: 'F' }
    ]
  }
};

function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
}

function buildSvg(id, path, meta) {
  const linePts = path.map(([u, v]) => `${u},${v}`).join(' ');
  const markers = meta.landmarks
    .map((lm) => {
      return `  <circle cx="${lm.u}" cy="${lm.v}" r="0.012" fill="#e02020"/>
  <text x="${lm.u + 0.018}" y="${lm.v + 0.005}" fill="#e02020" font-family="Hiragino Sans,Yu Gothic,sans-serif" font-size="0.028" font-weight="bold">${esc(lm.label)}</text>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1" preserveAspectRatio="xMidYMid meet">
  <defs>
    <pattern id="chk-${id}" width="0.04" height="0.04" patternUnits="userSpaceOnUse">
      <rect width="0.04" height="0.04" fill="#dcdcdc"/>
      <rect width="0.02" height="0.02" fill="#efefef"/>
      <rect x="0.02" y="0.02" width="0.02" height="0.02" fill="#efefef"/>
    </pattern>
  </defs>
  <rect width="1" height="1" fill="url(#chk-${id})"/>
  <text x="0.03" y="0.05" fill="#555" font-family="JetBrains Mono,monospace" font-size="0.035" font-weight="bold">${esc(meta.title)}</text>
  <polyline points="${linePts}" fill="none" stroke="rgba(50,50,55,0.4)" stroke-width="0.014" stroke-linecap="round" stroke-linejoin="round" transform="translate(0.004,0.006)"/>
  <polyline points="${linePts}" fill="none" stroke="#ffffff" stroke-width="0.012" stroke-linecap="round" stroke-linejoin="round"/>
${markers}
</svg>
`;
}

for (const [id, meta] of Object.entries(META)) {
  const path = paths[id];
  if (!path?.length) {
    console.error(`missing path: ${id}`);
    process.exit(1);
  }
  writeFileSync(join(root, `assets/${id}-layout.svg`), buildSvg(id, path, meta));
  console.log(`wrote assets/${id}-layout.svg`);
}
