#!/usr/bin/env node
/** 環状コース：時計回りの滑らかな閉ループ（地図4隅＋S/F） */
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** 時計回り：計測基点S → 淀屋橋 → 北浜 → 道頓堀 → 難波 → S */
const WAYPOINTS = [
  [0.207, 0.461],
  [0.22, 0.14],
  [0.75, 0.17],
  [0.78, 0.8],
  [0.18, 0.8]
];

function catmullRomPoint(p0, p1, p2, p3, t) {
  const t2 = t * t;
  const t3 = t2 * t;
  const u =
    0.5 *
    (2 * p1[0] +
      (-p0[0] + p2[0]) * t +
      (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 +
      (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3);
  const v =
    0.5 *
    (2 * p1[1] +
      (-p0[1] + p2[1]) * t +
      (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 +
      (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3);
  return [u, v];
}

function catmullRomClosed(pts, nPerSeg) {
  const m = pts.length;
  const out = [];
  for (let i = 0; i < m; i++) {
    const p0 = pts[(i - 1 + m) % m];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % m];
    const p3 = pts[(i + 2) % m];
    for (let j = 0; j < nPerSeg; j++) {
      const t = j / nPerSeg;
      const [u, v] = catmullRomPoint(p0, p1, p2, p3, t);
      out.push([Math.round(u * 10000) / 10000, Math.round(v * 10000) / 10000]);
    }
  }
  return out;
}

function chaikin(path, iter = 2) {
  let pts = path.slice();
  for (let n = 0; n < iter; n++) {
    const next = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      next.push(
        [a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25],
        [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]
      );
    }
    pts = next;
  }
  return pts;
}

function resampleUniform(path, nPts) {
  const lens = [0];
  for (let i = 1; i < path.length; i++) {
    lens.push(lens[i - 1] + Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]));
  }
  const total = lens[lens.length - 1] || 1;
  const out = [];
  for (let i = 0; i < nPts; i++) {
    const target = (i / (nPts - 1)) * total;
    let j = 1;
    while (j < lens.length && lens[j] < target) j++;
    const t = (target - lens[j - 1]) / (lens[j] - lens[j - 1] || 1);
    const a = path[j - 1];
    const b = path[Math.min(j, path.length - 1)];
    out.push([
      Math.round((a[0] + (b[0] - a[0]) * t) * 10000) / 10000,
      Math.round((a[1] + (b[1] - a[1]) * t) * 10000) / 10000
    ]);
  }
  return out;
}

let path = catmullRomClosed(WAYPOINTS, 32);
path = chaikin(path, 2);
path = resampleUniform(path, 120);
path[path.length - 1] = [path[0][0], path[0][1]];

const extracted = JSON.parse(readFileSync(join(root, 'scripts/extracted-paths.json'), 'utf8'));
extracted.kanjo = path;
writeFileSync(join(root, 'scripts/extracted-paths.json'), JSON.stringify(extracted, null, 2));

const span = Math.hypot(path[0][0] - path.at(-1)[0], path[0][1] - path.at(-1)[1]);
console.log('kanjo smooth:', path.length, 'pts, close span', span.toFixed(5));
console.log('S', path[0], 'mid', path[Math.floor(path.length / 4)]);
