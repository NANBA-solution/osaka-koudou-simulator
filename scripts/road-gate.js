/**
 * OpenStreetMap から最寄りの道路方位を読み取り、横断ゲート (pA–pB) を生成する。
 * Overpass API 利用（要ネットワーク）。
 */
(function (global) {
  'use strict';

  const CACHE_PREFIX = 'road_gate_cache_v1_';
  const DEFAULT_HALF_WIDTH_M = 10;
  const SEARCH_RADIUS_M = 40;
  const OVERPASS_ENDPOINTS = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.openstreetmap.fr/api/interpreter'
  ];

  function toRad(d) { return (d * Math.PI) / 180; }
  function toDeg(r) { return (r * 180) / Math.PI; }

  /** 起点から方位角・距離で移動した点 */
  function destinationPoint(lat, lng, bearingDeg, distanceM) {
    const R = 6371000;
    const brng = toRad(bearingDeg);
    const lat1 = toRad(lat);
    const lng1 = toRad(lng);
    const lat2 = Math.asin(
      Math.sin(lat1) * Math.cos(distanceM / R) +
      Math.cos(lat1) * Math.sin(distanceM / R) * Math.cos(brng)
    );
    const lng2 = lng1 + Math.atan2(
      Math.sin(brng) * Math.sin(distanceM / R) * Math.cos(lat1),
      Math.cos(distanceM / R) - Math.sin(lat1) * Math.sin(lat2)
    );
    return { lat: toDeg(lat2), lng: toDeg(lng2) };
  }

  function haversineM(a, b) {
    const R = 6371000;
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const s =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(Math.max(0, s)));
  }

  /** 線分 ab 上の点 p への最近点（緯度経度） */
  function closestOnSegment(p, a, b) {
    const ax = a.lng;
    const ay = a.lat;
    const bx = b.lng;
    const by = b.lat;
    const px = p.lng;
    const py = p.lat;
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    if (len2 < 1e-14) return { ...a };
    let t = ((px - ax) * dx + (py - ay) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    return { lat: ay + t * dy, lng: ax + t * dx };
  }

  function segmentBearingDeg(a, b) {
    const y = toRad(b.lat - a.lat);
    const x = toRad(b.lng - a.lng) * Math.cos(toRad((a.lat + b.lat) / 2));
    return (toDeg(Math.atan2(x, y)) + 360) % 360;
  }

  function highwayPriority(tags) {
    const hw = tags?.highway || '';
    const rank = {
      motorway: 1, trunk: 2, primary: 3, secondary: 4, tertiary: 5,
      unclassified: 6, residential: 7, service: 8, track: 9
    };
    return rank[hw] ?? 50;
  }

  function cacheKey(lat, lng, halfW) {
    return `${CACHE_PREFIX}${lat.toFixed(5)}_${lng.toFixed(5)}_${halfW}`;
  }

  function readCache(key) {
    try {
      const raw = sessionStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
  }

  function writeCache(key, gate) {
    try {
      sessionStorage.setItem(key, JSON.stringify(gate));
    } catch (_) {}
  }

  /** 道路に直角なゲートを OSM 道路ジオメトリから算出 */
  function gateFromSegment(center, segA, segB, halfWidthM) {
    const onRoad = closestOnSegment(center, segA, segB);
    const roadBearing = segmentBearingDeg(segA, segB);
    const gateBearing = (roadBearing + 90) % 360;
    return {
      pA: destinationPoint(onRoad.lat, onRoad.lng, gateBearing, halfWidthM),
      pB: destinationPoint(onRoad.lat, onRoad.lng, (gateBearing + 180) % 360, halfWidthM),
      meta: { roadBearing, gateBearing, snapped: onRoad }
    };
  }

  function pickBestWay(ways, center) {
    let best = null;
    for (const way of ways) {
      const geom = way.geometry;
      if (!geom || geom.length < 2) continue;
      const prio = highwayPriority(way.tags);
      for (let i = 0; i < geom.length - 1; i++) {
        const a = { lat: geom[i].lat, lng: geom[i].lon };
        const b = { lat: geom[i + 1].lat, lng: geom[i + 1].lon };
        const snap = closestOnSegment(center, a, b);
        const dist = haversineM(center, snap);
        if (dist > SEARCH_RADIUS_M) continue;
        const score = dist + prio * 2;
        if (!best || score < best.score) {
          best = { score, dist, a, b, snap, highway: way.tags?.highway || 'road' };
        }
      }
    }
    return best;
  }

  async function fetchWaysNear(lat, lng) {
    const query = `[out:json][timeout:15];way(around:${SEARCH_RADIUS_M},${lat},${lng})["highway"];out geom;`;
    const body = `data=${encodeURIComponent(query)}`;
    let lastErr = null;
    for (const endpoint of OVERPASS_ENDPOINTS) {
      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Accept: 'application/json'
          },
          body
        });
        if (!res.ok) throw new Error(`Overpass HTTP ${res.status}`);
        const ct = res.headers.get('content-type') || '';
        if (!ct.includes('json')) throw new Error('Overpass: JSON以外の応答');
        const data = await res.json();
        return data.elements || [];
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr || new Error('Overpass 接続失敗');
  }

  /**
   * @param {number} lat
   * @param {number} lng
   * @param {{ halfWidthM?: number }} opts
   * @returns {Promise<{ pA, pB, meta? }>}
   */
  async function buildGateFromRoad(lat, lng, opts = {}) {
    const halfWidthM = opts.halfWidthM ?? DEFAULT_HALF_WIDTH_M;
    const key = cacheKey(lat, lng, halfWidthM);
    const cached = readCache(key);
    if (cached?.pA && cached?.pB) return cached;

    const center = { lat, lng };
    const ways = await fetchWaysNear(lat, lng);
    const best = pickBestWay(ways, center);
    if (!best) {
      throw new Error('付近に道路データが見つかりません（OSM未登録の可能性）');
    }

    const gate = gateFromSegment(center, best.a, best.b, halfWidthM);
    gate.meta = {
      ...gate.meta,
      highway: best.highway,
      distM: Math.round(best.dist),
      source: 'openstreetmap'
    };
    writeCache(key, { pA: gate.pA, pB: gate.pB, meta: gate.meta });
    return gate;
  }

  /** gate 定義を解決（静的 pA/pB または autoRoad 中心点） */
  async function resolveGateDef(def) {
    if (!def) return null;
    if (def.pA && def.pB) {
      return { pA: def.pA, pB: def.pB, meta: { source: 'static' } };
    }
    if (def.autoRoad && def.center) {
      const halfWidthM = def.halfWidthM ?? DEFAULT_HALF_WIDTH_M;
      return buildGateFromRoad(def.center.lat, def.center.lng, { halfWidthM });
    }
    return null;
  }

  global.RoadGate = {
    buildGateFromRoad,
    resolveGateDef,
    destinationPoint,
    DEFAULT_HALF_WIDTH_M
  };
})(typeof window !== 'undefined' ? window : globalThis);
