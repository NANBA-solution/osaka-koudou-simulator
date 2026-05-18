/**
 * 峠・路面コンディション特化のアフィリエイト装備推奨
 */
(function (global) {
  'use strict';

  const MY_AMAZON_TAG = '&tag=irohack0d-22';

  const HIGH_PERFORMANCE_PRODUCTS = [
    {
      course: 'hanna',
      wet: false,
      keywords: 'ダンロップ DIREZZA ZIII 205 55 R16',
      item_name: 'DUNLOP DIREZZA ZIII (ハイグリップタイヤ)',
      reason: '超高速セクターが続くドライの阪奈道路で、リアの横滑りを極限まで抑え込み、レコードラインを1ミリも外さないために必須です。'
    },
    {
      course: 'hanna',
      wet: true,
      keywords: 'ヨコハマタイヤ ADVAN NEOVA AD09',
      item_name: 'YOKOHAMA ADVAN NEOVA AD09',
      reason: 'ヘビーウェットの阪奈道路で最も恐ろしい『ハイドロプレーニング現象』による全損クラッシュを引き算し、路面を力技で引き剥がすための選択。'
    },
    {
      course: 'shigisan',
      wet: false,
      keywords: 'エンドレス ブレーキパッド MX72',
      item_name: 'ENDLESS MX72 セミメタリックブレーキパッド',
      reason: '信貴山（十三峠）の超タイトな連続ヘアピンで、後半フェード現象（ブレーキの熱ダレ）を起こして崖下にダイブするのを物理的に防ぎます。'
    },
    {
      course: 'saruyama',
      wet: false,
      keywords: 'アルパインスターズ レーシンググローブ バイク 車',
      item_name: 'alpinestars 高反発レーシンググローブ',
      reason: '箕面（猿山）の激しい路面ギャップからくるキックバック（ステアリングの強い縦揺れ）を吸収し、正確なカウンターを当てるための必須装備。'
    },
    {
      course: 'any',
      wet: true,
      keywords: 'レインレーシンググローブ 防水',
      item_name: 'プロ仕様 防水レインレーシンググローブ',
      reason: 'WETμの冷たい雨の中、手元が滑ってステアリングやハンドル操作が1コマ遅れ、そのまま天国へ即日チェックインするのを回避せよ。'
    }
  ];

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function normalizeCourseId(courseId) {
    if (!courseId || courseId === 'test') return 'shigisan';
    if (courseId === 'sigisan') return 'shigisan';
    return courseId;
  }

  function pickProduct(courseId, isWet) {
    const course = normalizeCourseId(courseId);
    let item = HIGH_PERFORMANCE_PRODUCTS.find((p) => p.course === course && p.wet === isWet);
    if (!item) {
      item = HIGH_PERFORMANCE_PRODUCTS.find((p) => p.course === 'any' && p.wet === isWet);
    }
    if (!item) {
      item = HIGH_PERFORMANCE_PRODUCTS.find((p) => p.course === 'shigisan' && !p.wet)
        || HIGH_PERFORMANCE_PRODUCTS[0];
    }
    return item;
  }

  function updateEquipmentAdvisory(selectedCourse, isWet) {
    const item = pickProduct(selectedCourse, !!isWet);
    const finalURL =
      `https://www.amazon.co.jp/s?k=${encodeURIComponent(item.keywords)}${MY_AMAZON_TAG}`;
    const reason = escapeHtml(item.reason);
    const itemName = escapeHtml(item.item_name);

    const html = `
    <div class="border border-gray-800 bg-[#0a0a0a] p-3 text-left font-mono rounded-sm text-xs space-y-2" style="border-color: #1f2937;">
      <div class="flex justify-between text-[10px] tracking-widest text-red-500 font-bold gap-2">
        <span>⚠️ VEHICLE_EQUIPMENT_ADVISORY // 装備推奨</span>
        <span class="animate-pulse text-red-400 shrink-0">● ANALYSIS_OK</span>
      </div>
      <p class="text-gray-400 leading-relaxed text-[11px]">
        現在の設定コースに基づき車両スペックを演算した結果、<span class="text-gray-200 font-bold">${reason}</span>
      </p>
      <a href="${finalURL}" target="_blank" rel="noopener noreferrer sponsored"
         class="block w-full text-center bg-transparent hover:bg-red-950/20 text-red-400 border border-red-900/60 font-bold py-2 px-3 rounded-sm transition tracking-wider text-[11px] hover:border-red-500"
         style="border-color: rgba(127, 29, 29, 0.6); color: #f87171;">
        👉 Amazonで「${itemName}」の最安値・適合サイズをチェックする
      </a>
    </div>`;

    const targetZone = document.getElementById('affiliate-zone');
    if (targetZone) targetZone.innerHTML = html;
  }

  global.AffiliateAdvisory = {
    update: updateEquipmentAdvisory,
    products: HIGH_PERFORMANCE_PRODUCTS
  };
})(typeof window !== 'undefined' ? window : globalThis);
