/**
 * 参照画像: 🔴始点ピン → 赤線上BFS → 🔴終点ピン を忠実再現
 */

export function isCourseRed(r, g, b) {
  if (r < 55) return false;
  const gb = Math.max(g, b);
  if (r - gb > 18 && r > 68) return true;
  if (r > 115 && g < 95 && b < 95 && r > g + 30) return true;
  return false;
}

export function isPinRed(r, g, b) {
  return r > 140 && g < 100 && b < 100 && r - Math.max(g, b) > 50;
}

export function buildRedMask(data, w, h, crop) {
  const { y0, y1, x0, x1 } = crop;
  const mask = new Uint8Array(w * h);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (w * y + x) * 4;
      if (isCourseRed(data[i], data[i + 1], data[i + 2])) mask[w * y + x] = 1;
    }
  }
  return mask;
}

function buildPinMask(data, w, h, crop) {
  const { y0, y1, x0, x1 } = crop;
  const mask = new Uint8Array(w * h);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (w * y + x) * 4;
      if (isPinRed(data[i], data[i + 1], data[i + 2])) mask[w * y + x] = 1;
    }
  }
  return mask;
}

function dilate(mask, w, h, radius) {
  if (!radius) return mask;
  const out = new Uint8Array(mask);
  for (let y = radius; y < h - radius; y++) {
    for (let x = radius; x < w - radius; x++) {
      if (mask[y * w + x]) continue;
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (mask[(y + dy) * w + (x + dx)]) {
            out[y * w + x] = 1;
            break;
          }
        }
        if (out[y * w + x]) break;
      }
    }
  }
  return out;
}

function findPinBlobs(pinMask, w, h) {
  const visited = new Uint8Array(w * h);
  const pins = [];
  const flood = (sx, sy) => {
    const comp = [];
    const stack = [[sx, sy]];
    visited[sy * w + sx] = 1;
    while (stack.length) {
      const [x, y] = stack.pop();
      comp.push({ x, y });
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const k = ny * w + nx;
        if (pinMask[k] && !visited[k]) {
          visited[k] = 1;
          stack.push([nx, ny]);
        }
      }
    }
    return comp;
  };

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const k = w * y + x;
      if (!pinMask[k] || visited[k]) continue;
      const comp = flood(x, y);
      if (comp.length < 60 || comp.length > 900) continue;
      let minX = 1e9, maxX = 0, minY = 1e9, maxY = 0, sx = 0, sy = 0;
      for (const p of comp) {
        sx += p.x;
        sy += p.y;
        minX = Math.min(minX, p.x);
        maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y);
        maxY = Math.max(maxY, p.y);
      }
      const box = (maxX - minX + 1) * (maxY - minY + 1);
      if (comp.length / box > 0.28) {
        pins.push({ cx: sx / comp.length, cy: sy / comp.length, n: comp.length });
      }
    }
  }
  return pins;
}

function cornerPixel(corner, w, h) {
  const map = { ul: [0, 0], ur: [w - 1, 0], ll: [0, h - 1], lr: [w - 1, h - 1] };
  const [x, y] = map[corner] || map.ll;
  return { x, y };
}

function pickPinByCorner(pins, corner, w, h) {
  const t = cornerPixel(corner, w, h);
  let best = pins[0];
  let bestD = 1e18;
  for (const p of pins) {
    const d = (p.cx - t.x) ** 2 + (p.cy - t.y) ** 2;
    if (d < bestD) { bestD = d; best = p; }
  }
  return best;
}

function nearestRed(mask, w, h, tx, ty, maxR = 80) {
  const ix = Math.round(tx);
  const iy = Math.round(ty);
  if (ix >= 0 && iy >= 0 && ix < w && iy < h && mask[iy * w + ix]) return { x: ix, y: iy };
  for (let r = 1; r <= maxR; r++) {
    for (let y = iy - r; y <= iy + r; y++) {
      for (let x = ix - r; x <= ix + r; x++) {
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        if (mask[y * w + x]) return { x, y };
      }
    }
  }
  return null;
}

