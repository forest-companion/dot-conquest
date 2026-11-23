// 세계 육지 데이터(Natural Earth, 공공 데이터)를 도트 지형 격자로 바꿔 src/mapdata.js 로 저장한다.
// 사용법: node tools/build-map.js
// 지형 값: 0 바다, 1 평야, 2 언덕, 3 산, 4 사막, 5 툰드라
//
// - 너무 작은 섬은 지우고(MIN_ISLAND 칸 미만), 육지 속 작은 호수는 메운다.
// - 한국·일본·호주처럼 작게 보이는 곳은 "돋보기(LENSES)"로 키운다.
//   반경 rs 안쪽은 m배로 고르게 커지고, 그 바깥 R 까지의 고리만 눌리며, R 밖은 그대로다.
// - 투영: 고위도(러시아·캐나다·그린란드)가 옆으로 늘어나 보이지 않게 위도에 따라 가로를 좁힌다.
//   x = 가운데 + 경도 × k(위도),  k = PROJ_A + PROJ_B·cos(위도)   (적도 1배, 위도 70도 약 0.74배)
const fs = require('fs');
const path = require('path');

const W = 1000;
const PROJ_A = 0.6, PROJ_B = 0.4;
const LAT_TOP = 78, LAT_BOT = -56;
const H = Math.round(W * (LAT_TOP - LAT_BOT) / 360);
const MIN_ISLAND = 30; // 이보다 작은 섬은 바다로
const MIN_LAKE = 30;   // 이보다 작은 호수(바다와 안 이어진 물)는 땅으로

// [원래 경도, 원래 위도, 키울 반경 rs(도), 배율 m, 영향 반경 R(도)]  — 큰 것부터
const LENSES = [
  [133.0, 37.5, 9, 1.8, 25],    // 한반도 + 일본
  [127.6, 37.0, 4.2, 1.45, 8],  // 한반도 한 번 더
  [134.0, -26.0, 21, 1.15, 30], // 호주
  [121.0, 23.7, 2, 2.0, 6],     // 대만
  [122.5, 12.0, 4, 1.5, 9],     // 필리핀
  [172.5, -41.5, 6, 1.6, 13],   // 뉴질랜드
];

const geo = JSON.parse(fs.readFileSync(path.join(__dirname, 'raw', 'land50.geojson'), 'utf8'));

// ---------- 1. 원본 좌표계(경위도 0.1도)로 육지 마스크를 고해상도로 칠한다 ----------
const RES = 10; // 1도에 10칸
const SW = 360 * RES, SH = 180 * RES; // 위도 90 ~ -90
const src = new Uint8Array(SW * SH);
const rows = Array.from({ length: SH }, () => []);
for (const f of geo.features) {
  const g = f.geometry;
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
  for (const poly of polys) for (const ring of poly) {
    for (let i = 0; i < ring.length - 1; i++) {
      const [x1, y1] = ring[i], [x2, y2] = ring[i + 1];
      if (y1 === y2) continue;
      // 이 선분이 지나는 행들에 등록
      const r1 = Math.floor((90 - Math.max(y1, y2)) * RES), r2 = Math.ceil((90 - Math.min(y1, y2)) * RES);
      for (let r = Math.max(0, r1); r <= Math.min(SH - 1, r2); r++) rows[r].push([x1, y1, x2, y2]);
    }
  }
}
for (let r = 0; r < SH; r++) {
  const lat = 90 - (r + 0.5) / RES;
  const xs = [];
  for (const [x1, y1, x2, y2] of rows[r]) {
    if ((y1 <= lat && y2 > lat) || (y2 <= lat && y1 > lat)) xs.push(x1 + (lat - y1) * (x2 - x1) / (y2 - y1));
  }
  xs.sort((a, b) => a - b);
  for (let i = 0; i + 1 < xs.length; i += 2) {
    const a = Math.ceil((xs[i] + 180) * RES - 0.5), b = Math.floor((xs[i + 1] + 180) * RES - 0.5);
    for (let c = Math.max(0, a); c <= Math.min(SW - 1, b); c++) src[r * SW + c] = 1;
  }
}
const isLand = (lon, lat) => {
  let c = Math.floor((lon + 180) * RES), r = Math.floor((90 - lat) * RES);
  c = ((c % SW) + SW) % SW;
  if (r < 0 || r >= SH) return false;
  return src[r * SW + c] === 1;
};

