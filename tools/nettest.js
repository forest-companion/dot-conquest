// 멀티 동기화 점검: 방장 게임을 돌리면서 보낸 상태를 거울 게임에 적용해, 화면에 쓰는 값이 같은지 본다
// 사용법: node tools/nettest.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const PC = require('../src/game.js');
const NET = require('../src/net.js');
const ctx = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'mapdata.js'), 'utf8'), ctx);
const md = ctx.window.MAP_DATA;
const map = PC.decodeMap(md);

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass++; console.log('  ✓ ' + m); };

const host = new PC.Game(map, { seed: 9, spawnTicks: 30 });
const me = host.addPlayer({ name: '방장', isBot: false });
const friend = host.addPlayer({ name: '친구', isBot: false });
for (let i = 0; i < 20; i++) host.addPlayer({ isBot: true });
for (const p of host.players) if (p.isBot) host.randomSpawn(p.id);
host.netDirty = [];

// 친구가 들어옴 → 전체 상태
const mirror = new PC.Game(map, {});
let bytes = 0;
const send = pk => { const s = JSON.stringify(pk); bytes += s.length; return JSON.parse(s); };
NET.applyPacket(mirror, send(NET.makeSnapshot(host)));
const st = NET.newSendState(host);
ok(mirror.players.length === host.players.length && mirror.phase === 'spawn', '[멀티] 처음 전체 상태 받음');

// 시작 위치는 명령으로
ok(NET.runCommand(host, me, 'spawnPlayer', [PC.tileAt(md, 2, 47)]) === true, '[멀티] 방장 시작 위치 (명령)');
ok(NET.runCommand(host, friend, 'spawnPlayer', [PC.tileAt(md, 10, 50)]) === true, '[멀티] 친구 시작 위치 (명령)');
ok(typeof NET.runCommand(host, friend, 'step', []) === 'string' && typeof NET.runCommand(host, friend, 'addPlayer', []) === 'string', '[멀티] 허용 안 된 명령은 거절');

let maxPk = 0, packets = 0;
const t0 = Date.now();
for (let i = 1; i <= 1800; i++) {
  host.step();
  if (i === 200) { host.players[me].gold = 2e5; NET.runCommand(host, me, 'autoBuild', []); }
  if (i === 250) NET.runCommand(host, friend, 'orderAttack', [PC.tileAt(md, 12, 52), 0.5]);
  if (i % 3 === 0) {
    const pk = NET.makeDelta(host, st);
    const s = JSON.stringify(pk);
    bytes += s.length; maxPk = Math.max(maxPk, s.length); packets++;
    NET.applyPacket(mirror, JSON.parse(s));
  }
}
const pk = NET.makeDelta(host, st); NET.applyPacket(mirror, send(pk));
const sec = (Date.now() - t0) / 1000;

let diff = 0;
for (let t = 0; t < host.N; t++) if (host.owner[t] !== mirror.owner[t]) diff++;
ok(diff === 0, `[멀티] 땅 주인 지도 똑같음 (다른 칸 ${diff})`);
ok(host.players.every((p, i) => mirror.players[i].tiles === p.tiles && mirror.players[i].alive === p.alive), '[멀티] 나라별 칸 수·생존 같음');
ok(host.players.every((p, i) => Math.abs(mirror.players[i].troops - p.troops) <= 1 && Math.abs(mirror.players[i].gold - p.gold) <= 1), '[멀티] 병력·금 같음');
ok(host.players.every((p, i) => mirror.maxTroops(mirror.players[i]) === host.maxTroops(p) && mirror.goldRate(mirror.players[i]) === host.goldRate(p)), '[멀티] 최대 병력·금 수입 같음');
ok(mirror.structures.length === host.structures.length && mirror.structures.length > 0, `[멀티] 건물 ${mirror.structures.length}개 같음`);
ok(mirror.ships.length === host.ships.length && mirror.boats.length === host.boats.length && mirror.attacks.length === host.attacks.length, `[멀티] 배·공격 수 같음 (배 ${mirror.ships.length}, 공격 ${mirror.attacks.length})`);
ok(mirror.alliances.size === host.alliances.size && mirror.vassals.size === host.vassals.size, `[멀티] 동맹 ${mirror.alliances.size}·복종 ${mirror.vassals.size} 같음`);
ok(mirror.events.length === host.events.length, `[멀티] 알림 ${host.events.length}개 빠짐없이 받음`);
// 화면에서 쓰는 판단(지을 수 있나, 가격)도 같은지
const big = host.players.filter(p => p.alive).sort((a, b) => b.tiles - a.tiles)[0].id;
host.players[big].gold = mirror.players[big].gold = 1e6;
let same = 0, tried = 0;
for (let k = 0; k < 20000 && tried < 300; k++) {
  const t = (Math.random() * host.N) | 0;
  if (host.owner[t] !== big) continue;
  tried++;
  for (const type of ['village', 'farm', 'mine', 'port', 'market']) if (host.canBuild(big, type, t) === mirror.canBuild(big, type, t)) same++;
}
ok(tried > 0 && same === tried * 5, `[멀티] 지을 수 있는지 판단이 같음 (${tried}칸 × 5종)`);
ok(['village', 'farm', 'warship', 'missile'].every(ty => host.cost(host.players[big], ty) === mirror.cost(mirror.players[big], ty)), '[멀티] 건물 가격 같음');
for (const a of host.attacks) {
  const m = mirror.attacks.find(x => x.att === a.att && x.def === a.def);
  if (a.def >= 0) assert.ok(m && Math.abs(mirror.battleEdge(m) - host.battleEdge(a)) <= 2, '판세 다름');
}
ok(true, '[멀티] 싸움 판세 같음');
const kbps = bytes / 1024 / (1800 / 10);
ok(maxPk < 120000, `[멀티] 한 번에 보내는 크기 최대 ${(maxPk / 1024).toFixed(0)}KB, 평균 초당 ${kbps.toFixed(0)}KB (패킷 ${packets}개)`);
console.log(`\n모두 통과 (${pass}개) · 3분 게임 ${sec.toFixed(1)}초`);
