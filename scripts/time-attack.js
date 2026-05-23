/**
 * GPSベクトル交差タイムアタック（スタート／ゴールゲート通過検知）
 */
(function (global) {
  'use strict';

  const LOG_KEY = 'osaka_kodo_attack_log_v2';
  const MAX_LOG = 200;
  const SHARE_APP_URL = 'https://nanba-solution.github.io/osaka-koudou-simulator/';

  /** タイムアタック用チャイム（Web Audio・外部ファイル不要） */
  const RecordChime = (function () {
    let ctx = null;
    const START_NOTES = [{ f: 523.25, at: 0 }, { f: 783.99, at: 0.07 }];
    const FINISH_NOTES = [{ f: 880, at: 0 }, { f: 1174.66, at: 0.1 }];

    function getCtx() {
      if (ctx) return ctx;
      const Ctx = global.AudioContext || global.webkitAudioContext;
      if (!Ctx) return null;
      try {
        ctx = new Ctx();
      } catch (_) {
        return null;
      }
      return ctx;
    }

    function shouldPlay() {
      return !global.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    }

    function playNotes(c, t0, notes, peak, decay) {
      notes.forEach(({ f, at }) => {
        const osc = c.createOscillator();
        const gain = c.createGain();
        osc.type = 'sine';
        osc.frequency.value = f;
        const t = t0 + at;
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(peak, t + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + decay);
        osc.connect(gain);
        gain.connect(c.destination);
        osc.start(t);
        osc.stop(t + decay + 0.04);
      });
    }

    function run(notes, peak, decay) {
      if (!shouldPlay()) return;
      const c = getCtx();
      if (!c) return;
      const exec = () => playNotes(c, c.currentTime, notes, peak, decay);
      if (c.state === 'suspended') {
        c.resume().then(exec).catch(() => {});
      } else {
        exec();
      }
    }

    function unlock() {
      const c = getCtx();
      if (!c) return Promise.resolve();
      const resume = c.state === 'suspended' ? c.resume() : Promise.resolve();
      return resume.then(() => {
        const o = c.createOscillator();
        const g = c.createGain();
        g.gain.value = 0.0001;
        o.connect(g);
        g.connect(c.destination);
        const t = c.currentTime;
        o.start(t);
        o.stop(t + 0.02);
      }).catch(() => {});
    }

    return {
      unlock,
      playStart: () => run(START_NOTES, 0.2, 0.2),
      playFinish: () => run(FINISH_NOTES, 0.22, 0.32)
    };
  })();

  const COURSE_GROUP_LABELS = {
    shigisan: '信貴山',
    saruyama: '猿山',
    hanna: '阪奈',
    kanjo: '阪神環状',
    test: 'テスト'
  };

  function buildShareText(courseName, time, gateName) {
    return (
      '【大阪公道シミュレーター】タイムアタック計測完了！\n\n' +
      `▶︎ コース: ${courseName}\n` +
      `⏱️ タイム: ${time}\n` +
      `📍 地点: ${gateName}\n\n` +
      '#大阪公道シミュレーター #タイムアタック\n'
    );
  }

  function isMobileOrStandalone() {
    return (
      /iPhone|iPad|iPod|Android/i.test(navigator.userAgent || '') ||
      window.navigator.standalone === true ||
      window.matchMedia('(display-mode: standalone)').matches
    );
  }

  function isIOS() {
    return /iPhone|iPad|iPod/i.test(navigator.userAgent || '');
  }

  function isAndroid() {
    return /Android/i.test(navigator.userAgent || '');
  }

  /** 記録保存時に先読み — IG タップ後すぐ保存・起動できるように */
  const storyBlobCache = new Map();
  const STORY_CACHE_MAX = 30;

  function cacheStoryBlobForEntry(entry) {
    const meta = entryShareMeta(entry);
    buildStoryImageBlob(meta.courseName, meta.time, meta.gateName).then((blob) => {
      if (!blob) return;
      storyBlobCache.set(entry.id, blob);
      if (storyBlobCache.size > STORY_CACHE_MAX) {
        const oldest = storyBlobCache.keys().next().value;
        storyBlobCache.delete(oldest);
      }
    });
  }

  /** iOS: 標準クリップボード（Instagram が参照する場合あり） */
  async function copyImageToClipboard(blob) {
    if (!global.navigator.clipboard?.write || !global.ClipboardItem) return false;
    try {
      await global.navigator.clipboard.write([
        new global.ClipboardItem({ 'image/png': blob })
      ]);
      return true;
    } catch (_) {
      return false;
    }
  }

  const IG_APP_SCHEMES = [
    'instagram-stories://share',
    'instagram://story-camera',
    'instagram://camera',
    'instagram://app'
  ];

  /** ユーザータップ直後（同期）で Instagram アプリ起動を試行 */
  function openInstagramSchemesSync() {
    if (!isMobileOrStandalone()) return;
    const url = IG_APP_SCHEMES[0];
    try {
      const a = global.document.createElement('a');
      a.href = url;
      a.style.display = 'none';
      global.document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (_) {}
    if (isIOS()) {
      try {
        const iframe = global.document.createElement('iframe');
        iframe.style.cssText = 'position:absolute;width:1px;height:1px;opacity:0;pointer-events:none';
        iframe.src = url;
        global.document.body.appendChild(iframe);
        global.setTimeout(() => iframe.remove(), 2000);
      } catch (_) {}
    }
    if (isAndroid()) {
      try {
        const a = global.document.createElement('a');
        a.href = 'instagram-stories://share';
        a.style.display = 'none';
        global.document.body.appendChild(a);
        a.click();
        a.remove();
      } catch (_) {}
    }
  }

  /** X 投稿画面へ（intent/tweet — モバイルでは X アプリが開く） */
  function xIntentTweetUrl(text) {
    const params = new URLSearchParams();
    params.set('text', text.trim());
    params.set('url', SHARE_APP_URL);
    return `https://x.com/intent/tweet?${params.toString()}`;
  }

  /**
   * ワンタップで X へ — スマホ/PWA は同一タブ遷移でアプリ Handoff、PC は別タブ
   * ※ intent/post は iOS でループするため tweet を使用
   */
  function shareToX(courseName, time, gateName) {
    const text = buildShareText(courseName, time, gateName);
    const intentUrl = xIntentTweetUrl(text);

    if (isMobileOrStandalone()) {
      window.location.href = intentUrl;
      return;
    }

    const a = document.createElement('a');
    a.href = intentUrl;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  global.shareToX = shareToX;

  function entryShareMeta(entry) {
    const courseName = COURSE_GROUP_LABELS[entry.courseGroup] || entry.courseGroup || '—';
    let gateName = entry.label || '—';
    if (entry.testMode) gateName += ' (現地確認)';
    return { courseName, time: entry.time || '—', gateName };
  }

  function wrapLines(ctx, text, maxWidth) {
    const lines = [];
    let line = '';
    for (const ch of String(text)) {
      const test = line + ch;
      if (ctx.measureText(test).width > maxWidth && line) {
        lines.push(line);
        line = ch;
      } else {
        line = test;
      }
    }
    if (line) lines.push(line);
    return lines.length ? lines : ['—'];
  }

  async function buildStoryImageBlob(courseName, time, gateName) {
    const W = 1080;
    const H = 1920;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    if (global.document?.fonts?.load) {
      try {
        await Promise.all([
          global.document.fonts.load('900 108px Orbitron'),
          global.document.fonts.load('600 36px "JetBrains Mono"')
        ]);
      } catch (_) {}
    }

    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#0a1018');
    bg.addColorStop(0.45, '#05070a');
    bg.addColorStop(1, '#0d1219');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    ctx.strokeStyle = 'rgba(0, 240, 255, 0.35)';
    ctx.lineWidth = 3;
    ctx.strokeRect(48, 48, W - 96, H - 96);

    ctx.shadowColor = 'rgba(0, 240, 255, 0.45)';
    ctx.shadowBlur = 24;
    ctx.strokeStyle = '#00f0ff';
    ctx.lineWidth = 2;
    ctx.strokeRect(72, 72, W - 144, H - 144);
    ctx.shadowBlur = 0;

    ctx.fillStyle = 'rgba(0, 229, 255, 0.12)';
    ctx.fillRect(72, 72, W - 144, 4);

    ctx.textAlign = 'center';
    ctx.fillStyle = '#64748b';
    ctx.font = '600 28px "JetBrains Mono", ui-monospace, monospace';
    ctx.fillText('OSAKA KOUDO SIMULATOR', W / 2, 200);
    ctx.fillStyle = '#f87171';
    ctx.font = '700 32px "JetBrains Mono", ui-monospace, monospace';
    ctx.fillText('GPS TIME ATTACK', W / 2, 248);

    ctx.fillStyle = '#00f0ff';
    ctx.font = '900 108px Orbitron, ui-monospace, monospace';
    ctx.shadowColor = 'rgba(0, 240, 255, 0.55)';
    ctx.shadowBlur = 28;
    ctx.fillText(time, W / 2, 520);
    ctx.shadowBlur = 0;

    ctx.fillStyle = '#94a3b8';
    ctx.font = '600 34px "JetBrains Mono", ui-monospace, monospace';
    ctx.fillText('LAP TIME', W / 2, 580);

    const padX = 120;
    const maxW = W - padX * 2;
    ctx.textAlign = 'left';
    ctx.fillStyle = '#cbd5e1';
    ctx.font = '600 32px "JetBrains Mono", ui-monospace, monospace';
    ctx.fillText(`▶ コース: ${courseName}`, padX, 720);

    ctx.fillStyle = '#94a3b8';
    ctx.font = '500 28px "JetBrains Mono", ui-monospace, monospace';
    const gateLines = wrapLines(ctx, `📍 ${gateName}`, maxW);
    gateLines.forEach((ln, i) => {
      ctx.fillText(ln, padX, 780 + i * 40);
    });

    ctx.textAlign = 'center';
    ctx.fillStyle = '#475569';
    ctx.font = '500 24px "JetBrains Mono", ui-monospace, monospace';
    ctx.fillText('#大阪公道シミュレーター #タイムアタック', W / 2, H - 220);
    ctx.fillStyle = '#00e5ff';
    ctx.font = '600 22px "JetBrains Mono", ui-monospace, monospace';
    const host = SHARE_APP_URL.replace(/^https?:\/\//, '');
    ctx.fillText(host, W / 2, H - 170);

    return new Promise((resolve) => {
      canvas.toBlob((blob) => resolve(blob), 'image/png');
    });
  }

  function storyImageFilename(timeLabel) {
    const safe = String(timeLabel || 'lap').replace(/[^\dA-Za-z-]+/g, '-');
    return `osaka-koudou-lap-${safe}.png`;
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = global.document.createElement('a');
    a.href = url;
    a.download = filename;
    global.document.body.appendChild(a);
    a.click();
    a.remove();
    global.setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  /**
   * IGタップ — 画像を端末に保存してから Instagram アプリを起動
   */
  async function saveImageAndOpenInstagram(blob, timeLabel) {
    if (!blob) {
      global.alert('ストーリー用画像の作成に失敗しました。');
      return;
    }

    const filename = storyImageFilename(timeLabel);
    downloadBlob(blob, filename);
    await copyImageToClipboard(blob);

    if (isMobileOrStandalone()) {
      global.setTimeout(() => {
        openInstagramSchemesSync();
        global.setTimeout(openInstagramSchemesSync, 450);
      }, 200);
      return;
    }

    global.alert(
      '画像をダウンロードしました。\nスマホのInstagramアプリでストーリーに画像を追加してください。'
    );
  }

  async function shareToInstagramStory(courseName, time, gateName) {
    const blob = await buildStoryImageBlob(courseName, time, gateName);
    await saveImageAndOpenInstagram(blob, time);
  }

  global.shareToInstagramStory = shareToInstagramStory;
  global.saveImageAndOpenInstagram = saveImageAndOpenInstagram;
  global.deliverInstagramStory = saveImageAndOpenInstagram;

  function newRecordId() {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }

  function formatRecordDate(ts) {
    const d = new Date(ts);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function normalizeEntries(raw) {
    if (!Array.isArray(raw)) return [];
    return raw.map((e) => ({
      id: e.id || newRecordId(),
      at: e.at || Date.now(),
      label: e.label || '—',
      time: e.time || '—',
      ms: typeof e.ms === 'number' ? e.ms : 0,
      courseGroup: e.courseGroup || '',
      courseDir: e.courseDir || '',
      testMode: !!e.testMode
    }));
  }

  function checkIntersection(p1, p2, p3, p4) {
    const tc1 = (p1.lng - p2.lng) * (p3.lat - p1.lat) + (p1.lat - p2.lat) * (p1.lng - p3.lng);
    const tc2 = (p1.lng - p2.lng) * (p4.lat - p1.lat) + (p1.lat - p2.lat) * (p1.lng - p4.lng);
    const tc3 = (p3.lng - p4.lng) * (p1.lat - p3.lat) + (p3.lat - p4.lat) * (p3.lng - p1.lng);
    const tc4 = (p3.lng - p4.lng) * (p2.lat - p3.lat) + (p3.lat - p4.lat) * (p3.lng - p2.lng);
    return tc1 * tc2 < 0 && tc3 * tc4 < 0;
  }

  function formatTime(ms) {
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    const milliseconds = Math.floor(ms % 1000);
    return (
      String(minutes).padStart(2, '0') + ':' +
      String(seconds).padStart(2, '0') + '.' +
      String(milliseconds).padStart(3, '0')
    );
  }

  function loadLog() {
    try {
      let raw = localStorage.getItem(LOG_KEY);
      if (!raw) {
        raw = localStorage.getItem('osaka_kodo_attack_log_v1');
        if (raw) {
          const migrated = normalizeEntries(JSON.parse(raw));
          saveLog(migrated);
          localStorage.removeItem('osaka_kodo_attack_log_v1');
          return migrated;
        }
        return [];
      }
      return normalizeEntries(JSON.parse(raw));
    } catch (_) {
      return [];
    }
  }

  function saveLog(entries) {
    try {
      const sorted = entries
        .slice()
        .sort((a, b) => (b.at || 0) - (a.at || 0))
        .slice(0, MAX_LOG);
      localStorage.setItem(LOG_KEY, JSON.stringify(sorted));
    } catch (_) {}
  }

  /** 2点間の概算距離（m） */
  function distM(a, b) {
    const R = 6371000;
    const toR = Math.PI / 180;
    const dLat = (b.lat - a.lat) * toR;
    const dLng = (b.lng - a.lng) * toR;
    const s =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(a.lat * toR) * Math.cos(b.lat * toR) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(s));
  }

  function gateMidpoint(gate) {
    return {
      lat: (gate.pA.lat + gate.pB.lat) / 2,
      lng: (gate.pA.lng + gate.pB.lng) / 2
    };
  }

  function isLapGateGroup(groupId) {
    return !!(global.ATTACK_GATES?.[groupId]?.lap);
  }

  function resolveGateConfig(groupId, dir) {
    const gates = global.ATTACK_GATES;
    if (!gates) return null;
    if (groupId === 'test') {
      return gates.test?.lap || gates.test?.up || null;
    }
    if (!gates[groupId]) return null;
    if (dir === 'lap' && gates[groupId].lap) return gates[groupId].lap;
    const branch = gates[groupId][dir] || gates[groupId].down || gates[groupId].up;
    return branch || null;
  }

  function isBidirectionalGroup(groupId) {
    if (global.isAttackBidirectional) return global.isAttackBidirectional(groupId);
    const gates = global.ATTACK_GATES;
    const g = gates?.[groupId];
    return !!(g?.up && g?.down);
  }

  function branchLabel(groupId, dir) {
    const branch = resolveGateConfig(groupId, dir);
    return branch?.name || '—';
  }

  /** スタート／ゴールが同一ライン（テスト・環状など） */
  function gatesShareSameLine(cfg) {
    if (!cfg?.start?.pA || !cfg?.goal?.pA) return false;
    const s = cfg.start;
    const g = cfg.goal;
    return (
      s.pA.lat === g.pA.lat &&
      s.pA.lng === g.pA.lng &&
      s.pB.lat === g.pB.lat &&
      s.pB.lng === g.pB.lng
    );
  }

  function lapNeedsDepartArming(cfg, inTestMode) {
    return !!(cfg?.lapMode && (inTestMode || gatesShareSameLine(cfg)));
  }

  function initTimeAttack(opts) {
    const getCourseGroup = opts.getCourseGroup;
    const getCourseDir = opts.getCourseDir;
    const onUiChange = opts.onUiChange;
    const onCourseDirDetected = opts.onCourseDirDetected;
    const els = opts.elements;

    let active = false;
    let watchId = null;
    let isRacing = false;
    let startTime = 0;
    let lastPosition = null;
    let uiInterval = null;
    let currentConfig = null;
    /** 計測待機中の双方向ゲート（上り／下り自動判定用） */
    let pendingBidirectional = null;
    let testMode = false;
    let goalArmed = false;
    let startGateMid = null;
    let lastCoordsPaint = 0;
    /** スタート直後の誤ゴール防止（同一ライン・GPSノイズ対策） */
    const MIN_RACE_MS = 2500;
    const MIN_DIST_FROM_START_M = 30;

    function addGpsLog(text) {
      if (!els.gpsLog) return;
      els.gpsLog.innerHTML += `> ${text}<br>`;
      els.gpsLog.scrollTop = els.gpsLog.scrollHeight;
    }

    const MSG = {
      off: '計測地点を通過するとスタート／ゴールを判定します',
      idle: '計測地点の通過を待機中',
      racing: '計測中 — ゴール地点を通過で停止',
      finished: 'ゴール地点通過 · 記録を保存しました',
      errorPos: '位置情報を取得できません（設定を確認）',
      errorGate: '計測地点を取得できません（ネットを確認）',
      errorUnsupported: 'この端末は位置情報に非対応です',
      errorUnset: 'このコースの計測地点が未設定です'
    };

    function setGpsPower(on) {
      if (els.timerPulse) {
        els.timerPulse.classList.toggle('measuring-pulse', on);
      }
      if (els.gpsPower) {
        els.gpsPower.textContent = on ? 'GPS ON' : 'GPS OFF';
        els.gpsPower.className = 'gps-power ' + (on ? 'gps-power-on' : 'gps-power-off');
      }
      if (els.toggleBtn) {
        els.toggleBtn.textContent = on ? 'OFF' : 'ON';
        els.toggleBtn.setAttribute('aria-label', on ? 'GPSをオフにする' : 'GPSをオンにする');
        if (on) {
          els.toggleBtn.classList.add('border-motec-warn', 'text-motec-warn');
          els.toggleBtn.classList.remove('border-red-800', 'text-red-300');
        } else {
          els.toggleBtn.classList.remove('border-motec-warn', 'text-motec-warn');
          els.toggleBtn.classList.add('border-red-800', 'text-red-300');
        }
      }
    }

    function setStatus(text, mode) {
      if (!els.status) return;
      els.status.textContent = text;
      els.status.className = 'text-xs font-bold tracking-wide ';
      if (mode === 'racing') els.status.className += 'text-motec-ok glow-cyan';
      else if (mode === 'finished') els.status.className += 'text-sky-400';
      else if (mode === 'error') els.status.className += 'text-motec-warn';
      else if (mode === 'warn') els.status.className += 'text-amber-400';
      else if (mode === 'off') els.status.className += 'text-slate-500';
      else els.status.className += 'text-amber-400/90';
    }

    function setTimerClass(mode) {
      if (!els.time) return;
      const base = 'attack-timer speed-text font-black tabular-nums tracking-widest ';
      if (mode === 'racing') els.time.className = base + 'text-motec-ok glow-cyan';
      else if (mode === 'finished') els.time.className = base + 'text-sky-400 glow-cyan';
      else els.time.className = base + 'text-red-400 glow-red';
    }

    function updateLogCount(n) {
      if (els.logCount) els.logCount.textContent = `(${n})`;
    }

    function shareRecordToX(id) {
      const entry = loadLog().find((e) => e.id === id);
      if (!entry) return;
      const meta = entryShareMeta(entry);
      shareToX(meta.courseName, meta.time, meta.gateName);
    }

    function shareRecordToInstagram(id) {
      const entry = loadLog().find((e) => e.id === id);
      if (!entry) return;
      const meta = entryShareMeta(entry);

      const cached = storyBlobCache.get(id);
      const run = cached
        ? Promise.resolve(cached)
        : buildStoryImageBlob(meta.courseName, meta.time, meta.gateName).then((blob) => {
            if (blob) storyBlobCache.set(id, blob);
            return blob;
          });

      run
        .then((blob) => saveImageAndOpenInstagram(blob, meta.time))
        .then(() => {
          addGpsLog('IG: 画像を保存 → Instagram を起動');
        })
        .catch(() => {
          global.alert('共有できませんでした。');
        });
    }

    function renderLogList() {
      if (!els.logList) return;
      const entries = loadLog();
      updateLogCount(entries.length);
      if (!entries.length) {
        els.logList.innerHTML = '<p class="text-slate-600 text-[10px] py-1">記録なし — ゴール地点通過で自動保存</p>';
        return;
      }
      els.logList.innerHTML = entries.map((e) => {
        const date = formatRecordDate(e.at);
        const label = escapeHtml(e.label);
        const time = escapeHtml(e.time);
        const id = escapeHtml(e.id);
        return (
          `<article class="attack-record-row py-1.5 border-b border-motec-border/60" data-record-id="${id}">` +
          `<div class="min-w-0">` +
          `<div class="text-motec-ok font-bold tabular-nums text-sm">${time}</div>` +
          `<div class="text-[10px] text-slate-500 truncate">${label}</div>` +
          `<div class="text-[9px] text-slate-600">${date}</div></div>` +
          `<div class="attack-record-actions">` +
          `<button type="button" class="attack-record-share" data-share-id="${id}" aria-label="Xで共有">X</button>` +
          `<button type="button" class="attack-record-share attack-record-share--ig" data-share-ig-id="${id}" aria-label="画像を保存してInstagramストーリーを開く" title="画像を自動保存してInstagramを起動">IG</button>` +
          `<button type="button" class="attack-record-del" data-delete-id="${id}" aria-label="この記録を削除">削除</button>` +
          `</div></article>`
        );
      }).join('');
    }

    function deleteRecord(id) {
      if (!id) return;
      saveLog(loadLog().filter((e) => e.id !== id));
      renderLogList();
      addGpsLog('記録を削除しました');
    }

    function clearAllRecords() {
      if (!loadLog().length) return;
      if (!global.confirm('すべてのタイム記録を削除しますか？')) return;
      saveLog([]);
      renderLogList();
      addGpsLog('全記録を削除しました');
    }

    function pushResult(finalMs) {
      const group = testMode ? 'test' : (currentConfig?.groupId || getCourseGroup());
      const dir = testMode ? 'lap' : (currentConfig?.courseDir || getCourseDir());
      const entry = {
        id: newRecordId(),
        at: Date.now(),
        label: currentConfig?.name || '—',
        time: formatTime(finalMs),
        ms: Math.round(finalMs),
        courseGroup: group,
        courseDir: dir,
        testMode: !!testMode
      };
      const entries = loadLog();
      entries.unshift(entry);
      saveLog(entries);
      renderLogList();
      addGpsLog(`記録保存 · ${entry.time}`);
      RecordChime.playFinish();
      cacheStoryBlobForEntry(entry);
    }

    let syncToken = 0;
    let gateLoadPromise = null;

    function gateSourceLabel(src) {
      if (src === 'openstreetmap') return ' · 道路方位OSM';
      if (src === 'fallback') return ' · オフラインゲート';
      return '';
    }

    function updateGateNote(cfg) {
      if (!els.gateNote || !cfg) return;
      if (testMode || cfg.lapMode) {
        els.gateNote.textContent =
          `${cfg.name} · 計測基点を通過するたびにラップ記録（2周目以降も自動継続）`;
        return;
      }
      if (cfg.bidirectional) {
        const src = gateSourceLabel(cfg.gateSource);
        els.gateNote.textContent =
          `${cfg.nameBase} · どちらの計測地点からでも可${src} · 最初の通過で方向自動`;
        return;
      }
      const src = gateSourceLabel(cfg.gateSource);
      els.gateNote.textContent = `${cfg.name}${src} · スタート地点通過で計測開始`;
    }

    async function resolveGateDef(def) {
      if (!def) return null;
      if (def.pA && def.pB) {
        return { pA: def.pA, pB: def.pB, meta: { source: 'static' } };
      }
      if (def.autoRoad && def.center && global.RoadGate) {
        try {
          return await global.RoadGate.buildGateFromRoad(
            def.center.lat, def.center.lng, { halfWidthM: def.halfWidthM }
          );
        } catch (err) {
          if (def.fallback) {
            return {
              pA: def.fallback.pA,
              pB: def.fallback.pB,
              meta: { source: 'fallback', error: err.message }
            };
          }
          throw err;
        }
      }
      if (def.fallback) {
        return { pA: def.fallback.pA, pB: def.fallback.pB, meta: { source: 'fallback' } };
      }
      return null;
    }

    async function resolveBranchGates(branch) {
      const [start, goal] = await Promise.all([
        resolveGateDef(branch.start),
        resolveGateDef(branch.goal)
      ]);
      if (!start?.pA || !goal?.pA) throw new Error('ゲート解決失敗');
      const src =
        start.meta?.source === 'openstreetmap' || goal.meta?.source === 'openstreetmap'
          ? 'openstreetmap'
          : start.meta?.source || goal.meta?.source || 'static';
      return { name: branch.name, start, goal, gateSource: src };
    }

    function nameBaseFromBranch(branch) {
      if (!branch?.name) return 'コース';
      return branch.name.replace(/（上り）|（下り）/g, '').trim();
    }

    async function resolveBidirectionalGates(groupId) {
      const gates = global.ATTACK_GATES;
      const up = gates?.[groupId]?.up;
      if (!up || !gates[groupId]?.down) throw new Error('双方向ゲート未定義');
      const [gateA, gateB] = await Promise.all([
        resolveGateDef(up.start),
        resolveGateDef(up.goal)
      ]);
      if (!gateA?.pA || !gateB?.pA) throw new Error('ゲート解決失敗');
      const src =
        gateA.meta?.source === 'openstreetmap' || gateB.meta?.source === 'openstreetmap'
          ? 'openstreetmap'
          : gateA.meta?.source || gateB.meta?.source || 'static';
      return {
        bidirectional: true,
        groupId,
        nameBase: nameBaseFromBranch(up),
        gateA,
        gateB,
        gateSource: src
      };
    }

    function armRaceFromFirstCross(cfg, crossedA, crossedB, crossTime) {
      const groupId = cfg.groupId;
      let dir;
      if (crossedA && !crossedB) dir = 'up';
      else if (crossedB && !crossedA) dir = 'down';
      else dir = 'up';

      const start = dir === 'up' ? cfg.gateA : cfg.gateB;
      const goal = dir === 'up' ? cfg.gateB : cfg.gateA;
      const name = branchLabel(groupId, dir);
      const gateSource = cfg.gateSource;

      currentConfig = { name, start, goal, gateSource, courseDir: dir, groupId };
      isRacing = true;
      goalArmed = false;
      startGateMid = gateMidpoint(start);
      startTime = crossTime;
      setStatus(MSG.racing, 'racing');
      setTimerClass('racing');
      const dirJa = dir === 'up' ? '上り' : '下り';
      addGpsLog(`方向自動: ${dirJa}（最初の計測地点通過）`);
      addGpsLog('計測地点通過 → スタート');
      updateGateNote(currentConfig);
      onCourseDirDetected?.(dir, groupId);
      uiInterval = setInterval(() => {
        if (els.time) els.time.textContent = formatTime(performance.now() - startTime);
      }, 33);
      updateLapButtons();
      RecordChime.playStart();
    }

    function restoreBidirectionalIdle() {
      if (!pendingBidirectional) return;
      currentConfig = pendingBidirectional;
      updateGateNote(currentConfig);
    }

    function setTestMode(on) {
      if (isRacing) return;
      testMode = !!on;
      syncCourse();
      onUiChange?.();
      if (active) {
        if (testMode) addGpsLog('テストゲートモード ON · ゲート同期済み');
        else addGpsLog('テストゲートモード OFF');
      } else if (testMode) {
        addGpsLog('テストゲートモード ON');
      }
    }

    function syncCourse() {
      if (isRacing) return gateLoadPromise || Promise.resolve();
      const token = ++syncToken;
      const group = testMode ? 'test' : getCourseGroup();
      const dir = testMode || isLapGateGroup(group) ? 'lap' : getCourseDir();
      const branch = resolveGateConfig(group, dir);

      if (!branch) {
        currentConfig = null;
        if (!active) setStatus(MSG.errorUnset, 'warn');
        if (els.gateNote) els.gateNote.textContent = '—';
        return Promise.resolve();
      }

      const useAutoDir = !testMode && isBidirectionalGroup(group);
      const needsOsm = !testMode && (
        useAutoDir
          ? !!(global.ATTACK_GATES?.[group]?.up?.start?.autoRoad)
          : !!(branch.start?.autoRoad || branch.goal?.autoRoad)
      );
      if (needsOsm && els.gateNote) {
        const label = useAutoDir ? nameBaseFromBranch(resolveGateConfig(group, 'up')) : branch.name;
        els.gateNote.textContent = `${label} · 道路データ取得中…`;
      }

      gateLoadPromise = (async () => {
        try {
          let cfg;
          if (useAutoDir) {
            cfg = await resolveBidirectionalGates(group);
            cfg.groupId = group;
          } else {
            cfg = await resolveBranchGates(branch);
            if (isLapGateGroup(group)) {
              cfg.lapMode = true;
              cfg.courseDir = 'lap';
            }
            cfg.groupId = group;
          }
          if (token !== syncToken) return;
          pendingBidirectional = useAutoDir ? cfg : null;
          currentConfig = cfg;
          updateGateNote(cfg);
          if (active) {
            const mode = useAutoDir ? '方向自動' : cfg.gateSource;
            addGpsLog(`コース同期: ${useAutoDir ? cfg.nameBase : cfg.name} (${mode})`);
            setStatus(MSG.idle, 'idle');
          }
        } catch (err) {
          if (token !== syncToken) return;
          pendingBidirectional = null;
          addGpsLog(`計測地点取得失敗: ${err.message}`);
          if (active) setStatus(MSG.errorGate, 'error');
          if (els.gateNote) {
            const label = useAutoDir ? nameBaseFromBranch(branch) : branch.name;
            els.gateNote.textContent = `${label} · OSM取得失敗`;
          }
        }
      })();

      return gateLoadPromise;
    }

    function stopWatch() {
      if (watchId != null) {
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
      }
    }

    function updateLapButtons() {
      if (els.resetBtn) els.resetBtn.disabled = !active;
      if (els.stopBtn) els.stopBtn.disabled = !active || !isRacing;
    }

    function resetRaceUi() {
      isRacing = false;
      goalArmed = false;
      startGateMid = null;
      if (uiInterval) {
        clearInterval(uiInterval);
        uiInterval = null;
      }
      setTimerClass('idle');
      if (els.time) els.time.textContent = '00:00.000';
      updateLapButtons();
    }

    function resetLap() {
      if (!active) return;
      resetRaceUi();
      restoreBidirectionalIdle();
      setStatus(MSG.idle, 'idle');
      addGpsLog('リセット');
    }

    function stopLap() {
      if (!active || !isRacing) return;
      resetRaceUi();
      restoreBidirectionalIdle();
      setStatus(MSG.idle, 'idle');
      addGpsLog('ストップ（記録なし）');
    }

    function onPosition(position) {
      const currentPos = {
        lat: position.coords.latitude,
        lng: position.coords.longitude,
        time: performance.now(),
        acc: position.coords.accuracy
      };

      if (!currentConfig) return;
      if (currentConfig.bidirectional) {
        if (!currentConfig.gateA?.pA || !currentConfig.gateB?.pA) return;
      } else if (!currentConfig.start?.pA || !currentConfig.goal?.pA) {
        return;
      }

      if (els.coords) {
        const now = performance.now();
        if (!isRacing || now - lastCoordsPaint > 400) {
          lastCoordsPaint = now;
          els.coords.textContent = `${currentPos.lat.toFixed(5)}, ${currentPos.lng.toFixed(5)} ±${Math.round(currentPos.acc || 0)}m`;
        }
      }

      if (lastPosition) {
        if (currentConfig.lapMode && currentConfig.start?.pA) {
          const needsDepart = lapNeedsDepartArming(currentConfig, testMode);
          if (isRacing && needsDepart && !goalArmed && startGateMid) {
            const elapsed = performance.now() - startTime;
            const away = distM(currentPos, startGateMid);
            if (elapsed >= MIN_RACE_MS && away >= MIN_DIST_FROM_START_M) {
              goalArmed = true;
              addGpsLog(`ラップ記録準備 (${Math.round(away)}m離脱)`);
            }
          }
          const crossedLine = checkIntersection(
            lastPosition, currentPos,
            currentConfig.start.pA, currentConfig.start.pB
          );
          if (crossedLine) {
            const timeDiff = currentPos.time - lastPosition.time;
            const crossTime = lastPosition.time + timeDiff * 0.5;
            if (!isRacing) {
              isRacing = true;
              goalArmed = false;
              startGateMid = gateMidpoint(currentConfig.start);
              startTime = crossTime;
              setStatus(MSG.racing, 'racing');
              setTimerClass('racing');
              addGpsLog('計測基点通過 → ラップ計測開始');
              if (uiInterval) clearInterval(uiInterval);
              uiInterval = setInterval(() => {
                if (els.time) els.time.textContent = formatTime(performance.now() - startTime);
              }, 33);
              updateLapButtons();
              RecordChime.playStart();
            } else if (crossTime - startTime >= MIN_RACE_MS && (!needsDepart || goalArmed)) {
              const finalTime = crossTime - startTime;
              if (els.time) els.time.textContent = formatTime(finalTime);
              setStatus(MSG.finished, 'finished');
              setTimerClass('finished');
              pushResult(finalTime);
              addGpsLog(`計測基点通過 → ラップ ${formatTime(finalTime)} 記録 · 継続`);
              startTime = crossTime;
              goalArmed = false;
              setStatus(MSG.racing, 'racing');
              setTimerClass('racing');
            }
          }
        } else if (!isRacing) {
          if (currentConfig.bidirectional) {
            const crossedA = checkIntersection(
              lastPosition, currentPos,
              currentConfig.gateA.pA, currentConfig.gateA.pB
            );
            const crossedB = checkIntersection(
              lastPosition, currentPos,
              currentConfig.gateB.pA, currentConfig.gateB.pB
            );
            if (crossedA || crossedB) {
              const timeDiff = currentPos.time - lastPosition.time;
              const crossTime = lastPosition.time + timeDiff * 0.5;
              armRaceFromFirstCross(currentConfig, crossedA, crossedB, crossTime);
            }
          } else if (currentConfig.start?.pA) {
            const crossedStart = checkIntersection(
              lastPosition, currentPos,
              currentConfig.start.pA, currentConfig.start.pB
            );
            if (crossedStart) {
              isRacing = true;
              goalArmed = false;
              startGateMid = gateMidpoint(currentConfig.start);
              const timeDiff = currentPos.time - lastPosition.time;
              startTime = lastPosition.time + timeDiff * 0.5;
              setStatus(MSG.racing, 'racing');
              setTimerClass('racing');
              addGpsLog('計測地点通過 → スタート');
              uiInterval = setInterval(() => {
                if (els.time) els.time.textContent = formatTime(performance.now() - startTime);
              }, 33);
              updateLapButtons();
              RecordChime.playStart();
            }
          }
        } else if (!currentConfig.lapMode) {
          if (!goalArmed && startGateMid) {
            const elapsed = performance.now() - startTime;
            const away = distM(currentPos, startGateMid);
            if (elapsed >= MIN_RACE_MS && away >= MIN_DIST_FROM_START_M) {
              goalArmed = true;
              addGpsLog(`ゴール地点判定準備 (${Math.round(away)}m離脱)`);
            }
          }
          const crossedGoal = goalArmed && checkIntersection(
            lastPosition, currentPos,
            currentConfig.goal.pA, currentConfig.goal.pB
          );
          if (crossedGoal) {
            const timeDiff = currentPos.time - lastPosition.time;
            const finalTime = (lastPosition.time + timeDiff * 0.5) - startTime;
            resetRaceUi();
            if (els.time) els.time.textContent = formatTime(finalTime);
            setStatus(MSG.finished, 'finished');
            setTimerClass('finished');
            pushResult(finalTime);
            addGpsLog(`計測地点通過 → ゴール · ${formatTime(finalTime)}`);
            restoreBidirectionalIdle();
            setStatus(MSG.idle, 'idle');
            updateLapButtons();
          }
        }
      }

      lastPosition = currentPos;
    }

    function onGpsError(err) {
      addGpsLog(`位置情報: ${err.message}`);
      setStatus(MSG.errorPos, 'error');
    }

    async function startGps() {
      if (!('geolocation' in navigator)) {
        setGpsPower(false);
        setStatus(MSG.errorUnsupported, 'error');
        return;
      }
      await syncCourse();
      const gatesReady = currentConfig?.bidirectional
        ? currentConfig.gateA?.pA && currentConfig.gateB?.pA
        : currentConfig?.start?.pA && currentConfig?.goal?.pA;
      if (!gatesReady) {
        setGpsPower(false);
        setStatus(MSG.errorGate, 'warn');
        return;
      }
      active = true;
      resetRaceUi();
      lastPosition = null;
      lastCoordsPaint = 0;
      stopWatch();
      setGpsPower(true);
      setStatus(MSG.idle, 'idle');
      updateLapButtons();
      addGpsLog('GPS ON · 計測地点の通過で計測します');
      watchId = navigator.geolocation.watchPosition(onPosition, onGpsError, {
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: 5000
      });
    }

    function stopGps() {
      active = false;
      stopWatch();
      resetRaceUi();
      setGpsPower(false);
      setStatus(MSG.off, 'off');
      updateLapButtons();
      addGpsLog('GPS OFF');
    }

    function toggleGps() {
      RecordChime.unlock();
      if (active) stopGps();
      else startGps().catch(() => {});
    }

    if (els.toggleBtn) els.toggleBtn.addEventListener('click', toggleGps);
    if (els.resetBtn) els.resetBtn.addEventListener('click', resetLap);
    if (els.stopBtn) els.stopBtn.addEventListener('click', stopLap);
    if (els.logList) {
      els.logList.addEventListener('click', (ev) => {
        const shareBtn = ev.target.closest('[data-share-id]');
        if (shareBtn) {
          ev.preventDefault();
          shareRecordToX(shareBtn.getAttribute('data-share-id'));
          return;
        }
        const igBtn = ev.target.closest('[data-share-ig-id]');
        if (igBtn) {
          ev.preventDefault();
          shareRecordToInstagram(igBtn.getAttribute('data-share-ig-id'));
          return;
        }
        const delBtn = ev.target.closest('[data-delete-id]');
        if (!delBtn) return;
        ev.preventDefault();
        deleteRecord(delBtn.getAttribute('data-delete-id'));
      });
    }
    if (els.clearAllBtn) els.clearAllBtn.addEventListener('click', clearAllRecords);

    renderLogList();
    setGpsPower(false);
    setStatus(MSG.off, 'off');
    updateLapButtons();
    syncCourse();

    return {
      syncCourse,
      setTestMode,
      isTestMode: () => testMode,
      isRacing: () => isRacing,
      isActive: () => active,
      isAutoDirCourse: () => !testMode && isBidirectionalGroup(getCourseGroup()),
      stopGps,
      reloadLog: renderLogList,
      shareRecordToX,
      shareRecordToInstagram
    };
  }

  global.TimeAttack = {
    init: initTimeAttack,
    formatTime,
    shareToX,
    shareToInstagramStory
  };
})(typeof window !== 'undefined' ? window : globalThis);