// ---------- 2. 돋보기 ----------
// 한 돋보기: 원본 거리 s → 화면 거리 d, 그리고 반대
const lensFwd = (s, rs, m, R) => s <= rs ? s * m : s < R ? rs * m + (s - rs) * (R - rs * m) / (R - rs) : s;
const lensInv = (d, rs, m, R) => d <= rs * m ? d / m : d < R ? rs + (d - rs * m) * (R - rs) / (R - rs * m) : d;
function applyLens(lon, lat, L, inv) {
  const [cx, cy, rs, m, R] = L;
  const dx = lon - cx, dy = lat - cy, d = Math.hypot(dx, dy);
  if (d === 0 || d >= R) return [lon, lat];
  const e = inv ? lensInv(d, rs, m, R) : lensFwd(d, rs, m, R);
  return [cx + dx * e / d, cy + dy * e / d];
}
// 돋보기는 순서대로 겹쳐 적용된다. 뒤 돋보기의 중심은 앞 돋보기들을 거친 위치로 옮겨 둔다.
const placed = [];
for (const L of LENSES) {
  let [x, y] = [L[0], L[1]];
  for (const P of placed) [x, y] = applyLens(x, y, P, false);
  placed.push([x, y, L[2], L[3], L[4]]);
}
// 화면 경위도 → 원본 경위도 (마지막에 적용된 돋보기부터 되돌린다)
function unlens(lon, lat) {
  for (let i = placed.length - 1; i >= 0; i--) [lon, lat] = applyLens(lon, lat, placed[i], true);
  return [lon, lat];
}
// 화면 칸 좌표 → 원본 경위도 (지도 밖이면 null)
function unproject(fx, fy) {
  const lat = LAT_TOP - fy * (LAT_TOP - LAT_BOT) / H;
  const k = PROJ_A + PROJ_B * Math.cos(lat * Math.PI / 180);
  const lon = (fx - W / 2) / (W / 2) * 180 / k;
  if (lon < -180 || lon > 180) return null;
  return unlens(lon, lat);
}

// 칸 하나를 3x3 으로 나눠 보고 절반 넘게 땅이면 땅
const land = new Uint8Array(W * H);
const srcLL = new Float32Array(W * H * 2);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  let n = 0;
  for (let sy = 0; sy < 3; sy++) for (let sx = 0; sx < 3; sx++) {
    const ll = unproject(x + (sx + 0.5) / 3, y + (sy + 0.5) / 3);
    if (ll && isLand(ll[0], ll[1])) n++;
  }
  const i = y * W + x;
  land[i] = n >= 5 ? 1 : 0;
  const ll = unproject(x + 0.5, y + 0.5) || [999, 0];
  srcLL[i * 2] = ll[0]; srcLL[i * 2 + 1] = ll[1];
}

// ---------- 2.5 좁은 해협 뚫기 (칸이 커서 막혀 버리는 곳) ----------
// [원본 경위도 점들, 반폭(도)]
const STRAITS = [
  [[[-6.6, 35.95], [-5.9, 35.97], [-5.2, 36.05]], 0.33],                                   // 지브롤터
  [[[26.15, 40.05], [26.6, 40.35], [27.5, 40.65], [28.6, 40.9], [29.05, 41.1], [29.15, 41.3]], 0.3], // 다르다넬스·마르마라·보스포루스
  [[[43.1, 12.8], [43.45, 12.55], [43.7, 12.3]], 0.3],                                      // 바브엘만데브
];
let carved = 0;
for (let i = 0; i < W * H; i++) {
  if (!land[i]) continue;
  const lo = srcLL[i * 2], la = srcLL[i * 2 + 1];
  for (const [pts, w] of STRAITS) {
    let best = 1e9;
    for (let k = 0; k < pts.length - 1; k++) {
      const [ax, ay] = pts[k], [bx, by] = pts[k + 1];
      const dx = bx - ax, dy = by - ay;
      let t = ((lo - ax) * dx + (la - ay) * dy) / (dx * dx + dy * dy);
      t = Math.max(0, Math.min(1, t));
      best = Math.min(best, Math.hypot(lo - ax - t * dx, la - ay - t * dy));
    }
    if (best < w) { land[i] = 0; carved++; break; }
  }
}

