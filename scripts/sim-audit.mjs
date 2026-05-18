#!/usr/bin/env node
/**
 * index.html 同等の校正済み物理で妥当性検証
 */
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const G = 9.80665;
const RHO = 1.225;
const WHEEL_POWER_EFF = 0.84;
const TOUGE_SURFACE_MU = 0.90;
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const paths = JSON.parse(readFileSync(join(root, 'scripts/extracted-paths.json'), 'utf8'));

const LAP_REF = {
  shigisan_up: { min: 175, max: 255 },
  shigisan_down: { min: 165, max: 245 },
  saruyama_up: { min: 130, max: 215 },
  saruyama_down: { min: 125, max: 210 },
  hanna_down: { min: 145, max: 235 }
};

const gr86 = {
  m: 1275,
  powerKw: 173,
  powerRpm: 7000,
  torqueNm: 250,
  torqueRpm: 3700,
  torqueRpmEnd: 6400,
  NeMax: 7800,
  finalDrive: 4.1,
  gears: [3.626, 2.189, 1.541, 1.213, 1.0, 0.767],
  tireCircumM: (() => {
    const w = 215, a = 40, r = 18;
    return (Math.PI * (r * 25.4 + 2 * w * (a / 100))) / 1000;
  })(),
  Cd: 0.29,
  A: 2.05,
  Crr: 0.013,
  Lr: 1.25,
  L: 2.57,
  vmaxCatalog: 226,
  wheelPowerEff: WHEEL_POWER_EFF
};

function torque(rpm) {
  const { torqueNm, torqueRpm, torqueRpmEnd, powerKw, NeMax, powerRpm } = gr86;
  const rpmTEnd = torqueRpmEnd;
  if (rpm < 900) return torqueNm * 0.45 * (rpm / 900);
  if (rpm < torqueRpm) return torqueNm * (0.55 + 0.45 * (rpm - 900) / (torqueRpm - 900));
  if (rpm <= rpmTEnd) return torqueNm;
  const Tpower = (powerKw * 1000 * 60) / (rpm * 2 * Math.PI);
  if (rpm >= NeMax) return Tpower * 0.88;
  return Math.min(torqueNm, Tpower);
}

function powerKw(rpm, scale) {
  return (torque(rpm) * rpm * 2 * Math.PI) / 60000 * gr86.wheelPowerEff * scale;
}

function rpmFromGear(vMs, g) {
  return (vMs / gr86.tireCircumM) * 60 * gr86.finalDrive * gr86.gears[g];
}

function pickGearAccel(vMs, rpmCap, scale) {
  let best = gr86.gears.length - 1;
  let bestF = -1;
  const v = Math.max(vMs, 0.5);
  for (let g = 0; g < gr86.gears.length; g++) {
    const rpm = rpmFromGear(v, g);
    if (rpm > rpmCap + 120 || rpm < 1400) continue;
    const Fd = (powerKw(rpm, scale) * 1000) / v;
    if (Fd > bestF) {
      bestF = Fd;
      best = g;
    }
  }
  return best;
}

function driveBest(vMs, rpmCap, scale) {
  const g = pickGearAccel(vMs, rpmCap, scale);
  const rpm = Math.min(rpmCap, Math.max(1200, rpmFromGear(Math.max(vMs, 0.5), g)));
  return (powerKw(rpm, scale) * 1000) / Math.max(vMs, 0.5);
}

function calibrateScale() {
  let lo = 0.55, hi = 1.05;
  for (let i = 0; i < 30; i++) {
    const scale = (lo + hi) / 2;
    const v = solvePower(0, 7400, scale);
    if (v > gr86.vmaxCatalog + 0.4) hi = scale;
    else lo = scale;
  }
  return Math.round(lo * 1000) / 1000;
}

function solvePower(theta, rpmCap, scale) {
  const vGearMs = (rpmCap * 60 * gr86.tireCircumM) / (gr86.finalDrive * gr86.gears.at(-1) * 1000) / 3.6;
  let lo = 3, hi = vGearMs;
  for (let n = 0; n < 56; n++) {
    const mid = (lo + hi) / 2;
    const Fd = driveBest(mid, rpmCap, scale);
    const Fa = 0.5 * RHO * gr86.Cd * gr86.A * mid * mid;
    const Fr = gr86.Crr * gr86.m * G;
    const Fg = gr86.m * G * Math.sin(theta);
    if (Fd >= Fa + Fr + Fg) lo = mid;
    else hi = mid;
  }
  return lo * 3.6;
}

function maxAccel(vMs, mu, rpmCap, theta, scale) {
  const traction = mu * G * (gr86.Lr / gr86.L);
  const g = pickGearAccel(vMs, rpmCap, scale);
  const rpm = Math.min(rpmCap, Math.max(1200, rpmFromGear(Math.max(vMs, 0.5), g)));
  const Fd = (powerKw(rpm, scale) * 1000) / Math.max(vMs, 0.5);
  const Fa = 0.5 * RHO * gr86.Cd * gr86.A * vMs * vMs;
  const Fr = gr86.Crr * gr86.m * G;
  const Fg = gr86.m * G * Math.sin(theta);
  return Math.max(0.15, Math.min(traction, (Fd - Fa - Fr - Fg) / gr86.m));
}

function cornerV(R, mu, grip) {
  const Re = Math.max(12, Math.min(R, 120));
  return Math.sqrt(mu * G * Re) * grip;
}

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

