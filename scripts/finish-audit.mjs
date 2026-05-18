#!/usr/bin/env node
/**
 * 仕上げ総合精査 — 静的整合・コース・車種・デプロイ前提
 */
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'index.html'), 'utf8');
const paths = JSON.parse(readFileSync(join(root, 'scripts/extracted-paths.json'), 'utf8'));

const fail = [];
const warn = [];
const pass = (msg) => console.log(`  ✓ ${msg}`);

function carBlocks() {
  const re = /^\s+([a-z0-9_]+):\s+mkCar\(\{([\s\S]*?)\n      \}\),/gm;
  const out = [];
  let m;
  while ((m = re.exec(html)) !== null) out.push({ key: m[1], body: m[2] });
  return out;
}

function kanjoBlock() {
  const i = html.indexOf('// 阪神環状：滑らかな外回り1周');
  if (i < 0) return '';
  const j = html.indexOf('// 阪奈府道8号', i);
  return j > i ? html.slice(i, j) : '';
}

console.log('══ 大阪公道シミュレーター 仕上げ精査 ══\n');

// ── デプロイ必須ファイル ──
const required = [
  'index.html',
  'scripts/red-path-browser.js',
  'assets/shigisan-ref.png',
  'assets/minoo-ref.png',
  'assets/hanna-ref.png',
  'assets/kanjo-ref.png'
];
for (const f of required) {
  if (!existsSync(join(root, f))) fail.push(`必須ファイル欠落: ${f}`);
  else pass(`ファイル ${f}`);
}

