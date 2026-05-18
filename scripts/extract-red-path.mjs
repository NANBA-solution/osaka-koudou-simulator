#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import jpeg from 'jpeg-js';
import { extractPinToPinPath } from './red-path-core.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const CONFIG = {
  shigisan: { file: 'assets/shigisan-ref.png', startCorner: 'll', nPts: 140, dilateMax: 4 },
  saruyama: { file: 'assets/minoo-ref.png', startCorner: 'ul', nPts: 140, dilateMax: 4 },
  hanna: { file: 'assets/hanna-ref.png', markerPair: true, hannaRoute: true, nPts: 200, dilate: 4 },
  kanjo: { file: 'assets/kanjo-ref.png', kanjoLoop: true, nPts: 200, dilateMax: 6 }
};

const out = {};
for (const [id, cfg] of Object.entries(CONFIG)) {
  const img = jpeg.decode(readFileSync(join(root, cfg.file)), { useTArray: true });
  const path = extractPinToPinPath(img.data, img.width, img.height, cfg);
  out[id] = path;
  const span = path
    ? Math.hypot(path[0][0] - path.at(-1)[0], path[0][1] - path.at(-1)[1]).toFixed(3)
    : '—';
  console.log(`${id}: ${path?.length ?? 0} pts  S=${JSON.stringify(path?.[0])} F=${JSON.stringify(path?.at(-1))}  span=${span}`);
}

writeFileSync(join(root, 'scripts/extracted-paths.json'), JSON.stringify(out, null, 2));
