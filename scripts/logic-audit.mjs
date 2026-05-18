#!/usr/bin/env node
/**
 * 大阪公道シミュレーター — 物理・コース・監査ロジックの不変条件チェック
 * index.html と同式の簡易シミュ＋設定整合性
 */
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { buildKanjoLandmarkSegments } from './kanjo-landmark-profile.mjs';

const G = 9.80665;
const RHO = 1.225;
const TOUGE_SURFACE_MU = 0.90;
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'index.html'), 'utf8');
const paths = JSON.parse(readFileSync(join(root, 'scripts/extracted-paths.json'), 'utf8'));

const gr86 = {
  m: 1275,
  powerKw: 173,
  torqueNm: 250,
  torqueRpm: 3700,
  torqueRpmEnd: 6400,
  NeMax: 7800,
  powerRpm: 7000,
  finalDrive: 4.1,
  gears: [3.626, 2.189, 1.541, 1.213, 1.0, 0.767],
  tireCircumM: (Math.PI * (18 * 25.4 + 2 * 215 * 0.4)) / 1000,
  Cd: 0.29,
  A: 2.05,
  Crr: 0.013,
  Lr: 1.25,
  L: 2.57,
  vmaxCatalog: 226,
  wheelPowerEff: 0.84
};

function torque(rpm) {
  const { torqueNm, torqueRpm, torqueRpmEnd, powerKw, NeMax, powerRpm } = gr86;
  if (rpm < 900) return torqueNm * 0.45 * (rpm / 900);
  if (rpm < torqueRpm) return torqueNm * (0.55 + 0.45 * (rpm - 900) / (torqueRpm - 900));
  if (rpm <= torqueRpmEnd) return torqueNm;
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

function pickGear(vMs, rpmCap, scale) {
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
  const g = pickGear(vMs, rpmCap, scale);
  const rpm = Math.min(rpmCap, Math.max(1200, rpmFromGear(Math.max(vMs, 0.5), g)));
  return (powerKw(rpm, scale) * 1000) / Math.max(vMs, 0.5);
}

function calibrateScale() {
  let lo = 0.55, hi = 1.05;
  for (let i = 0; i < 30; i++) {
    const scale = (lo + hi) / 2;
    const v = solvePowerMs(0, 7000, scale) * 3.6;
    if (v > gr86.vmaxCatalog + 0.4) hi = scale;
    else lo = scale;
  }
  return Math.round(lo * 1000) / 1000;
}

function solvePowerMs(theta, rpmCap, scale) {
  const vGearMs =
    (rpmCap * 60 * gr86.tireCircumM) / (gr86.finalDrive * gr86.gears.at(-1) * 1000) / 3.6;
  let lo = 3, hi = Math.max(vGearMs, 12);
  for (let n = 0; n < 56; n++) {
    const mid = (lo + hi) / 2;
    const Fd = driveBest(mid, rpmCap, scale);
    const Fa = 0.5 * RHO * gr86.Cd * gr86.A * mid * mid;
    const Fr = gr86.Crr * gr86.m * G;
    const Fg = gr86.m * G * Math.sin(theta);
    if (Fd >= Fa + Fr + Fg) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** index.html cornerLimitMs と同一 */
function cornerLimitMs(mu, R, modifier = 1, course) {
  const rCap = course?.logic === 'expressway' ? 650 : 120;
  const Reff = Math.min(rCap, Math.max(R, 12));
  return Math.sqrt(mu * G * Reff * modifier);
}

/** 修正後 cornerLimitMsForSeg と同一 */
function cornerLimitMsForSeg(mu, R, grip, logic) {
  const course = logic === 'expressway' ? { logic: 'expressway' } : null;
  let vLim = cornerLimitMs(mu, R ?? 9999, 1, course);
  if (logic === 'lateral') vLim *= Math.pow(mu / 0.88, 0.42);
  return vLim * grip;
}

function segmentStraightVmaxMs(theta, scale, course) {
  let vMs = solvePowerMs(theta, 7400, scale);
  if (course.logic === 'expressway') {
    const vGearMs =
      (7400 * 60 * gr86.tireCircumM) / (gr86.finalDrive * gr86.gears.at(-1) * 1000) / 3.6;
    vMs = Math.min(vMs, vGearMs, gr86.vmaxCatalog / 3.6);
    return vMs;
  }
  if ((course.logic === 'climb' || course.logic === 'mixed') && theta > 0.01) {
    vMs /= 1 + theta * (course.climbPenalty ?? 1.15) * 4;
  }
  const vGearMs =
    (7400 * 60 * gr86.tireCircumM) / (gr86.finalDrive * gr86.gears.at(-1) * 1000) / 3.6;
  vMs = Math.min(vMs, vGearMs);
  vMs = Math.min(vMs, (course.peakCeilingKmh ?? 130) / 3.6);
  return vMs;
}

function flatLimits(scale) {
  const vGear = (7400 * 60 * gr86.tireCircumM) / (gr86.finalDrive * gr86.gears.at(-1) * 1000);
  const vPowerPhys = solvePowerMs(0, 7400, 1) * 3.6;
  const vPower = solvePowerMs(0, 7400, scale) * 3.6;
  const vEff = Math.min(vGear, vPower, gr86.vmaxCatalog);
  return { vGear, vPowerPhys, vPower, vEff };
}

const scale = calibrateScale();
const muSport = 0.84 * TOUGE_SURFACE_MU;
const issues = [];
const ok = [];

function fail(msg) {
  issues.push(msg);
}
function pass(msg) {
  ok.push(msg);
}

// ── 1. 平坦上限チェーン ──
const flat = flatLimits(scale);
if (flat.vEff !== gr86.vmaxCatalog) fail(`平坦照合 ${flat.vEff} ≠ 公称 ${gr86.vmaxCatalog}`);
else pass(`平坦理論 min(ギア${flat.vGear.toFixed(0)},出力${flat.vPower.toFixed(0)}) → 公称${flat.vEff}km/h`);

if (flat.vPower > flat.vPowerPhys + 1) fail('照合後出力が物理出力を上回る（異常）');
else pass('出力照合スケール ≤ 物理限界');

// ── 2. コーナ公式の一貫性（旧バグ: R||40, min18） ──
for (const R of [12, 15, 18, 20, 40, 9999]) {
  const v = cornerLimitMsForSeg(muSport, R, 0.92, 'mixed');
  const vRef = cornerLimitMs(muSport, R, 1) * 0.92;
  if (Math.abs(v - vRef) > 0.05) {
    fail(`コーナ限界 R=${R}: ForSeg=${v.toFixed(2)} ≠ cornerLimitMs=${vRef.toFixed(2)}`);
  }
}
pass('cornerLimitMsForSeg ≡ cornerLimitMs × grip');

// ── 3. 直線上限は公称226を超えない（山岳） ──
for (const ceil of [125, 140, 155]) {
  const vMs = segmentStraightVmaxMs(-0.012, scale, {
    logic: 'mixed',
    peakCeilingKmh: ceil
  });
  if (vMs * 3.6 > ceil + 0.5) fail(`直線vmax ${vMs * 3.6} > 天井${ceil}`);
}
pass('segmentStraightVmaxMs ≤ peakCeiling（下り勾配含む）');

if (segmentStraightVmaxMs(0, scale, { logic: 'mixed', peakCeilingKmh: 999 }) * 3.6 > gr86.vmaxCatalog + 2) {
  pass('山岳直線は公称キャップなし（peakCeilingで制御）');
}

// ── 4. HTML設定整合 ──
const courseKeys = [...html.matchAll(/COURSES\.(\w+)\s*=/g)].map((m) => m[1]);
const tabOrder = html.match(/COURSE_TAB_ORDER\s*=\s*\[([\s\S]*?)\]/);
const tabs = tabOrder ? tabOrder[1].match(/'(\w+)'/g)?.map((s) => s.slice(1, -1)) : [];

const CEIL = {
  shigisan_up: 125,
  shigisan_down: 140,
  saruyama_up: 110,
  saruyama_down: 125,
  hanna_down: 155
};

for (const key of tabs || []) {
  if (!CEIL[key]) fail(`タブ ${key} に peakCeiling 定義なし`);
  const block = html.match(new RegExp(`${key}:\\s*\\{[\\s\\S]*?\\n\\s*\\}`, 'm'));
  if (!block) continue;
  const ceilM = block[0].match(/peakCeilingKmh:\s*(\d+)/);
  if (ceilM && +ceilM[1] !== CEIL[key]) {
    fail(`${key} peakCeilingKmh=${ceilM[1]} 期待${CEIL[key]}`);
  }
  if (key.endsWith('_down') && !block[0].includes('gradeSign: -1')) {
    fail(`${key} は gradeSign:-1 必須`);
  }
  if (key.endsWith('_up') && block[0].includes('gradeSign: -1')) {
    fail(`${key} は上りなのに gradeSign:-1`);
  }
}
pass('コース variant: gradeSign / peakCeiling 整合');

if (html.includes("logic: 'downhill'") && html.includes('hanna_down')) {
  pass('阪奈下り logic:downhill');
}

if (html.includes("logic: 'expressway'") && html.includes('kanjo_lap')) {
  pass('環状 expressway + kanjo_lap');
}

const vExp = segmentStraightVmaxMs(0, scale, { logic: 'expressway' }) * 3.6;
if (vExp < gr86.vmaxCatalog - 2 || vExp > gr86.vmaxCatalog + 1) {
  fail(`expressway直線 ${vExp.toFixed(0)} ≠ 公称${gr86.vmaxCatalog}`);
} else pass(`expressway直線 = 公称vmax ${vExp.toFixed(0)}km/h`);

const vCornerExp = cornerLimitMsForSeg(0.84 * 0.93, 420, 0.97, 'expressway');
if (vCornerExp * 3.6 < 180) fail(`expresswayコーナ R420 限界が低すぎ ${(vCornerExp * 3.6).toFixed(0)}`);
else pass(`expresswayコーナ R420 → ${(vCornerExp * 3.6).toFixed(0)}km/h`);

// ── 5. 簡易ラップ＋不変条件 ──
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

function analyze(path, arc, f0, f1, totalM, rCap = 150) {
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
  const R = turn > 0.08 ? Math.max(20, Math.min(lenM / turn, rCap)) : 9999;
  return { type: R < 78 ? 'corner' : 'straight', R: Math.round(R), lenM };
}

function simulateFull(path, cfg) {
  const arc = buildArc(path);
  const n = 22;
  const segs = [];
  for (let i = 0; i < n; i++) {
    const geo = analyze(path, arc, i / n, (i + 1) / n, cfg.m);
    segs.push({ ...geo, len: cfg.m / n });
  }
  const course = {
    logic: cfg.logic,
    peakCeilingKmh: cfg.ceil,
    climbPenalty: cfg.climbPenalty ?? 1.15
  };
  const grip = cfg.grip;
  const thetaBase = cfg.sign > 0 ? 0.015 : -0.012;
  const aBrake = 0.72 * G;
  let v = 38 / 3.6;
  let t = 0;
  let coursePeakMs = 0;
  const sectorLog = [];
  let prevVOut = v * 3.6;

  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    const next = segs[i + 1];
    const theta = thetaBase;
    const vIn = v * 3.6;

    if (Math.abs(vIn - prevVOut) > 2.6) {
      fail(`${cfg.key} ${i}: 速度連鎖ギャップ ${Math.abs(vIn - prevVOut).toFixed(1)}km/h`);
    }

    if (s.type === 'corner') {
      const vLim = cornerLimitMsForSeg(muSport, s.R, grip, course.logic);
      const dNeed = v > vLim ? (v * v - vLim * vLim) / (2 * aBrake) : 0;
      if (dNeed <= s.len - 0.05) {
        if (v > vLim + 0.25) {
          t += (v - vLim) / aBrake;
          v = vLim;
        }
      } else {
        const vEnd = Math.sqrt(Math.max(v * v - 2 * aBrake * s.len, vLim * vLim * 0.82));
        v = Math.max(vEnd, vLim);
        t += (vIn / 3.6 - v) / aBrake;
      }
      const cruiseLeft = Math.max(0, s.len - dNeed);
      if (cruiseLeft > 0.1) t += cruiseLeft / Math.max(v, 2.5);
      v = Math.min(v, vLim);
      if (v * 3.6 > vLim * 3.6 + 1.5) fail(`${cfg.key} corner: 出口${(v * 3.6).toFixed(0)} > 限界${(vLim * 3.6).toFixed(0)}`);
      sectorLog.push({ peak: vLim * 3.6, vOut: v * 3.6, vLim: vLim * 3.6 });
    } else {
      const vMax = segmentStraightVmaxMs(theta, scale, course);
      const vLimNext = next?.type === 'corner' ? cornerLimitMsForSeg(muSport, next.R, grip, course.logic) : null;
      let peak = v;
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
          const traction = muSport * G * (gr86.Lr / gr86.L);
          const g = pickGear(v, 7400, scale);
          const rpm = Math.min(7400, Math.max(1200, rpmFromGear(Math.max(v, 0.5), g)));
          const Fd = (powerKw(rpm, scale) * 1000) / Math.max(v, 0.5);
          const Fa = 0.5 * RHO * gr86.Cd * gr86.A * v * v;
          const Fr = gr86.Crr * gr86.m * G;
          const Fg = gr86.m * G * Math.sin(theta);
          const a = Math.max(0.15, Math.min(traction, (Fd - Fa - Fr - Fg) / gr86.m));
          vNew = Math.min(v + a * dt, vMax);
        }
        if (vNew > vMax + 0.3) fail(`${cfg.key} straight: 積分速度 > segmentStraightVmaxMs`);
        peak = Math.max(peak, vNew);
        const dStep = Math.min(rem, Math.max((v + vNew) * 0.5 * dt, 0.02));
        t += dStep / Math.max((v + vNew) * 0.5, 0.5);
        dist += dStep;
        v = vNew;
      }
      const ceilMs = cfg.ceil / 3.6;
      coursePeakMs = Math.max(coursePeakMs, Math.min(peak, ceilMs));
      if (vLimNext != null && v > vLimNext + 1.0) {
        fail(`${cfg.key} straight終端: v=${(v * 3.6).toFixed(0)} > 次コーナ${(vLimNext * 3.6).toFixed(0)}`);
      }
      sectorLog.push({ peak: peak * 3.6, vOut: v * 3.6 });
    }
    prevVOut = v * 3.6;
  }

  const peakKmh = coursePeakMs * 3.6;
  if (peakKmh > cfg.ceil + 1) fail(`${cfg.key} coursePeak ${peakKmh} > ceil ${cfg.ceil}`);
  return { t, peakKmh, avg: (cfg.m / 1000) / (t / 3600) };
}

