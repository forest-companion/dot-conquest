// 도트 정복전 — 게임 규칙 (화면과 분리되어 있어서 node 로도 돌릴 수 있다)
(function (root) {
  'use strict';

  const NEUTRAL = -1;
  const TPS = 10; // 초당 틱
  // 지형: 0 바다, 1 평야, 2 언덕, 3 산, 4 사막, 5 툰드라
  const TER = [
    null,
    { name: '평야', cost: 1.0, delay: 1.0 },
    { name: '언덕', cost: 1.5, delay: 1.7 },
    { name: '산', cost: 2.2, delay: 2.6 },
    { name: '사막', cost: 1.15, delay: 1.25 },
    { name: '툰드라', cost: 1.3, delay: 1.4 },
  ];

  // 건물: size = 차지하는 정사각형 한 변(칸), pop = 최대 인구 +, gold = 틱당 금 + (초당은 ×10)
  // 땅 넓이로는 인구·금이 늘지 않는다. 땅은 건물을 지을 자리.
  const MARKET_RADIUS = 12, MARKET_BONUS = 0.5;
  const BUILD = {
    capital: { name: '수도', icon: '🏰', size: 5, base: 0, grow: 1, pop: 20000, gold: 5, buildable: false, desc: '시작할 때 주어져요. 최대 인구 +2만, 금 +50/초. 빼앗기면 상대의 도시가 돼요' },
    village: { name: '마을', icon: '🏠', size: 3, base: 1000, grow: 1.12, pop: 12000, desc: '최대 인구 +1.2만. 산이 아닌 곳' },
    city: { name: '도시', icon: '🏙', size: 3, base: 5000, grow: 1.25, pop: 40000, upgradeOf: 'village', desc: '내 마을을 눌러 업그레이드. 최대 인구 +4만(마을 대신)' },
    farm: { name: '농장', icon: '🌾', size: 3, base: 600, grow: 1.1, gold: 3, desc: '평야가 절반 넘는 곳. 금 +30/초' },
    mine: { name: '광산', icon: '⛏', size: 3, base: 2500, grow: 1.12, gold: 8, desc: '언덕·산이 4칸 이상인 곳. 금 +80/초' },
    port: { name: '항구', icon: '⚓', size: 3, base: 3000, grow: 1.2, gold: 1, desc: '바다에 닿은 곳. 금 +10/초 + 무역선이 다른 나라 항구에 갔다 오면 돈(동맹 항구면 +30%). 배 +1척, 전함을 만들 수 있어요' },
    market: { name: '시장', icon: '🏦', size: 3, base: 4000, grow: 1.3, desc: `반경 ${MARKET_RADIUS}칸 안 내 농장·광산·항구 수입 +50%` },
    fort: { name: '요새', icon: '🏯', size: 3, base: 2500, grow: 1.3, desc: '반경 10칸 땅을 빼앗기 2배 어렵게' },
    silo: { name: '미사일 기지', icon: '🚀', size: 3, base: 30000, grow: 1.6, desc: '미사일을 쏠 수 있게 돼요' },
  };
  const PRODUCERS = { farm: 1, mine: 1, port: 1 };
  // 바다의 배: 무역선(항구에서 자동 출발)과 전함(항구에서 만들어 정한 곳 근처를 지킴)
  const SHIP = {
    warCost: 4000, warGrow: 1.3, warHp: 1000, warSpeed: 1, warRange: 4, warSight: 10, warDmg: 12, warRepair: 20,
    patrolR: 7, retreatAt: 0.3, portGunRange: 5, portGunDmg: 10,
    tradeSpeed: 1.2, tradePerPort: 2, tradeEvery: 90, tradeBase: 40, tradePerTile: 4, tradeAlly: 1.3, tradeHost: 0.2,
  };
  const BASE_POP = 5000, BASE_GOLD = 3;
  const MISSILE_COST = 15000;
  const MISSILE_RADIUS = 9;
  const FORT_RADIUS = 10;
  const MAX_BOATS = 3;
  const BOAT_SPEED = 1.6; // 틱당 칸
  const WIN_SHARE = 0.8;
  const TRIBUTE = 0.3;      // 속국이 종주국에 바치는 병력 생산·금 수입 비율
  const BETRAY_SECS = 90, BETRAY_MUL = 2; // 동맹을 깬 나라는 90초 동안 그 나라를 칠 때 칸당 병력 2배 (= 공격력 -50%)

  const DIFF = {
    easy: { aggr: 0.25, build: 0.15, think: 14, ratio: 0.3 },
    normal: { aggr: 0.5, build: 0.4, think: 10, ratio: 0.4 },
    hard: { aggr: 0.8, build: 0.8, think: 6, ratio: 0.55 },
  };

  function decodeMap(md) {
    const ter = new Uint8Array(md.w * md.h);
    let i = 0;
    for (const run of md.rle.split(',')) {
      const v = +run[0], n = parseInt(run.slice(1), 36);
      ter.fill(v, i, i + n);
      i += n;
    }
    return { w: md.w, h: md.h, ter };
  }

  // 원래 경위도 → 지도 칸 번호 (tools/build-map.js 의 투영·돋보기와 같은 계산)
  function tileAt(md, lon, lat) {
    for (const [cx, cy, rs, m, R] of (md.lenses || [])) {
      const dx = lon - cx, dy = lat - cy, d = Math.hypot(dx, dy);
      if (d === 0 || d >= R) continue;
      const e = d <= rs ? d * m : rs * m + (d - rs) * (R - rs * m) / (R - rs);
      lon = cx + dx * e / d; lat = cy + dy * e / d;
    }
    const k = md.projA != null ? md.projA + md.projB * Math.cos(lat * Math.PI / 180) : 1;
    const x = Math.floor(md.w / 2 + lon / 180 * (md.w / 2) * k);
    const y = Math.floor((md.latTop - lat) / (md.latTop - md.latBot) * md.h);
    if (x < 0 || y < 0 || x >= md.w || y >= md.h) return -1;
    return y * md.w + x;
  }

  function mulberry(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // 작은 최소 힙 (준비 시각, 칸 번호)
  class Heap {
    constructor() { this.k = []; this.v = []; }
    get size() { return this.k.length; }
    peek() { return this.k[0]; }
    push(key, val) {
      const k = this.k, v = this.v;
      let i = k.length;
      k.push(key); v.push(val);
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (k[p] <= key) break;
        k[i] = k[p]; v[i] = v[p]; i = p;
      }
      k[i] = key; v[i] = val;
    }
    pop() {
      const k = this.k, v = this.v;
      const top = v[0];
      const lk = k.pop(), lv = v.pop();
      const n = k.length;
      if (n > 0) {
        let i = 0;
        while (true) {
          let c = 2 * i + 1;
          if (c >= n) break;
          if (c + 1 < n && k[c + 1] < k[c]) c++;
          if (k[c] >= lk) break;
          k[i] = k[c]; v[i] = v[c]; i = c;
        }
        k[i] = lk; v[i] = lv;
      }
      return top;
    }
  }

  const SYL = ['카', '르', '벨', '로', '아', '미', '도', '란', '세', '타', '노', '비', '에', '온', '라', '스', '티', '엘', '무', '하', '진', '바', '펠', '그', '리', '안', '소', '크', '네', '루', '자', '모', '키', '오', '사', '델'];
  const SUFFIX = ['왕국', '연방', '공화국', '제국', '부족', '연합', '공국', '칸국', '자치령', '동맹'];

  class Game {
    constructor(map, opts = {}) {
      this.w = map.w; this.h = map.h; this.ter = map.ter;
      this.N = this.w * this.h;
      this.owner = new Int16Array(this.N).fill(NEUTRAL);
      this.rng = mulberry(opts.seed ?? (Math.random() * 1e9));
      this.players = [];
      this.attacks = [];
      this.boats = [];
      this.ships = []; // 무역선·전함
      this._shipId = 0;
      this._pathCache = new Map();
      // 바다를 이어진 덩어리로 나눠 둔다 (항구는 큰 바다에만, 무역은 같은 바다끼리)
      this.seaId = new Int32Array(this.N).fill(-1);
      this.seaSize = [];
      const sq = new Int32Array(this.N);
      for (let s0 = 0; s0 < this.N; s0++) {
        if (this.ter[s0] || this.seaId[s0] >= 0) continue;
        const id = this.seaSize.length, q = sq;
        let h = 0, tl = 0;
        q[tl++] = s0; this.seaId[s0] = id;
        while (h < tl) {
          const t = q[h++], x = t % this.w;
          for (const n of [x > 0 ? t - 1 : -1, x < this.w - 1 ? t + 1 : -1, t - this.w, t + this.w]) {
            if (n < 0 || n >= this.N || this.ter[n] || this.seaId[n] >= 0) continue;
            this.seaId[n] = id; q[tl++] = n;
          }
        }
        this.seaSize.push(tl);
      }
      this.missiles = [];
      this.structures = [];
      this.structAt = new Map();
      this.events = [];
      this.dirty = [];
      this.netDirty = null; // 멀티: 방장 쪽에서 바뀐 칸을 모아 보낼 때 [] 로 켠다
      this.structVer = 0;   // 건물 목록이 바뀔 때마다 +1 (멀티 전송용)
      this._reqId = 0;
      this.tick = 0;
      this.phase = 'spawn';
      this.spawnTicks = opts.spawnTicks ?? 100;
      this.winner = null;
      this.land = 0;
      for (let i = 0; i < this.N; i++) if (this.ter[i]) this.land++;
      // 배 길찾기용 버퍼
      this._q = new Int32Array(this.N);
      this._prev = new Int32Array(this.N);
      this._stamp = new Uint32Array(this.N);
      this._stampV = 0;
      this.labelDist = new Uint16Array(this.N);
      this.occ = new Uint8Array(this.N); // 건물이 차지한 칸 = 1
      this.usedNames = new Set();
      // 동맹: 짝 키 → 맺은 틱
      this.alliances = new Map();
      this.allianceVer = 0;
      this.requests = []; // { from, to, tick }
      this.reqCooldown = new Map(); // '종류:짝 키' → 다시 요청 가능한 틱
      this.betrayals = new Map(); // (배신한 나라 × 4096 + 배신당한 나라) → 패널티 끝나는 틱
      this.vassals = new Map(); // 속국 id → 종주국 id
      this.vassalSince = new Map();
    }

    // ---------- 동맹 · 복종 · 지원 ----------
    pairKey(a, b) { return a < b ? a * 4096 + b : b * 4096 + a; }
    allied(a, b) { return a >= 0 && b >= 0 && a !== b && this.alliances.has(this.pairKey(a, b)); }
    alliesOf(pid) { return this.players.filter(q => q.id !== pid && q.alive && this.allied(pid, q.id)); }
    atWar(a, b) { return this.attacks.some(x => (x.att === a && x.def === b) || (x.att === b && x.def === a)); }
    overlordOf(pid) { const o = this.vassals.get(pid); return o === undefined ? -1 : o; }
    vassalsOf(pid) { const out = []; for (const [s, o] of this.vassals) if (o === pid) out.push(this.players[s]); return out; }
    empireTiles(p) { let n = p.tiles; for (const v of this.vassalsOf(p.id)) n += v.tiles; return n; }
    isVassalPair(a, b) { return this.overlordOf(a) === b || this.overlordOf(b) === a; }

    // 요청 공통: type 'ally'(동맹) | 'submit'(from 이 to 에게 복종하겠다) | 'demand'(from 이 to 에게 복종하라)
    request(from, to, type) {
      const a = this.players[from], b = this.players[to];
      if (this.phase !== 'play' || !a || !b || !a.alive || !b.alive || from === to) return '지금은 할 수 없어요';
      if (type === 'ally' && this.allied(from, to)) return '이미 동맹이에요';
      if (type !== 'ally') {
        if (this.isVassalPair(from, to)) return '이미 복종 관계예요';
        const sub = type === 'submit' ? from : to, over = type === 'submit' ? to : from;
        if (this.overlordOf(sub) >= 0) return `${this.players[sub].name}은(는) 이미 다른 나라에 복종 중이에요`;
        if (this.vassalsOf(sub).length) return `${this.players[sub].name}은(는) 속국을 거느리고 있어서 복종할 수 없어요`;
        if (this.overlordOf(over) >= 0) return `${this.players[over].name}은(는) 다른 나라의 속국이라 속국을 둘 수 없어요`;
      }
      if (this.requests.some(r => (r.from === from && r.to === to) || (r.from === to && r.to === from))) return '이미 요청 중이에요';
      const k = type + ':' + this.pairKey(from, to), cd = this.reqCooldown.get(k) || 0;
      if (cd > this.tick) return `${Math.ceil((cd - this.tick) / TPS)}초 뒤에 다시 할 수 있어요`;
      this.reqCooldown.set(k, this.tick + 30 * TPS);
      this.requests.push({ id: ++this._reqId, from, to, tick: this.tick, type });
      const word = type === 'ally' ? '동맹 요청' : type === 'submit' ? '복종 제안' : '복종 요구';
      this.log(`${a.name} → ${b.name} ${word}`, type === 'ally' ? 'ally' : 'vassal', [from, to]);
      return null;
    }
    requestAlliance(from, to) { return this.request(from, to, 'ally'); }
    requestSubmit(from, to) { return this.request(from, to, 'submit'); }
    requestDemand(from, to) { return this.request(from, to, 'demand'); }

    // 받은 사람만 대답할 수 있게 id 로 찾아서 대답
    answerRequestById(pid, id, accept) {
      const req = this.requests.find(r => r.id === id);
      if (!req || req.to !== pid) return '이미 끝난 요청이에요';
      this.answerRequest(req, !!accept);
      return null;
    }
    answerRequest(req, accept) {
      const i = this.requests.indexOf(req);
      if (i < 0) return;
      this.requests.splice(i, 1);
      const a = this.players[req.from], b = this.players[req.to];
      if (!a.alive || !b.alive) return;
      const type = req.type || 'ally';
      if (accept) {
        if (type === 'ally') this.formAlliance(req.from, req.to);
        else if (type === 'submit') this.makeVassal(req.from, req.to);
        else this.makeVassal(req.to, req.from);
        return;
      }
      if (type === 'ally') this.log(`${b.name}이(가) ${a.name}의 동맹 요청을 거절했어요`, 'ally-no', [req.from, req.to]);
      else if (type === 'submit') this.log(`${b.name}이(가) ${a.name}의 복종을 받지 않았어요`, 'ally-no', [req.from, req.to]);
      else {
        this.log(`${b.name}이(가) ${a.name}의 복종 요구를 거절했어요`, 'ally-no', [req.from, req.to]);
        // 거절당한 컴퓨터는 화가 나서 쳐들어온다
        if (a.isBot && !this.allied(a.id, b.id) && this.scanBorder(a.id, 10).counts.has(b.id)) {
          const send = a.troops * 0.5;
          a.troops -= send;
          if (this.startAttack(a.id, b.id, send)) this.log(`😠 ${a.name}이(가) 거절에 화가 나 쳐들어와요!`, 'attack', [a.id, b.id]);
        }
      }
    }
    formAlliance(a, b, quiet) {
      this.alliances.set(this.pairKey(a, b), this.tick);
      this.allianceVer++;
      for (const x of this.attacks.slice()) if ((x.att === a && x.def === b) || (x.att === b && x.def === a)) this.endAttack(x);
      if (!quiet) this.log(`🤝 ${this.players[a].name} · ${this.players[b].name} 동맹 성립`, 'ally', [a, b]);
    }
    makeVassal(sub, over) {
      if (!this.allied(sub, over)) this.formAlliance(sub, over, true);
      this.vassals.set(sub, over);
      this.vassalSince.set(sub, this.tick);
      this.allianceVer++;
      this.log(`👑 ${this.players[sub].name}이(가) ${this.players[over].name}에 복종했어요 (생산의 ${Math.round(TRIBUTE * 100)}%를 바침)`, 'vassal', [sub, over]);
    }
    // 종주국이 속국을 풀어줌 (동맹은 남음)
    releaseVassal(over, sub) {
      if (this.overlordOf(sub) !== over) return '내 속국이 아니에요';
      this.vassals.delete(sub);
      this.allianceVer++;
      this.log(`🕊 ${this.players[over].name}이(가) ${this.players[sub].name}을(를) 풀어줬어요`, 'vassal', [over, sub]);
      return null;
    }
    breakAlliance(by, other) {
      if (!this.allied(by, other)) return '동맹이 아니에요';
      this.alliances.delete(this.pairKey(by, other));
      this.allianceVer++;
      this.players[by].traitorUntil = this.tick + 90 * TPS;
      this.betrayals.set(by * 4096 + other, this.tick + BETRAY_SECS * TPS);
      for (const t of ['ally', 'submit', 'demand']) this.reqCooldown.set(t + ':' + this.pairKey(by, other), this.tick + 60 * TPS);
      const B = this.players[by].name, O = this.players[other].name;
      if (this.overlordOf(by) === other) { this.vassals.delete(by); this.log(`🔥 ${B}이(가) ${O}로부터 독립을 선언했어요!`, 'betray', [by, other]); }
      else if (this.overlordOf(other) === by) { this.vassals.delete(other); this.log(`💔 ${B}이(가) 속국 ${O}와(과)의 관계를 끊었어요!`, 'betray', [by, other]); }
      else this.log(`💔 ${B}이(가) ${O}와(과)의 동맹을 깼어요!`, 'betray', [by, other]);
      this.log(`⚠ 배신 패널티: ${B}은(는) ${BETRAY_SECS}초 동안 ${O}을(를) 공격할 때 공격력 -50%`, 'betray', [by, other]);
      return null;
    }
    // 배신 패널티: att 가 def 를 배신한 지 얼마 안 됐으면 칸당 드는 병력 배수(2), 아니면 1
    attackMul(att, def) {
      if (att < 0 || def < 0) return 1;
      const until = this.betrayals.get(att * 4096 + def);
      if (until === undefined) return 1;
      if (until <= this.tick) { this.betrayals.delete(att * 4096 + def); return 1; }
      return BETRAY_MUL;
    }
    betrayLeft(att, def) {
      const until = this.betrayals.get(att * 4096 + def);
      return until && until > this.tick ? Math.ceil((until - this.tick) / TPS) : 0;
    }
    // 동맹에게 병력·금 지원. kind: 'troops' | 'gold'
    sendAid(from, to, kind, amount) {
      const a = this.players[from], b = this.players[to];
      if (this.phase !== 'play' || !a.alive || !b || !b.alive) return '지금은 지원할 수 없어요';
      if (!this.allied(from, to)) return '동맹에게만 지원할 수 있어요';
      amount = Math.floor(Math.min(amount, kind === 'gold' ? a.gold : a.troops));
      if (amount < 1) return kind === 'gold' ? '보낼 금이 없어요' : '보낼 여유 병력이 없어요';
      if (kind === 'gold') { a.gold -= amount; b.gold += amount; }
      else { a.troops -= amount; b.troops += amount; }
      this.log(`${kind === 'gold' ? '💰' : '💪'} ${a.name} → ${b.name} ${kind === 'gold' ? '금' : '병력'} ${fmt(amount)} 지원`, 'aid', [from, to]);
      return null;
    }

    // 컴퓨터가 요청을 받을지
    botAccepts(b, r, type = 'ally') {
      const D = DIFF[b.diff] || DIFF.normal, rng = this.rng;
      if (type === 'submit') return rng() < 0.9; // 바치겠다는데 마다할 이유가 없다
      if (type === 'demand') {
        // 상대가 훨씬 강할 때만 굴복
        const ratio = r.troops / Math.max(1, b.troops);
        if (ratio < 2.5) return false;
        const losing = this.incomingAttacks(b.id).some(a => a.att === r.id);
        return rng() < Math.min(0.9, 0.25 + (ratio - 2.5) * 0.15 + (losing ? 0.3 : 0) - D.aggr * 0.2);
      }
      if (this.alliesOf(b.id).length >= 3) return false;
      if ((r.traitorUntil || 0) > this.tick && rng() > 0.1) return false;
      if (this.atWar(b.id, r.id) && b.troops > r.troops * 0.7) return false;
      let s = 0.35 + (r.troops > b.troops ? 0.25 : 0) + (r.tiles > b.tiles ? 0.15 : -0.05) + (D.aggr < 0.5 ? 0.1 : -0.05);
      return rng() < s;
    }
    processRequests() {
      for (const r of this.requests.slice()) {
        const age = this.tick - r.tick;
        const to = this.players[r.to];
        if (!to.alive || !this.players[r.from].alive) { this.requests.splice(this.requests.indexOf(r), 1); continue; }
        if (to.isBot && age >= 15) this.answerRequest(r, this.botAccepts(to, this.players[r.from], r.type || 'ally'));
        else if (age >= 15 * TPS) this.answerRequest(r, false);
      }
    }
    // 전선 위치(배지 표시용): 공격 전선 칸들의 가운데에 가장 가까운 전선 칸
    updateFronts() {
      for (const a of this.attacks) {
        if (!a.front.size) continue;
        let sx = 0, sy = 0, n = 0;
        for (const t of a.front) { sx += t % this.w; sy += (t / this.w) | 0; if (++n > 3000) break; }
        sx /= n; sy /= n;
        let best = -1, bd = 1e18, k = 0;
        for (const t of a.front) {
          const dx = t % this.w - sx, dy = ((t / this.w) | 0) - sy, d = dx * dx + dy * dy;
          if (d < bd) { bd = d; best = t; }
          if (++k > 3000) break;
        }
        a.fx = best % this.w; a.fy = (best / this.w) | 0;
      }
    }
    // 남은 공격 병력으로 대략 몇 칸 더 빼앗을 수 있나 (표시용)
    tilesLeft(a) {
      if (a.def < 0) return Math.floor(a.pool / 5);
      const dp = this.players[a.def];
      return Math.floor(a.pool / (((dp.troops / Math.max(1, dp.tiles)) * 1.1 + 3) * this.attackMul(a.att, a.def)));
    }
    // 싸움 판세: 보낸 병력 − 상대 전체 병력 (양수면 공격 쪽이 앞섬)
    battleEdge(a) {
      if (a.def < 0) return a.pool;
      return a.pool / this.attackMul(a.att, a.def) - this.players[a.def].troops;
    }

    // ---------- 기본 도우미 ----------
    xy(t) { return [t % this.w, (t / this.w) | 0]; }
    log(text, kind, ids) { this.events.push({ tick: this.tick, text, kind: kind || 'info', ids: ids || [] }); }
    randName() {
      for (let k = 0; k < 50; k++) {
        const n = 2 + (this.rng() < 0.4 ? 1 : 0);
        let s = '';
        for (let i = 0; i < n; i++) s += SYL[(this.rng() * SYL.length) | 0];
        const name = s + ' ' + SUFFIX[(this.rng() * SUFFIX.length) | 0];
        if (!this.usedNames.has(name)) { this.usedNames.add(name); return name; }
      }
      return '이름없는 나라 ' + this.players.length;
    }

    addPlayer({ name, color, isBot = true, difficulty = 'normal' } = {}) {
      const id = this.players.length;
      if (!color) {
        const h = (id * 137.508 + 20) % 360;
        color = hsl(h, 0.62, 0.52 + ((id % 3) - 1) * 0.08);
      }
      const p = {
        id, name: name || this.randName(), color, isBot, diff: difficulty,
        alive: true, spawned: false, tiles: 0, troops: 1200, gold: 0,
        bbox: [this.w, this.h, -1, -1], counts: Object.fromEntries(Object.keys(BUILD).map(k => [k, 0])), popCap: 0, goldIncome: BASE_GOLD,
        label: null, spawnTile: -1, deadTick: -1, nextThink: 0, peakTiles: 0,
      };
      this.players.push(p);
      return id;
    }

    // 최대 인구·금 수입은 건물에서만 나온다 (recalcEconomy 가 매 틱 계산)
    maxTroops(p) { return BASE_POP + (p.popCap || 0); }
    growth(p) { return 8 + this.maxTroops(p) * 0.005; }
    goldRate(p) { return p.goldIncome != null ? p.goldIncome : BASE_GOLD; }
    recalcEconomy() {
      const allyN = new Map();
      for (const k of this.alliances.keys()) {
        const a = Math.floor(k / 4096), b = k % 4096;
        if (this.players[a].alive && this.players[b].alive) { allyN.set(a, (allyN.get(a) || 0) + 1); allyN.set(b, (allyN.get(b) || 0) + 1); }
      }
      for (const p of this.players) { p.popCap = 0; p.goldIncome = BASE_GOLD; }
      const markets = new Map(); // 주인 → 시장들
      for (const s of this.structures) if (s.type === 'market' && s.owner >= 0) { if (!markets.has(s.owner)) markets.set(s.owner, []); markets.get(s.owner).push(s); }
      const R2 = MARKET_RADIUS * MARKET_RADIUS;
      for (const s of this.structures) {
        if (s.owner < 0) continue;
        const p = this.players[s.owner], b = BUILD[s.type];
        if (b.pop) p.popCap += b.pop;
        let g = b.gold || 0;
        const mk = markets.get(s.owner);
        if (g && mk && PRODUCERS[s.type] && mk.some(m => (m.x - s.x) ** 2 + (m.y - s.y) ** 2 <= R2)) g *= 1 + MARKET_BONUS;
        p.goldIncome += g;
      }
    }
    maxBoats(p) { return MAX_BOATS + Math.min(5, p.counts.port || 0); }
    cost(p, type) {
      if (type === 'missile') return MISSILE_COST;
      if (type === 'warship') return Math.round(SHIP.warCost * Math.pow(SHIP.warGrow, this.warships(p.id).length));
      const b = BUILD[type];
      return Math.round(b.base * Math.pow(b.grow, p.counts[type]));
    }

    setOwner(t, o) {
      const old = this.owner[t];
      if (old === o) return;
      if (old >= 0) this.players[old].tiles--;
      this.owner[t] = o;
      if (o >= 0) {
        const p = this.players[o];
        p.tiles++;
        if (p.tiles > p.peakTiles) p.peakTiles = p.tiles;
        const x = t % this.w, y = (t / this.w) | 0, b = p.bbox;
        if (x < b[0]) b[0] = x; if (y < b[1]) b[1] = y;
        if (x > b[2]) b[2] = x; if (y > b[3]) b[3] = y;
      }
      this.dirty.push(t);
      if (this.netDirty) this.netDirty.push(t);
      const s = this.structAt.get(t);
      if (s) {
        if (s.owner >= 0) this.players[s.owner].counts[s.type]--;
        if (o < 0) { this.removeStructure(s); }
        else {
          if (s.type === 'capital') {
            s.type = 'city';
            if (s.owner >= 0) this.log(`🏰 ${this.players[s.owner].name}의 수도가 ${this.players[o].name}에게 함락됐어요!`, 'big', [o, s.owner]);
          }
          s.owner = o; this.players[o].counts[s.type]++;
          this.structVer++;
        }
      }
    }

    // 건물 발자국 칸 표시/지우기
    markFootprint(s, v) {
      this.structVer++;
      for (let dy = -s.half; dy <= s.half; dy++) for (let dx = -s.half; dx <= s.half; dx++) {
        const x = s.x + dx, y = s.y + dy;
        if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.occ[y * this.w + x] = v;
      }
    }
    removeStructure(s) {
      this.markFootprint(s, 0);
      this.structAt.delete(s.tile);
      const i = this.structures.indexOf(s);
      if (i >= 0) this.structures.splice(i, 1);
    }

    adjacentTo(t, pid) {
      const w = this.w, x = t % w, o = this.owner;
      return (x > 0 && o[t - 1] === pid) || (x < w - 1 && o[t + 1] === pid) ||
        (t >= w && o[t - w] === pid) || (t + w < this.N && o[t + w] === pid);
    }
    neighbors(t, out) {
      const w = this.w, x = t % w;
      out.length = 0;
      if (x > 0) out.push(t - 1);
      if (x < w - 1) out.push(t + 1);
      if (t >= w) out.push(t - w);
      if (t + w < this.N) out.push(t + w);
      return out;
    }

    // 한 나라의 국경 정보: 이웃별 맞닿은 칸 수, 해안 여부
    // maxAge 틱 안에 잰 결과가 있으면 다시 쓴다 (컴퓨터 판단용)
    scanBorder(pid, maxAge = 0) {
      const p = this.players[pid];
      if (maxAge > 0 && p._sb && this.tick - p._sbTick <= maxAge) return p._sb;
      const r = this._scanBorder(pid);
      p._sb = r; p._sbTick = this.tick;
      return r;
    }
    _scanBorder(pid) {
      const p = this.players[pid], b = p.bbox, w = this.w, h = this.h, o = this.owner, ter = this.ter;
      const cnt = new Int32Array(this.players.length + 1); // [주인 id + 1]
      let coastal = false;
      for (let y = b[1]; y <= b[3]; y++) {
        for (let x = b[0], t = y * w + b[0]; x <= b[2]; x++, t++) {
          if (o[t] !== pid) continue;
          let n;
          if (x > 0) { n = t - 1; if (!ter[n]) coastal = true; else if (o[n] !== pid) cnt[o[n] + 1]++; }
          if (x < w - 1) { n = t + 1; if (!ter[n]) coastal = true; else if (o[n] !== pid) cnt[o[n] + 1]++; }
          if (y > 0) { n = t - w; if (!ter[n]) coastal = true; else if (o[n] !== pid) cnt[o[n] + 1]++; }
          if (y < h - 1) { n = t + w; if (!ter[n]) coastal = true; else if (o[n] !== pid) cnt[o[n] + 1]++; }
        }
      }
      const counts = new Map();
      for (let i = 0; i < cnt.length; i++) if (cnt[i]) counts.set(i - 1, cnt[i]);
      return { counts, coastal };
    }

    // ---------- 시작 위치 ----------
    spawnPlayer(pid, tile) {
      if (this.phase !== 'spawn') return false;
      const p = this.players[pid];
      if (!this.ter[tile] || this.owner[tile] !== NEUTRAL) {
        if (this.owner[tile] !== pid) return false;
      }
      // 다른 나라와 너무 가까우면 안 됨
      const [sx, sy] = this.xy(tile);
      for (const q of this.players) {
        if (q === p || !q.spawned) continue;
        const [qx, qy] = this.xy(q.spawnTile);
        if (Math.hypot(qx - sx, qy - sy) < 9) return false;
      }
      if (p.spawned) { // 다시 고르기: 이전 땅 비우기
        for (let t = 0; t < this.N; t++) if (this.owner[t] === pid) this.setOwner(t, NEUTRAL);
        p.bbox = [this.w, this.h, -1, -1];
      }
      const R = 3;
      for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
        if (dx * dx + dy * dy > R * R + 1) continue;
        const x = sx + dx, y = sy + dy;
        if (x < 0 || y < 0 || x >= this.w || y >= this.h) continue;
        const t = y * this.w + x;
        if (this.ter[t] && this.owner[t] === NEUTRAL) this.setOwner(t, pid);
      }
      p.spawned = true;
      p.spawnTile = tile;
      return true;
    }

    landAround(tile, r) {
      const [sx, sy] = this.xy(tile);
      let c = 0;
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        const x = sx + dx, y = sy + dy;
        if (x < 0 || y < 0 || x >= this.w || y >= this.h) continue;
        if (this.ter[y * this.w + x]) c++;
      }
      return c;
    }

    randomSpawn(pid) {
      for (let k = 0; k < 400; k++) {
        const t = (this.rng() * this.N) | 0;
        if (!this.ter[t] || this.owner[t] !== NEUTRAL) continue;
        if (this.ter[t] === 3 || this.ter[t] === 5) continue;
        if (this.landAround(t, 6) < 100) continue;
        if (this.spawnPlayer(pid, t)) return true;
      }
      return false;
    }

    // ---------- 공격 ----------
    // 한 칸을 빼앗는 데 드는 병력: 빈 땅은 5, 나라 땅은 (그 나라 칸당 병력 × 1.1 + 3). 지형·요새 배수
    tileCost(def, t) {
      const tc = TER[this.ter[t]].cost;
      if (def < 0) return 5 * tc;
      const dp = this.players[def];
      const dens = dp.troops / Math.max(1, dp.tiles);
      return (dens * 1.1 + 3) * tc * this.fortMul(def, t);
    }
    // 방어 쪽이 칸을 잃을 때 그 칸에 있던 병력도 잃는다
    defLoss(def, loss) {
      const dp = this.players[def];
      dp.troops = Math.max(0, dp.troops - loss);
    }
    fortMul(def, t) {
      if (def < 0 || this.players[def].counts.fort === 0) return 1;
      const x = t % this.w, y = (t / this.w) | 0;
      for (const s of this.structures) {
        if (s.type !== 'fort' || s.owner !== def) continue;
        const dx = s.x - x, dy = s.y - y;
        if (dx * dx + dy * dy <= FORT_RADIUS * FORT_RADIUS) return 2;
      }
      return 1;
    }

    findAttack(att, def) {
      for (const a of this.attacks) if (a.att === att && a.def === def) return a;
      return null;
    }
    incomingAttacks(pid) { return this.attacks.filter(a => a.def === pid); }
    outgoingAttacks(pid) { return this.attacks.filter(a => a.att === pid); }

    pushFront(a, t) {
      const nb = this._nb || (this._nb = []);
      let nAtt = 0;
      this.neighbors(t, nb);
      for (const n of nb) if (this.owner[n] === a.att) nAtt++;
      let d = (1 + this.rng() * 2.5) * TER[this.ter[t]].delay * (a.def >= 0 ? 1.25 : 0.8) * (1.3 - 0.15 * nAtt);
      if (a.def >= 0 && this.fortMul(a.def, t) > 1) d *= 1.6;
      a.front.add(t);
      a.heap.push(this.tick + d, t);
    }

    buildFront(a) {
      const p = this.players[a.att], b = p.bbox, w = this.w, h = this.h, o = this.owner, ter = this.ter;
      const att = a.att, def = a.def, f = a.front;
      for (let y = b[1]; y <= b[3]; y++) {
        for (let x = b[0], t = y * w + b[0]; x <= b[2]; x++, t++) {
          if (o[t] !== att) continue;
          let n;
          if (x > 0) { n = t - 1; if (o[n] === def && ter[n] && !f.has(n)) this.pushFront(a, n); }
          if (x < w - 1) { n = t + 1; if (o[n] === def && ter[n] && !f.has(n)) this.pushFront(a, n); }
          if (y > 0) { n = t - w; if (o[n] === def && ter[n] && !f.has(n)) this.pushFront(a, n); }
          if (y < h - 1) { n = t + w; if (o[n] === def && ter[n] && !f.has(n)) this.pushFront(a, n); }
        }
      }
    }

    // troops 는 이미 공격자에게서 빠진 상태로 넘겨야 한다
    startAttack(att, def, troops) {
      if (att === def || troops <= 0) return null;
      const ap = this.players[att];
      this._lastCancel = false;
      if (def >= 0 && (!this.players[def].alive || this.allied(att, def))) { ap.troops += troops; return null; }
      // 맞공격이면 서로 깎는다
      if (def >= 0) {
        const opp = this.findAttack(def, att);
        if (opp) {
          const m = Math.min(troops, opp.pool);
          troops -= m; opp.pool -= m;
          this._lastCancel = true;
          if (opp.pool <= 0.5) this.endAttack(opp);
          if (troops <= 0.5) return null;
        }
      }
      let a = this.findAttack(att, def);
      if (a) { a.pool += troops; this.buildFront(a); return a; }
      a = { att, def, pool: troops, startPool: troops, front: new Set(), heap: new Heap(), started: this.tick };
      this.buildFront(a);
      if (a.heap.size === 0) { ap.troops += troops; return null; }
      this.attacks.push(a);
      if (def >= 0) this.log(`${ap.name} → ${this.players[def].name} 공격 (${fmt(troops)})`, 'attack', [att, def]);
      return a;
    }

    endAttack(a, refund = true) {
      const i = this.attacks.indexOf(a);
      if (i >= 0) this.attacks.splice(i, 1);
      if (refund && a.pool > 0) this.players[a.att].troops += a.pool;
      a.pool = 0;
    }

    processAttack(a) {
      const o = this.owner, nb = [];
      let n = 0;
      // 보낸 병력이 남아 있는 동안 계속 칸을 빼앗는다 (칸마다 병력 소모)
      while (a.heap.size && a.heap.peek() <= this.tick && n < 400) {
        const t = a.heap.pop();
        a.front.delete(t);
        if (o[t] !== a.def || !this.adjacentTo(t, a.att)) continue;
        const c = this.tileCost(a.def, t) * this.attackMul(a.att, a.def);
        if (a.pool < c) { this.endAttack(a); return; }
        a.pool -= c;
        if (a.def >= 0) {
          const dp = this.players[a.def];
          this.defLoss(a.def, dp.troops / Math.max(1, dp.tiles));
        }
        this.setOwner(t, a.att);
        n++;
        this.neighbors(t, nb);
        for (const m of nb) if (this.ter[m] && o[m] === a.def && !a.front.has(m)) this.pushFront(a, m);
      }
      if (a.heap.size === 0) this.endAttack(a);
    }

    // 사람이 땅을 눌렀을 때: 맞닿아 있으면 땅 공격, 아니면 배
    // 돌려주는 값: 'land' | 'boat' | 실패 이유 문자열
    orderAttack(pid, tile, ratio) {
      const p = this.players[pid];
      if (this.phase !== 'play' || !p.alive) return '지금은 공격할 수 없어요';
      if (!this.ter[tile]) return '바다는 공격할 수 없어요';
      const def = this.owner[tile];
      if (def === pid) return '내 땅이에요';
      if (this.allied(pid, def)) return '동맹 나라예요 (오른쪽 클릭 → 동맹 끊기)';
      const troops = Math.floor(p.troops * ratio);
      if (troops < 1) return '병력이 부족해요';
      if (this.reachableByLand(pid, tile)) {
        p.troops -= troops;
        return this.startAttack(pid, def, troops) || this._lastCancel ? 'land' : '공격할 국경이 없어요';
      }
      return this.sendBoat(pid, tile, troops) ? 'boat' : (this.boats.filter(b => b.owner === pid).length >= this.maxBoats(p) ? `배는 동시에 ${this.maxBoats(p)}척까지예요 (항구를 지으면 늘어요)` : '배로 갈 수 없는 곳이에요');
    }

    // 누른 칸과 같은 주인의 이어진 땅이 내 땅과 맞닿아 있나?
    reachableByLand(pid, tile) {
      const def = this.owner[tile], o = this.owner, ter = this.ter;
      const st = ++this._stampV, stamp = this._stamp, q = this._q, nb = [];
      let h = 0, tl = 0;
      q[tl++] = tile; stamp[tile] = st;
      while (h < tl) {
        const t = q[h++];
        this.neighbors(t, nb);
        for (const n of nb) {
          if (!ter[n] || stamp[n] === st) continue;
          if (o[n] === pid) return true;
          if (o[n] !== def) continue;
          stamp[n] = st; q[tl++] = n;
        }
      }
      return false;
    }

    // ---------- 배 ----------
    sendBoat(pid, tile, troops) {
      const p = this.players[pid];
      if (this.boats.filter(b => b.owner === pid).length >= this.maxBoats(p)) return false;
      tile = this.nearestCoast(pid, tile);
      if (tile < 0) return false;
      const path = this.boatPath(pid, tile);
      if (!path) return false;
      p.troops -= troops;
      this.boats.push({ owner: pid, troops, path, pos: 0, dest: tile });
      const def = this.owner[tile];
      if (def >= 0) this.log(`${p.name}의 배가 ${this.players[def].name}(으)로 출발 (${fmt(troops)})`, 'boat', [pid, def]);
      return true;
    }

    // 누른 칸에서 가장 가까운 (내 땅이 아닌) 해안 칸
    nearestCoast(pid, tile) {
      const o = this.owner, ter = this.ter, q = this._q, stamp = this._stamp, nb = [];
      const st = ++this._stampV;
      let h = 0, tl = 0;
      q[tl++] = tile; stamp[tile] = st;
      while (h < tl && h < 20000) {
        const t = q[h++];
        this.neighbors(t, nb);
        if (o[t] !== pid && nb.some(n => !ter[n])) return t;
        for (const n of nb) {
          if (!ter[n] || stamp[n] === st) continue;
          stamp[n] = st; q[tl++] = n;
        }
      }
      return -1;
    }

    boatPath(pid, tile) {
      const o = this.owner, ter = this.ter, q = this._q, prev = this._prev, stamp = this._stamp, nb = [];
      const st = ++this._stampV;
      let h = 0, tl = 0;
      this.neighbors(tile, nb);
      for (const n of nb) if (!ter[n]) { q[tl++] = n; stamp[n] = st; prev[n] = -1; }
      const w = this.w, N = this.N;
      while (h < tl) {
        const t = q[h++], x = t % w;
        for (let k = 0; k < 4; k++) {
          let n;
          if (k === 0) { if (x === 0) continue; n = t - 1; }
          else if (k === 1) { if (x === w - 1) continue; n = t + 1; }
          else if (k === 2) { n = t - w; if (n < 0) continue; }
          else { n = t + w; if (n >= N) continue; }
          if (ter[n]) {
            if (o[n] === pid) { // 도착(=출발 항구)
              const path = [];
              for (let c = t; c !== -1; c = prev[c]) path.push(c);
              return path; // 내 쪽 바다 → 목표 쪽 바다
            }
            continue;
          }
          if (stamp[n] === st) continue;
          stamp[n] = st; prev[n] = t; q[tl++] = n;
        }
      }
      return null;
    }

    // ---------- 무역선 · 전함 ----------
    warships(pid) { return this.ships.filter(x => x.kind === 'war' && x.owner === pid); }
    traders(pid) { return this.ships.filter(x => x.kind === 'trade' && x.owner === pid); }
    // 큰 바다(작은 호수 말고)인 바다 칸인가
    isSea(t) { return t >= 0 && !this.ter[t] && this.seaSize[this.seaId[t]] >= 300; }
    // 항구가 배를 띄우는 바다 칸
    portDock(st) {
      if (st.dock !== undefined) return st.dock;
      st.dock = -1;
      for (let dy = -st.half; dy <= st.half && st.dock < 0; dy++) for (let dx = -st.half; dx <= st.half; dx++) {
        const x = st.x + dx, y = st.y + dy;
        if (x < 0 || y < 0 || x >= this.w || y >= this.h) continue;
        const t = y * this.w + x;
        for (const n of [x > 0 ? t - 1 : -1, x < this.w - 1 ? t + 1 : -1, y > 0 ? t - this.w : -1, y < this.h - 1 ? t + this.w : -1]) {
          if (n >= 0 && this.isSea(n)) { st.dock = n; break; }
        }
        if (st.dock >= 0) break;
      }
      return st.dock;
    }
    ownPorts(pid) { return this.structures.filter(st => st.owner === pid && st.type === 'port' && this.portDock(st) >= 0); }
    nearestOwnPort(pid, tile) {
      const [x, y] = this.xy(tile);
      let best = null, bd = 1e18;
      for (const st of this.ownPorts(pid)) { const d = (st.x - x) ** 2 + (st.y - y) ** 2; if (d < bd) { bd = d; best = st; } }
      return best;
    }
    // 바다 칸 from → to 길 (바다로만). cache 면 저장해 두고 다시 씀. maxNodes 로 찾는 범위 제한
    waterPath(from, to, cache = false, maxNodes = Infinity) {
      if (from === to) return [from];
      if (this.ter[from] || this.ter[to] || this.seaId[from] !== this.seaId[to]) return null;
      const key = from * this.N + to;
      if (cache && this._pathCache.has(key)) return this._pathCache.get(key);
      // 목표 쪽을 먼저 살피는 길찾기(A*). 거리 추정에 1.2 를 곱해 조금 더 곧장 간다
      const ter = this.ter, prev = this._prev, seen = this._stamp, w = this.w, N = this.N;
      const closed = this._closed || (this._closed = new Uint32Array(N));
      const gs = this._gs || (this._gs = new Float32Array(N));
      const st = ++this._stampV;
      const tx = to % w, ty = (to / w) | 0;
      const est = t => (Math.abs(t % w - tx) + Math.abs(((t / w) | 0) - ty)) * 1.2;
      const heap = new Heap();
      heap.push(est(from), from); seen[from] = st; gs[from] = 0; prev[from] = -1;
      let found = false, expanded = 0;
      while (heap.size) {
        const t = heap.pop();
        if (closed[t] === st) continue;
        closed[t] = st;
        if (t === to) { found = true; break; }
        if (++expanded > maxNodes) break;
        const x = t % w, ng = gs[t] + 1;
        for (let k = 0; k < 4; k++) {
          let n;
          if (k === 0) { if (x === 0) continue; n = t - 1; }
          else if (k === 1) { if (x === w - 1) continue; n = t + 1; }
          else if (k === 2) { n = t - w; if (n < 0) continue; }
          else { n = t + w; if (n >= N) continue; }
          if (ter[n] || closed[n] === st) continue;
          if (seen[n] !== st || ng < gs[n]) { seen[n] = st; gs[n] = ng; prev[n] = t; heap.push(ng + est(n), n); }
        }
      }
      let path = null;
      if (found) {
        path = [];
        for (let c = to; c !== -1; c = prev[c]) path.push(c);
        path.reverse();
      }
      if (cache) this._pathCache.set(key, path);
      return path;
    }
    // 무역선 띄우기: 다른 나라 항구로 갔다가 돌아온다
    spawnTrade(st) {
      const from = this.portDock(st);
      if (from < 0) return null;
      const sea = this.seaId[from];
      // 같은 바다의 다른 나라 항구 중 가까운 6곳 (멀리 있는 길은 계산이 무거움)
      const [fx, fy] = this.xy(from);
      const cands = this.structures.filter(d => d.type === 'port' && d.owner >= 0 && d.owner !== st.owner && this.players[d.owner].alive && this.portDock(d) >= 0 && this.seaId[d.dock] === sea)
        .map(d => { const [x, y] = this.xy(d.dock); return [d, (x - fx) ** 2 + (y - fy) ** 2]; })
        .sort((a, b) => a[1] - b[1]).slice(0, 6).map(e => e[0]);
      if (!cands.length) return null;
      let tw = 0;
      // 동맹 항구를 더 좋아하고, 적대 전함이 지키는 항구는 피한다
      const ws = cands.map(d => {
        let v = this.allied(st.owner, d.owner) ? 3 : 1;
        const [dx, dy] = this.xy(d.dock);
        let danger = 0;
        for (const o of this.ships) if (o.kind === 'war' && o.owner !== st.owner && !this.allied(o.owner, st.owner)) { const [ox, oy] = this.shipXY(o); if ((ox - dx) ** 2 + (oy - dy) ** 2 <= 144) danger++; }
        v /= 1 + danger * 6;
        tw += v; return v;
      });
      let r = this.rng() * tw, dest = cands[0];
      for (let i = 0; i < cands.length; i++) { r -= ws[i]; if (r <= 0) { dest = cands[i]; break; } }
      const path = this.waterPath(from, dest.dock, true);
      if (!path || path.length < 2) return null;
      const L = path.length;
      const value = Math.round((SHIP.tradeBase + L * SHIP.tradePerTile) * (this.allied(st.owner, dest.owner) ? SHIP.tradeAlly : 1));
      const sh = { id: ++this._shipId, kind: 'trade', owner: st.owner, home: st, dest, path: path.concat(path.slice(0, -1).reverse()), half: L - 1, pos: 0, tile: from, value, paidHost: false, speed: SHIP.tradeSpeed };
      this.ships.push(sh);
      return sh;
    }
    // 전함 만들기: 내 항구 중 그 바다로 갈 수 있는 가장 가까운 곳에서 나와 그 근처를 지킨다
    buildWarship(pid, tile) {
      const p = this.players[pid];
      if (this.phase !== 'play' || !p.alive) return '지금은 만들 수 없어요';
      if (tile < 0 || this.ter[tile]) return '바다를 눌러서 전함이 지킬 곳을 정하세요';
      const ports = this.ownPorts(pid).filter(st => this.seaId[st.dock] === this.seaId[tile]);
      if (!ports.length && this.ownPorts(pid).length) return '내 항구와 이어지지 않은 바다예요';
      if (!ports.length) return '항구가 있어야 전함을 만들 수 있어요';
      if (p.gold < this.cost(p, 'warship')) return '금이 부족해요';
      const [x, y] = this.xy(tile);
      ports.sort((a, b) => ((a.x - x) ** 2 + (a.y - y) ** 2) - ((b.x - x) ** 2 + (b.y - y) ** 2));
      for (const st of ports.slice(0, 4)) {
        const path = this.waterPath(st.dock, tile);
        if (!path) continue;
        p.gold -= this.cost(p, 'warship');
        const sh = { id: ++this._shipId, kind: 'war', owner: pid, hp: SHIP.warHp, maxHp: SHIP.warHp, center: tile, path, pos: 0, tile: st.dock, state: 'go', speed: SHIP.warSpeed, chasing: false };
        this.ships.push(sh);
        return null;
      }
      return '내 항구에서 그 바다까지 갈 수 없어요';
    }
    // 전함이 지킬 곳 바꾸기
    setPatrol(pid, shipId, tile) {
      const sh = this.ships.find(x => x.id === shipId && x.kind === 'war');
      if (!sh || sh.owner !== pid) return '내 전함이 아니에요';
      if (tile < 0 || this.ter[tile]) return '바다를 눌러야 해요';
      if (this.seaId[tile] !== this.seaId[sh.tile]) return '이어지지 않은 바다예요';
      const path = this.waterPath(sh.tile, tile);
      if (!path) return '그 바다까지 갈 수 없어요';
      sh.center = tile;
      if (sh.state === 'return' || sh.state === 'repair') return null; // 수리 끝나면 그리로 간다
      sh.path = path; sh.pos = 0; sh.state = 'go'; sh.chasing = false;
      return null;
    }
    shipXY(sh) { return [sh.tile % this.w, (sh.tile / this.w) | 0]; }
    // 한 칸씩 목표 쪽 바다로 (추격용)
    stepToward(sh, tx, ty) {
      const t = sh.tile, x = t % this.w, y = (t / this.w) | 0;
      let best = t, bd = (x - tx) ** 2 + (y - ty) ** 2;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= this.w || ny >= this.h) continue;
        const n = ny * this.w + nx;
        if (this.ter[n]) continue;
        const d = (nx - tx) ** 2 + (ny - ty) ** 2;
        if (d < bd) { bd = d; best = n; }
      }
      sh.tile = best;
    }
    removeShip(sh) { const i = this.ships.indexOf(sh); if (i >= 0) this.ships.splice(i, 1); }
    // 전함 공격 한 번
    fire(sh, tgt, isBoat) {
      const me = this.players[sh.owner];
      if (isBoat) { // 병력 실은 침공 배
        tgt.troops -= Math.max(200, tgt.troops * 0.08);
        if (tgt.troops < 1) {
          const i = this.boats.indexOf(tgt); if (i >= 0) this.boats.splice(i, 1);
          this.log(`⚓ ${me.name}의 전함이 ${this.players[tgt.owner].name}의 침공 배를 침몰시켰어요`, 'boat', [sh.owner, tgt.owner]);
        }
        return;
      }
      const vic = this.players[tgt.owner];
      if (tgt.kind === 'trade') {
        this.removeShip(tgt);
        me.gold += tgt.value;
        this.log(`🏴 ${vic.name}의 무역선이 ${me.name}의 전함에 털렸어요 (금 ${fmt(tgt.value)})`, 'boat', [tgt.owner, sh.owner]);
        return;
      }
      tgt.hp -= SHIP.warDmg;
      if (tgt.hp <= 0) {
        this.removeShip(tgt);
        this.log(`💥 ${me.name}의 전함이 ${vic.name}의 전함을 격침했어요`, 'boat', [sh.owner, tgt.owner]);
      }
    }
    processShips() {
      // 항구마다 무역선 출발
      for (const st of this.structures) {
        if (st.type !== 'port' || st.owner < 0) continue;
        if (this.tick < (st.nextTrade || 0)) continue;
        st.nextTrade = this.tick + SHIP.tradeEvery + ((this.rng() * 40) | 0);
        if (this.ships.filter(x => x.kind === 'trade' && x.home === st).length < SHIP.tradePerPort) this.spawnTrade(st);
      }
      // 항구 포대: 항구 앞 바다로 온 적 전함을 쏜다
      const G2 = SHIP.portGunRange * SHIP.portGunRange;
      for (const st of this.structures) {
        if (st.type !== 'port' || st.owner < 0 || st.dock < 0 || st.dock === undefined) continue;
        const [px, py] = this.xy(st.dock);
        let tgt = null, td = 1e18;
        for (const o of this.ships) {
          if (o.kind !== 'war' || o.owner === st.owner || this.allied(o.owner, st.owner)) continue;
          const [ox, oy] = this.shipXY(o), d = (ox - px) ** 2 + (oy - py) ** 2;
          if (d <= G2 && d < td) { td = d; tgt = o; }
        }
        if (tgt) {
          tgt.hp -= SHIP.portGunDmg;
          if (tgt.hp <= 0) { this.removeShip(tgt); this.log(`💥 ${this.players[st.owner].name}의 항구 포대가 ${this.players[tgt.owner].name}의 전함을 격침했어요`, 'boat', [st.owner, tgt.owner]); }
        }
      }
      const R2 = SHIP.warRange * SHIP.warRange, S2 = SHIP.warSight * SHIP.warSight;
      for (const sh of this.ships.slice()) {
        if (!this.ships.includes(sh)) continue; // 이번 틱에 이미 가라앉음
        if (sh.kind === 'trade') {
          sh.pos += sh.speed;
          sh.tile = sh.path[Math.min(sh.path.length - 1, Math.floor(sh.pos))];
          if (!sh.paidHost && sh.pos >= sh.half) { // 상대 항구에 들름: 그 나라도 조금 번다
            sh.paidHost = true;
            if (sh.dest.owner >= 0 && this.players[sh.dest.owner].alive) this.players[sh.dest.owner].gold += sh.value * SHIP.tradeHost;
          }
          if (sh.pos >= sh.path.length - 1) {
            this.removeShip(sh);
            const p = this.players[sh.owner];
            if (p.alive && sh.home.owner === sh.owner && this.structures.includes(sh.home)) {
              p.gold += sh.value;
              p.tradeLog = (p.tradeLog || []).filter(e => this.tick - e[0] < 600);
              p.tradeLog.push([this.tick, sh.value]);
            }
          }
          continue;
        }
        // ----- 전함 -----
        if (sh.state === 'repair') {
          // 적 전함이 가까이 있으면 수리 멈춤 (항구 포대가 대신 쏴 줌)
          const [rx, ry] = this.shipXY(sh);
          const threat = this.ships.some(o => o.kind === 'war' && o.owner !== sh.owner && !this.allied(o.owner, sh.owner) && (() => { const [ox, oy] = this.shipXY(o); return (ox - rx) ** 2 + (oy - ry) ** 2 <= SHIP.warSight * SHIP.warSight; })());
          if (!threat) sh.hp = Math.min(sh.maxHp, sh.hp + SHIP.warRepair);
          if (sh.hp >= sh.maxHp) { sh.state = 'go'; sh.path = this.waterPath(sh.tile, sh.center); sh.pos = 0; }
          continue;
        }
        if (sh.state !== 'return' && sh.hp < sh.maxHp * SHIP.retreatAt) {
          const port = this.nearestOwnPort(sh.owner, sh.tile);
          const path = port && this.waterPath(sh.tile, port.dock);
          if (path) { sh.state = 'return'; sh.path = path; sh.pos = 0; sh.chasing = false; }
        }
        // 가까운 적 찾기 (동맹·속국·내 배는 빼고)
        let tgt = null, td = 1e18, tBoat = false;
        if (sh.state !== 'return') {
          const [x, y] = this.shipXY(sh);
          for (const o of this.ships) {
            if (o === sh || o.owner === sh.owner || this.allied(o.owner, sh.owner)) continue;
            const [ox, oy] = this.shipXY(o), d = (ox - x) ** 2 + (oy - y) ** 2;
            if (d <= S2 && d < td) { td = d; tgt = o; tBoat = false; }
          }
          for (const b of this.boats) {
            if (b.owner === sh.owner || this.allied(b.owner, sh.owner)) continue;
            const t = b.path[Math.min(b.path.length - 1, Math.floor(b.pos))];
            const bx = t % this.w, by = (t / this.w) | 0, d = (bx - x) ** 2 + (by - y) ** 2;
            if (d <= S2 && d < td) { td = d; tgt = b; tBoat = true; }
          }
        }
        if (tgt) {
          if (td <= R2) this.fire(sh, tgt, tBoat);
          else {
            const t = tBoat ? tgt.path[Math.min(tgt.path.length - 1, Math.floor(tgt.pos))] : tgt.tile;
            this.stepToward(sh, t % this.w, (t / this.w) | 0);
          }
          sh.chasing = true; sh.path = null;
          continue;
        }
        if (sh.chasing) { sh.chasing = false; sh.path = this.waterPath(sh.tile, sh.center); sh.pos = 0; }
        if (sh.path && sh.pos < sh.path.length - 1) {
          sh.pos += sh.speed;
          sh.tile = sh.path[Math.min(sh.path.length - 1, Math.floor(sh.pos))];
          continue;
        }
        if (sh.state === 'return') { sh.state = 'repair'; continue; }
        // 지킬 곳 근처를 배회
        sh.state = 'patrol';
        const [cx, cy] = [sh.center % this.w, (sh.center / this.w) | 0];
        sh.path = null;
        // 지킬 곳 둘레 원 안의 바다로, 멀리 돌아가야 하는 곳은 빼고
        const [sx0, sy0] = this.shipXY(sh);
        if (this.tick < (sh.idleUntil || 0)) continue;
        if ((sx0 - cx) ** 2 + (sy0 - cy) ** 2 > (SHIP.patrolR * 1.5) ** 2) { // 너무 멀어졌으면 먼저 돌아간다
          sh.path = this.waterPath(sh.tile, sh.center); sh.pos = 0;
          if (!sh.path) sh.idleUntil = this.tick + 30;
          continue;
        }
        for (let k = 0; k < 6; k++) {
          const ang = this.rng() * Math.PI * 2, rad = Math.sqrt(this.rng()) * SHIP.patrolR;
          const nx = Math.round(cx + Math.cos(ang) * rad), ny = Math.round(cy + Math.sin(ang) * rad);
          if (nx < 0 || ny < 0 || nx >= this.w || ny >= this.h) continue;
          const n = ny * this.w + nx;
          if (this.ter[n] || n === sh.tile) continue;
          const path = this.waterPath(sh.tile, n, false, 400);
          if (path && path.length <= Math.hypot(nx - sx0, ny - sy0) * 1.8 + 4) { sh.path = path; sh.pos = 0; break; }
        }
        if (!sh.path) sh.idleUntil = this.tick + 10;
      }
    }

    processBoats() {
      for (let i = this.boats.length - 1; i >= 0; i--) {
        const b = this.boats[i];
        b.pos += BOAT_SPEED;
        if (b.pos < b.path.length - 1) continue;
        this.boats.splice(i, 1);
        const p = this.players[b.owner];
        if (!p.alive) continue;
        const def = this.owner[b.dest];
        if (def === b.owner || this.allied(b.owner, def)) { p.troops += b.troops; continue; }
        const c = this.tileCost(def, b.dest) * this.attackMul(b.owner, def);
        if (b.troops < c) { this.log(`${p.name}의 상륙이 실패했어요`, 'boat', [b.owner, def]); continue; }
        b.troops -= c;
        if (def >= 0) { const dp = this.players[def]; this.defLoss(def, dp.troops / Math.max(1, dp.tiles)); }
        this.setOwner(b.dest, b.owner);
        if (!this.startAttack(b.owner, def, b.troops)) { /* 남은 병력은 startAttack 이 돌려줌 */ }
      }
    }

    // ---------- 건물 · 미사일 ----------
    // 칸을 덮고 있는 건물 (건물은 정사각형 여러 칸을 차지한다)
    structureAt(t) {
      const x = t % this.w, y = (t / this.w) | 0;
      for (const s of this.structures) if (Math.abs(s.x - x) <= s.half && Math.abs(s.y - y) <= s.half) return s;
      return null;
    }
    // 돌려주는 값: null(지을 수 있음) 또는 이유
    canBuild(pid, type, tile) {
      const p = this.players[pid], b = BUILD[type];
      if (this.phase !== 'play' || !p.alive) return '지금은 지을 수 없어요';
      if (!b || b.buildable === false) return '지을 수 없는 건물이에요';
      if (tile < 0) return '지도 밖이에요';
      if (b.upgradeOf) {
        const s = this.structureAt(tile);
        if (!s || s.owner !== pid || s.type !== b.upgradeOf) return `내 ${BUILD[b.upgradeOf].name}을(를) 눌러야 ${b.name}(으)로 바꿀 수 있어요`;
        return p.gold < this.cost(p, type) ? '금이 부족해요' : null;
      }
      const cx = tile % this.w, cy = (tile / this.w) | 0, h = (b.size - 1) / 2;
      if (cx - h < 0 || cy - h < 0 || cx + h >= this.w || cy + h >= this.h) return '지도 끝이라 지을 수 없어요';
      let plains = 0, rough = 0, mtn = 0, coast = false;
      for (let dy = -h; dy <= h; dy++) for (let dx = -h; dx <= h; dx++) {
        const t = (cy + dy) * this.w + cx + dx, tt = this.ter[t];
        if (!tt) return `바다가 섞여 있어요 (${b.size}×${b.size}칸이 모두 땅이어야 해요)`;
        if (this.owner[t] !== pid) return `${b.size}×${b.size}칸이 모두 내 땅이어야 해요`;
        if (tt === 1) plains++;
        if (tt === 2 || tt === 3) rough++;
        if (tt === 3) mtn++;
        if (!coast) {
          const x = cx + dx, y = cy + dy;
          if ((x > 0 && this.isSea(t - 1)) || (x < this.w - 1 && this.isSea(t + 1)) || (y > 0 && this.isSea(t - this.w)) || (y < this.h - 1 && this.isSea(t + this.w))) coast = true;
        }
      }
      for (let dy = -h; dy <= h; dy++) for (let dx = -h; dx <= h; dx++) {
        const t = (cy + dy) * this.w + cx + dx;
        if (this.occ[t]) { const o = this.structureAt(t); return `다른 건물(${o ? BUILD[o.type].name : '?'})과 겹쳐요`; }
      }
      const n = b.size * b.size;
      if (type === 'village' && mtn * 2 > n) return '산 위에는 마을을 지을 수 없어요';
      if (type === 'farm' && plains * 2 <= n) return '농장은 평야가 절반 넘는 곳에만 지을 수 있어요';
      if (type === 'mine' && rough < 4) return '광산은 언덕·산이 4칸 이상 있어야 해요';
      if (type === 'port' && !coast) return '항구는 큰 바다에 닿아 있어야 해요 (호수 X)';
      if (p.gold < this.cost(p, type)) return '금이 부족해요';
      return null;
    }
    build(pid, type, tile) {
      const err = this.canBuild(pid, type, tile);
      if (err) return err;
      const p = this.players[pid], b = BUILD[type];
      p.gold -= this.cost(p, type);
      if (b.upgradeOf) {
        const s = this.structureAt(tile);
        p.counts[s.type]--; s.type = type; p.counts[type]++;
        this.structVer++;
      } else {
        const [x, y] = this.xy(tile);
        const s = { type, owner: pid, tile, x, y, half: (b.size - 1) / 2, built: this.tick };
        this.structures.push(s);
        this.structAt.set(tile, s);
        this.markFootprint(s, 1);
        p.counts[type]++;
      }
      this.recalcEconomy();
      return null;
    }
    // 시작할 때 수도를 시작 위치에 둔다 (칸 조건 없이)
    placeCapital(p) {
      const t = p.spawnTile;
      if (t < 0 || this.owner[t] !== p.id || this.structAt.has(t)) return;
      const [x, y] = this.xy(t);
      const s = { type: 'capital', owner: p.id, tile: t, x, y, half: (BUILD.capital.size - 1) / 2, built: this.tick };
      this.structures.push(s);
      this.structAt.set(t, s);
      this.markFootprint(s, 1);
      p.counts.capital++;
    }
    // ---------- 자동 건설: 가진 금을 다 쓸 때까지 지금 가장 남는 장사를 짓는다 ----------
    // 점수 = 얻는 가치 ÷ 값. 금 수입 1(틱당) ≈ 가치 400, 인구 1 ≈ 0.06~0.2 (인구가 찰수록 인구 건물 가치 ↑)
    autoBuild(pid, maxBuilds = 150) {
      const p = this.players[pid];
      if (this.phase !== 'play' || !p.alive) return { built: {}, spent: 0, err: '지금은 지을 수 없어요' };
      const GOLD_W = 400, built = {}, noSpot = new Set();
      let spent = 0;
      for (let n = 0; n < maxBuilds; n++) {
        const fill = Math.min(1, p.troops / this.maxTroops(p));
        const popW = 0.06 + 0.14 * fill;
        const prod = p.counts.farm + p.counts.mine + p.counts.port;
        const opts = [];
        const add = (type, value) => {
          if (noSpot.has(type)) return;
          const c = this.cost(p, type);
          if (c <= p.gold) opts.push({ type, c, score: value / c });
        };
        add('village', BUILD.village.pop * popW);
        if (p.counts.village > 0) add('city', (BUILD.city.pop - BUILD.village.pop) * popW);
        add('farm', BUILD.farm.gold * GOLD_W);
        add('mine', BUILD.mine.gold * GOLD_W);
        add('port', (BUILD.port.gold + 2.5) * GOLD_W * (p.counts.port === 0 ? 1.6 : 1));
        let mSpot = -1;
        if (prod >= 3 && !noSpot.has('market') && this.cost(p, 'market') <= p.gold) {
          const r = this.bestSpot(pid, 'market');
          if (r.tile < 0) noSpot.add('market');
          else { mSpot = r.tile; opts.push({ type: 'market', c: this.cost(p, 'market'), score: r.gain * MARKET_BONUS * GOLD_W / this.cost(p, 'market') }); }
        }
        // 항구마다 전함 한 척은 지켜 둔다
        if (p.counts.port > 0 && this.warships(pid).length < p.counts.port) add('warship', this.cost(p, 'warship') * 1.0);
        opts.sort((a, b) => b.score - a.score);
        let done = false;
        for (const o of opts) {
          const tile = o.type === 'market' ? mSpot : this.bestSpot(pid, o.type).tile;
          if (tile < 0) { noSpot.add(o.type); continue; }
          const err = o.type === 'warship' ? this.buildWarship(pid, tile) : this.build(pid, o.type, tile);
          if (err) { noSpot.add(o.type); continue; }
          built[o.type] = (built[o.type] || 0) + 1;
          spent += o.c;
          done = true;
          break;
        }
        if (!done) break;
      }
      return { built, spent };
    }
    // 지을 자리 고르기: 지을 수 있는 자리 여러 개 중 국경에서 먼(안전한) 곳. 시장은 근처 생산 건물이 많은 곳
    bestSpot(pid, type) {
      const p = this.players[pid];
      if (type === 'warship') {
        const ports = this.ownPorts(pid);
        for (let k = 0; k < 40 && ports.length; k++) {
          const st = ports[(this.rng() * ports.length) | 0];
          const [dx, dy] = this.xy(st.dock);
          const ang = this.rng() * Math.PI * 2, rad = 4 + this.rng() * 5;
          const nx = Math.round(dx + Math.cos(ang) * rad), ny = Math.round(dy + Math.sin(ang) * rad);
          if (nx < 0 || ny < 0 || nx >= this.w || ny >= this.h) continue;
          const t = ny * this.w + nx;
          if (this.isSea(t) && this.seaId[t] === this.seaId[st.dock]) return { tile: t, gain: 0 };
        }
        return { tile: -1, gain: 0 };
      }
      if (type === 'city') {
        let best = null;
        for (const s of this.structures) if (s.owner === pid && s.type === 'village' && (!best || this.labelDist[s.tile] > this.labelDist[best.tile])) best = s;
        return { tile: best ? best.tile : -1, gain: 0 };
      }
      if (type === 'port') { // 바다에 닿은 내 땅에서 안쪽으로 1~2칸 들어간 자리를 가운데로
        const b = p.bbox, w = this.w, coast = [];
        for (let y = b[1]; y <= b[3]; y++) for (let x = b[0], t = y * w + b[0]; x <= b[2]; x++, t++) {
          if (this.owner[t] !== pid) continue;
          if ((x > 0 && this.isSea(t - 1)) || (x < w - 1 && this.isSea(t + 1)) || (y > 0 && this.isSea(t - w)) || (y < this.h - 1 && this.isSea(t + w))) coast.push(t);
        }
        let bestT = -1, bestS = -1;
        for (let k = 0; k < 60 && coast.length; k++) {
          const c = coast[(this.rng() * coast.length) | 0], cx = c % w, cy = (c / w) | 0;
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1], [2, 0], [-2, 0], [0, 2], [0, -2]]) {
            const x = cx + dx, y = cy + dy;
            if (x < 0 || y < 0 || x >= w || y >= this.h) continue;
            const t = y * w + x;
            if (this.canBuild(pid, 'port', t) !== null) continue;
            if (this.labelDist[t] > bestS) { bestS = this.labelDist[t]; bestT = t; }
            break;
          }
        }
        return { tile: bestT, gain: 0 };
      }
      const R2 = MARKET_RADIUS * MARKET_RADIUS;
      const prods = type === 'market' ? this.structures.filter(s => s.owner === pid && PRODUCERS[s.type]) : null;
      let bestT = -1, bestS = -1, bestGain = 0, found = 0;
      for (let k = 0; k < 90 && found < 14; k++) {
        const t = this.randomOwnTile(p, false);
        if (t < 0 || this.canBuild(pid, type, t) !== null) continue;
        found++;
        let sc = this.labelDist[t], gain = 0;
        if (prods) {
          const x = t % this.w, y = (t / this.w) | 0;
          for (const s of prods) if ((s.x - x) ** 2 + (s.y - y) ** 2 <= R2) gain += BUILD[s.type].gold || 0;
          sc = gain * 100 + this.labelDist[t];
        }
        if (sc > bestS) { bestS = sc; bestT = t; bestGain = gain; }
      }
      return { tile: bestT, gain: bestGain };
    }

    // 이 건물을 지을 수 있는 내 땅을 무작위로 찾는다 (없으면 -1)
    findSpot(pid, type, tries = 50) {
      const p = this.players[pid];
      if (BUILD[type] && BUILD[type].upgradeOf) {
        const v = this.structures.filter(s => s.owner === pid && s.type === BUILD[type].upgradeOf);
        return v.length ? v[(this.rng() * v.length) | 0].tile : -1;
      }
      for (let k = 0; k < tries; k++) {
        const t = this.randomOwnTile(p, false);
        if (t >= 0 && this.canBuild(pid, type, t) === null) return t;
      }
      return -1;
    }

    launchMissile(pid, tile) {
      const p = this.players[pid];
      if (this.phase !== 'play' || !p.alive) return '지금은 쏠 수 없어요';
      if (p.counts.silo === 0) return '미사일 기지가 필요해요';
      if (p.gold < MISSILE_COST) return '금이 부족해요';
      if (this.allied(pid, this.owner[tile])) return '동맹 나라에는 쏠 수 없어요';
      const [x, y] = this.xy(tile);
      let best = null, bd = 1e9;
      for (const s of this.structures) {
        if (s.type !== 'silo' || s.owner !== pid) continue;
        const d = Math.hypot(s.x - x, s.y - y);
        if (d < bd) { bd = d; best = s; }
      }
      p.gold -= MISSILE_COST;
      this.missiles.push({ owner: pid, fx: best.x, fy: best.y, tx: x, ty: y, t: 0, dur: Math.round(20 + bd * 0.25) });
      const tgt = this.owner[tile];
      if (tgt >= 0 && tgt !== pid) this.log(`${p.name}이(가) ${this.players[tgt].name}에 미사일 발사!`, 'missile', [pid, tgt]);
      return null;
    }

    processMissiles() {
      for (let i = this.missiles.length - 1; i >= 0; i--) {
        const m = this.missiles[i];
        if (++m.t < m.dur) continue;
        this.missiles.splice(i, 1);
        const R = MISSILE_RADIUS, lost = new Map();
        for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
          const d2 = dx * dx + dy * dy;
          if (d2 > R * R * (0.8 + this.rng() * 0.3)) continue;
          const x = m.tx + dx, y = m.ty + dy;
          if (x < 0 || y < 0 || x >= this.w || y >= this.h) continue;
          const t = y * this.w + x;
          const o = this.owner[t];
          if (!this.ter[t] || o < 0) continue;
          lost.set(o, (lost.get(o) || 0) + 1);
        }
        for (const [o, n] of lost) {
          const q = this.players[o];
          q.troops = Math.max(0, q.troops - q.troops / Math.max(1, q.tiles) * n * 1.5);
        }
        for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
          if (dx * dx + dy * dy > R * R) continue;
          const x = m.tx + dx, y = m.ty + dy;
          if (x < 0 || y < 0 || x >= this.w || y >= this.h) continue;
          const t = y * this.w + x;
          if (this.ter[t] && this.owner[t] >= 0) this.setOwner(t, NEUTRAL);
        }
        this.lastBlast = { x: m.tx, y: m.ty, tick: this.tick };
        (this.blasts || (this.blasts = [])).push({ x: m.tx, y: m.ty, tick: this.tick });
      }
    }

    // ---------- 컴퓨터 나라 ----------
    botThink(p) {
      const D = DIFF[p.diff] || DIFF.normal, r = this.rng;
      const max = this.maxTroops(p), fill = p.troops / max;
      const out = this.outgoingAttacks(p.id);

      // 막기: 쳐들어오는 공격이 있으면 맞받아친다
      for (const a of this.incomingAttacks(p.id)) {
        if (a.att >= 0 && r() < D.aggr + 0.2 && p.troops > a.pool * 0.6) {
          const send = Math.min(p.troops * 0.6, a.pool * 1.3);
          p.troops -= send;
          this.startAttack(p.id, a.att, send);
          return;
        }
      }
      // 동맹 다루기
      if (r() < 0.35 && this.botAlliances(p, D)) return;
      // 건물
      if (r() < D.build + 0.2) this.botBuild(p, fill);
      if (p.counts.silo > 0 && p.gold >= MISSILE_COST * 1.5 && r() < 0.07) {
        let leader = this.players.filter(q => q.alive && q.id !== p.id && !this.allied(p.id, q.id)).sort((a, b) => b.tiles - a.tiles)[0];
        // 내가 1위면 가장 강한 적 이웃을 노린다
        // 1위가 진짜 위협(땅 15% 이상)일 때만 1위를 노리고, 아니면 가장 강한 적 이웃
        if (leader && (leader.tiles <= p.tiles * 0.8 || leader.tiles < this.land * 0.15)) {
          let best = null;
          // 지금 나를 치고 있는 나라 중 가장 강한 곳만
          for (const a of this.incomingAttacks(p.id)) { const q = this.players[a.att]; if (!best || q.troops > best.troops) best = q; }
          leader = best;
        }
        if (leader) {
          const t = this.randomOwnTile(leader, true);
          if (t >= 0) this.launchMissile(p.id, t);
        }
      }
      if (out.length >= 2 || fill < 0.2) return;

      const { counts, coastal } = this.scanBorder(p.id, 10);
      const free = p.troops;
      // 빈 땅부터 먹는다
      if (counts.has(NEUTRAL) && fill > 0.25 && r() < 0.85) {
        const send = free * (D.ratio + r() * 0.15);
        p.troops -= send;
        this.startAttack(p.id, NEUTRAL, send);
        return;
      }
      // 이웃 나라 중 칸당 병력이 가장 적은(=빼앗기 쉬운) 곳
      let best = null, bestD = Infinity;
      for (const [o, c] of counts) {
        if (o < 0 || this.allied(p.id, o)) continue;
        const q = this.players[o];
        const d = q.troops / Math.max(1, q.tiles) / (1 + Math.min(c, 50) * 0.01) * (q.isBot ? 1 : 0.9);
        if (d < bestD) { bestD = d; best = q; }
      }
      if (best && fill > 0.35 && r() < D.aggr) {
        const send = free * (D.ratio + r() * 0.2);
        // 상대 전체 병력보다 충분히 많을 때 주로 친다. 병력이 넘치면 그냥 친다
        if (send > best.troops * 0.8 || fill > 0.9 || r() < 0.1) {
          p.troops -= send;
          this.startAttack(p.id, best.id, send);
          return;
        }
      }
      // 바다 건너 원정
      // 땅으로 맞닿은 적(빈 땅 포함)이 없으면 가장 약한 적국 해안으로 충분한 병력을 보낸다
      let landEnemy = false;
      for (const [o] of counts) if (o === NEUTRAL || !this.allied(p.id, o)) { landEnemy = true; break; }
      if (coastal && !landEnemy && fill > 0.6 && r() < 0.5) {
        const targets = this.players.filter(q => q.alive && q.id !== p.id && !this.allied(p.id, q.id)).sort((a, b) => a.troops - b.troops);
        for (const tgt of targets.slice(0, 3)) {
          const t = this.randomOwnTile(tgt, false);
          const send = Math.min(free * 0.8, tgt.troops * 1.4 + 2000);
          if (t >= 0 && this.sendBoat(p.id, t, send)) return;
        }
      }
      if (coastal && fill > 0.6 && r() < D.aggr * (counts.size === 0 ? 0.6 : 0.08)) {
        for (let k = 0; k < 30; k++) {
          const t = (r() * this.N) | 0;
          if (!this.ter[t] || this.owner[t] === p.id) continue;
          const o = this.owner[t];
          if (o >= 0 && (this.players[o].troops > p.troops * 0.8 || this.allied(p.id, o))) continue;
          if (this.sendBoat(p.id, t, free * 0.35)) return;
          break;
        }
      }
    }

    // 동맹을 깨고 치거나, 위협적인 이웃에게 동맹을 청한다. 무언가 했으면 true
    botAlliances(p, D) {
      const r = this.rng;
      const allies = this.alliesOf(p.id);
      const leader = this.players.filter(q => q.alive).sort((a, b) => b.tiles - a.tiles)[0];
      const ov = this.overlordOf(p.id);
      // 속국: 종주국만큼 강해지면 독립 선언
      if (ov >= 0) {
        const o = this.players[ov];
        const since = this.tick - (this.vassalSince.get(p.id) || 0);
        if (since > 60 * TPS && p.troops > o.troops * 0.8 && r() < D.aggr * 0.3) {
          this.breakAlliance(p.id, ov);
          return true;
        }
      }
      // 국경에 적이 하나도 없고 병력이 넘치면, 결국 가장 약한 이웃 동맹(속국은 마지막)을 친다
      {
        const { counts } = this.scanBorder(p.id, 10);
        let enemy = false, prey = null;
        for (const [o] of counts) {
          if (o < 0 || !this.allied(p.id, o)) { enemy = true; break; }
          const q = this.players[o];
          const score = q.troops * (this.overlordOf(o) === p.id ? 3 : 1);
          if (this.overlordOf(p.id) !== o && (!prey || score < prey.s)) prey = { q, s: score };
        }
        if (!enemy && prey && p.troops > this.maxTroops(p) * 0.75 && p.troops > prey.q.troops * 3 && r() < 0.25) {
          this.breakAlliance(p.id, prey.q.id);
          const send = p.troops * Math.min(0.9, D.ratio + 0.2);
          p.troops -= send;
          this.startAttack(p.id, prey.q.id, send);
          return true;
        }
      }
      // 공격받는 동맹에게 병력 지원
      if (this.tick - (p.lastAid || -1e9) > 30 * TPS) {
        for (const q of allies) {
          const losing = this.incomingAttacks(q.id).some(a => this.battleEdge(a) > 0);
          if (losing && p.troops > this.maxTroops(p) * 0.6 && r() < 0.25) {
            if (!this.sendAid(p.id, q.id, 'troops', p.troops * 0.15)) { p.lastAid = this.tick; return true; }
          }
        }
      }
      const { counts } = this.scanBorder(p.id, 10);
      // 훨씬 강한 이웃에게 밀리면 복종을 청한다
      if (ov < 0 && !this.vassalsOf(p.id).length && r() < 0.06) {
        for (const [o] of counts) {
          if (o < 0) continue;
          const q = this.players[o];
          const hit = this.incomingAttacks(p.id).some(a => a.att === o);
          if (q.troops > p.troops * 4 && (hit || r() < 0.3) && !this.request(p.id, o, 'submit')) return true;
        }
      }
      // 약한 이웃에게 복종을 요구한다
      if (ov < 0 && r() < 0.03 * (D.aggr * 2)) {
        for (const [o] of counts) {
          if (o < 0 || this.allied(p.id, o)) continue;
          const q = this.players[o];
          if (q.troops * 3 < p.troops && !this.request(p.id, o, 'demand')) return true;
        }
      }
      for (const q of allies) {
        if (this.isVassalPair(p.id, q.id)) continue; // 속국·종주국은 아래 규칙으로 배신하지 않음
        const since = this.tick - this.alliances.get(this.pairKey(p.id, q.id));
        if (since < 40 * TPS) continue;
        const weak = q.troops < p.troops * 0.15;                                             // 동맹 병력이 너무 낮음 (배신 패널티 감안)
        const strong = q === leader && q.tiles > p.tiles * 2.5 && q.tiles > this.land * 0.2; // 동맹이 너무 강해짐
        if ((weak || strong) && r() < D.aggr * 0.35) {
          this.breakAlliance(p.id, q.id);
          const send = p.troops * Math.min(0.9, D.ratio + 0.2);
          p.troops -= send;
          this.startAttack(p.id, q.id, send);
          return true;
        }
      }
      if (allies.length < 2 && r() < 0.12) {
        let threat = null;
        for (const [o] of counts) {
          if (o < 0 || this.allied(p.id, o)) continue;
          const q = this.players[o];
          if ((q.traitorUntil || 0) > this.tick) continue;
          if (q.troops > p.troops * 0.8 && (!threat || q.troops > threat.troops)) threat = q;
        }
        if (threat && !this.requestAlliance(p.id, threat.id)) return true;
      }
      return false;
    }

    // 컴퓨터의 건설: 인구가 차면 마을·도시, 아니면 돈 버는 건물, 상황에 따라 시장·요새·미사일 기지
    botBuild(p, fill) {
      const c = p.counts, r = this.rng;
      const prod = c.farm + c.mine + c.port;
      const homes = c.village + c.city + c.capital;
      const wants = [];
      if (this.incomingAttacks(p.id).length && c.fort < 3 && r() < 0.5) wants.push('fort');
      if (c.silo === 0 && ((p.diff === 'hard' && p.tiles > 2500) || (p.diff === 'normal' && p.tiles > 4000 && p.gold > 200000))) wants.push('silo');
      if (fill > 0.8) wants.push(c.village > 0 && r() < 0.5 ? 'city' : 'village');
      if (prod >= 4 && c.market < Math.floor(prod / 5)) wants.push('market');
      if (prod < homes * 2 + 1) wants.push('mine', 'port', 'farm');
      wants.push('village', 'farm');
      // 항구가 있으면 전함도 (항구 수 + 1 척까지), 자기 항구 앞바다를 지킨다
      const nWar = this.warships(p.id).length;
      if (c.port > 0 && nWar < Math.min(4, c.port + 1) && p.gold >= this.cost(p, 'warship') * 1.3 && r() < 0.5) {
        const ports = this.ownPorts(p.id);
        const st = ports[(r() * ports.length) | 0];
        if (st) {
          const [dx, dy] = this.xy(st.dock);
          for (let k = 0; k < 10; k++) {
            const nx = dx + Math.round((r() * 2 - 1) * 10), ny = dy + Math.round((r() * 2 - 1) * 10);
            if (nx < 0 || ny < 0 || nx >= this.w || ny >= this.h) continue;
            const n = ny * this.w + nx;
            if (!this.ter[n] && this.buildWarship(p.id, n) === null) return true;
          }
        }
      }
      for (const type of wants) {
        if (p.gold < this.cost(p, type)) continue;
        const t = this.findSpot(p.id, type, 30);
        if (t >= 0 && this.build(p.id, type, t) === null) return true;
      }
      return false;
    }

    randomOwnTile(p, interior) {
      const b = p.bbox, nb = [];
      for (let k = 0; k < 80; k++) {
        const x = b[0] + ((this.rng() * (b[2] - b[0] + 1)) | 0);
        const y = b[1] + ((this.rng() * (b[3] - b[1] + 1)) | 0);
        const t = y * this.w + x;
        if (this.owner[t] !== p.id) continue;
        if (interior) {
          this.neighbors(t, nb);
          if (nb.some(n => this.owner[n] !== p.id)) continue;
        }
        return t;
      }
      return -1;
    }

    // ---------- 이름표 위치 (나라 안쪽 가장 넓은 곳) · 경계 상자 다시 계산 ----------
    computeLabels() {
      const w = this.w, h = this.h, o = this.owner, d = this.labelDist;
      for (const p of this.players) { p.bbox = [w, h, -1, -1]; p._best = 0; p._bt = -1; }
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const t = y * w + x, v = o[t];
        if (v < 0) { d[t] = 0; continue; }
        const b = this.players[v].bbox;
        if (x < b[0]) b[0] = x; if (y < b[1]) b[1] = y;
        if (x > b[2]) b[2] = x; if (y > b[3]) b[3] = y;
        if (x === 0 || y === 0 || x === w - 1 || y === h - 1) { d[t] = 1; continue; }
        const up = o[t - w] === v ? d[t - w] : 0, lf = o[t - 1] === v ? d[t - 1] : 0;
        d[t] = Math.min(up, lf) + 1;
      }
      for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) {
        const t = y * w + x, v = o[t];
        if (v < 0) continue;
        let m = d[t];
        if (x < w - 1) m = Math.min(m, (o[t + 1] === v ? d[t + 1] : 0) + 1);
        if (y < h - 1) m = Math.min(m, (o[t + w] === v ? d[t + w] : 0) + 1);
        d[t] = m;
        const p = this.players[v];
        if (m > p._best) { p._best = m; p._bt = t; }
      }
      for (const p of this.players) {
        p.label = p._bt >= 0 ? { x: p._bt % w, y: (p._bt / w) | 0, size: p._best } : null;
      }
    }

    // ---------- 한 틱 ----------
    step() {
      if (this.phase === 'over') return;
      this.tick++;
      if (this.phase === 'spawn') {
        if (--this.spawnTicks <= 0) {
          for (const p of this.players) if (!p.spawned) this.randomSpawn(p.id);
          for (const p of this.players) if (!p.spawned) p.alive = false;
          this.phase = 'play';
          for (const p of this.players) if (p.alive) this.placeCapital(p);
          this.recalcEconomy();
          this.log('전쟁이 시작됐어요! 살아남으세요.', 'big');
          this.computeLabels();
        }
        return;
      }
      this.recalcEconomy();
      for (const p of this.players) p.trib = { inT: 0, inG: 0, outT: 0, outG: 0 };
      for (const p of this.players) {
        if (!p.alive) continue;
        const max = this.maxTroops(p);
        let gainT = 0;
        if (p.troops < max) gainT = Math.min(max, p.troops + this.growth(p) * (1 - p.troops / max) + 0.5) - p.troops;
        else p.troops -= (p.troops - max) * 0.02;
        let gainG = this.goldRate(p);
        const ov = this.overlordOf(p.id);
        if (ov >= 0 && this.players[ov].alive) {
          const o = this.players[ov], t = gainT * TRIBUTE, g = gainG * TRIBUTE;
          gainT -= t; gainG -= g;
          o.troops += t; o.gold += g;
          p.trib.outT += t; p.trib.outG += g; o.trib.inT += t; o.trib.inG += g;
        }
        p.troops += gainT;
        p.gold += gainG;
      }
      for (let i = this.attacks.length - 1; i >= 0; i--) {
        const a = this.attacks[i];
        if (a) this.processAttack(a);
      }
      this.processBoats();
      this.processShips();
      this.processMissiles();
      this.processRequests();
      if (this.tick % 5 === 0) this.updateFronts();
      for (const p of this.players) {
        if (!p.alive || !p.isBot) continue;
        if (this.tick >= p.nextThink) {
          const D = DIFF[p.diff] || DIFF.normal;
          p.nextThink = this.tick + D.think + ((this.rng() * 6) | 0);
          this.botThink(p);
        }
      }
      // 망한 나라 처리
      for (const p of this.players) {
        if (p.alive && p.spawned && p.tiles === 0) {
          p.alive = false;
          p.deadTick = this.tick;
          p.troops = 0;
          for (const a of this.attacks.filter(a => a.att === p.id || a.def === p.id)) this.endAttack(a, a.att !== p.id);
          this.boats = this.boats.filter(b => b.owner !== p.id);
          this.ships = this.ships.filter(x => x.owner !== p.id);
          for (const q of this.players) if (this.allied(p.id, q.id)) { this.alliances.delete(this.pairKey(p.id, q.id)); this.allianceVer++; }
          this.requests = this.requests.filter(r => r.from !== p.id && r.to !== p.id);
          for (const [sId, oId] of this.vassals) if (sId === p.id || oId === p.id) this.vassals.delete(sId);
          this.log(`${p.name}이(가) 멸망했어요`, 'death', [p.id]);
        }
      }
      if (this.tick % 10 === 0) {
        this.computeLabels();
        const alive = this.players.filter(p => p.alive);
        // 속국 땅은 종주국 몫으로 친다
        const top = alive.slice().sort((a, b) => this.empireTiles(b) - this.empireTiles(a))[0];
        if (alive.length <= 1 || (top && this.empireTiles(top) >= this.land * WIN_SHARE)) {
          this.phase = 'over';
          this.winner = top ? top.id : null;
          this.log(`${top ? top.name : '아무도'} 승리!`, 'big');
        }
      }
    }
  }

  function hsl(h, s, l) {
    const a = s * Math.min(l, 1 - l);
    const f = n => { const k = (n + h / 30) % 12; return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))); };
    return [f(0), f(8), f(4)];
  }
  // 한국식 숫자: 9,800 / 1.2만 / 35만 / 1.5억
  function fmt(n) {
    n = Math.round(n);
    const a = Math.abs(n), trim = s => s.replace(/\.0$/, '');
    if (a >= 1e8) return trim((n / 1e8).toFixed(1)) + '억';
    if (a >= 1e4) return trim((n / 1e4).toFixed(a >= 1e5 ? 0 : 1)) + '만';
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  const api = { Game, decodeMap, tileAt, NEUTRAL, TPS, TER, BUILD, MARKET_RADIUS, SHIP, BETRAY_SECS, BETRAY_MUL, MISSILE_COST, MISSILE_RADIUS, FORT_RADIUS, MAX_BOATS, WIN_SHARE, DIFF, TRIBUTE, fmt, hsl };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PC = api;
})(typeof window !== 'undefined' ? window : globalThis);
