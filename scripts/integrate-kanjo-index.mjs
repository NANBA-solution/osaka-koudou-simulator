#!/usr/bin/env node
/** index.html に環状コース一式を統合（HEAD復旧後用） */
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pathPts = JSON.parse(readFileSync(join(root, 'scripts/extracted-paths.json'), 'utf8')).kanjo;
if (!pathPts?.length) throw new Error('kanjo path missing');

const pathLines = pathPts.map(([u, v]) => `          [${u},${v}]`).join(',\n');
const [su, sv] = pathPts[0];
const [fu, fv] = pathPts[pathPts.length - 1];

let html = readFileSync(join(root, 'index.html'), 'utf8');

const replacements = [
  [
    '信貴山 · 猿山 · 阪奈 · 赤線コース',
    '信貴山 · 猿山 · 阪奈 · 環状 · 赤線コース'
  ],
  [
    '信貴山・猿山・阪奈の走行ライン',
    '信貴山・猿山・阪奈・阪神環状の走行ライン'
  ],
  [
    `        saruyama: {
          distanceM: {
            tier: 'config',
            value: 3100,
            ref: '府道43号（猿山〜箕面方面）走行区間概算'
          },
          path: { tier: 'extract', ref: 'assets/minoo-ref.png 赤線抽出' },
          lapRef: {
            tier: 'model',
            minSec: 130,
            maxSec: 215,
            car: 'gr86',
            tire: 'sport',
            ref: '同上'
          }
        },
        hanna: {`,
    `        saruyama: {
          distanceM: {
            tier: 'config',
            value: 3100,
            ref: '府道43号（猿山〜箕面方面）走行区間概算'
          },
          path: { tier: 'extract', ref: 'assets/minoo-ref.png 赤線抽出' },
          lapRef: {
            tier: 'model',
            minSec: 130,
            maxSec: 215,
            car: 'gr86',
            tire: 'sport',
            ref: '同上'
          }
        },
        kanjo: {
          distanceM: {
            tier: 'config',
            value: 10300,
            ref: '阪神高速1号環状線 外回り走行区間概算（全周の一部・約10.3km）'
          },
          path: { tier: 'extract', ref: 'assets/kanjo-ref.png 時計回りスプライン' },
          lapRef: {
            tier: 'model',
            minSec: 175,
            maxSec: 295,
            car: 'gr86',
            tire: 'sport',
            ref: '外回り1周 · 赤点ランドマーク付近のみコーナー・他は直線（出力・ギア上限）'
          }
        },
        hanna: {`
  ],
  [
    `      const cornerThresh = course?.cornerThresh ?? 78;
      const R = turn > 0.08
        ? Math.max(20, Math.min(lenM / turn, 150))
        : 9999;`,
    `      const cornerThresh = course?.cornerThresh ?? 78;
      const rCap = course?.logic === 'expressway' ? 650 : 150;
      const R = turn > 0.08
        ? Math.max(20, Math.min(lenM / turn, rCap))
        : 9999;`
  ],
  [
    `    function buildSegmentsFromPath(course) {
      if (!course.useManualProfile) {
        course.physicsProfile = generatePhysicsProfileFromPath(course);
      }`,
    `    /** 地図上の赤点ランドマーク付近のみコーナー、他は直線 */
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

    function generateLandmarkCornerProfile(course) {
      const path = course.path;
      if (!path?.length) return [];
      const arc = buildArcTable(path);
      course.arc = arc;
      const totalM = course.totalMeters || 4000;
      const zoneM = course.landmarkCornerZoneM ?? 380;
      const halfF = (zoneM / totalM) * 0.5;
      const defaultR = course.landmarkCornerR ?? 420;
      const zones = [];
      const seen = new Set();
      for (const lm of course.landmarks || []) {
        if (lm.label == null || lm.label === '') continue;
        const f = pathFractionAtLandmark(path, arc, lm.u, lm.v);
        const key = Math.round(f * 400);
        if (seen.has(key)) continue;
        seen.add(key);
        const f0 = Math.max(0, f - halfF);
        const f1 = Math.min(1, f + halfF);
        let R = defaultR;
        const geo = analyzePathSegment(path, arc, f0, f1, totalM, course);
        if (geo.R < 9000) R = Math.max(280, Math.min(600, geo.R));
        zones.push({ f0, f1, R, label: lm.label });
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
      let idx = 1;
      for (const z of merged) {
        if (z.f0 > pos + 0.002) {
          profile.push({
            id: 'K' + String(idx++).padStart(2, '0'),
            type: 'straight',
            pathFrom: pos,
            pathTo: z.f0
          });
        }
        profile.push({
          id: 'K' + String(idx++).padStart(2, '0'),
          type: 'corner',
          pathFrom: z.f0,
          pathTo: z.f1,
          R: z.R
        });
        pos = z.f1;
      }
      if (pos < 1 - 0.002) {
        profile.push({
          id: 'K' + String(idx++).padStart(2, '0'),
          type: 'straight',
          pathFrom: pos,
          pathTo: 1
        });
      }
      return profile;
    }

    function buildSegmentsFromPath(course) {
      if (course.cornerAtLandmarks) {
        course.physicsProfile = generateLandmarkCornerProfile(course);
      } else if (!course.useManualProfile) {
        course.physicsProfile = generatePhysicsProfileFromPath(course);
      }`
  ]
];

