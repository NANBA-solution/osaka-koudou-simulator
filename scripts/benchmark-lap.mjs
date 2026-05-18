#!/usr/bin/env node
/** ラップタイム妥当性チェック（index.html と同式の簡易版） */
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const G = 9.80665;
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const paths = JSON.parse(readFileSync(join(root, 'scripts/extracted-paths.json'), 'utf8'));

const COURSES = {
  shigisan_up: { m: 4200, straightV: 120, grip: 0.97 },
  saruyama_up: { m: 3100, straightV: 100, grip: 0.96 },
  hanna_down: { m: 4400, straightV: 130, grip: 0.97 }
};

function buildArc(path) {
  const cum = [0];
  for (let i = 1; i < path.length; i++) {
    cum.push(cum.at(-1) + Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]));
  }
  return { cum, total: cum.at(-1) || 1 };
}

function uvAt(path, arc, f) {
  const t = f * arc.total;
  let i = 0;
  while (i < arc.cum.length - 2 && arc.cum[i + 1] < t - 1e-9) i++;
  const seg = arc.cum[i + 1] - arc.cum[i] || 1;
  const u = (t - arc.cum[i]) / seg;
  return [
    path[i][0] + (path[i + 1][0] - path[i][0]) * u,
    path[i][1] + (path[i + 1][1] - path[i][1]) * u
  ];
}

function analyze(path, arc, f0, f1, totalM) {
  let prev = uvAt(path, arc, f0);
  let lenM = 0;
  let heading = null;
  let turn = 0;
  for (let k = 1; k <= 36; k++) {
    const f = f0 + (f1 - f0) * (k / 36);
    const p = uvAt(path, arc, f);
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
  const R = turn > 0.08 ? Math.max(20, Math.min(lenM / turn, 150)) : 9999;
  return { type: R < 78 ? 'corner' : 'straight', R: Math.round(R), lenM };
}

function cornerV(R, mu, grip) {
  const Re = Math.max(R, 18);
  return Math.sqrt(mu * G * Re) * grip;
}

function simulate(path, cfg) {
  const arc = buildArc(path);
  const n = 18;
  const mu = 0.88;
  let v = 48 / 3.6;
  let t = 0;
  const segs = [];
  for (let i = 0; i < n; i++) {
    const f0 = i / n;
    const f1 = (i + 1) / n;
    const geo = analyze(path, arc, f0, f1, cfg.m);
    const len = cfg.m / n;
    segs.push({ ...geo, len });
  }
  const aBrake = 0.75 * G;
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    const next = segs[i + 1];
    if (s.type === 'straight') {
      const vRoad = cfg.straightV / 3.6;
      const vLim = next?.type === 'corner' ? cornerV(next.R, mu, cfg.grip) : null;
      let dist = 0;
      let peak = v;
      while (dist < s.len - 0.05) {
        const rem = s.len - dist;
        const mustBrake =
          vLim != null &&
          v > vLim + 0.2 &&
          (v * v - vLim * vLim) / (2 * aBrake) >= rem - 0.08;
        let vNew;
        if (mustBrake) vNew = Math.max(vLim, v - aBrake * 0.04);
        else vNew = Math.min(vRoad, v + 1.2 * 0.04);
        const dStep = Math.min(rem, Math.max((v + vNew) * 0.5 * 0.04, 0.02));
        t += dStep / Math.max((v + vNew) * 0.5, 3);
        dist += dStep;
        v = vNew;
        peak = Math.max(peak, v);
      }
      segs[i]._peak = peak * 3.6;
    } else {
      const vLim = cornerV(s.R, mu, cfg.grip);
      if (v > vLim + 0.3) {
        t += (v - vLim) / aBrake;
        v = vLim;
      }
      t += s.len / Math.max(v, 3);
      v = Math.min(v, vLim);
    }
  }
  const avg = (cfg.m / 1000) / (t / 3600);
  let peak = 0;
  for (const s of segs) {
    peak = Math.max(
      peak,
      s._peak ?? (s.type === 'corner' ? cornerV(s.R, mu, cfg.grip) * 3.6 : 0)
    );
  }
  return { t, avg, peak, corners: segs.filter((s) => s.type === 'corner').length };
}

function fmt(sec) {
  const m = Math.floor(sec / 60);
  const s = (sec % 60).toFixed(1);
  return `${m}:${s.padStart(4, '0')}`;
}

for (const [key, cfg] of Object.entries(COURSES)) {
  const base = key.replace(/_(up|down)$/, '');
  const path = paths[base];
  if (!path) continue;
  const p = key.endsWith('_down') ? path.slice().reverse() : path;
  const r = simulate(p, cfg);
  console.log(
    `${key}: ${fmt(r.t)} 平均${r.avg.toFixed(0)}km/h ピーク~${r.peak.toFixed(0)}km/h コーナ${r.corners}`
  );
}