function geodesicFarthest(mask, w, h, start) {
  const dist = new Int32Array(w * h);
  dist.fill(-1);
  const q = [[start.x, start.y]];
  dist[start.y * w + start.x] = 0;
  let far = { x: start.x, y: start.y, d: 0 };
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]];

  while (q.length) {
    const [x, y] = q.shift();
    const d = dist[y * w + x];
    if (d > far.d) far = { x, y, d };
    for (const [dx, dy] of dirs) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const k = ny * w + nx;
      if (!mask[k] || dist[k] >= 0) continue;
      dist[k] = d + 1;
      q.push([nx, ny]);
    }
  }
  return far;
}

function reachableFrom(mask, w, h, sx, sy) {
  const vis = new Uint8Array(w * h);
  const q = [[sx, sy]];
  vis[sy * w + sx] = 1;
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]];
  while (q.length) {
    const [x, y] = q.shift();
    for (const [dx, dy] of dirs) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const k = ny * w + nx;
      if (mask[k] && !vis[k]) {
        vis[k] = 1;
        q.push([nx, ny]);
      }
    }
  }
  return vis;
}

function maskReachableFromStart(baseMask, w, h, startU, startV, dilateR) {
  const dilated = dilate(baseMask, w, h, dilateR);
  const s = nearestRed(dilated, w, h, startU * w, startV * h);
  if (!s) return null;
  const vis = reachableFrom(dilated, w, h, s.x, s.y);
  const out = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    if (dilated[i] && vis[i]) out[i] = 1;
  }
  return { mask: out, start: s };
}

/** 南ループ最下点（日下町側のUターン底） */
function findLoopBottom(mask, w, h, crop) {
  let bx = 0, by = 0, bv = 0;
  for (let y = crop.y0; y < crop.y1; y++) {
    for (let x = crop.x0; x < crop.x1; x++) {
      if (!mask[w * y + x]) continue;
      const u = x / w, v = y / h;
      if (v < 0.62 || v > 0.82 || u < 0.32 || u > 0.72) continue;
      if (v > bv) { bv = v; bx = x; by = y; }
    }
  }
  return bv > 0 ? { x: bx, y: by } : null;
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

function bfsPath(mask, w, h, start, end) {
  const key = (x, y) => y * w + x;
  const endK = key(end.x, end.y);
  const prev = new Map();
  const q = [[start.x, start.y]];
  prev.set(key(start.x, start.y), null);
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]];

  while (q.length) {
    const [x, y] = q.shift();
    const k = key(x, y);
    if (k === endK) {
      const path = [];
      let cur = k;
      while (cur != null) {
        path.push({ x: cur % w, y: (cur / w) | 0 });
        cur = prev.get(cur);
      }
      return path.reverse();
    }
    for (const [dx, dy] of dirs) {
      const nx = x + dx, ny = y + dy;
      const nk = key(nx, ny);
      if (nx < 0 || ny < 0 || nx >= w || ny >= h || !mask[nk] || prev.has(nk)) continue;
      prev.set(nk, k);
      q.push([nx, ny]);
    }
  }
  return null;
}

