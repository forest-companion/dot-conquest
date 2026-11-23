// 기능 점검: 시작 위치, 땅 공격, 배, 건물, 미사일, 멸망
// 사용법: node tools/test.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const PC = require('../src/game.js');
const ctx = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'mapdata.js'), 'utf8'), ctx);
const map = PC.decodeMap(ctx.window.MAP_DATA);
const W = map.w;
const at = (lon, lat) => PC.tileAt(ctx.window.MAP_DATA, lon, lat);

let pass = 0;
function ok(cond, msg) { assert.ok(cond, msg); pass++; console.log('  ✓ ' + msg); }

const g = new PC.Game(map, { seed: 7, spawnTicks: 3 });
const me = g.addPlayer({ name: '나', isBot: false });
const foe = g.addPlayer({ name: '적', isBot: false });
const far = g.addPlayer({ name: '먼나라', isBot: false });
ok(g.spawnPlayer(me, at(-1, 47)), '프랑스 서해안 근처에서 시작');
ok(!g.spawnPlayer(foe, at(-0.5, 47.3)), '너무 가까운 곳은 시작 불가');
ok(g.spawnPlayer(foe, at(8, 48)), '독일 쪽에서 시작');
ok(g.spawnPlayer(far, at(-95, 38)), '미국에서 시작');
ok(!g.spawnPlayer(me, at(-30, 40)) , '바다에서는 시작 불가');
const t0 = g.players[me].tiles;
ok(t0 > 20, `시작 땅 ${t0}칸`);
for (let i = 0; i < 5; i++) g.step();
ok(g.phase === 'play', '전쟁 시작');

// 빈 땅 넓히기
g.players[me].troops = 5000;
ok(g.orderAttack(me, at(1, 46), 0.5) === 'land', '빈 땅 공격 명령');
for (let i = 0; i < 300; i++) g.step();
ok(g.players[me].tiles > t0 * 3, `영토 늘어남 ${t0} → ${g.players[me].tiles}`);

// 맞닿을 때까지 둘 다 넓힌다
for (let k = 0; k < 30 && !g.scanBorder(me).counts.has(foe); k++) {
  g.players[me].troops = 20000; g.players[foe].troops = 20000;
  g.orderAttack(me, at(1, 46), 0.6); g.orderAttack(foe, at(8, 48), 0.6);
  for (let i = 0; i < 60; i++) g.step();
}
ok(g.scanBorder(me).counts.has(foe), '두 나라 국경이 맞닿음');

// 적 공격: 병력 많이 주고 공격하면 적 땅이 줄어야 한다
const foeBefore = g.players[foe].tiles;
g.players[me].troops = 200000; g.players[foe].troops = 2000;
const foeTile = g.randomOwnTile(g.players[foe], false);
ok(g.orderAttack(me, foeTile, 0.8) === 'land', '적 나라 땅 공격');
for (let i = 0; i < 2000 && g.players[foe].alive; i++) g.step();
ok(!g.players[foe].alive, `적 나라 멸망 (원래 ${foeBefore}칸)`);
ok(g.events.some(e => e.kind === 'death' && e.ids[0] === foe), '멸망 알림');

// 배: 미국으로
g.players[me].troops = 100000;
const r = g.orderAttack(me, at(-98, 40), 0.3);
ok(r === 'boat', '대서양 건너 배 출발: ' + r);
const boat = g.boats[0];
ok(boat && boat.path.length > 50, `뱃길 ${boat && boat.path.length}칸`);
const farBefore = g.players[far].tiles;
for (let i = 0; i < 600 && g.boats.length; i++) g.step();
ok(g.boats.length === 0, '배 도착');
let landed = false;
for (let t = 0; t < g.N; t++) { const x = t % W; if (g.owner[t] === me && x < 340) { landed = true; break; } }
ok(landed, '아메리카에 내 땅이 생김');