// ---------- 3. 작은 섬 지우기 · 작은 호수 메우기 ----------
function components(value) {
  const seen = new Uint8Array(W * H), out = [];
  const q = new Int32Array(W * H);
  for (let s = 0; s < W * H; s++) {
    if (seen[s] || land[s] !== value) continue;
    let h = 0, t = 0, edge = false;
    q[t++] = s; seen[s] = 1;
    while (h < t) {
      const i = q[h++], x = i % W, y = (i / W) | 0;
      if (x === 0 || y === 0 || x === W - 1 || y === H - 1) edge = true;
      for (const n of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, y > 0 ? i - W : -1, y < H - 1 ? i + W : -1]) {
        if (n < 0 || seen[n] || land[n] !== value) continue;
        seen[n] = 1; q[t++] = n;
      }
    }
    out.push({ tiles: Array.from(q.subarray(0, t)), edge });
  }
  return out;
}
let removedIslands = 0, filledLakes = 0, keptIslands = 0;
for (const c of components(1)) {
  if (c.tiles.length < MIN_ISLAND) { for (const i of c.tiles) land[i] = 0; removedIslands++; }
  else keptIslands++;
}
for (const c of components(0)) {
  if (!c.edge && c.tiles.length < MIN_LAKE) { for (const i of c.tiles) land[i] = 1; filledLakes++; }
}

// ---------- 4. 지형 ----------
function hash(x, y, s) {
  let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function noise(x, y, scale, s) {
  const fx = x / scale, fy = y / scale;
  const ix = Math.floor(fx), iy = Math.floor(fy);
  const tx = fx - ix, ty = fy - iy;
  const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
  const a = hash(ix, iy, s), b = hash(ix + 1, iy, s), c = hash(ix, iy + 1, s), d = hash(ix + 1, iy + 1, s);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}
const fbm = (x, y, s) => noise(x, y, 24, s) * 0.55 + noise(x, y, 9, s + 7) * 0.3 + noise(x, y, 4, s + 13) * 0.15;

// 산맥·사막 띠 (원본 경도, 위도 점들 + 폭(도))
const RANGES = [
  ['mtn', 2.6, [[-78, 8], [-77, 2], [-79, -4], [-76, -12], [-70, -18], [-69, -25], [-70, -33], [-71, -40], [-73, -48], [-73, -53]]],
  ['mtn', 3.5, [[-150, 62], [-138, 60], [-128, 56], [-120, 51], [-113, 45], [-108, 40], [-106, 35], [-106, 30], [-102, 24], [-98, 19]]],
  ['mtn', 1.4, [[5, 44], [8, 46], [12, 47], [16, 47]]],
  ['mtn', 2.8, [[70, 36], [75, 35], [80, 31], [86, 28], [92, 28], [97, 28]]],
  ['hill', 4.5, [[80, 34], [88, 33], [96, 33]]],
  ['hill', 1.6, [[59, 68], [60, 60], [59, 52]]],
  ['mtn', 1.3, [[40, 43.5], [48, 41]]],
  ['mtn', 2.0, [[45, 36], [52, 31], [58, 27]]],
  ['hill', 1.8, [[-8, 31], [0, 33], [8, 35]]],
  ['hill', 3.0, [[38, 12], [37, 0], [35, -8]]],
  ['hill', 2.0, [[-84, 34], [-78, 38], [-73, 42], [-68, 46]]],
  ['hill', 2.2, [[6, 60], [12, 64], [18, 68]]],
  ['mtn', 2.4, [[70, 42], [80, 42], [88, 45], [95, 48]]],
  ['hill', 2.0, [[146, -38], [150, -32], [147, -24], [145, -16]]],
  ['hill', 4.0, [[-46, -21], [-42, -14]]],
  ['hill', 1.5, [[-4, 43], [2, 42.5]]],
  ['hill', 1.2, [[128.5, 41], [128.6, 38], [128.8, 36]]], // 태백산맥
  ['mtn', 1.6, [[136, 35], [140, 38], [141, 42]]],
  ['hill', 3.0, [[100, 26], [104, 30], [108, 33]]],
  ['hill', 1.5, [[170, -44], [167, -46]]],
];
const DESERTS = [
  [7, [[-14, 22], [5, 23], [20, 22], [32, 22]]],
  [6, [[40, 24], [48, 21], [55, 20]]],
  [4, [[95, 42], [104, 43], [112, 43]]],
  [6, [[118, -24], [128, -25], [138, -26]]],
  [3, [[20, -24], [22, -22]]],
  [2, [[-70, -20], [-70, -26]]],
  [3, [[-116, 34], [-110, 32]]],
  [3, [[78, 39], [88, 40]]],
  [2.5, [[70, 27], [73, 26]]],
  [3, [[55, 33], [60, 31]]],
  [4, [[56, 42], [64, 42]]],
];
function distToLine(lon, lat, pts) {
  let best = 1e9;
  const k = Math.cos(lat * Math.PI / 180);
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
    const dx = (bx - ax) * k, dy = by - ay;
    const px = (lon - ax) * k, py = lat - ay;
    let t = (px * dx + py * dy) / (dx * dx + dy * dy || 1);
    t = Math.max(0, Math.min(1, t));
    best = Math.min(best, Math.hypot(px - t * dx, py - t * dy));
  }
  return best;
}

