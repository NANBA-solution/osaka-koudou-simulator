#!/usr/bin/env node
/** 阪奈上り（スクショ赤線）を index.html に統合 */
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const paths = JSON.parse(readFileSync(join(root, 'scripts/extracted-paths.json'), 'utf8'));
const pathPts = paths.hanna_up;
if (!pathPts?.length) throw new Error('hanna_up path missing — run extract-hanna-up.mjs');

const pathLines = pathPts.map(([u, v]) => `          [${u},${v}]`).join(',\n');
const [su, sv] = pathPts[0];
const [fu, fv] = pathPts[pathPts.length - 1];
const mid1 = pathPts[Math.floor(pathPts.length * 0.35)];
const mid2 = pathPts[Math.floor(pathPts.length * 0.58)];

let html = readFileSync(join(root, 'index.html'), 'utf8');

const hannaUpBlock = `      // 阪奈上り：Apple Maps 赤線（RSタイチ〜旧道スイッチバック）
      hanna_up: {
        name: '阪奈 上り（赤線コース）',
        desc: '🔴RSタイチ付近S→スイッチバック上り→F',
        refMap: { src: 'assets/hanna-up-map.png' },
        refSource: 'hanna_up',
        mapAspect: 473 / 1024,
        pathExtract: { startCorner: 'lr', nPts: 160, dilateMax: 4 },
        logic: 'mixed',
        terrain: 'ridge',
        gradeFactor: 0.52,
        gradeSign: 1,
        totalMeters: 3300,
        cornerGripFactor: 0.92,
        surfaceMuFactor: TOUGE_SURFACE_MU,
        cornerThresh: 78,
        profileSegmentCount: 20,
        usePrecisionSim: true,
        startSpeedKmh: 38,
        peakCeilingKmh: 125,
        startLabel: 'RSタイチ付近 S',
        endLabel: '旧道頂上 F',
        landmarks: [
          { u: ${su}, v: ${sv}, label: 'S' },
          { u: ${mid1[0]}, v: ${mid1[1]}, label: '中垣内' },
          { u: ${mid2[0]}, v: ${mid2[1]}, label: '残念石付近' },
          { u: ${fu}, v: ${fv}, label: 'F' }
        ],
        path: [
${pathLines}
        ]
      },

`;

const anchor = '      // 阪奈府道8号：赤線どおり 左(市街)S→右(山)F、南側ループ含む';
if (!html.includes('hanna_up:')) {
  html = html.replace(anchor, hannaUpBlock + anchor);
}

html = html.replace(
  /function registerHannaDownVariant\(\) \{[\s\S]*?delete COURSES\.hanna;\s*\}\s*registerHannaDownVariant\(\);/,
  `function registerHannaVariants() {
      const downBase = pickBaseCourse('hanna');
      const upBase = pickBaseCourse('hanna_up');
      if (!downBase?.path?.length || !upBase?.path?.length) return;

      const { physicsProfile: _pD, ...baseD } = downBase;
      COURSES.hanna_down = {
        ...baseD,
        refSource: 'hanna',
        refMap: { src: 'assets/hanna-ref.png' },
        name: '阪奈 下り',
        desc: '府道8号S→善根寺町F · 下り 4.4km（南ループ経由）',
        startLabel: '府道8号 S',
        endLabel: '善根寺町 F',
        path: reversePath(downBase.path),
        landmarks: cloneLandmarksForPath(downBase.landmarks, reversePath(downBase.path)),
        gradeSign: -1,
        gradeFactor: downBase.gradeFactor,
        logic: 'downhill',
        terrain: 'downhill_city',
        useManualProfile: false,
        usePrecisionSim: true
      };

      const { physicsProfile: _pU, ...baseU } = upBase;
      COURSES.hanna_up = {
        ...baseU,
        refSource: 'hanna_up',
        name: '阪奈 上り',
        desc: 'RSタイチ付近S→スイッチバック上り · 約3.3km',
        gradeSign: 1,
        logic: 'mixed',
        terrain: 'ridge',
        useManualProfile: false,
        usePrecisionSim: true
      };

      delete COURSES.hanna;
    }
    registerHannaVariants();`
);