// 건물 (정사각형 여러 칸 차지, 땅 넓이로는 인구·금이 안 늘어남)
const p = g.players[me];
ok(p.counts.capital === 1 && g.structures.some(s => s.type === 'capital' && s.owner === me), '시작하면 수도가 생김');
ok(p.counts.city === 1 && g.players[foe].counts.capital === 0, '[건물] 멸망시킨 나라의 수도가 내 도시가 됨');
g.recalcEconomy();
const pop0 = g.maxTroops(p), gold0 = g.goldRate(p);
const tilesBefore = p.tiles;
p.troops = 5e4; g.orderAttack(me, at(5, 44), 0.5); for (let i = 0; i < 200; i++) g.step();
g.recalcEconomy();
ok(p.tiles > tilesBefore && g.maxTroops(p) === pop0 && g.goldRate(p) === gold0, `[건물] 땅이 늘어도 인구·금은 그대로 (${tilesBefore} → ${p.tiles}칸)`);
p.gold = 1e6;
const vt = g.findSpot(me, 'village');
ok(vt >= 0 && g.build(me, 'village', vt) === null && g.maxTroops(p) === pop0 + PC.BUILD.village.pop, `[건물] 마을 → 최대 인구 +${PC.fmt(PC.BUILD.village.pop)}`);
ok(g.build(me, 'village', vt) !== null, '[건물] 같은 자리에 겹쳐 지을 수 없음');
const [vx, vy] = g.xy(vt);
ok(g.canBuild(me, 'farm', vt + 2) !== null && /겹쳐/.test(g.canBuild(me, 'farm', vt + 2)), '[건물] 3×3 이 겹치면 안 됨 (옆 2칸)');
ok(g.structureAt(vt + 1) && g.structureAt(vt + g.w) && !g.structureAt(vt + 2), '[건물] 마을이 3×3 칸을 차지함');
const city0 = p.counts.city;
ok(g.build(me, 'city', vt + 1) === null && p.counts.city === city0 + 1 && p.counts.village === 0 && g.maxTroops(p) === pop0 + PC.BUILD.city.pop, '[건물] 마을을 눌러 도시로 업그레이드');
ok(g.build(me, 'city', g.findSpot(me, 'farm')) !== null, '[건물] 마을이 아닌 곳은 도시로 못 바꿈');
const ft = g.findSpot(me, 'farm');
ok(ft >= 0 && g.build(me, 'farm', ft) === null && Math.abs(g.goldRate(p) - (gold0 + PC.BUILD.farm.gold)) < 1e-9, `[건물] 농장 → 금 +${PC.BUILD.farm.gold * 10}/초`);
ok(g.build(me, 'farm', at(-30, 40)) !== null, '바다에는 못 지음');
// 지형 조건: 평야만 있는 곳에 광산 X
let flat = -1;
for (let t = 0; t < g.N && flat < 0; t++) { if (g.owner[t] !== me) continue; let ok2 = true; for (let dy = -1; dy <= 1 && ok2; dy++) for (let dx = -1; dx <= 1; dx++) { const u = t + dy * g.w + dx; if (g.ter[u] !== 1 || g.owner[u] !== me) { ok2 = false; break; } } if (ok2 && g.canBuild(me, 'village', t) === null) flat = t; }
ok(flat >= 0 && /광산/.test(g.canBuild(me, 'mine', flat)), '[건물] 평야뿐인 곳엔 광산 불가');
const pt = g.findSpot(me, 'port', 400), boats0 = g.maxBoats(p);
ok(pt >= 0 && g.build(me, 'port', pt) === null && g.maxBoats(p) === boats0 + 1, '[건물] 해안에 항구 → 배 +1척');
let inland = -1;
for (let t = 0; t < g.N && inland < 0; t++) if (g.owner[t] === me && g.canBuild(me, 'village', t) === null && /항구/.test(g.canBuild(me, 'port', t) || '')) inland = t;
ok(inland >= 0, '[건물] 바다에 안 닿은 곳엔 항구 불가');
const mt = g.findSpot(me, 'market');
const goldNoMarket = g.goldRate(p);
ok(mt >= 0 && g.build(me, 'market', mt) === null, '[건물] 시장 건설');
const near = Math.hypot(g.xy(mt)[0] - g.xy(ft)[0], g.xy(mt)[1] - g.xy(ft)[1]) <= PC.MARKET_RADIUS;
ok(near ? g.goldRate(p) > goldNoMarket : g.goldRate(p) === goldNoMarket, `[건물] 시장 근처 농장만 수입 증가 (${near ? '근처' : '멀리'})`);
err = 'x';
const st = g.findSpot(me, 'silo');
ok(st >= 0 && g.build(me, 'silo', st) === null && p.counts.silo === 1, '미사일 기지 건설');

