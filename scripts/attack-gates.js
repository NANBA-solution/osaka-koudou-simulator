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

  /** 東西フォールバック用（OSM取得失敗時） */
  function gateAt(lat, lng, halfSpanLng = 0.0001) {
    return {
      pA: { lat, lng: lng - halfSpanLng },
      pB: { lat, lng: lng + halfSpanLng }
    };
  }

  /** OSM 道路読み取り用（中心点のみ登録） */
  function roadCenter(lat, lng) {
    return {
      autoRoad: true,
      center: { lat, lng },
      halfWidthM: HALF_WIDTH_M,
      fallback: gateAt(lat, lng)
    };
  }

  const TEST_GATE_LINE = {
    pA: { lat: 34.696439, lng: 135.609434 },
    pB: { lat: 34.696941, lng: 135.612101 }
  };

  /** 上り・下りの2端点ゲート — 最初に跨いだ方で方向を自動判定 */
  function isBidirectionalGroup(groupId) {
    const g = global.ATTACK_GATES?.[groupId];
    return !!(g?.up && g?.down);
  }

  global.ATTACK_GATES = {
    test: {
      lap: {
        name: 'テストゲート（現地確認）',
        start: TEST_GATE_LINE,
        goal: TEST_GATE_LINE
      }
    },
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
      down: {
        name: '阪奈道路 · 下り',
        start: roadCenter(34.704923, 135.656437),
        goal: roadCenter(34.702292, 135.652744)
      }
    },
    saruyama: {
      up: {
        name: '箕面 · 猿山（上り）',
        start: roadCenter(34.854785, 135.472299),
        goal: roadCenter(34.847327, 135.475892)
      },
      down: {
        name: '箕面 · 猿山（下り）',
        start: roadCenter(34.847327, 135.475892),
        goal: roadCenter(34.854785, 135.472299)
      }
    }
  };

  global.isAttackBidirectional = isBidirectionalGroup;
})(typeof window !== 'undefined' ? window : globalThis);
