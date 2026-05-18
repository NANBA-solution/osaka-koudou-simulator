/** 環状：赤点ランドマーク付近のみコーナー（index.html generateLandmarkCornerProfile と同型） */
export const KANJO_LANDMARKS = [
  { u: 0.2072, v: 0.4571, label: 'S' },
  { u: 0.22, v: 0.14, label: '淀屋橋' },
  { u: 0.75, v: 0.17, label: '北浜' },
  { u: 0.78, v: 0.8, label: '道頓堀' },
  { u: 0.18, v: 0.8, label: '難波' },
  { u: 0.2072, v: 0.4571, label: 'F' }
];

export function buildArc(path) {
  const cum = [0];
  for (let i = 1; i < path.length; i++) {
    cum.push(cum.at(-1) + Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]));
  }
  return { cum, total: cum.at(-1) || 1 };
}

function pathFractionAtLandmark(path, arc, u, v) {
  let bestF = 0;
  let bestD = Infinity;
  for (let i = 0; i < path.length; i++) {
    const d = Math.hypot(path[i][0] - u, path[i][1] - v);
    if (d < bestD) {
      bestD = d;
      bestF = arc.cum[i] / arc.total;
    }
  }
  return bestF;
}

function analyzeSegment(path, arc, f0, f1, totalM, rCap = 650) {
  let prev = [path[0][0], path[0][1]];
  let lenM = 0;
  let heading = null;
  let turn = 0;
  const target = (f) => {
    const t = f * arc.total;
    let i = 0;
    while (i < arc.cum.length - 2 && arc.cum[i + 1] < t - 1e-9) i++;
    const seg = arc.cum[i + 1] - arc.cum[i] || 1;
    const u = (t - arc.cum[i]) / seg;
    return [
      path[i][0] + (path[i + 1][0] - path[i][0]) * u,
      path[i][1] + (path[i + 1][1] - path[i][1]) * u
    ];
  };
  for (let k = 1; k <= 36; k++) {
    const f = f0 + (f1 - f0) * (k / 36);
    const p = target(f);
    const du = p[0] - prev[0];
    const dv = p[1] - prev[1];
    lenM += Math.hypot(du, dv) * (totalM / arc.total);
    const h = Math.atan2(dv, du);
    if (heading !== null) {
      let dh = h - heading;
      while (dh > Math.PI) dh -= 2 * Math.PI;
      while (dh < -Math.PI) dh += 2 * Math.PI;
      turn += Math.abs(dh);
    }
    heading = h;
    prev = p;
  }
  const R = turn > 0.08 ? Math.max(20, Math.min(lenM / turn, rCap)) : 9999;
  return { lenM, R: Math.round(R) };
}

export function buildKanjoLandmarkSegments(path, cfg = {}) {
  const totalM = cfg.totalMeters ?? 10300;
  const zoneM = cfg.landmarkCornerZoneM ?? 380;
  const defaultR = cfg.landmarkCornerR ?? 420;
  const landmarks = cfg.landmarks ?? KANJO_LANDMARKS;
  const halfF = (zoneM / totalM) * 0.5;
  const arc = buildArc(path);

  const zones = [];
  const seen = new Set();
  for (const lm of landmarks) {
    const f = pathFractionAtLandmark(path, arc, lm.u, lm.v);
    const key = Math.round(f * 400);
    if (seen.has(key)) continue;
    seen.add(key);
    const f0 = Math.max(0, f - halfF);
    const f1 = Math.min(1, f + halfF);
    let R = defaultR;
    const geo = analyzeSegment(path, arc, f0, f1, totalM, 650);
    if (geo.R < 9000) R = Math.max(280, Math.min(600, geo.R));
    zones.push({ f0, f1, R });
  }
  zones.sort((a, b) => a.f0 - b.f0);

  const merged = [];
  for (const z of zones) {
    const last = merged[merged.length - 1];
    if (last && z.f0 <= last.f1 + 0.002) {
      last.f1 = Math.max(last.f1, z.f1);
      last.R = Math.min(last.R, z.R);
    } else merged.push({ ...z });
  }

  const profile = [];
  let pos = 0;
  for (const z of merged) {
    if (z.f0 > pos + 0.002) {
      profile.push({ type: 'straight', pathFrom: pos, pathTo: z.f0 });
    }
    profile.push({ type: 'corner', pathFrom: z.f0, pathTo: z.f1, R: z.R });
    pos = z.f1;
  }
  if (pos < 1 - 0.002) {
    profile.push({ type: 'straight', pathFrom: pos, pathTo: 1 });
  }

  const segments = profile.map((p) => {
    const geo = analyzeSegment(path, arc, p.pathFrom, p.pathTo, totalM, 650);
    return {
      type: p.type,
      R: p.type === 'corner' ? p.R : 9999,
      len: geo.lenM
    };
  });
  const lenSum = segments.reduce((a, s) => a + s.len, 0) || 1;
  const scale = totalM / lenSum;
  segments.forEach((s) => {
    s.len *= scale;
  });
  return segments;
}