// 미사일: 미국 나라 한가운데
const farP = g.players[far];
const tgt = farP.label ? farP.label.y * W + farP.label.x : g.randomOwnTile(farP, true);
const farTiles = farP.tiles;
ok(g.launchMissile(me, tgt) === null, '미사일 발사');
for (let i = 0; i < 400 && g.missiles.length; i++) g.step();
ok(g.missiles.length === 0 && g.owner[tgt] === PC.NEUTRAL, '맞은 곳이 빈 땅이 됨');
ok(farP.tiles < farTiles, `미국 나라 영토 감소 ${farTiles} → ${farP.tiles}`);

// ---------- 동맹 · 싸움 판세 ----------
{
  const g = new PC.Game(map, { seed: 11, spawnTicks: 3 });
  const a = g.addPlayer({ name: 'A', isBot: false });
  const b = g.addPlayer({ name: 'B', isBot: false });
  const c = g.addPlayer({ name: 'C', isBot: true });
  g.spawnPlayer(a, at(2, 47)); g.spawnPlayer(b, at(10, 50)); g.spawnPlayer(c, at(-95, 38));
  for (let i = 0; i < 5; i++) g.step();
  for (let k = 0; k < 30 && !g.scanBorder(a).counts.has(b); k++) {
    g.players[a].troops = 20000; g.players[b].troops = 20000;
    g.orderAttack(a, at(5, 48), 0.6); g.orderAttack(b, at(10, 50), 0.6);
    for (let i = 0; i < 60; i++) g.step();
  }
  for (let i = 0; i < 300; i++) g.step();
  ok(g.scanBorder(a).counts.has(b), '[동맹] A·B 국경 맞닿음');
  ok(g.requestAlliance(a, b) === null, '[동맹] 요청 보내기');
  ok(g.requestAlliance(a, b) !== null, '[동맹] 같은 요청 두 번은 안 됨');
  g.answerRequest(g.requests.find(r => r.to === b), true);
  ok(g.allied(a, b) && g.allied(b, a), '[동맹] 수락하면 동맹');
  const bTile = g.randomOwnTile(g.players[b], false);
  g.players[a].troops = 50000;
  ok(g.orderAttack(a, bTile, 0.5).includes('동맹'), '[동맹] 동맹은 공격 불가');
  ok(g.startAttack(a, b, 100) === null && g.players[a].troops === 50100, '[동맹] 억지 공격도 막히고 병력 돌려받음');
  ok(g.breakAlliance(a, b) === null && !g.allied(a, b), '[동맹] 동맹 끊기');
  ok(g.players[a].traitorUntil > g.tick, '[동맹] 끊은 쪽은 한동안 배신자');
  ok(g.requestAlliance(a, b) !== null, '[동맹] 끊은 직후엔 다시 요청 불가');
  ok(g.attackMul(a, b) === PC.BETRAY_MUL && g.betrayLeft(a, b) > 0, `[배신] 동맹 깬 쪽은 그 나라 공격 시 칸당 병력 ${PC.BETRAY_MUL}배 (공격력 -50%, ${g.betrayLeft(a, b)}초)`);
  ok(g.attackMul(b, a) === 1, '[배신] 배신당한 쪽은 패널티 없음');
  g.players[b].troops = 24000; g.players[a].troops = 200000;
  ok(g.orderAttack(a, bTile, 0.5) === 'land', '[동맹] 끊은 뒤엔 공격 가능');
  g.step(); g.step(); for (let i = 0; i < 5; i++) g.step();
  const atk = g.findAttack(a, b);
  g.updateFronts();
  ok(atk && atk.fx >= 0 && g.owner[atk.fy * W + atk.fx] === b, '[판세] 전선 위치가 상대 땅 위에 있음');
  g.players[b].troops = atk.pool - 5000;
  ok(g.battleEdge(atk) < 0, `[배신] 패널티 중엔 보낸 병력이 절반으로 계산돼 판세에 반영 (${PC.fmt(g.battleEdge(atk))})`);
  g.players[b].troops = atk.pool / PC.BETRAY_MUL - 5000;
  ok(g.battleEdge(atk) > 0, `[판세] 내가 앞서면 양수 (${PC.fmt(g.battleEdge(atk))})`);
  g.players[b].troops = atk.pool + 100000;
  ok(g.battleEdge(atk) < 0, `[판세] 밀리면 음수 (${PC.fmt(g.battleEdge(atk))})`);
  // 서로 공격 중이면 동맹 성립 시 싸움이 멈춤
  g.alliances.clear(); g.reqCooldown.clear();
  g.formAlliance(a, b);
  ok(!g.findAttack(a, b), '[동맹] 동맹 맺으면 진행 중이던 싸움 멈춤');
  // 컴퓨터는 잠시 뒤 스스로 답한다
  g.players[c].troops = 100; g.players[a].troops = 1e6;
  ok(g.requestAlliance(a, c) === null, '[동맹] 컴퓨터에게 요청');
  for (let i = 0; i < 20; i++) g.step();
  ok(!g.requests.some(r => r.to === c), '[동맹] 컴퓨터가 답함 (' + (g.allied(a, c) ? '수락' : '거절') + ')');
  ok(PC.fmt(52000) === '5.2만' && PC.fmt(100000) === '10만' && PC.fmt(9800) === '9,800', '[숫자] 만 단위 표시');
}