const ter = new Uint8Array(W * H);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const i = y * W + x;
  if (!land[i]) continue;
  const lon = srcLL[i * 2], lat = srcLL[i * 2 + 1];
  const n = fbm(x, y, 1);
  const jitter = (n - 0.5) * 2.2;
  let t = 1;
  if (lat > 64 + jitter * 3 || lat < -50) t = 5;
  for (const [w, pts] of DESERTS) if (distToLine(lon, lat, pts) < w + jitter * 1.5) t = 4;
  if (t === 1 && n > 0.72) t = 2;
  for (const [kind, w, pts] of RANGES) {
    const d = distToLine(lon, lat, pts) + jitter * 0.6;
    if (kind === 'mtn') { if (d < w * 0.5) t = 3; else if (d < w && t !== 3) t = 2; }
    else if (d < w && t !== 3) t = (n > 0.78 ? 3 : 2);
  }
  ter[i] = t;
}

// ---------- 5. 저장 (런 길이 압축: "값 + 길이(36진수)") ----------
const out = [];
let cur = ter[0], len = 0;
for (let i = 0; i < ter.length; i++) {
  if (ter[i] === cur) len++;
  else { out.push(cur + len.toString(36)); cur = ter[i]; len = 1; }
}
out.push(cur + len.toString(36));
const js = `// 자동 생성 파일 (tools/build-map.js). 원본: Natural Earth 1:50m 육지 (공공 데이터)\n` +
  `// 작은 섬 제거(${MIN_ISLAND}칸 미만), 한국·일본·대만·필리핀·호주·뉴질랜드 확대\n` +
  `(typeof window !== 'undefined' ? window : globalThis).MAP_DATA = { w: ${W}, h: ${H}, latTop: ${LAT_TOP}, latBot: ${LAT_BOT}, projA: ${PROJ_A}, projB: ${PROJ_B}, lenses: ${JSON.stringify(placed.map(l => l.map(v => +v.toFixed(3))))}, rle: "${out.join(',')}" };\n`;
fs.writeFileSync(path.join(__dirname, '..', 'src', 'mapdata.js'), js);
const cnt = [0, 0, 0, 0, 0, 0];
for (const v of ter) cnt[v]++;
console.log(`해협 ${carved}칸 뚫음 · ${W}x${H}, 육지 ${W * H - cnt[0]}칸, 지형별`, cnt, `· 지운 섬 ${removedIslands}개, 남은 섬·대륙 ${keptIslands}개, 메운 호수 ${filledLakes}개 · 파일 ${(js.length / 1024).toFixed(0)}KB`);

// 확인용: 지역별 칸 수
const region = (lo1, lo2, la1, la2) => {
  let c = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (!land[i]) continue;
    const lo = srcLL[i * 2], la = srcLL[i * 2 + 1];
    if (lo >= lo1 && lo <= lo2 && la >= la1 && la <= la2) c++;
  }
  return c;
};
console.log('한반도', region(124, 131, 33, 43), '· 일본', region(129, 146, 30, 46), '· 호주', region(112, 155, -44, -10), '· 영국', region(-11, 2, 49, 61), '· 뉴질랜드', region(165, 179, -48, -34));
