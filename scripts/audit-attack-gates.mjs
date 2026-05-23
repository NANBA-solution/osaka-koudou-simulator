#!/usr/bin/env node
/**
 * 信貴山・猿山 GPSゲートの上り／下り整合性チェック
 * - 上りは緯度が増える（北向き）こと
 * - down は up の start/goal 反転
 */
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function coordsForGroup(js, id) {
  const next =
    id === 'shigisan'
      ? String.raw`/\*\* 猿山`
      : id === 'saruyama'
        ? 'kanjo:'
        : 'test:';
  const re = new RegExp(`${id}:\\s*\\{([\\s\\S]*?)\\n    \\},\\n    ${next}`, 'm');
  const m = js.match(re);
  if (!m) throw new Error(`${id} block not found`);
  const nums = [...m[1].matchAll(/roadCenter\(([\d.]+),\s*([\d.]+)\)/g)].map((x) => ({
    lat: Number(x[1]),
    lng: Number(x[2])
  }));
  if (nums.length !== 4) throw new Error(`${id}: expected 4 roadCenter(), got ${nums.length}`);
  return {
    up: { start: nums[0], goal: nums[1] },
    down: { start: nums[2], goal: nums[3] }
  };
}

function distM(a, b) {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const fail = [];
const pass = (m) => console.log(`  ✓ ${m}`);

const js = readFileSync(join(root, 'scripts/attack-gates.js'), 'utf8');

console.log('══ GPSゲート 上り／下り 精査 ══\n');

for (const id of ['shigisan', 'saruyama']) {
  const { up, down } = coordsForGroup(js, id);
  const upS = up.start;
  const upG = up.goal;
  const downS = down.start;
  const downG = down.goal;

  const dLat = upG.lat - upS.lat;
  const label = id === 'shigisan' ? '信貴山' : '猿山';
  console.log(`── ${label} ──`);
  console.log(`  上り S: ${upS.lat.toFixed(6)}, ${upS.lng.toFixed(6)}`);
  console.log(`  上り G: ${upG.lat.toFixed(6)}, ${upG.lng.toFixed(6)}`);
  console.log(`  距離: ${(distM(upS, upG) / 1000).toFixed(2)} km · Δlat ${(dLat * 1000).toFixed(0)} m`);

  if (dLat <= 0) fail.push(`${id}: 上りが北向きではない（goal.lat <= start.lat）`);
  else pass(`${label} 上りは北向き（南→北）`);

  const downOk =
    Math.abs(downS.lat - upG.lat) < 1e-5 &&
    Math.abs(downS.lng - upG.lng) < 1e-5 &&
    Math.abs(downG.lat - upS.lat) < 1e-5 &&
    Math.abs(downG.lng - upS.lng) < 1e-5;
  if (!downOk) fail.push(`${id}: 下りが上りの反転になっていない`);
  else pass(`${label} 下りは上りの S/G 反転`);
  console.log('');
}

{
  const jusan = { lat: 34.636265, lng: 135.662733 };
  const upS = coordsForGroup(js, 'shigisan').up.start;
  if (distM(upS, jusan) > 80) fail.push('shigisan: 上りスタートが十三峠座標から80m以上離れている');
  else pass(`信貴山スタートは十三峠付近（${Math.round(distM(upS, jusan))}m）`);
}

if (fail.length) {
  console.log('── 不合格 ──');
  fail.forEach((f) => console.log(`  ✗ ${f}`));
  process.exit(1);
}
console.log('GPSゲート精査: 合格\n');
