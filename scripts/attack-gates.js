/**
 * GPSタイムアタック — スタート／ゴールゲート
 *
 * autoRoad: true の地点は起動時に OpenStreetMap から道路方位を読み取り、
 * 道路に直角な pA–pB を自動生成する（要ネットワーク）。
 * 失敗時は gateAt による東西フォールバックを使用。
 */
(function (global) {
  'use strict';

  const HALF_WIDTH_M = 10;

  const toRad = (d) => (d * Math.PI) / 180;
  const toDeg = (r) => (r * 180) / Math.PI;

  /** 起点から方位角・距離で移動（road-gate.js と同式） */
  function destinationPoint(lat, lng, bearingDeg, distanceM) {
    const R = 6371000;
    const brng = toRad(bearingDeg);
    const lat1 = toRad(lat);
    const lng1 = toRad(lng);
    const lat2 = Math.asin(
      Math.sin(lat1) * Math.cos(distanceM / R) +
      Math.cos(lat1) * Math.sin(distanceM / R) * Math.cos(brng)
    );
    const lng2 =
      lng1 +
      Math.atan2(
        Math.sin(brng) * Math.sin(distanceM / R) * Math.cos(lat1),
        Math.cos(distanceM / R) - Math.sin(lat1) * Math.sin(lat2)
      );
    return { lat: toDeg(lat2), lng: toDeg(lng2) };
  }

  function segmentBearingDeg(a, b) {
    const y = toRad(b.lat - a.lat);
    const x = toRad(b.lng - a.lng) * Math.cos(toRad((a.lat + b.lat) / 2));
    return (toDeg(Math.atan2(x, y)) + 360) % 360;
  }

  /** 道路方位に直角なゲート（オフライン／OSM失敗時） */
  function gatePerpendicularAt(lat, lng, roadBearingDeg, halfWidthM = HALF_WIDTH_M) {
    const gateBearing = (roadBearingDeg + 90) % 360;
    return {
      pA: destinationPoint(lat, lng, gateBearing, halfWidthM),
      pB: destinationPoint(lat, lng, (gateBearing + 180) % 360, halfWidthM)
    };
  }

  /** 東西フォールバック用（道路方位不明時） */
  function gateAt(lat, lng, halfSpanLng = 0.0001) {
    return {
      pA: { lat, lng: lng - halfSpanLng },
      pB: { lat, lng: lng + halfSpanLng }
    };
  }

  /** OSM 道路読み取り用（中心点＋道路直角フォールバック） */
  function roadCenter(lat, lng, roadBearingDeg) {
    const fallback =
      roadBearingDeg != null
        ? gatePerpendicularAt(lat, lng, roadBearingDeg)
        : gateAt(lat, lng);
    return {
      autoRoad: true,
      center: { lat, lng },
      halfWidthM: HALF_WIDTH_M,
      fallback
    };
  }

  /** 阪奈上り S/F（府道8号・赤線コース） */
  const HANNA_UP_S = { lat: 34.70454, lng: 135.65035 };
  const HANNA_UP_F = { lat: 34.706508, lng: 135.653153 };
  const HANNA_UP_ROAD_BEARING = segmentBearingDeg(HANNA_UP_S, HANNA_UP_F);

  /** 阪奈下り S/F（南ループ経由・hanna-ref コース） */
  const HANNA_DOWN_S = { lat: 34.704923, lng: 135.656437 };
  const HANNA_DOWN_F = { lat: 34.702292, lng: 135.652744 };
  const HANNA_DOWN_ROAD_BEARING = segmentBearingDeg(HANNA_DOWN_S, HANNA_DOWN_F);

  const TEST_GATE_LINE = {
    pA: { lat: 34.696439, lng: 135.609434 },
    pB: { lat: 34.696941, lng: 135.612101 }
  };

  /** 信貴山・猿山のみ：2端点ゲートで最初の通過から方向自動。阪奈は上り／下りを手動切替 */
  function isBidirectionalGroup(groupId) {
    if (groupId === 'hanna') return false;
    const g = global.ATTACK_GATES?.[groupId];
    return !!(g?.up && g?.down);
  }

  function gateCenterPoint(gateDef) {
    if (!gateDef) return null;
    if (gateDef.center) return { lat: gateDef.center.lat, lng: gateDef.center.lng };
    if (gateDef.pA && gateDef.pB) {
      return {
        lat: (gateDef.pA.lat + gateDef.pB.lat) / 2,
        lng: (gateDef.pA.lng + gateDef.pB.lng) / 2
      };
    }
    return null;
  }

  function getAttackGateCoords(groupId, dir) {
    const gates = global.ATTACK_GATES;
    if (!gates?.[groupId]) return null;
    let branch;
    if (dir === 'lap' && gates[groupId].lap) branch = gates[groupId].lap;
    else branch = gates[groupId][dir] || gates[groupId].down || gates[groupId].up;
    if (!branch) return null;
    return {
      name: branch.name,
      start: gateCenterPoint(branch.start),
      goal: gateCenterPoint(branch.goal)
    };
  }

  global.ATTACK_GATES = {
    test: {
      lap: {
        name: 'テストゲート（現地確認）',
        start: TEST_GATE_LINE,
        goal: TEST_GATE_LINE
      }
    },
    /** 信貴山：gateA=十三峠（南） gateB=鳴川・山上方面（北）。上り=南→北 */
    shigisan: {
      up: {
        name: '信貴山 · 十三峠（上り）',
        start: roadCenter(34.636125, 135.662671),
        goal: roadCenter(34.661322, 135.674728)
      },
      down: {
        name: '信貴山 · 十三峠（下り）',
        start: roadCenter(34.661322, 135.674728),
        goal: roadCenter(34.636125, 135.662671)
      }
    },
    hanna: {
      up: {
        name: '阪奈道路 · 上り',
        start: roadCenter(HANNA_UP_S.lat, HANNA_UP_S.lng, HANNA_UP_ROAD_BEARING),
        goal: roadCenter(HANNA_UP_F.lat, HANNA_UP_F.lng, HANNA_UP_ROAD_BEARING)
      },
      down: {
        name: '阪奈道路 · 下り',
        start: roadCenter(HANNA_DOWN_S.lat, HANNA_DOWN_S.lng, HANNA_DOWN_ROAD_BEARING),
        goal: roadCenter(HANNA_DOWN_F.lat, HANNA_DOWN_F.lng, HANNA_DOWN_ROAD_BEARING)
      }
    },
    /** 猿山（府道43・箕面ドライブウェイ）：上り=北向き。gateA=箕面側（南） gateB=山荘方面（北） */
    saruyama: {
      up: {
        name: '箕面 · 猿山（上り）',
        start: roadCenter(34.847327, 135.475892),
        goal: roadCenter(34.854785, 135.472299)
      },
      down: {
        name: '箕面 · 猿山（下り）',
        start: roadCenter(34.854785, 135.472299),
        goal: roadCenter(34.847327, 135.475892)
      }
    },
    kanjo: {
      lap: {
        name: '阪神環状 · 外回り',
        start: roadCenter(34.686417, 135.497954),
        goal: roadCenter(34.686417, 135.497954)
      }
    }
  };

  global.isAttackBidirectional = isBidirectionalGroup;
  global.getAttackGateCoords = getAttackGateCoords;
})(typeof window !== 'undefined' ? window : globalThis);