for (const [a, b] of replacements) {
  if (!html.includes(a)) {
    console.warn('skip block not found:', a.slice(0, 40));
    continue;
  }
  html = html.replace(a, b);
}

const kanjoBlock = `      // 阪神環状：滑らかな外回り1周
      kanjo: {
        name: '阪神環状（赤線コース）',
        desc: '外回り1周 · 阪神高速1号環状線 · 約10.3km',
        refMap: { src: 'assets/kanjo-ref.png' },
        refSource: 'kanjo',
        mapAspect: 473 / 1024,
        pathExtract: { kanjoSmooth: true, nPts: 120 },
        logic: 'expressway',
        terrain: 'urban_express',
        gradeFactor: 0.05,
        gradeSign: 1,
        totalMeters: 10300,
        cornerGripFactor: 0.97,
        surfaceMuFactor: 0.93,
        cornerAtLandmarks: true,
        landmarkCornerZoneM: 380,
        landmarkCornerR: 420,
        usePrecisionSim: true,
        useManualProfile: false,
        startSpeedKmh: 80,
        startLabel: '計測基点 S/F',
        endLabel: '1周',
        landmarks: [
          { u: ${su}, v: ${sv}, label: 'S' },
          { u: 0.22, v: 0.14, label: '淀屋橋' },
          { u: 0.75, v: 0.17, label: '北浜' },
          { u: 0.78, v: 0.8, label: '道頓堀' },
          { u: 0.18, v: 0.8, label: '難波' },
          { u: ${fu}, v: ${fv}, label: 'F' }
        ],
        path: [
${pathLines}
        ]
      },

`;

const hannaAnchor = '      // 阪奈府道8号：赤線どおり 左(市街)S→右(山)F、南側ループ含む';
if (!html.includes('// 阪神環状：滑らかな外回り1周')) {
  html = html.replace(hannaAnchor, kanjoBlock + hannaAnchor);
}

html = html.replace(
  /registerUpDownVariants\('saruyama',[\s\S]*?\}, true\);\n    registerHannaDownVariant\(\);/,
  `registerUpDownVariants('saruyama', {
      prefixUp: 'YU',
      prefixDown: 'YD',
      up: { name: '猿山 上り', desc: '左上S→右下F · 上り 3.1km', peakCeilingKmh: 110 },
      down: { name: '猿山 下り', desc: '右下S→左上F · 下り 3.1km', peakCeilingKmh: 125 }
    }, true);
    function registerKanjoLapVariant() {
      const base = pickBaseCourse('kanjo');
      if (!base?.path?.length) return;
      const { physicsProfile: _discard, ...baseK } = base;
      COURSES.kanjo_lap = {
        ...baseK,
        refSource: 'kanjo',
        name: '阪神環状 外回り',
        desc: '外回り1周 · 約10.3km · 赤点のみコーナー',
        cornerAtLandmarks: true,
        useManualProfile: false,
        usePrecisionSim: true
      };
      delete COURSES.kanjo;
    }
    registerKanjoLapVariant();
    registerHannaDownVariant();`
);