function resampleChain(chain, w, h, nPts) {
  if (!chain || chain.length < 2) return null;
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

function pathSpanUv(path) {
  if (!path?.length) return 0;
  return Math.hypot(path[0][0] - path[path.length - 1][0], path[0][1] - path[path.length - 1][1]);
}

/** 地図上の🔴始終点マーカー（濃い赤の丸） */
function isMarkerRed(r, g, b) {
  return r > 175 && g < 75 && b < 75 && r - Math.max(g, b) > 90;
}

function findRouteMarkerDots(data, w, h, crop) {
  const { y0, y1, x0, x1 } = crop;
  const mask = new Uint8Array(w * h);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (w * y + x) * 4;
      if (isMarkerRed(data[i], data[i + 1], data[i + 2])) mask[w * y + x] = 1;
    }
  }
  const visited = new Uint8Array(w * h);
  const dots = [];
  const flood = (sx, sy) => {
    const comp = [];
    const stack = [[sx, sy]];
    visited[sy * w + sx] = 1;
    while (stack.length) {
      const [x, y] = stack.pop();
      comp.push({ x, y });
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const k = ny * w + nx;
        if (mask[k] && !visited[k]) {
          visited[k] = 1;
          stack.push([nx, ny]);
        }
      }
    }
    return comp;
  };

  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const k = w * y + x;
      if (!mask[k] || visited[k]) continue;
      const comp = flood(x, y);
      if (comp.length < 40 || comp.length > 350) continue;
      let minX = 1e9, maxX = 0, minY = 1e9, maxY = 0, sx = 0, sy = 0;
      for (const p of comp) {
        sx += p.x;
        sy += p.y;
        minX = Math.min(minX, p.x);
        maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y);
        maxY = Math.max(maxY, p.y);
      }
      const box = (maxX - minX + 1) * (maxY - minY + 1);
      if (comp.length / box < 0.3) continue;
      dots.push({
        cx: sx / comp.length,
        cy: sy / comp.length,
        u: sx / comp.length / w,
        v: sy / comp.length / h
      });
    }
  }
  return dots.sort((a, b) => a.cx - b.cx);
}

/** 終点🔴が赤線と癒着しているとき東側クラスタ重心を取る */
function findEastEndMarker(data, w, h, crop) {
  const { y0, y1, x0, x1 } = crop;
  let sx = 0, sy = 0, n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const u = x / w, v = y / h;
      if (u < 0.6 || v < 0.44 || v > 0.64) continue;
      const i = (w * y + x) * 4;
      if (isMarkerRed(data[i], data[i + 1], data[i + 2])) {
        sx += x;
        sy += y;
        n++;
      }
    }
  }
  if (n < 8) return null;
  return { cx: sx / n, cy: sy / n, u: sx / n / w, v: sy / n / h };
}

/** 終点🔴（北側・十三峠手前の濃赤マーカー） */
function findNorthFinishMarker(data, w, h, crop) {
  const dots = findRouteMarkerDots(data, w, h, crop);
  const north = dots.filter((d) => d.u > 0.78 && d.v < 0.42);
  if (!north.length) return null;
  north.sort((a, b) => a.v - b.v);
  return north[0];
}

/** 府道8号→F の坂道区間で東側の誤ショートカットを遮断 */
function maskForClimbSegment(mask, w, h, crop) {
  const out = new Uint8Array(mask);
  for (let y = crop.y0; y < crop.y1; y++) {
    for (let x = crop.x0; x < crop.x1; x++) {
      const u = x / w, v = y / h;
      if (u > 0.91 && v > 0.43 && v < 0.55) out[y * w + x] = 0;
    }
  }
  return out;
}

/** 府道8号表示付近（東側帯の北向き折れ点＝坂道クライム手前） */
function findRoad8Junction(mask, w, h, crop) {
  let bx = 0, by = 0, bestV = 1;
  for (let y = crop.y0; y < crop.y1; y++) {
    for (let x = crop.x0; x < crop.x1; x++) {
      if (!mask[w * y + x]) continue;
      const u = x / w, v = y / h;
      if (u < 0.74 || u > 0.9 || v < 0.44 || v > 0.58) continue;
      if (v < bestV) {
        bestV = v;
        bx = x;
        by = y;
      }
    }
  }
  if (bestV >= 1) return nearestRed(mask, w, h, 0.835 * w, 0.525 * h);
  return { x: bx, y: by };
}