// ── DOM id と els.* の対応 ──
const domIds = [...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
const elsRefs = [...html.matchAll(/\$\('([^']+)'\)/g)].map((m) => m[1]);
const uniqueEls = [...new Set(elsRefs)];
for (const id of uniqueEls) {
  if (!domIds.includes(id)) fail.push(`DOM id 未定義: #${id} (els参照)`);
}
pass(`DOM id ${domIds.length} · els参照 ${uniqueEls.length} 整合`);

// ── 車種 ──
const cars = carBlocks();
const keys = cars.map((c) => c.key);
const dup = keys.filter((k, i) => keys.indexOf(k) !== i);
if (dup.length) fail.push(`車種キー重複: ${dup.join(', ')}`);
pass(`車種 ${keys.length} 台`);

for (const { key, body } of cars) {
  for (const f of ['name', 'baseKg', 'powerKw', 'finalDrive', 'tire', 'vmaxCatalog', 'NeMax']) {
    if (!body.includes(`${f}:`)) fail.push(`${key}: ${f} 欠落`);
  }
  if (!body.includes('gears:') && !body.includes('gearTop:')) fail.push(`${key}: 変速比未定義`);
  const pw = +body.match(/powerKw:\s*([\d.]+)/)?.[1];
  const vmax = +body.match(/vmaxCatalog:\s*(\d+)/)?.[1];
  if (pw > 350 && vmax < 280) warn.push(`${key}: 高出力(${pw}kW)だが公称vmax${vmax}が低め`);
}

// ── コース（ベース定義 → 実行時に up/down / lap 生成）──
const baseCourses = ['shigisan', 'saruyama', 'hanna', 'kanjo'];
for (const ck of baseCourses) {
  const pathRe = new RegExp(`${ck}:\\s*\\{[\\s\\S]*?path:\\s*\\[`, 'm');
  if (!pathRe.test(html)) fail.push(`コース ${ck}: 埋め込み path なし`);
}
if (!html.includes('registerUpDownVariants(') || !html.includes('registerHannaDownVariant()')) {
  fail.push('コース variant 登録処理欠落');
}
if (!html.includes('registerKanjoLapVariant()')) fail.push('registerKanjoLapVariant 欠落');
for (const v of [
  'shigisan_up', 'shigisan_down', 'saruyama_up', 'saruyama_down', 'hanna_down', 'kanjo_lap'
]) {
  if (!html.includes(v)) fail.push(`variant キー ${v} がソースに未登場`);
}
pass(`コース base ${baseCourses.length} + variant 6`);

for (const src of ['shigisan', 'saruyama', 'hanna', 'kanjo']) {
  if (!paths[src]?.length || paths[src].length < 8) fail.push(`extracted-paths ${src}: 点数不足`);
}
pass('extracted-paths 4コース');

// ── 環状コース整合 ──
const kb = kanjoBlock();
if (!kb.includes("logic: 'expressway'")) fail.push('kanjo: logic expressway 未定義');
if (kb.includes('peakCeilingKmh:')) fail.push('kanjo: peakCeilingKmh が残存（expresswayと矛盾）');
if (kb.includes('阿波座') || kb.includes('江戸堀')) fail.push('kanjo: 旧ランドマーク表記が残存');
if (!kb.includes('道頓堀') || !kb.includes('難波')) fail.push('kanjo: ランドマーク 道頓堀/難波 欠落');
if (!kb.includes('cornerAtLandmarks: true')) fail.push('kanjo: cornerAtLandmarks 必須（赤点のみコーナー）');
else pass('kanjo 赤点ランドマークのみコーナー');
if (kb.includes('totalMeters: 10300')) {
  const emb = (kb.match(/path:\s*\[([\s\S]*?)\]\s*\n\s*\}/) || [])[1];
  const n = emb ? (emb.match(/\[[\d.,\s]+\]/g) || []).length : 0;
  if (n !== paths.kanjo.length) {
    fail.push(`kanjo: 埋め込みpath ${n}点 ≠ extracted-paths ${paths.kanjo.length}点`);
  } else pass('kanjo path 埋め込み = extracted-paths');
}
if (!html.includes("id: 'kanjo'") || !html.includes('lapGps: true')) {
  fail.push('COURSE_GROUPS kanjo / lapGps 欠落');
} else pass('COURSE_GROUPS 環状 lapGps');

// ── エビデンス接続 ──
if (!html.includes('buildEvidenceReport(r, course')) {
  fail.push('buildEvidenceReport が physicsLog に未接続');
} else pass('エビデンス buildEvidenceReport → physicsLog');

if (!html.includes('function buildEvidenceReport')) pass('buildEvidenceReport 定義あり');

// ── 旧API・typo ──
if (html.includes('powerMode')) fail.push('廃止 powerMode が残存');
if (html.includes('<motion')) fail.push('壊れた <motion> タグ残存');
if (html.includes('cornerLimitMsForSeg(') && !html.includes('function cornerLimitMsForSeg')) {
  fail.push('cornerLimitMsForSeg 未定義');
} else pass('cornerLimitMsForSeg 定義あり');

// ── エイリアス ──
const aliases = {
  shigisan: 'shigisan_up',
  minoo: 'saruyama_up',
  saruyama: 'saruyama_up',
  hanna: 'hanna_down',
  kanjo: 'kanjo_lap'
};
for (const [from, to] of Object.entries(aliases)) {
  if (!html.includes(`${from}: '${to}'`)) fail.push(`COURSE_KEY_ALIASES ${from}→${to} 欠落`);
}
pass('localStorage コースエイリアス');

// ── EVIDENCE コース根拠 ──
if (
  !html.match(
    /courses:\s*\{[\s\S]*shigisan:[\s\S]*saruyama:[\s\S]*kanjo:[\s\S]*hanna:/
  )
) {
  fail.push('EVIDENCE.courses 4コースブロック不整合');
} else pass('EVIDENCE.courses 4件');

const evKanjo = html.match(/kanjo:\s*\{[\s\S]*?distanceM:\s*\{[\s\S]*?value:\s*(\d+)/);
const tmKanjo = kb.match(/totalMeters:\s*(\d+)/);
if (evKanjo && tmKanjo && evKanjo[1] !== tmKanjo[1]) {
  fail.push(`kanjo distanceM ${evKanjo[1]} ≠ totalMeters ${tmKanjo[1]}`);
} else if (evKanjo) pass('kanjo EVIDENCE.distanceM = totalMeters');

// ── GPS ゲート ──
const gates = readFileSync(join(root, 'scripts/attack-gates.js'), 'utf8');
if (!gates.includes('kanjo:') || !gates.includes('lap:')) fail.push('attack-gates kanjo.lap 欠落');
else pass('attack-gates 環状 lap');

// ── SW キャッシュ ──
if (!html.includes("CACHE='setup-lab-v9'") || !html.includes('kanjo-ref.png')) {
  warn.push('Service Worker v9 / kanjo-ref キャッシュ要確認');
} else pass('Service Worker v9 + kanjo-ref');

// ── 監査スクリプト同梱 ──
for (const s of ['logic-audit.mjs', 'sim-audit.mjs']) {
  if (!existsSync(join(root, 'scripts', s))) fail.push(`監査 ${s} なし`);
}
pass('logic-audit / sim-audit 同梱');

console.log('');
if (warn.length) {
  console.log('── 警告 ──');
  warn.forEach((w) => console.log(`  △ ${w}`));
  console.log('');
}

if (fail.length) {
  console.log('── 不合格 ──');
  fail.forEach((f) => console.log(`  ✗ ${f}`));
  process.exit(1);
}
console.log('仕上げ静的精査: 全項目合格\n');