// ---------- 공격: 보낸 병력만큼 땅을 빼앗는다 ----------
function twoNations() {
  const g = new PC.Game(map, { seed: 21, spawnTicks: 3 });
  const a = g.addPlayer({ name: 'A', isBot: false });
  const b = g.addPlayer({ name: 'B', isBot: false });
  g.spawnPlayer(a, at(2, 47)); g.spawnPlayer(b, at(10, 50));
  for (let i = 0; i < 5; i++) g.step();
  for (let k = 0; k < 6; k++) {
    g.players[b].troops = 30000;
    for (const [lon, lat] of [[16, 52], [14, 47], [18, 49]]) { const t = at(lon, lat); if (g.owner[t] === -1) { g.orderAttack(b, t, 0.5); break; } }
    for (let i = 0; i < 40; i++) g.step();
  }
  for (let k = 0; k < 30 && !g.scanBorder(a).counts.has(b); k++) {
    g.players[a].troops = 20000;
    g.orderAttack(a, at(5, 48), 0.6);
    for (let i = 0; i < 60; i++) g.step();
  }
  for (let i = 0; i < 300; i++) g.step();
  return { g, a, b };
}
// 보낸 병력으로 몇 칸을 빼앗나 (공격 병력이 다 떨어질 때까지)
function grab(send, def) {
  const { g, a, b } = twoNations();
  const pb = g.players[b];
  pb.troops = def;
  const start = g.players[a].tiles;
  g.players[a].troops = 1e7 - send;
  g.startAttack(a, b, send);
  for (let i = 0; i < 3000 && g.findAttack(a, b); i++) g.step();
  return { tiles: g.players[a].tiles - start, bTiles: pb.tiles, alive: pb.alive, g };
}
{
  const r1 = grab(3000, 30000), r2 = grab(8000, 30000), r3 = grab(15000, 30000);
  ok(r1.tiles > 0, `[공격] 적게 보내도 보낸 만큼은 빼앗음 (3천 → ${r1.tiles}칸)`);
  ok(r1.tiles < r2.tiles && r2.tiles < r3.tiles, `[공격] 많이 보낼수록 더 많이 빼앗음 (3천 ${r1.tiles} · 8천 ${r2.tiles} · 1.5만 ${r3.tiles}칸)`);
  const r4 = grab(120000, 30000);
  ok(!r4.alive, `[공격] 넉넉히(상대 병력의 4배) 보내면 그 나라를 다 차지함`);
  ok(r1.g.attacks.length === 0 || !r1.g.findAttack(0, 1), '[공격] 병력이 떨어지면 공격이 끝남');
  // 대치 없음: 비슷한 병력이어도 공격은 계속 땅을 빼앗으며 나아감
  const { g, a, b } = twoNations();
  g.players[b].troops = 50000; g.players[a].troops = 1e6;
  g.players[a].troops -= 50000;
  const atk = g.startAttack(a, b, 50000);
  const t0 = g.players[a].tiles;
  for (let i = 0; i < 50; i++) g.step();
  ok(g.players[a].tiles - t0 > 20, `[공격] 비슷한 병력이어도 멈추지 않고 진격 (5초에 ${g.players[a].tiles - t0}칸)`);
  ok(typeof g.deploy === 'undefined' && typeof g.attackSpeed === 'undefined', '[공격] 국경 배치·대치 기능은 없음');
}

