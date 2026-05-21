#!/usr/bin/env node
/** index.html の COURSES[].path を scripts/extracted-paths.json で上書き */
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const paths = JSON.parse(readFileSync(join(root, 'scripts/extracted-paths.json'), 'utf8'));
let html = readFileSync(join(root, 'index.html'), 'utf8');

const meta = {
  shigisan: {
    desc: '赤線抽出：左下S→右上F（十三峠〜鳴川峠〜旗立山方面）',
    start: '左下 赤点',
    end: '右上 赤点'
  },
  saruyama: {
    desc: '赤線抽出：左上S→右下F（猿山・府道43号）',
    start: '左上 赤点',
    end: '地獄谷口'
  },
  hanna: {
    desc: '🔴S→南ループ底→F（赤線どおり南へUターンして東へ）',
    start: '善根寺町付近 S',
    end: '府道8号 F'
  },
  hanna_up: {
    desc: '🔴府道8号（中垣内）S→赤線スイッチバック→旧道頂上F',
    start: '府道8号 🔴S',
    end: '旧道頂上 F'
  },
  kanjo: {
    desc: '赤線抽出：外回り1周 · 阪神高速1号環状線',
    start: 'スタート／ゴール',
    end: '1周'
  }
};

const pathArrayRe = '(?:\\s*\\[[^\\]]+\\],?)+';

for (const ids of [['hanna_up'], ['hanna'], ['shigisan', 'saruyama', 'kanjo']]) {
  for (const id of ids) {
    const pts = paths[id];
    if (!pts?.length) continue;
    const pathStr = '[\n' + pts.map(([u, v]) => `          [${u},${v}]`).join(',\n') + '\n        ]';
    let re;
    if (id === 'kanjo') {
      re =
        /(\/\/ 阪神環状：滑らかな外回り1周[\s\S]*?path:\s*)\[[\s\S]*?\](\s*\n\s*\},?\s*\n\s*\/\/ 阪奈)/m;
      if (!re.test(html)) {
        console.error('path block not found:', id, '(run integrate-kanjo-index.mjs first)');
        continue;
      }
      html = html.replace(re, `$1${pathStr}$2`);
    } else if (id === 'hanna_up') {
    re = new RegExp(
      `(// 阪奈上り[\\s\\S]*?path:\\s*)\\[${pathArrayRe}\\s*\\](?=\\s*\\n\\s*\\},)`,
      'm'
    );
    if (!re.test(html)) {
      console.error('path block not found:', id);
      continue;
    }
      html = html.replace(re, `$1${pathStr}`);
    } else {
      re = new RegExp(
        `(\\n      ${id}:\\s*\\{[\\s\\S]*?path:\\s*)\\[${pathArrayRe}\\s*\\](?=\\s*\\n\\s*(?:physicsProfile:|\\},))`,
        'm'
      );
      if (!re.test(html)) {
        console.error('path block not found:', id);
        continue;
      }
      html = html.replace(re, `$1${pathStr}`);
    }

    const [su, sv] = pts[0];
    const [fu, fv] = pts[pts.length - 1];
    const lmAnchor =
      id === 'hanna_up' ? '// 阪奈上り' : `\\n      ${id}:\\s*\\{`;
    const lmRe = new RegExp(`(${lmAnchor}[\\s\\S]*?landmarks:\\s*)\\[([\\s\\S]*?)\\](?=,\\s*path:)`);
  const lmMatch = html.match(lmRe);
  if (lmMatch) {
    let inner = lmMatch[2];
    if (/\blabel:\s*'S'/.test(inner)) {
      inner = inner.replace(/(\{\s*u:\s*)[\d.]+(\s*,\s*v:\s*)[\d.]+(\s*,\s*label:\s*'S')/, `$1${su}$2${sv}$3`);
    } else {
      inner = `          { u: ${su}, v: ${sv}, label: 'S' },\n` + inner;
    }
    inner = inner.replace(
      /\{\s*u:\s*[\d.]+\s*,\s*v:\s*[\d.]+\s*,\s*label:\s*'F[^']*'\s*\}/g,
      `{ u: ${fu}, v: ${fv}, label: 'F' }`
    );
    if (!/\blabel:\s*'F/.test(inner)) {
      inner = inner.trimEnd().replace(/,\s*$/, '') + `,\n          { u: ${fu}, v: ${fv}, label: 'F' }\n        `;
    }
    html = html.replace(lmRe, `$1[${inner}]`);
  }

  const m = meta[id];
  if (m) {
    html = html.replace(new RegExp(`(${id}:[\\s\\S]*?desc:\\s*)'[^']*'`), `$1'${m.desc}'`);
    html = html.replace(new RegExp(`(${id}:[\\s\\S]*?startLabel:\\s*)'[^']*'`), `$1'${m.start}'`);
    html = html.replace(new RegExp(`(${id}:[\\s\\S]*?endLabel:\\s*)'[^']*'`), `$1'${m.end}'`);
  }
    console.log('patched', id, pts.length, 'pts');
  }
}

writeFileSync(join(root, 'index.html'), html);
console.log('index.html updated');
