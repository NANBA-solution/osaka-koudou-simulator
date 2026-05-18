#!/usr/bin/env node
/**
 * index.html の kanjo ブロックを extracted-paths.json と同期
 * （初回挿入は非推奨 — finish-audit で整合確認すること）
 */
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pathPts = JSON.parse(readFileSync(join(root, 'scripts/extracted-paths.json'), 'utf8')).kanjo;
if (!pathPts?.length) throw new Error('kanjo path missing in extracted-paths.json');

const pathLines = pathPts.map(([u, v]) => `          [${u},${v}]`).join(',\n');
const [su, sv] = pathPts[0];
const [fu, fv] = pathPts[pathPts.length - 1];

let html = readFileSync(join(root, 'index.html'), 'utf8');
if (!html.includes('// 阪神環状：滑らかな外回り1周')) {
  console.error('kanjo COURSES block not in index.html — run integrate-kanjo-index.mjs first');
  process.exit(1);
}

const pathRe =
  /(\/\/ 阪神環状：滑らかな外回り1周[\s\S]*?path:\s*)\[[\s\S]*?\](\s*\n\s*\},?\s*\n\s*\/\/ 阪奈)/m;
if (!pathRe.test(html)) throw new Error('kanjo path block not found');
html = html.replace(pathRe, `$1[\n${pathLines}\n        ]$2`);

const lmRe = /(kanjo:\s*\{[\s\S]*?landmarks:\s*)\[([\s\S]*?)\](\s*,\s*\n\s*physicsProfile)/m;
const lmMatch = html.match(lmRe);
if (lmMatch) {
  let inner = lmMatch[2];
  inner = inner.replace(
    /(\{\s*u:\s*)[\d.]+(\s*,\s*v:\s*)[\d.]+(\s*,\s*label:\s*'S')/,
    `$1${su}$2${sv}$3`
  );
  inner = inner.replace(
    /\{\s*u:\s*[\d.]+\s*,\s*v:\s*[\d.]+\s*,\s*label:\s*'F[^']*'\s*\}/,
    `{ u: ${fu}, v: ${fv}, label: 'F' }`
  );
  html = html.replace(lmRe, `$1[${inner}]$3`);
}

const kb = html.slice(
  html.indexOf('// 阪神環状：滑らかな外回り1周'),
  html.indexOf('// 阪奈府道8号', html.indexOf('// 阪神環状'))
);
if (kb.includes('peakCeilingKmh:')) {
  console.warn('警告: kanjo に peakCeilingKmh が残っています（expressway と矛盾）');
}
if (html.includes('阿波座')) {
  console.warn('警告: 旧ランドマーク「阿波座」が残っています');
}

writeFileSync(join(root, 'index.html'), html);
console.log('kanjo path synced:', pathPts.length, 'pts · S/F landmarks updated');