function simulate0to100(scale) {
  const mu = 0.84 * TOUGE_SURFACE_MU;
  const rpmCap = 7400;
  let v = 0.1;
  let t = 0;
  let dist = 0;
  const dt = 0.04;
  const vMax = gr86.vmaxCatalog / 3.6;
  while (v < 100 / 3.6 && t < 30) {
    const a = maxAccel(v, mu, rpmCap, 0, scale);
    let vNew = Math.min(v + a * dt, vMax);
    const d = (v + vNew) * 0.5 * dt;
    t += d / Math.max((v + vNew) * 0.5, 0.5);
    dist += d;
    v = vNew;
  }
  return t;
}

function segmentVmaxMs(theta, scale, ceilKmh, gradeSign) {
  let vMs = solvePower(theta, 7400, scale) / 3.6;
  if (gradeSign > 0 && theta > 0.01) vMs /= 1 + theta * 1.15 * 4;
  vMs = Math.min(vMs, ceilKmh / 3.6);
  return vMs;
}

function simulateCourse(path, totalM, grip, scale, gradeSign = 1, ceilKmh = 130) {
  const arc = buildArc(path);
  const n = 22;
  const mu = 0.84 * TOUGE_SURFACE_MU;
  const segs = [];
  for (let i = 0; i < n; i++) {
    const geo = analyze(path, arc, i / n, (i + 1) / n, totalM);
    segs.push({ ...geo, len: totalM / n });
  }
  let v = 38 / 3.6;
  let t = 0;
  let peak = 0;
  const aBrake = 0.72 * G;
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    const next = segs[i + 1];
    const theta = gradeSign > 0 ? 0.015 : -0.012;
    if (s.type === 'straight') {
      const vLimNext = next?.type === 'corner' ? cornerV(next.R, mu, grip) : null;
      const vMax = segmentVmaxMs(theta, scale, ceilKmh, gradeSign);
      let dist = 0;
      const dt = 0.04;
      while (dist < s.len - 0.05) {
        const rem = s.len - dist;
        const mustBrake =
          vLimNext != null &&
          v > vLimNext + 0.2 &&
          (v * v - vLimNext * vLimNext) / (2 * aBrake) >= rem - 0.08;
        let vNew;
        if (mustBrake) vNew = Math.max(vLimNext, v - aBrake * dt);
        else {
          const a = maxAccel(v, mu, 7400, theta, scale);
          vNew = Math.min(v + a * dt, vMax);
        }
        const dStep = Math.min(rem, Math.max((v + vNew) * 0.5 * dt, 0.02));
        t += dStep / Math.max((v + vNew) * 0.5, 0.5);
        dist += dStep;
        v = vNew;
        peak = Math.max(peak, v);
      }
    } else {
      const vLim = cornerV(s.R, mu, grip);
      if (v > vLim + 0.3) {
        t += (v - vLim) / aBrake;
        v = vLim;
      }
      t += s.len / Math.max(v, 3);
      v = Math.min(v, vLim);
    }
  }
  const avg = (totalM / 1000) / (t / 3600);
  return { t, avg, peak: peak * 3.6 };
}

function fmt(sec) {
  const m = Math.floor(sec / 60);
  const s = (sec % 60).toFixed(1);
  return `${m}:${s.padStart(4, '0')}`;
}

const scale = calibrateScale();
gr86.wheelPowerScale = scale;

const vGear = (7400 * 60 * gr86.tireCircumM) / (gr86.finalDrive * gr86.gears.at(-1) * 1000);
const vPhys = solvePower(0, 7400, 1);
const vCal = solvePower(0, 7400, scale);

console.log('── GR86 公称照合 ──');
console.log(`変速比 ${gr86.gears.join('/')} × ${gr86.finalDrive}`);
console.log(`ギア上限 ${vGear.toFixed(0)} km/h · 物理出力 ${vPhys.toFixed(0)} · 照合後 ${vCal.toFixed(0)} km/h（×${scale}）`);
console.log(`0-100km/h ${simulate0to100(scale).toFixed(1)}s（目安 6.3–7.5s）`);
console.log(`実効μ sport乾燥 ${(0.84 * TOUGE_SURFACE_MU).toFixed(2)}`);
console.log('');

const COURSES = {
  shigisan_up: { m: 4200, grip: 0.92, sign: 1, ceil: 125 },
  shigisan_down: { m: 4200, grip: 0.92, sign: -1, ceil: 140 },
  saruyama_up: { m: 3100, grip: 0.91, sign: 1, ceil: 110 },
  saruyama_down: { m: 3100, grip: 0.91, sign: -1, ceil: 125 },
  hanna_down: { m: 4400, grip: 0.92, sign: -1, ceil: 155 }
};

for (const [key, cfg] of Object.entries(COURSES)) {
  const base = key.replace(/_(up|down)$/, '');
  const path = paths[base];
  if (!path) continue;
  const p = key.endsWith('_down') ? path.slice().reverse() : path;
  const r = simulateCourse(p, cfg.m, cfg.grip, scale, cfg.sign, cfg.ceil);
  const ref = LAP_REF[key];
  const ok = ref && r.t >= ref.min * 0.92 && r.t <= ref.max * 1.08;
  console.log(
    `${key}: ${fmt(r.t)} 平均${r.avg.toFixed(0)}km/h ピーク${r.peak.toFixed(0)}/${cfg.ceil}km/h ${ok ? '妥当帯OK' : '妥当帯外'}`
  );
}