const patches = [
  [
    `{ id: 'hanna', label: '阪奈', up: null, down: 'hanna_down', downOnly: true },`,
    `{ id: 'hanna', label: '阪奈', up: 'hanna_up', down: 'hanna_down' },`
  ],
  [
    `hanna: 'hanna_down'`,
    `hanna: 'hanna_down',
      hanna_up: 'hanna_up'`
  ],
  [
    `if (courseKey.startsWith('kanjo')) return 'kanjo';
      return 'hanna';`,
    `if (courseKey.startsWith('kanjo')) return 'kanjo';
      if (courseKey.startsWith('hanna')) return 'hanna';
      return 'shigisan';`
  ],
  [
    `if (course.refSource === 'hanna' && key === 'hanna_down') return true;
      if (course.refSource === 'kanjo' && key === 'kanjo_lap') return true;`,
    `if (course.refSource === 'hanna' && key === 'hanna_down') return true;
      if (course.refSource === 'hanna_up' && key === 'hanna_up') return true;
      if (course.refSource === 'kanjo' && key === 'kanjo_lap') return true;`
  ],
  [
    `else if (src === 'kanjo') applyPathToCourse('kanjo_lap', path);
              else syncUpDownPaths(src, path);`,
    `else if (src === 'kanjo') applyPathToCourse('kanjo_lap', path);
              else if (src === 'hanna_up') applyPathToCourse('hanna_up', path);
              else syncUpDownPaths(src, path);`
  ],
  [
    `else if (src === 'kanjo') applyPathToCourse('kanjo_lap', path);
      else if (courseKey.endsWith('_up') || src === courseKey) syncUpDownPaths(src, path);`,
    `else if (src === 'kanjo') applyPathToCourse('kanjo_lap', path);
      else if (src === 'hanna_up') applyPathToCourse('hanna_up', path);
      else if (courseKey.endsWith('_up') || src === courseKey) syncUpDownPaths(src, path);`
  ],
  [
    `'./assets/shigisan-ref.png','./assets/minoo-ref.png','./assets/hanna-ref.png','./assets/kanjo-ref.png'`,
    `'./assets/shigisan-ref.png','./assets/minoo-ref.png','./assets/hanna-ref.png','./assets/hanna-up-map.png','./assets/kanjo-ref.png'`
  ],
  [
    `    hanna: {
          distanceM: {
            tier: 'config',
            value: 4400,
            ref: '阪奈道路（府道8号・善根寺町〜交野）下り走行区間概算'
          },
          path: { tier: 'extract', ref: 'assets/hanna-ref.png マーカー経路抽出' },
          lapRef: {
            tier: 'model',
            minSec: 145,
            maxSec: 235,
            car: 'gr86',
            tire: 'sport',
            ref: '下り基調・同上'
          }
        }`,
    `    hanna: {
          distanceM: {
            tier: 'config',
            value: 4400,
            ref: '阪奈道路（府道8号・南ループ含む下り）走行区間概算'
          },
          path: { tier: 'extract', ref: 'assets/hanna-ref.png マーカー経路抽出' },
          lapRef: {
            tier: 'model',
            minSec: 145,
            maxSec: 235,
            car: 'gr86',
            tire: 'sport',
            ref: '下り・南ループ経由'
          }
        },
        hanna_up: {
          distanceM: {
            tier: 'config',
            value: 3300,
            ref: '府道8号旧道スイッチバック上り（RSタイチ〜頂上）概算'
          },
          path: { tier: 'extract', ref: 'assets/hanna-up-map.png Apple Maps赤線' },
          lapRef: {
            tier: 'model',
            minSec: 155,
            maxSec: 245,
            car: 'gr86',
            tire: 'sport',
            ref: '上り・旧道スイッチバック'
          }
        }`
  ]
];

for (const [a, b] of patches) {
  if (html.includes(a)) html = html.replace(a, b);
  else console.warn('patch miss:', a.slice(0, 50));
}

writeFileSync(join(root, 'index.html'), html);
console.log('integrated hanna_up', pathPts.length, 'pts');