/** 阪奈など：🔴マーカー2点間（北側の誤ルートを除外） */
function resolveEndpointsMarkers(data, routeMask, w, h, crop) {
  const dots = findRouteMarkerDots(data, w, h, crop);
  const filtered = dots.filter((d) => !(d.u > 0.72 && d.v < 0.42));
  if (filtered.length < 1) return null;

  const startDot = filtered[0];
  const eastEnd = findEastEndMarker(data, w, h, crop);
  const endDot = eastEnd || filtered[filtered.length - 1];

  const startPt = nearestRed(routeMask, w, h, startDot.cx, startDot.cy);
  const endPt = nearestRed(routeMask, w, h, endDot.cx, endDot.cy);
  if (!startPt || !endPt) return null;
  return { startPt, endPt, startDot, endDot };
}

function resolveEndpoints(routeMask, pinMask, w, h, startCorner) {
  const pins = findPinBlobs(pinMask, w, h);
  let startPt;

  if (pins.length >= 1) {
    const startPin = pickPinByCorner(pins, startCorner, w, h);
    startPt = nearestRed(routeMask, w, h, startPin.cx, startPin.cy);
  } else {
    const c = cornerPixel(startCorner, w, h);
    startPt = nearestRed(routeMask, w, h, c.x, c.y);
  }

  if (!startPt) return null;

  const far = geodesicFarthest(routeMask, w, h, startPt);
  return { startPt, endPt: { x: far.x, y: far.y }, pins: pins.length };
}

/** 阪奈専用：S→南ループ底→府道8号→F の4段BFS */
export function extractHannaPath(data, w, h, opts = {}) {
  const { nPts = 200, dilate = 4 } = opts;
  const crop = opts.crop ?? {
    y0: Math.floor(h * 0.08),
    y1: Math.floor(h * 0.88),
    x0: Math.floor(w * 0.02),
    x1: Math.floor(w * 0.98)
  };
  const baseMask = buildRedMask(data, w, h, crop);

  const dots = findRouteMarkerDots(data, w, h, crop).filter((d) => !(d.u > 0.72 && d.v < 0.42));
  const startU = dots[0]?.u ?? 0.482;
  const startV = dots[0]?.v ?? 0.447;
  const finish = findNorthFinishMarker(data, w, h, crop);
  if (!finish) return null;

  for (let dil = dilate; dil <= dilate + 2; dil++) {
    const routed = maskReachableFromStart(baseMask, w, h, startU, startV, dil);
    if (!routed) continue;

    const { mask, start } = routed;
    const loopB = findLoopBottom(mask, w, h, crop);
    const road8 = findRoad8Junction(mask, w, h, crop);
    if (!loopB || !road8) continue;

    const lb = nearestRed(mask, w, h, loopB.x, loopB.y);
    const r8 = nearestRed(mask, w, h, road8.x, road8.y);
    const end = nearestRed(mask, w, h, finish.cx, finish.cy);
    if (!lb || !r8 || !end) continue;

    const c1 = bfsPath(mask, w, h, start, lb);
    const c2 = bfsPath(mask, w, h, lb, r8);
    const climbMask = maskForClimbSegment(mask, w, h, crop);
    const c3 = bfsPath(climbMask, w, h, r8, end);
    const chain = concatChains([c1, c2, c3]);
    if (!chain || chain.length < 12) continue;
    const path = resampleChain(chain, w, h, nPts);
    if (!path) continue;
    path[path.length - 1] = [
      Math.round((finish.cx / w) * 10000) / 10000,
      Math.round((finish.cy / h) * 10000) / 10000
    ];
    return path;
  }
  return null;
}