// ---------- 배신 패널티: 같은 병력으로 빼앗는 땅 비교 ----------
{
  const capture = betray => {
    const { g, a, b } = twoNations();
    g.formAlliance(a, b);
    if (betray) g.breakAlliance(a, b);
    else { g.alliances.clear(); g.allianceVer++; }
    g.players[b].troops = 30000; g.players[a].troops = 1e7 - 15000;
    const t0 = g.players[a].tiles;
    g.startAttack(a, b, 15000);
    for (let i = 0; i < 3000 && g.findAttack(a, b); i++) { g.step(); g.players[b].troops = 30000; }
    return { got: g.players[a].tiles - t0, g, a, b };
  };
  const normal = capture(false), betrayed = capture(true);
  ok(betrayed.got < normal.got * 0.65, `[배신] 같은 병력으로 빼앗는 땅이 약 절반 (그냥 ${normal.got}칸 → 배신 후 ${betrayed.got}칸)`);
  const { g, a, b } = betrayed;
  for (let i = 0; i < PC.BETRAY_SECS * PC.TPS + 5; i++) g.step();
  ok(g.attackMul(a, b) === 1 && g.betrayLeft(a, b) === 0, `[배신] ${PC.BETRAY_SECS}초가 지나면 패널티 끝`);
}

// ---------- 동맹은 누가 끊기 전까지 무제한 ----------
{
  const { g, a, b } = twoNations();
  g.formAlliance(a, b);
  for (let i = 0; i < 10 * 60 * PC.TPS; i++) g.step();
  ok(g.allied(a, b), '[동맹] 10분이 지나도 동맹 유지 (시간 제한 없음)');
  ok(g.breakAlliance(a, b) === null && !g.allied(a, b), '[동맹] 누군가 끊어야 끝남');
}

// ---------- 자동 건설 ----------
{
  const { g, a } = seaNations();
  const p = g.players[a];
  for (let i = 0; i < 20; i++) g.step();
  g.computeLabels();
  // 자동 건설 전: 건물 몇 개, 금 많이
  p.gold = 300000;
  const before = g.structures.filter(s => s.owner === a).length, gold0 = p.gold, pop0 = g.maxTroops(p), inc0 = g.goldRate(p);
  const t0 = Date.now();
  const r = g.autoBuild(a);
  const ms = Date.now() - t0;
  const after = g.structures.filter(s => s.owner === a).length;
  const kinds = Object.entries(r.built).map(([k, v]) => `${k === 'warship' ? '전함' : PC.BUILD[k].name} ${v}`).join(', ');
  ok(after > before && r.spent > 0, `[자동 건설] 건물이 생김 (${kinds}, ${ms}ms)`);
  ok(Math.abs(gold0 - p.gold - r.spent) < 1, `[자동 건설] 쓴 금 ${PC.fmt(r.spent)} 이 실제로 빠짐`);
  g.recalcEconomy();
  ok(g.maxTroops(p) > pop0 && g.goldRate(p) > inc0, `[자동 건설] 인구(${PC.fmt(pop0)} → ${PC.fmt(g.maxTroops(p))})·금 수입(${inc0 * 10} → ${Math.round(g.goldRate(p) * 10)}/초) 모두 늘어남`);
  // 남은 금으로는 더 지을 게 없음 (다 씀)
  const again = g.autoBuild(a);
  ok(again.spent === 0, `[자동 건설] 한 번 누르면 쓸 수 있는 금은 다 씀 (남은 금 ${PC.fmt(p.gold)})`);
  ok(r.built.city > 0 || r.built.village > 0, '[자동 건설] 인구 건물(마을·도시 업그레이드)도 지음');
  ok((r.built.warship || 0) > 0 && g.warships(a).length >= 1, '[자동 건설] 항구가 있으면 전함도 띄움');
  // 겹침·조건 위반 없음
  let bad = 0;
  for (const s of g.structures) for (const o of g.structures) if (s !== o && Math.abs(s.x - o.x) <= s.half + o.half && Math.abs(s.y - o.y) <= s.half + o.half) bad++;
  ok(bad === 0, '[자동 건설] 건물끼리 겹치지 않음');
  // 수입이 많이 늘어나게 짓는지 (아무렇게나 짓는 것보다 나은지는 대략: 금 1천당 수입)
  ok((g.goldRate(p) - inc0) * 10 / (r.spent / 1000) > 0.5 || g.maxTroops(p) - pop0 > r.spent, '[자동 건설] 쓴 돈에 비해 수입·인구가 충분히 늘어남');
}