const patches = [
  [
    `if (course.refSource === 'hanna' && key === 'hanna_down') return true;
      return false;`,
    `if (course.refSource === 'hanna' && key === 'hanna_down') return true;
      if (course.refSource === 'kanjo' && key === 'kanjo_lap') return true;
      return false;`
  ],
  [
    `hanna: 'hanna_down'
    };`,
    `hanna: 'hanna_down',
      kanjo: 'kanjo_lap'
    };`
  ],
  [
    `if (courseKey.startsWith('saruyama')) return 'saruyama';
      return 'hanna';`,
    `if (courseKey.startsWith('saruyama')) return 'saruyama';
      if (courseKey.startsWith('kanjo')) return 'kanjo';
      return 'hanna';`
  ],
  [
    `function courseDirFromKey(courseKey) {
      return courseKey.endsWith('_down') ? 'down' : 'up';
    }`,
    `function courseDirFromKey(courseKey) {
      if (courseKey.startsWith('kanjo') || courseKey.endsWith('_lap')) return 'lap';
      return courseKey.endsWith('_down') ? 'down' : 'up';
    }`
  ],
  [
    `{ id: 'hanna', label: '阪奈', up: null, down: 'hanna_down', downOnly: true }
    ];`,
    `{ id: 'hanna', label: '阪奈', up: null, down: 'hanna_down', downOnly: true },
      { id: 'kanjo', label: '環状', up: null, down: 'kanjo_lap', downOnly: true, lapGps: true }
    ];`
  ],
  [
    `if (src === 'hanna') applyPathToCourse('hanna_down', reversePath(path));
              else syncUpDownPaths(src, path);`,
    `if (src === 'hanna') applyPathToCourse('hanna_down', reversePath(path));
              else if (src === 'kanjo') applyPathToCourse('kanjo_lap', path);
              else syncUpDownPaths(src, path);`
  ],
  [
    `if (src === 'hanna') applyPathToCourse('hanna_down', reversePath(path));
      else if (courseKey.endsWith('_up') || src === courseKey) syncUpDownPaths(src, path);`,
    `if (src === 'hanna') applyPathToCourse('hanna_down', reversePath(path));
      else if (src === 'kanjo') applyPathToCourse('kanjo_lap', path);
      else if (courseKey.endsWith('_up') || src === courseKey) syncUpDownPaths(src, path);`
  ],
  [
    `'./assets/shigisan-ref.png','./assets/minoo-ref.png','./assets/hanna-ref.png'`,
    `'./assets/shigisan-ref.png','./assets/minoo-ref.png','./assets/hanna-ref.png','./assets/kanjo-ref.png'`
  ],
  [
    `const CACHE='setup-lab-v3'`,
    `const CACHE='setup-lab-v9'`
  ],
  [
    `function cornerLimitMs(mu, R, modifier = 1) {
      const Reff = Math.min(120, Math.max(R, 12));
      return Math.sqrt(mu * G * Reff * modifier);
    }`,
    `function cornerLimitMs(mu, R, modifier = 1, course) {
      const rCap = course?.logic === 'expressway' ? 650 : 120;
      const Reff = Math.min(rCap, Math.max(R, 12));
      return Math.sqrt(mu * G * Reff * modifier);
    }`
  ],
  [
    `let vLim = cornerLimitMs(mu, R, 1);`,
    `let vLim = cornerLimitMs(mu, R, 1, course);`
  ],
  [
    `function segmentStraightVmaxMs(veh, rpm, theta, course) {
      let vMs = solvePowerLimitedSpeedMs(veh, rpm, theta);
      if ((course.logic === 'climb' || course.logic === 'mixed') && theta > 0.01) {`,
    `function segmentStraightVmaxMs(veh, rpm, theta, course) {
      let vMs = solvePowerLimitedSpeedMs(veh, rpm, theta);
      if (course.logic === 'expressway') {
        const vGearMs = gearLimitedTopSpeedKmh(Math.min(veh.NeMax, rpm), veh) / 3.6;
        vMs = Math.min(vMs, vGearMs);
        if (veh.vmaxCatalog) vMs = Math.min(vMs, veh.vmaxCatalog / 3.6);
        return vMs;
      }
      if ((course.logic === 'climb' || course.logic === 'mixed') && theta > 0.01) {`
  ],
  [
    "if (s.type === 'straight' && s.vMax > (course.peakCeilingKmh ?? 999) + 2) {\n" +
      '          issues.push(`${s.id}: 直線ピーク${s.vMax.toFixed(0)} > 山岳上限${course.peakCeilingKmh}km/h`);\n' +
      '        }',
    "if (course.peakCeilingKmh != null && s.type === 'straight' && s.vMax > course.peakCeilingKmh + 2) {\n" +
      '          issues.push(`${s.id}: 直線ピーク${s.vMax.toFixed(0)} > 山岳上限${course.peakCeilingKmh}km/h`);\n' +
      '        }'
  ],
  [
    `const ceil = course.peakCeilingKmh;
      if (ceil != null && coursePeakKmh != null && coursePeakKmh > ceil + 5) {`,
    `const ceil = course.peakCeilingKmh;
      if (ceil != null && course.logic !== 'expressway' && coursePeakKmh != null && coursePeakKmh > ceil + 5) {`
  ],
  [
    `const g = COURSE_GROUPS.find((x) => x.id === groupId) || COURSE_GROUPS[0];
      const isDown = dir === 'down';
      btn.disabled = !!g.downOnly;
      btn.textContent = isDown ? '↓ 下り' : '↑ 上り';`,
    `const g = COURSE_GROUPS.find((x) => x.id === groupId) || COURSE_GROUPS[0];
      if (g.lapGps) {
        btn.disabled = true;
        btn.textContent = '↻ 外回り';
        btn.classList.remove('active-up', 'active-down');
        btn.title = '阪神環状は外回り1周（GPS）';
        return;
      }
      const isDown = dir === 'down';
      btn.disabled = !!g.downOnly;
      btn.textContent = isDown ? '↓ 下り' : '↑ 上り';`
  ],
  [
    `const dir = g.downOnly ? 'down' : state.courseDir || 'up';`,
    `const dir = g.lapGps ? 'lap' : (g.downOnly ? 'down' : state.courseDir || 'up');`
  ]
];

for (const [a, b] of patches) {
  if (html.includes(a)) html = html.replace(a, b);
  else console.warn('patch miss:', a.slice(0, 50));
}

if (!html.includes("logic === 'expressway'")) {
  console.error('expressway logic patches missing — index may be incomplete');
  process.exit(1);
}

writeFileSync(join(root, 'index.html'), html);
console.log('index.html integrated, kanjo', pathPts.length, 'pts');
