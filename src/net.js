// 도트 정복전 — 멀티 플레이용 상태 보내기·받기 (방장 게임 → 모두의 화면)
// 방장 쪽(진짜 게임)은 makeSnapshot/makeDelta 로 상태를 만들고,
// 각자 화면(거울 게임)은 applyPacket 으로 그대로 따라간다. 거울 게임은 step() 을 돌리지 않는다.
(function (root) {
  'use strict';
  const PC = root.PC || (typeof require !== 'undefined' ? require('./game.js') : null);

  // 사람이 보낼 수 있는 명령 (첫 인자는 늘 보낸 사람의 나라 번호)
  const COMMANDS = new Set([
    'spawnPlayer', 'orderAttack', 'build', 'launchMissile', 'buildWarship', 'setPatrol',
    'requestAlliance', 'requestSubmit', 'requestDemand', 'answerRequestById',
    'breakAlliance', 'releaseVassal', 'sendAid', 'autoBuild',
  ]);
  function runCommand(game, pid, name, args) {
    if (!COMMANDS.has(name) || pid < 0 || !game.players[pid]) return '할 수 없는 명령이에요';
    try {
      return game[name](pid, ...(Array.isArray(args) ? args : []));
    } catch (e) {
      return '명령 실패: ' + (e && e.message);
    }
  }

  const r0 = v => Math.round(v);
  function packPlayer(p) {
    return {
      id: p.id, name: p.name, color: p.color, isBot: p.isBot, diff: p.diff, alive: p.alive, spawned: p.spawned,
      tiles: p.tiles, troops: r0(p.troops), gold: r0(p.gold), counts: p.counts, popCap: p.popCap, goldIncome: p.goldIncome,
      trib: p.trib ? { inT: +p.trib.inT.toFixed(2), inG: +p.trib.inG.toFixed(2), outT: +p.trib.outT.toFixed(2), outG: +p.trib.outG.toFixed(2) } : null,
      traitorUntil: p.traitorUntil || 0, peakTiles: p.peakTiles, deadTick: p.deadTick, spawnTile: p.spawnTile,
      tradeLog: p.tradeLog || [],
    };
  }
  const packStruct = s => [s.type, s.owner, s.tile, s.x, s.y, s.half];
  const packShip = x => x.kind === 'war'
    ? [x.id, 1, x.owner, x.tile, r0(x.hp), x.maxHp, x.state, x.center]
    : [x.id, 0, x.owner, x.tile, x.value];
  const packBoat = b => [b.owner, r0(b.troops), b.path[Math.min(b.path.length - 1, Math.floor(b.pos))], b.dest];
  const packAttack = a => [a.att, a.def, r0(a.pool), a.fx == null ? -1 : a.fx, a.fy == null ? -1 : a.fy];
  const packMissile = m => [m.owner, m.fx, m.fy, m.tx, m.ty, m.t, m.dur];
  const packReq = r => [r.id, r.from, r.to, r.type, r.tick];

  // 바다·빈 땅이 대부분이라 주인 지도는 (값, 길이) 묶음으로 줄인다
  function rleOwner(owner) {
    const out = [];
    let cur = owner[0], n = 0;
    for (let i = 0; i < owner.length; i++) {
      if (owner[i] === cur) n++;
      else { out.push(cur, n); cur = owner[i]; n = 1; }
    }
    out.push(cur, n);
    return out;
  }

  function common(game, st) {
    const pk = {
      tick: game.tick, phase: game.phase, spawnTicks: game.spawnTicks, winner: game.winner, startTick: game.startTick || 0,
      players: game.players.map(packPlayer),
      attacks: game.attacks.map(packAttack),
      boats: game.boats.map(packBoat),
      ships: game.ships.map(packShip),
      missiles: game.missiles.map(packMissile),
      requests: game.requests.map(packReq),
    };
    // 건물·동맹은 바뀌었을 때만
    if (!st || st.structVer !== game.structVer) { pk.structures = game.structures.map(packStruct); pk.structVer = game.structVer; }
    if (!st || st.allyVer !== game.allianceVer || st.betrayN !== game.betrayals.size) {
      pk.alliances = [...game.alliances];
      pk.vassals = [...game.vassals];
      pk.betrayals = [...game.betrayals];
      pk.allianceVer = game.allianceVer;
    }
    const blasts = game.blasts || [];
    pk.blasts = blasts.filter(b => !st || b.tick > st.blastTick).map(b => [b.x, b.y, b.tick]);
    if (st) {
      st.structVer = game.structVer; st.allyVer = game.allianceVer; st.betrayN = game.betrayals.size;
      if (blasts.length) st.blastTick = Math.max(st.blastTick, ...blasts.map(b => b.tick));
    }
    return pk;
  }

  // 처음 들어온 사람에게 줄 전체 상태
  function makeSnapshot(game) {
    const pk = common(game, null);
    pk.t = 'snap';
    pk.owner = rleOwner(game.owner);
    pk.events = game.events.slice(-40);
    pk.evIndex = game.events.length;
    return pk;
  }
  // 지난번 뒤로 바뀐 것만 (st: 보낸 기록, 방장이 하나 들고 있음)
  function makeDelta(game, st) {
    const pk = common(game, st);
    pk.t = 'delta';
    const seen = new Set(), tiles = [];
    for (const t of game.netDirty || []) {
      if (seen.has(t)) continue;
      seen.add(t);
      tiles.push(t, game.owner[t]);
    }
    if (game.netDirty) game.netDirty.length = 0;
    pk.tiles = tiles;
    pk.events = game.events.slice(st.evIndex);
    pk.evIndex = game.events.length;
    st.evIndex = game.events.length;
    return pk;
  }
  function newSendState(game) {
    return { structVer: -1, allyVer: -1, betrayN: -1, blastTick: game.tick, evIndex: game.events.length };
  }

  // ---------- 받는 쪽: 거울 게임에 적용 ----------
  function applyPacket(g, pk) {
    if (pk.owner) { // 전체
      let i = 0;
      for (let k = 0; k < pk.owner.length; k += 2) { g.owner.fill(pk.owner[k], i, i + pk.owner[k + 1]); i += pk.owner[k + 1]; }
      g.events = pk.events.slice();
      g.fullRepaint = true;
    }
    if (pk.tiles) {
      for (let k = 0; k < pk.tiles.length; k += 2) { g.owner[pk.tiles[k]] = pk.tiles[k + 1]; g.dirty.push(pk.tiles[k]); }
    }
    if (pk.t === 'delta' && pk.events) for (const e of pk.events) g.events.push(e);
    g.tick = pk.tick; g.phase = pk.phase; g.spawnTicks = pk.spawnTicks; g.winner = pk.winner; g.startTick = pk.startTick;
    // 나라
    pk.players.forEach((q, i) => {
      let p = g.players[i];
      if (!p) { p = { bbox: [g.w, g.h, -1, -1], label: null }; g.players[i] = p; }
      Object.assign(p, q);
    });
    g.players.length = pk.players.length;
    // 건물
    if (pk.structures) {
      g.structures = pk.structures.map(([type, owner, tile, x, y, half]) => ({ type, owner, tile, x, y, half }));
      g.structAt = new Map(g.structures.map(s => [s.tile, s]));
      g.occ.fill(0);
      for (const s of g.structures) for (let dy = -s.half; dy <= s.half; dy++) for (let dx = -s.half; dx <= s.half; dx++) {
        const x = s.x + dx, y = s.y + dy;
        if (x >= 0 && y >= 0 && x < g.w && y < g.h) g.occ[y * g.w + x] = 1;
      }
      g.structVer = pk.structVer;
    }
    if (pk.alliances) {
      g.alliances = new Map(pk.alliances);
      g.vassals = new Map(pk.vassals);
      g.betrayals = new Map(pk.betrayals);
      if (g.allianceVer !== pk.allianceVer) { g.allianceVer = pk.allianceVer; }
    }
    g.attacks = pk.attacks.map(([att, def, pool, fx, fy]) => ({ att, def, pool, fx: fx < 0 ? null : fx, fy: fy < 0 ? null : fy, front: { size: 1 } }));
    g.boats = pk.boats.map(([owner, troops, tile, dest]) => ({ owner, troops, path: [tile], pos: 0, dest }));
    g.ships = pk.ships.map(a => a[1] === 1
      ? { id: a[0], kind: 'war', owner: a[2], tile: a[3], hp: a[4], maxHp: a[5], state: a[6], center: a[7] }
      : { id: a[0], kind: 'trade', owner: a[2], tile: a[3], value: a[4] });
    g.missiles = pk.missiles.map(([owner, fx, fy, tx, ty, t, dur]) => ({ owner, fx, fy, tx, ty, t, dur }));
    g.requests = pk.requests.map(([id, from, to, type, tick]) => ({ id, from, to, type, tick }));
    if (pk.blasts && pk.blasts.length) (g.blasts || (g.blasts = [])).push(...pk.blasts.map(([x, y, tick]) => ({ x, y, tick })));
    // 이름표 자리는 각자 계산 (1초마다)
    if (pk.owner || g.tick - (g._labelTick || 0) >= 10) { g.computeLabels(); g._labelTick = g.tick; }
  }

  const api = { COMMANDS, runCommand, makeSnapshot, makeDelta, newSendState, applyPacket };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.NET = api;
})(typeof window !== 'undefined' ? window : globalThis);
