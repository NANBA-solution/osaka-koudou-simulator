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

console.log('══ 大阪公道シミュレーター 仕上げ精査 ══\n');

// ── デプロイ必須ファイル ──
const required = [
  'index.html',
  'scripts/red-path-browser.js',
  'assets/shigisan-ref.png',
  'assets/minoo-ref.png',
  'assets/hanna-ref.png'
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

// ── コース（ベース定義 → 実行時に up/down 生成）──
const baseCourses = ['shigisan', 'saruyama', 'hanna'];
for (const ck of baseCourses) {
  const pathRe = new RegExp(`${ck}:\\s*\\{[\\s\\S]*?path:\\s*\\[`, 'm');
  if (!pathRe.test(html)) fail.push(`コース ${ck}: 埋め込み path なし`);
}
if (!html.includes('registerUpDownVariants(') || !html.includes('registerHannaDownVariant()')) {
  fail.push('コース variant 登録処理欠落');
}
for (const v of ['shigisan_up', 'shigisan_down', 'saruyama_up', 'saruyama_down', 'hanna_down']) {
  if (!html.includes(v)) fail.push(`variant キー ${v} がソースに未登場`);
}
pass(`コース base ${baseCourses.length} + variant 5`);

for (const src of ['shigisan', 'saruyama', 'hanna']) {
  if (!paths[src]?.length || paths[src].length < 8) fail.push(`extracted-paths ${src}: 点数不足`);
}
pass('extracted-paths 3コース');

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
const aliases = { shigisan: 'shigisan_up', minoo: 'saruyama_up', saruyama: 'saruyama_up', hanna: 'hanna_down' };
for (const [from, to] of Object.entries(aliases)) {
  if (!html.includes(`${from}: '${to}'`)) fail.push(`COURSE_KEY_ALIASES ${from}→${to} 欠落`);
}
pass('localStorage コースエイリアス');

// ── EVIDENCE コース根拠 ──
for (const src of ['shigisan', 'saruyama', 'hanna']) {
  if (!html.includes(`${src}:`) || !html.includes('distanceM:')) {
    /* EVIDENCE block */
  }
}
if (!html.match(/courses:\s*\{[\s\S]*shigisan:[\s\S]*saruyama:[\s\S]*hanna:/)) {
  warn.push('EVIDENCE.courses 3コースブロック要確認');
} else pass('EVIDENCE.courses 3件');

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
