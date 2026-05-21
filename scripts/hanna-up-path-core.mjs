/**
 * 阪奈上り：Apple Maps 赤線＋🔴（大赤丸）まで
 * S=🔴（中垣内・RSタイチ側府道）→ 赤線スイッチバック → F=東端
 */
import { buildRedMask, maskReachableFromStart, nearestRed, bfsPath } from './red-path-core.mjs';

const DIRS8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]];

export function maskExcludeUi(mask, w, h) {
  const out = Uint8Array.from(mask);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const u = x / w;
      const v = y / h;
      if (v > 0.8 || v < 0.11) out[y * w + x] = 0;
      if (v > 0.73 && u > 0.4 && u < 0.6) out[y * w + x] = 0;
    }
  }
  return out;
}

/** 画像上の大きな🔴（ルート終点マーカー） */
export function findBigRedDot(data, w, h, crop) {
  const isDot = (r, g, b) => r > 200 && g < 85 && b < 85 && r - Math.max(g, b) > 55;
  const visited = new Uint8Array(w * h);
  let best = null;
  let bestN = 0;

  const flood = (sx, sy) => {
    const comp = [];
    const stack = [[sx, sy]];
    visited[sy * w + sx] = 1;
    while (stack.length) {
      const [x, y] = stack.pop();
      comp.push([x, y]);
      for (const [dx, dy] of DIRS8.slice(0, 4)) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const k = ny * w + nx;
        const i = k * 4;
        if (!visited[k] && isDot(data[i], data[i + 1], data[i + 2])) {
          visited[k] = 1;
          stack.push([nx, ny]);
        }
      }
    }
    return comp;
  };

  for (let y = crop.y0; y < crop.y1; y++) {
    for (let x = crop.x0; x < crop.x1; x++) {
      const k = w * y + x;
      const i = k * 4;
      if (!isDot(data[i], data[i + 1], data[i + 2]) || visited[k]) continue;
      const comp = flood(x, y);
      if (comp.length < 120 || comp.length > 6000) continue;
      if (comp.length > bestN) {
        let sx = 0;
        let sy = 0;
        for (const [px, py] of comp) {
          sx += px;
          sy += py;
        }
        bestN = comp.length;
        best = { x: sx / comp.length, y: sy / comp.length };
      }
    }
  }
  return best;
}

function dist2(a, b) {
  return (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
}

function norm(dx, dy) {
  const l = Math.hypot(dx, dy) || 1;
  return { x: dx / l, y: dy / l };
}

function branchReach(mask, w, h, from, forbid) {
  const dist = new Int32Array(w * h);
  dist.fill(-1);
  const q = [[from.x, from.y]];
  dist[from.y * w + from.x] = 0;
  let maxU = from.x / w;
  let px = 0;
  while (q.length) {
    const [x, y] = q.shift();
    px++;
    maxU = Math.max(maxU, x / w);
    for (const [dx, dy] of DIRS8) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const k = ny * w + nx;
      if (!mask[k] || dist[k] >= 0) continue;
      if (forbid && forbid[k]) continue;
      dist[k] = dist[y * w + x] + 1;
      q.push([nx, ny]);
    }
  }
  return { maxU, px };
}

function walkRoute(mask, w, h, start, goal) {
  const visited = new Uint8Array(w * h);
  const path = [{ ...start }];
  let cur = { ...start };
  let prev = null;

  for (let step = 0; step < 30000; step++) {
    if (dist2(cur, goal) < 20) {
      path.push({ ...goal });
      return path;
    }

    const nbrs = [];
    for (const [dx, dy] of DIRS8) {
      const nx = cur.x + dx;
      const ny = cur.y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const k = ny * w + nx;
      if (!mask[k] || visited[k]) continue;
      nbrs.push({ x: nx, y: ny });
    }
    if (!nbrs.length) break;

    const toGoal = norm(goal.x - cur.x, goal.y - cur.y);
    const head = prev ? norm(cur.x - prev.x, cur.y - prev.y) : toGoal;

    let best = null;
    let bestScore = -1e18;
    for (const n of nbrs) {
      const toN = norm(n.x - cur.x, n.y - cur.y);
      const align = toN.x * head.x + toN.y * head.y;
      const goalA = toN.x * toGoal.x + toN.y * toGoal.y;
      const reach = branchReach(mask, w, h, n, visited);
      const score = align * 7 + goalA * 4 + reach.maxU * 600 + reach.px * 0.01;
      if (score > bestScore) {
        bestScore = score;
        best = n;
      }
    }
    if (!best) break;
    prev = cur;
    cur = best;
    visited[cur.y * w + cur.x] = 1;
    path.push({ ...cur });
  }
  return path.length > 60 ? path : null;
}

function findEastEnd(mask, w, h) {
  let best = null;
  let score = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      const u = x / w;
      const v = y / h;
      if (u < 0.86 || v < 0.38 || v > 0.56) continue;
      const s = u * 5 - Math.abs(v - 0.455) * 0.4;
      if (s > score) {
        score = s;
        best = { x, y };
      }
    }
  }
  return best;
}

function concatChains(chains) {
  const out = [];
  for (const ch of chains) {
    if (!ch?.length) continue;
    const start = out.length ? 1 : 0;
    for (let i = start; i < ch.length; i++) out.push(ch[i]);
  }
  return out.length ? out : null;
}