/** 阪奈など：🔴マーカー2点（hannaRoute時は南ループ経由） */
export function extractMarkerPairPath(data, w, h, opts = {}) {
  if (opts.hannaRoute) return extractHannaPath(data, w, h, opts);

  const { nPts = 160, dilateMin = 2, dilateMax = 6 } = opts;
  const crop = opts.crop ?? {
    y0: Math.floor(h * 0.08),
    y1: Math.floor(h * 0.88),
    x0: Math.floor(w * 0.02),
    x1: Math.floor(w * 0.98)
  };
  const baseMask = buildRedMask(data, w, h, crop);

  let bestPath = null;
  let bestLen = 0;

  for (let dil = dilateMin; dil <= dilateMax; dil++) {
    const routeMask = dilate(baseMask, w, h, dil);
    const ep = resolveEndpointsMarkers(data, routeMask, w, h, crop);
    if (!ep) continue;
    const chain = bfsPath(routeMask, w, h, ep.startPt, ep.endPt);
    if (!chain || chain.length < 8) continue;
    if (chain.length > bestLen) {
      bestLen = chain.length;
      bestPath = resampleChain(chain, w, h, nPts);
    }
  }
  return bestPath;
}

/** 環状線：地図4隅を時計回りスプライン（ギザギザ防止） */
export function extractKanjoLoopPath(data, w, h, opts = {}) {
  const nPts = opts.nPts ?? 120;
  const waypoints = [
    [0.207, 0.461],
    [0.22, 0.14],
    [0.75, 0.17],
    [0.78, 0.8],
    [0.18, 0.8]
  ];
  const m = waypoints.length;
  const dense = [];
  const nPerSeg = Math.max(16, Math.round(nPts / m));
  for (let i = 0; i < m; i++) {
    const p0 = waypoints[(i - 1 + m) % m];
    const p1 = waypoints[i];
    const p2 = waypoints[(i + 1) % m];
    const p3 = waypoints[(i + 2) % m];
    for (let j = 0; j < nPerSeg; j++) {
      const t = j / nPerSeg;
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
      dense.push({ x: u * w, y: v * h });
    }
  }
  return resampleChain(dense, w, h, nPts);
}

export function extractPinToPinPath(data, w, h, opts = {}) {
  if (opts.kanjoLoop || opts.kanjoSmooth) return extractKanjoLoopPath(data, w, h, opts);
  if (opts.markerPair) return extractMarkerPairPath(data, w, h, opts);

  const {
    startCorner = 'll',
    nPts = 120,
    dilateMax = 16,
    minSpanUv = 0.45
  } = opts;

  const crop = opts.crop ?? {
    y0: Math.floor(h * 0.08),
    y1: Math.floor(h * 0.88),
    x0: Math.floor(w * 0.02),
    x1: Math.floor(w * 0.98)
  };

  const baseMask = buildRedMask(data, w, h, crop);
  const pinMask = buildPinMask(data, w, h, crop);

  let bestPath = null;
  let bestSpan = 0;

  for (let dil = 0; dil <= dilateMax; dil++) {
    const routeMask = dilate(baseMask, w, h, dil);
    const ep = resolveEndpoints(routeMask, pinMask, w, h, startCorner);
    if (!ep) continue;

    const chain = bfsPath(routeMask, w, h, ep.startPt, ep.endPt);
    if (!chain || chain.length < 8) continue;

    const path = resampleChain(chain, w, h, nPts);
    const span = pathSpanUv(path);
    if (span > bestSpan) {
      bestSpan = span;
      bestPath = path;
    }
    if (span >= minSpanUv) break;
  }

  return bestPath;
}

/** @deprecated 互換: 新APIへ委譲 */
export function extractPathFromRgba(data, w, h, opts = {}) {
  if (opts.kanjoLoop || opts.kanjoSmooth) return extractKanjoLoopPath(data, w, h, opts);
  if (opts.markerPair || opts.hannaRoute) return extractMarkerPairPath(data, w, h, opts);
  return extractPinToPinPath(data, w, h, {
    startCorner: opts.startCorner ?? 'll',
    nPts: opts.nPts ?? 120,
    dilateMax: opts.dilateMax ?? 6,
    minSpanUv: opts.minSpanUv ?? 0.45
  });
}

export function largestRedComponent() {
  return null;
}

export function traceRedPath() {
  return null;
}
