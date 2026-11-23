// 화면 없이 컴퓨터끼리 한 판 돌려 보는 자동 점검
// 사용법: node tools/sim.js [봇 수] [초] [난이도] [시드]
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const PC = require('../src/game.js');

const ctx = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'mapdata.js'), 'utf8'), ctx);
const map = PC.decodeMap(ctx.window.MAP_DATA);

const bots = +(process.argv[2] || 30);
const secs = +(process.argv[3] || 900);
const diff = process.argv[4] || 'normal';
const seed = +(process.argv[5] || 12345);

const g = new PC.Game(map, { seed, spawnTicks: 5 });
for (let i = 0; i < bots; i++) g.addPlayer({ isBot: true, difficulty: diff });
for (const p of g.players) g.randomSpawn(p.id);

let fail = 0;
function check() {
  const cnt = new Array(g.players.length).fill(0);
  for (let t = 0; t < g.N; t++) {
    const o = g.owner[t];
    if (o >= 0) { cnt[o]++; if (!g.ter[t]) { console.log('바다에 주인이 있음', t); fail++; return; } }
  }
  for (const p of g.players) {
    if (cnt[p.id] !== p.tiles) { console.log('칸 수 불일치', p.name, cnt[p.id], p.tiles); fail++; }
    if (!isFinite(p.troops) || p.troops < 0) { console.log('병력 이상', p.name, p.troops); fail++; }
    if (!isFinite(p.gold)) { console.log('금 이상', p.name); fail++; }
    for (const k of Object.keys(PC.BUILD)) {
      const real = g.structures.filter(s => s.owner === p.id && s.type === k).length;
      if (real !== p.counts[k]) { console.log('건물 수 불일치', p.name, k, real, p.counts[k]); fail++; }
    }
  }
  { let occN = 0; for (let t = 0; t < g.N; t++) occN += g.occ[t];
    let need = 0; for (const st of g.structures) { const n = st.half * 2 + 1; need += n * n; for (let dy = -st.half; dy <= st.half; dy++) for (let dx = -st.half; dx <= st.half; dx++) { const x = st.x + dx, y = st.y + dy; if (x >= 0 && y >= 0 && x < g.w && y < g.h && !g.occ[y * g.w + x]) { console.log('건물 칸 표시 빠짐', st.type); fail++; } } }
    if (occN > need) { console.log('건물 칸 표시가 남음/겹침', occN, need); fail++; } }
  for (const sh of g.ships) if (g.ter[sh.tile]) { console.log('배가 땅 위에', sh.kind, sh.tile); fail++; }
  for (const [sub, over] of g.vassals) if (!g.allied(sub, over)) { console.log('속국인데 동맹 아님', sub, over); fail++; }
  for (const a of g.attacks) {
    if (!isFinite(a.pool) || a.pool < 0) { console.log('공격 병력 이상', a.pool); fail++; }
    if (g.allied(a.att, a.def)) { console.log('동맹끼리 싸움', a.att, a.def); fail++; }
  }
}

const t0 = Date.now();
let worst = 0;
let missiles = 0, boats = 0;
const origLaunch = g.launchMissile.bind(g);
g.launchMissile = (...a) => { const r = origLaunch(...a); if (!r) missiles++; return r; };
const origBoat = g.sendBoat.bind(g);
g.sendBoat = (...a) => { const r = origBoat(...a); if (r) boats++; return r; };

for (let s = 1; s <= secs && g.phase !== 'over'; s++) {
  for (let k = 0; k < PC.TPS; k++) {
    const a = process.hrtime.bigint();
    g.step();
    const ms = Number(process.hrtime.bigint() - a) / 1e6;
    if (ms > worst) worst = ms;
  }
  if (s % 60 === 0 || g.phase === 'over') {
    check();
    const alive = g.players.filter(p => p.alive).sort((a, b) => b.tiles - a.tiles);
    const owned = g.players.reduce((n, p) => n + p.tiles, 0);
    console.log(`${String(s).padStart(4)}초 생존 ${alive.length}/${bots} 점령 ${(owned / g.land * 100).toFixed(0)}% 공격 ${g.attacks.length} 배 ${boats} 미사일 ${missiles} 건물 ${g.structures.length} | 1위 ${alive[0].name} ${(alive[0].tiles / g.land * 100).toFixed(1)}% (속국 포함 ${(Math.max(...alive.map(p => g.empireTiles(p))) / g.land * 100).toFixed(0)}%) 병력 ${PC.fmt(alive[0].troops)}/${PC.fmt(g.maxTroops(alive[0]))} 금 ${PC.fmt(alive[0].gold)}`);
  }
}
check();
const total = (Date.now() - t0) / 1000;
const ek = k => g.events.filter(e => e.kind === k).length;
const bc = {}; for (const st of g.structures) bc[st.type] = (bc[st.type] || 0) + 1;
console.log('건물', Object.entries(bc).map(([k, v]) => PC.BUILD[k].name + ' ' + v).join(' · '));
console.log(`동맹 요청 ${g.events.filter(e => e.kind === 'ally' && e.text.includes('요청')).length} · 성립 ${g.events.filter(e => e.kind === 'ally' && e.text.includes('성립')).length} · 거절 ${ek('ally-no')} · 배신 ${ek('betray')}`);
console.log(`복종 ${g.events.filter(e => e.text.startsWith('👑')).length} · 독립 ${g.events.filter(e => e.text.startsWith('🔥')).length} · 지원 ${ek('aid')} · 복종 요구 거절 후 침공 ${g.events.filter(e => e.text.startsWith('😠')).length}`);
console.log(`바다: 전함 ${g.ships.filter(x => x.kind === 'war').length}척 · 무역선 ${g.ships.filter(x => x.kind === 'trade').length}척 · 무역선 털림 ${g.events.filter(e => e.text.startsWith('🏴')).length} · 전함 격침 ${g.events.filter(e => e.text.startsWith('💥')).length} · 침공 배 격침 ${g.events.filter(e => e.text.includes('침공 배를 침몰')).length}`);
console.log(`끝: ${g.phase === 'over' ? '승자 ' + g.players[g.winner].name : '시간 종료'} · ${g.tick}틱 ${total.toFixed(1)}s (틱당 평균 ${(total * 1000 / g.tick).toFixed(2)}ms, 최악 ${worst.toFixed(1)}ms) · 오류 ${fail}`);
process.exit(fail ? 1 : 0);