const MAX_SEG = 100;

/** 赤線の曲がり角（🔴→東、画像精密） */
const CORNER_UV = [
  [0.173, 0.508],
  [0.145, 0.513],
  [0.155, 0.535],
  [0.18, 0.555],
  [0.22, 0.565],
  [0.28, 0.575],
  [0.35, 0.575],
  [0.39, 0.548],
  [0.392, 0.528],
  [0.42, 0.542],
  [0.455, 0.562],
  [0.5, 0.578],
  [0.55, 0.582],
  [0.6, 0.582],
  [0.63, 0.655],
  [0.665, 0.678],
  [0.702, 0.672],
  [0.705, 0.652],
  [0.688, 0.638],
  [0.648, 0.648],
  [0.598, 0.648],
  [0.548, 0.638],
  [0.498, 0.618],
  [0.448, 0.602],
  [0.421, 0.592],
  [0.391, 0.568],
  [0.391, 0.548],
  [0.419, 0.542],
  [0.455, 0.561],
  [0.514, 0.58],
  [0.577, 0.582],
  [0.638, 0.582],
  [0.668, 0.592],
  [0.683, 0.618],
  [0.683, 0.648],
  [0.706, 0.655],
  [0.759, 0.648],
  [0.803, 0.632],
  [0.825, 0.605],
  [0.828, 0.575],
  [0.808, 0.53],
  [0.808, 0.482],
  [0.894, 0.453]
];

function connectSegment(mask, w, h, u0, v0, u1, v1, depth = 0) {
  const a = nearestRed(mask, w, h, u0 * w, v0 * h, 45);
  const b = nearestRed(mask, w, h, u1 * w, v1 * h, 45);
  if (!a || !b) return null;
  const seg = bfsPath(mask, w, h, a, b);
  if (!seg) return null;
  if (seg.length <= MAX_SEG || depth > 8) return seg;
  const um = (u0 + u1) / 2;
  const vm = (v0 + v1) / 2;
  const s1 = connectSegment(mask, w, h, u0, v0, um, vm, depth + 1);
  const s2 = connectSegment(mask, w, h, um, vm, u1, v1, depth + 1);
  if (!s1 || !s2) return seg;
  return s1.concat(s2.slice(1));
}

function connectCorners(mask, w, h) {
  const chains = [];
  for (let i = 0; i < CORNER_UV.length - 1; i++) {
    const seg = connectSegment(mask, w, h, CORNER_UV[i][0], CORNER_UV[i][1], CORNER_UV[i + 1][0], CORNER_UV[i + 1][1]);
    if (!seg || seg.length < 2) return null;
    chains.push(seg);
  }
  return concatChains(chains);
}

export function resampleChain(chain, w, h, nPts) {
  if (!chain?.length) return null;
  const lens = [0];
  for (let i = 1; i < chain.length; i++) {
    lens.push(lens[i - 1] + Math.hypot(chain[i].x - chain[i - 1].x, chain[i].y - chain[i - 1].y));
  }
  const total = lens[lens.length - 1] || 1;
  const out = [];
  for (let i = 0; i < nPts; i++) {
    const target = (i / (nPts - 1)) * total;
    let j = 1;
    while (j < lens.length && lens[j] < target) j++;
    const t = (target - lens[j - 1]) / (lens[j] - lens[j - 1] || 1);
    const a = chain[j - 1];
    const b = chain[Math.min(j, chain.length - 1)];
    out.push([
      Math.round(((a.x + (b.x - a.x) * t) / w) * 10000) / 10000,
      Math.round(((a.y + (b.y - a.y) * t) / h) * 10000) / 10000
    ]);
  }
  return out;
}

export function extractHannaUpStroke(data, w, h) {
  const crop = {
    y0: Math.floor(h * 0.1),
    y1: Math.floor(h * 0.78),
    x0: Math.floor(w * 0.02),
    x1: Math.floor(w * 0.98)
  };

  const base = maskExcludeUi(buildRedMask(data, w, h, crop), w, h);
  const dot = findBigRedDot(data, w, h, crop);
  if (!dot) return null;

  const dotSnap = nearestRed(base, w, h, dot.x, dot.y, 35);
  if (!dotSnap) return null;

  const routed = maskReachableFromStart(base, w, h, dotSnap.x / w, dotSnap.y / h, 0);
  if (!routed?.mask) return null;

  const mask = routed.mask;
  const east = findEastEnd(mask, w, h);
  if (!east) return null;

  let chain = connectCorners(mask, w, h);
  const walked = walkRoute(mask, w, h, dotSnap, east);

  if (walked && walked.length > (chain?.length || 0) * 0.7) {
    chain = walked;
  }
  if (!chain || chain.length < 80) {
    chain = bfsPath(mask, w, h, dotSnap, east);
  }
  if (!chain?.length) return null;

  chain[0] = { ...dotSnap };
  chain[chain.length - 1] = { ...east };

  const bridge = bfsPath(mask, w, h, chain[0], dotSnap);
  if (bridge?.length && bridge.length < 80) {
    chain = bridge.slice(0, -1).concat(chain);
  }

  return { chain, start: dotSnap, goal: east, dot };
}