function simulateKanjoPath(path, cfg) {
  const segs = buildKanjoLandmarkSegments(path, { totalMeters: cfg.m });
  const course = { logic: 'expressway' };
  const grip = cfg.grip;
  const mu = 0.84 * 0.93;
  const aBrake = 0.72 * G;
  let v = 80 / 3.6;
  let t = 0;
  let coursePeakMs = 0;
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    const next = segs[i + 1];
    if (s.type === 'straight') {
      const vMax = segmentStraightVmaxMs(0, scale, course);
      const vLimNext =
        next?.type === 'corner' ? cornerLimitMsForSeg(mu, next.R, grip, 'expressway') : null;
      let peak = v;
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
          const traction = mu * G * (gr86.Lr / gr86.L);
          const g = pickGear(v, 7400, scale);
          const rpm = Math.min(7400, Math.max(1200, rpmFromGear(Math.max(v, 0.5), g)));
          const Fd = (powerKw(rpm, scale) * 1000) / Math.max(v, 0.5);
          const Fa = 0.5 * RHO * gr86.Cd * gr86.A * v * v;
          const Fr = gr86.Crr * gr86.m * G;
          const a = Math.max(0.15, Math.min(traction, (Fd - Fa - Fr) / gr86.m));
          vNew = Math.min(v + a * dt, vMax);
        }
        const dStep = Math.min(rem, Math.max((v + vNew) * 0.5 * dt, 0.02));
        t += dStep / Math.max((v + vNew) * 0.5, 0.5);
        dist += dStep;
        v = vNew;
        peak = Math.max(peak, vNew);
      }
      coursePeakMs = Math.max(coursePeakMs, peak);
    } else {
      const vLim = cornerLimitMsForSeg(mu, s.R, grip, 'expressway');
      if (v > vLim + 0.3) {
        t += (v - vLim) / aBrake;
        v = vLim;
      }
      t += s.len / Math.max(v, 3);
      v = Math.min(v, vLim);
    }
  }
  return { t, peakKmh: coursePeakMs * 3.6, avg: (cfg.m / 1000) / (t / 3600) };
}