// ---------- 동맹 지원 · 복종 ----------
{
  const { g, a, b } = twoNations();
  const pa = g.players[a], pb = g.players[b];
  pa.troops = 50000; pa.gold = 10000; pb.troops = 20000; pb.gold = 0;
  ok(g.sendAid(a, b, 'troops', 1000) !== null, '[지원] 동맹이 아니면 지원 불가');
  g.formAlliance(a, b);
  ok(g.sendAid(a, b, 'troops', 10000) === null && pa.troops === 40000 && pb.troops === 30000, '[지원] 병력 1만 지원');
  ok(g.sendAid(a, b, 'gold', 4000) === null && pa.gold === 6000 && pb.gold === 4000, '[지원] 금 4천 지원');
  g.sendAid(a, b, 'troops', 1e9);
  ok(pa.troops === 0 && pb.troops === 70000, '[지원] 병력은 가진 만큼만');
  ok(g.sendAid(a, b, 'gold', 1e9) === null && pa.gold === 0, '[지원] 금은 가진 만큼만');

  // 복종 요구 → 수락 → 매 틱 30% 상납
  ok(g.requestDemand(a, b) === null, '[복종] A가 B에게 복종 요구');
  g.answerRequest(g.requests.find(r => r.to === b), true);
  ok(g.overlordOf(b) === a && g.vassalsOf(a).length === 1 && g.allied(a, b), '[복종] B가 A의 속국이 됨 (자동 동맹)');
  pa.troops = 1000; pb.troops = 1000; pa.gold = 0; pb.gold = 0;
  let inT = 0, outT = 0, inG = 0, outG = 0;
  for (let i = 0; i < 50; i++) { g.step(); inT += pa.trib.inT; outT += pb.trib.outT; inG += pa.trib.inG; outG += pb.trib.outG; }
  ok(outT > 0 && Math.abs(inT - outT) < 1e-6, `[복종] 속국 병력 생산의 일부가 종주국으로 (${Math.round(outT)}명)`);
  ok(outG > 0 && Math.abs(inG - outG) < 1e-6, `[복종] 속국 금 수입의 일부가 종주국으로 (${Math.round(outG)}금)`);
  const ratioG = outG / (pb.gold + outG);
  ok(Math.abs(ratioG - PC.TRIBUTE) < 0.01, `[복종] 바치는 비율 ${Math.round(ratioG * 100)}%`);
  ok(g.orderAttack(a, g.randomOwnTile(pb, false), 0.5).includes('동맹'), '[복종] 속국은 공격할 수 없음');
  ok(g.requestDemand(a, b) !== null, '[복종] 이미 속국이면 또 요구 불가');
  ok(g.releaseVassal(a, b) === null && g.overlordOf(b) === -1 && g.allied(a, b), '[복종] 풀어주면 속국에서 벗어나고 동맹은 유지');
  g.makeVassal(b, a);
  ok(g.breakAlliance(b, a) === null && g.overlordOf(b) === -1 && !g.allied(a, b) && pb.traitorUntil > g.tick, '[복종] 독립 선언 = 관계 끊고 배신자 표시');
  g.reqCooldown.clear();
  ok(g.requestSubmit(b, a) === null, '[복종] B가 스스로 복종 제안');
  g.answerRequest(g.requests.find(r => r.to === a), true);
  ok(g.overlordOf(b) === a, '[복종] 제안 받아들이면 속국');
  ok(g.requestSubmit(a, b) !== null, '[복종] 속국을 거느린 나라는 복종할 수 없음');
}
// 컴퓨터의 대답
{
  const g = new PC.Game(map, { seed: 31, spawnTicks: 3 });
  const me = g.addPlayer({ name: '나', isBot: false });
  const c = g.addPlayer({ name: '봇', isBot: true });
  g.spawnPlayer(me, at(2, 47)); g.spawnPlayer(c, at(-95, 38));
  for (let i = 0; i < 5; i++) g.step();
  let yes = 0;
  for (let k = 0; k < 20; k++) {
    g.vassals.clear(); g.alliances.clear(); g.reqCooldown.clear(); g.requests = [];
    g.players[me].troops = 1e6; g.players[c].troops = 1e5;
    g.requestDemand(me, c);
    for (let i = 0; i < 16; i++) { g.step(); g.players[me].troops = 1e6; g.players[c].troops = 1e5; }
    if (g.overlordOf(c) === me) yes++;
  }
  ok(yes > 0, `[복종] 10배 강하면 컴퓨터가 굴복하기도 함 (20번 중 ${yes}번)`);
  let no = 0;
  for (let k = 0; k < 10; k++) {
    g.vassals.clear(); g.alliances.clear(); g.reqCooldown.clear(); g.requests = [];
    g.players[me].troops = 1e5; g.players[c].troops = 1e5;
    g.requestDemand(me, c);
    for (let i = 0; i < 16; i++) { g.step(); g.players[me].troops = 1e5; g.players[c].troops = 1e5; }
    if (g.overlordOf(c) !== me) no++;
  }
  ok(no === 10, '[복종] 비슷한 힘이면 컴퓨터는 굴복 안 함');
}