const RUNS = [
  { key: 'shigisan_up', base: 'shigisan', down: false, m: 4200, sign: 1, ceil: 125, logic: 'mixed', grip: 0.92 },
  { key: 'shigisan_down', base: 'shigisan', down: true, m: 4200, sign: -1, ceil: 140, logic: 'mixed', grip: 0.92 },
  { key: 'saruyama_up', base: 'saruyama', down: false, m: 3100, sign: 1, ceil: 110, logic: 'lateral', grip: 0.91 },
  { key: 'saruyama_down', base: 'saruyama', down: true, m: 3100, sign: -1, ceil: 125, logic: 'lateral', grip: 0.91 },
  { key: 'hanna_down', base: 'hanna', down: true, m: 4400, sign: -1, ceil: 155, logic: 'downhill', grip: 0.92 }
];

console.log('══ 大阪公道シミュレーター ロジック精査 ══\n');
console.log(`ホイール出力スケール ×${scale} · 実効μ=${muSport.toFixed(2)}\n`);

for (const cfg of RUNS) {
  let path = paths[cfg.base];
  if (!path) {
    fail(`${cfg.key}: パスなし`);
    continue;
  }
  if (cfg.down) path = path.slice().reverse();
  const r = simulateFull(path, cfg);
  console.log(
    `${cfg.key}: ピーク${r.peakKmh.toFixed(0)}/${cfg.ceil}km/h 平均${r.avg.toFixed(0)}km/h (${(r.t / 60).toFixed(1)}min)`
  );
}

if (paths.kanjo?.length) {
  const r = simulateKanjoPath(paths.kanjo, { m: 10300, grip: 0.97 });
  console.log(
    `kanjo_lap: ピーク${r.peakKmh.toFixed(0)}/${gr86.vmaxCatalog}km/h 平均${r.avg.toFixed(0)}km/h (${(r.t / 60).toFixed(1)}min)`
  );
  if (r.t < 175 * 0.92 || r.t > 295 * 1.08) fail(`kanjo_lap ラップ ${r.t.toFixed(0)}s が妥当帯外`);
  if (r.peakKmh < 195) fail(`kanjo_lap ピーク ${r.peakKmh.toFixed(0)} < 195km/h`);
}

console.log('\n── 不変条件 OK ──');
ok.forEach((m) => console.log(`  ✓ ${m}`));

if (issues.length) {
  console.log('\n── 問題 ──');
  issues.forEach((m) => console.log(`  ✗ ${m}`));
  process.exit(1);
}
console.log('\n全ロジックチェック合格');