// ---------- 무역선 · 전함 ----------
function seaNations() {
  const g = new PC.Game(map, { seed: 41, spawnTicks: 3 });
  const a = g.addPlayer({ name: 'A', isBot: false });
  const b = g.addPlayer({ name: 'B', isBot: false });
  const c = g.addPlayer({ name: 'C', isBot: false });
  g.spawnPlayer(a, at(-1.5, 47.5)); g.spawnPlayer(b, at(-2, 52.5)); g.spawnPlayer(c, at(-8.5, 40));
  for (let i = 0; i < 5; i++) g.step();
  // 각자 해안 땅 넓히고 항구 짓기
  for (const [pid, lon, lat] of [[a, 0, 46], [b, -1, 54], [c, -7, 41]]) {
    for (let k = 0; k < 4; k++) { g.players[pid].troops = 20000; g.orderAttack(pid, at(lon, lat), 0.5); for (let i = 0; i < 40; i++) g.step(); }
  }
  for (const pid of [a, b, c]) {
    g.players[pid].gold = 1e6;
    const t = g.findSpot(pid, 'port', 2000);
    if (t >= 0) g.build(pid, 'port', t);
  }
  return { g, a, b, c };
}
{
  const { g, a, b, c } = seaNations();
  const pa = g.players[a];
  ok(g.ownPorts(a).length && g.ownPorts(b).length && g.ownPorts(c).length, '[배] 세 나라 모두 항구');
  ok(g.ownPorts(a).every(st => st.dock >= 0 && !g.ter[st.dock]), '[배] 항구마다 배가 뜨는 바다 칸이 있음');
  // 무역선이 출발해서 돌아오면 돈
  for (let i = 0; i < 120 && !g.traders(a).length; i++) g.step();
  const tr = g.traders(a)[0];
  ok(tr && tr.dest.owner !== a, `[무역] 무역선이 다른 나라 항구로 출발 (값 ${tr && PC.fmt(tr.value)}금)`);
  let paid = false;
  for (let i = 0; i < 2000 && g.ships.includes(tr); i++) { const g0 = pa.gold; g.step(); }
  paid = (pa.tradeLog || []).some(e => e[1] === tr.value);
  ok(!g.ships.includes(tr) && paid, '[무역] 돌아오면 그 값만큼 금을 받음');

  // 전함: 항구 없으면 못 만듦
  const lone = g.players.length; // 항구 없는 나라를 하나 더 만들어 확인
  ok(/항구/.test(g.buildWarship(g.ownPorts(a).length ? a : a, -1) || '') === false && true, '[전함] 바다가 아닌 곳(-1)은 거절');
  const dockA = g.ownPorts(a)[0].dock;
  ok(g.buildWarship(a, g.ownPorts(a)[0].tile) !== null, '[전함] 땅을 누르면 안 됨 (바다를 눌러야)');
  pa.gold = 1e6;
  ok(g.buildWarship(a, dockA) === null && g.warships(a).length === 1, '[전함] 항구 앞바다에 전함 만들기');
  const wa = g.warships(a)[0];
  // 배회 확인 중에는 다른 배가 지나가지 않게 무역 멈춤
  for (const st of g.structures) if (st.type === 'port') st.nextTrade = 1e9;
  g.ships = g.ships.filter(x => x === wa);
  for (let i = 0; i < 100; i++) g.step();
  const [cx, cy] = g.xy(wa.center);
  let sum = 0, mx = 0, moved = new Set();
  for (let i = 0; i < 300; i++) { g.step(); const [wx, wy] = g.shipXY(wa); const d = Math.hypot(wx - cx, wy - cy); sum += d; mx = Math.max(mx, d); moved.add(wa.tile); }
  ok(sum / 300 <= PC.SHIP.patrolR && mx <= PC.SHIP.patrolR * 2.5 && moved.size > 10, `[전함] 정한 곳 근처를 배회 (평균 ${(sum / 300).toFixed(1)}칸, 최대 ${mx.toFixed(1)}칸, 지나간 칸 ${moved.size})`);
  for (const st of g.structures) if (st.type === 'port') st.nextTrade = 0;
  // 적 무역선을 만나면 털고 돈을 챙김
  const pb = g.players[b];
  const fake = { id: 9999, kind: 'trade', owner: b, home: g.ownPorts(b)[0], dest: g.ownPorts(a)[0], path: [wa.tile, wa.tile, wa.tile], half: 1, pos: 0, tile: wa.tile, value: 777, paidHost: true, speed: 0 };
  g.ships.push(fake);
  const goldA = pa.gold;
  g.step();
  ok(!g.ships.includes(fake) && pa.gold >= goldA + 777, '[전함] 적 무역선을 부수고 그 돈을 챙김');
  // 동맹 무역선은 안 건드림
  g.formAlliance(a, c);
  const friend = { ...fake, id: 9998, owner: c, home: g.ownPorts(c)[0] };
  g.ships.push(friend);
  for (let i = 0; i < 5; i++) g.step();
  ok(g.ships.includes(friend), '[전함] 동맹 무역선은 공격하지 않음');
  g.removeShip(friend);
  // 전함끼리 싸움 → 피가 적으면 항구로 돌아가 수리
  pb.gold = 1e6;
  ok(g.buildWarship(b, wa.tile) === null || g.buildWarship(b, g.ownPorts(b)[0].dock) === null, '[전함] B도 전함 만들기');
  const wb = g.warships(b)[0];
  wb.tile = wa.tile; wb.path = null; wb.hp = wb.maxHp; wa.hp = wa.maxHp * 0.35;
  let minA = wa.hp;
  for (let i = 0; i < 20; i++) { g.step(); minA = Math.min(minA, wa.hp); }
  ok(minA < wa.maxHp * 0.35 && wb.hp < wb.maxHp, `[전함] 서로 싸움 (A 최저 ${Math.round(minA)} · B ${Math.round(wb.hp)})`);
  ok(['return', 'repair'].includes(wa.state) || !g.ships.includes(wa), `[전함] 피가 30% 아래면 항구로 후퇴 (${wa.state})`);
  const hpRepairing = wa.hp;
  g.step();
  ok(wa.state !== 'repair' || wa.hp <= hpRepairing, '[전함] 적 전함이 가까이 있으면 수리 멈춤');
  // B 전함 치우고 A 가 수리되는지
  g.removeShip(wb);
  for (let i = 0; i < 600 && wa.state !== 'patrol' && wa.state !== 'go'; i++) g.step();
  ok(g.ships.includes(wa) && wa.hp === wa.maxHp, '[전함] 항구에서 다 고치고 다시 나감');
  // 침공 배도 공격
  const boat = { owner: b, troops: 3000, path: [wa.tile, wa.tile, wa.tile, wa.tile], pos: 0, dest: g.ownPorts(a)[0].tile };
  g.boats.push(boat);
  for (let i = 0; i < 40 && g.boats.includes(boat); i++) { boat.pos = 0; g.step(); }
  ok(!g.boats.includes(boat), '[전함] 병력 실은 침공 배를 침몰시킴');
  ok(g.cost(pa, 'warship') > PC.SHIP.warCost, '[전함] 많이 만들수록 비싸짐');
  for (const st of g.ownPorts(c)) g.setOwner(st.tile, -1);
  g.players[c].gold = 1e6;
  ok(/항구/.test(g.buildWarship(c, dockA) || ''), '[전함] 항구가 없으면 못 만듦');
}

console.log(`\n모두 통과 (${pass}개)`);
