// 도트 정복전 — 화면 그리기와 조작
(function () {
  'use strict';
  const { Game, decodeMap, NEUTRAL, TPS, TER, BUILD, MISSILE_COST, MISSILE_RADIUS, FORT_RADIUS, MARKET_RADIUS, fmt } = PC;
  const $ = id => document.getElementById(id);

  const map = decodeMap(window.MAP_DATA);
  const W = map.w, H = map.h, N = W * H;

  // ---------- 바탕 색 (지형) ----------
  const base = new Uint8ClampedArray(N * 3);
  (function buildBase() {
    // 바다 깊이: 육지에서 떨어진 거리
    const dist = new Uint8Array(N).fill(255);
    const q = new Int32Array(N);
    let h = 0, t = 0;
    for (let i = 0; i < N; i++) if (map.ter[i]) { dist[i] = 0; q[t++] = i; }
    while (h < t) {
      const i = q[h++], d = dist[i];
      if (d >= 12) continue;
      const x = i % W;
      for (const n of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i - W, i + W]) {
        if (n < 0 || n >= N || dist[n] !== 255) continue;
        dist[n] = d + 1; q[t++] = n;
      }
    }
    const COL = [null, [98, 148, 72], [134, 140, 84], [128, 114, 100], [204, 182, 122], [192, 204, 202]];
    for (let i = 0; i < N; i++) {
      const x = i % W, y = (i / W) | 0;
      const n = (hash(x, y) - 0.5) * 14;
      let c;
      if (!map.ter[i]) {
        const d = Math.min(dist[i], 12) / 12;
        const k = 1 - Math.pow(1 - d, 1.6);
        c = [62 + (20 - 62) * k, 118 + (46 - 118) * k, 172 + (92 - 172) * k];
        if (dist[i] === 1) c = [86, 146, 194];
        c[2] += n * 0.3;
      } else {
        c = COL[map.ter[i]].slice();
        if (map.ter[i] === 3 && hash(x + 7, y + 3) > 0.6) c = [168, 158, 150];
        c[0] += n; c[1] += n; c[2] += n;
      }
      base[i * 3] = c[0]; base[i * 3 + 1] = c[1]; base[i * 3 + 2] = c[2];
    }
  })();
  function hash(x, y) {
    let h = (x * 374761393 + y * 668265263) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  // ---------- 캔버스 ----------
  const view = $('view');
  const ctx = view.getContext('2d');
  const mapCv = document.createElement('canvas');
  mapCv.width = W; mapCv.height = H;
  const mctx = mapCv.getContext('2d');
  const img = mctx.createImageData(W, H);
  const px = img.data;
  let dpr = 1, cw = 0, ch = 0;
  const cam = { s: 1, x: 0, y: 0 };
  let minScale = 1;

  function resize() {
    dpr = window.devicePixelRatio || 1;
    cw = window.innerWidth; ch = window.innerHeight;
    view.width = Math.round(cw * dpr); view.height = Math.round(ch * dpr);
    minScale = Math.min(cw / W, ch / H) * 0.9;
    clampCam();
  }
  function fitCam() {
    cam.s = Math.min(cw / W, ch / H);
    cam.x = (cw - W * cam.s) / 2;
    cam.y = (ch - H * cam.s) / 2;
  }
  function clampCam() {
    if (!isFinite(cam.x) || !isFinite(cam.y) || !isFinite(cam.s)) { fitCam(); return; }
    cam.s = Math.max(minScale, Math.min(48, cam.s));
    const mw = W * cam.s, mh = H * cam.s;
    const mx = cw * 0.5, my = ch * 0.5;
    cam.x = Math.min(mx, Math.max(cw - mw - mx, cam.x));
    cam.y = Math.min(my, Math.max(ch - mh - my, cam.y));
  }
  function zoomAt(sx, sy, f) {
    const tx = (sx - cam.x) / cam.s, ty = (sy - cam.y) / cam.s;
    cam.s *= f; clampCam();
    cam.x = sx - tx * cam.s; cam.y = sy - ty * cam.s; clampCam();
  }
  function centerOn(tx, ty, s) {
    if (s) cam.s = s;
    cam.x = cw / 2 - (tx + 0.5) * cam.s; cam.y = ch / 2 - (ty + 0.5) * cam.s; clampCam();
  }
  const toTile = (sx, sy) => {
    const x = Math.floor((sx - cam.x) / cam.s), y = Math.floor((sy - cam.y) / cam.s);
    if (x < 0 || y < 0 || x >= W || y >= H) return -1;
    return y * W + x;
  };

  // ---------- 게임 상태 ----------
  let game = null, me = 0, ratio = 0.3, speed = 1, paused = false, mode = null, selShip = 0;
  let acc = 0, last = 0, watching = false, overShown = false, allyVer = 0;
  const SWATCH = [[255, 211, 77], [0, 214, 255], [255, 92, 138], [120, 255, 120], [190, 120, 255], [255, 140, 40], [255, 255, 255], [40, 120, 255]];
  let myColor = SWATCH[0];
  const settings = { bots: 30, diff: 'normal' };
  const fx = []; // 화면 효과 (클릭 물결 등)

  function paintTile(t) {
    const o = game.owner[t], i = t * 4, b = t * 3;
    if (o < 0) { px[i] = base[b]; px[i + 1] = base[b + 1]; px[i + 2] = base[b + 2]; px[i + 3] = 255; return; }
    const c = game.players[o].color;
    const x = t % W;
    const border = x === 0 || x === W - 1 || t < W || t >= N - W ||
      game.owner[t - 1] !== o || game.owner[t + 1] !== o || game.owner[t - W] !== o || game.owner[t + W] !== o;
    if (border) {
      if (o === me) { px[i] = 255; px[i + 1] = 255; px[i + 2] = 255; }
      else if (game.allied(me, o)) { px[i] = c[0] * 0.45 + 140; px[i + 1] = c[1] * 0.45 + 140; px[i + 2] = c[2] * 0.45 + 140; }
      else { px[i] = c[0] * 0.62; px[i + 1] = c[1] * 0.62; px[i + 2] = c[2] * 0.62; }
    } else {
      const k = 0.58;
      px[i] = base[b] * (1 - k) + c[0] * k; px[i + 1] = base[b + 1] * (1 - k) + c[1] * k; px[i + 2] = base[b + 2] * (1 - k) + c[2] * k;
    }
    px[i + 3] = 255;
  }
  function repaintAll() { for (let t = 0; t < N; t++) paintTile(t); mctx.putImageData(img, 0, 0); }
  function flushDirty() {
    const d = game.dirty;
    if (!d.length) return;
    for (const t of d) {
      paintTile(t);
      const x = t % W;
      if (x > 0) paintTile(t - 1);
      if (x < W - 1) paintTile(t + 1);
      if (t >= W) paintTile(t - W);
      if (t + W < N) paintTile(t + W);
    }
    d.length = 0;
    mctx.putImageData(img, 0, 0);
  }

  // ---------- 시작 화면 ----------
  (function setupStart() {
    const sw = $('swatches');
    SWATCH.forEach((c, k) => {
      const i = document.createElement('i');
      i.style.background = `rgb(${c})`;
      if (k === 0) i.classList.add('on');
      i.onclick = () => { myColor = c; sw.querySelectorAll('i').forEach(e => e.classList.remove('on')); i.classList.add('on'); };
      sw.appendChild(i);
    });
    seg('botSeg', [[10, '10'], [20, '20'], [30, '30'], [50, '50']], v => settings.bots = v, settings.bots);
    seg('diffSeg', [['easy', '쉬움'], ['normal', '보통'], ['hard', '어려움']], v => settings.diff = v, settings.diff);
    $('nameIn').value = localStorage.getItem('pc_name') || '';
    $('startBtn').onclick = startGame;
    $('hostBtn').onclick = createRoom;
    $('joinBtn').onclick = () => joinRoom($('codeIn').value);
    $('codeIn').addEventListener('keydown', e => { if (e.key === 'Enter') joinRoom($('codeIn').value); });
    $('copyBtn').onclick = () => { navigator.clipboard.writeText($('linkIn').value).then(() => { $('copyBtn').textContent = '복사됨!'; setTimeout(() => $('copyBtn').textContent = '링크 복사', 1500); }); };
    $('lobbyStart').onclick = () => { if (net && net.kind === 'host') { $('lobbyStart').disabled = true; workerStart(); } };
    $('lobbyLeave').onclick = () => leaveRoom('');
    const qRoom = new URLSearchParams(location.search).get('room');
    if (qRoom) { $('codeIn').value = qRoom; $('multiMsg').textContent = `방 ${qRoom} 초대를 받았어요. 이름·색을 정하고 [참가]를 누르세요`; $('joinBox').classList.add('invited'); }
    $('nameIn').addEventListener('keydown', e => { if (e.key === 'Enter') startGame(); });
    $('againBtn').onclick = () => { if (net) leaveRoom(''); $('over').classList.add('hidden'); $('start').classList.remove('hidden'); showRecord(); };
    $('watchBtn').onclick = () => { $('over').classList.add('hidden'); watching = true; };
    showRecord();
  })();
  function seg(id, items, set, init) {
    const el = $(id);
    for (const [v, label] of items) {
      const b = document.createElement('button');
      b.textContent = label;
      if (v === init) b.classList.add('on');
      b.onclick = () => { set(v); el.querySelectorAll('button').forEach(e => e.classList.remove('on')); b.classList.add('on'); };
      el.appendChild(b);
    }
  }
  function loadRec() { try { return JSON.parse(localStorage.getItem('pc_rec')) || { wins: 0, games: 0, best: 0 }; } catch (e) { return { wins: 0, games: 0, best: 0 }; } }
  function showRecord() {
    const r = loadRec();
    $('recTxt').textContent = r.games ? `지금까지 ${r.games}판 · 승리 ${r.wins}번 · 최장 생존 ${mmss(r.best)}` : '';
  }
  function mmss(ticks) { const s = Math.floor(ticks / TPS); return `${Math.floor(s / 60)}분 ${String(s % 60).padStart(2, '0')}초`; }

  function startGame() {
    const name = $('nameIn').value.trim() || '우리 나라';
    localStorage.setItem('pc_name', $('nameIn').value.trim());
    game = new Game(map, { spawnTicks: 120 });
    me = game.addPlayer({ name, color: myColor, isBot: false });
    for (let i = 0; i < settings.bots; i++) {
      const id = game.addPlayer({ isBot: true, difficulty: settings.diff });
      // 내 색과 너무 비슷하면 살짝 돌리기
      const c = game.players[id].color;
      if (Math.abs(c[0] - myColor[0]) + Math.abs(c[1] - myColor[1]) + Math.abs(c[2] - myColor[2]) < 90) game.players[id].color = PC.hsl((id * 137.5 + 200) % 360, 0.5, 0.4);
    }
    for (const p of game.players) if (p.isBot) game.randomSpawn(p.id);
    enterGame();
  }
  function enterGame() {
    repaintAll();
    game.dirty.length = 0; game.fullRepaint = false;
    fitCam();
    mode = null; paused = false; speed = 1; watching = false; overShown = false; acc = 0; selShip = 0;
    logSeen = Math.max(0, game.events.length - 5); allyVer = game.allianceVer; lastPhase = game.phase;
    $('log').innerHTML = '';
    $('reqs').innerHTML = ''; reqEls.clear();
    allyKey = '-'; $('allyPanel').classList.add('hidden');
    for (const id of ['hud', 'board', 'bar', 'log']) $(id).classList.remove('hidden');
    $('start').classList.add('hidden'); $('lobby').classList.add('hidden'); $('over').classList.add('hidden');
    const p = game.players[me];
    $('hSw').style.background = `rgb(${p.color})`;
    $('hName').textContent = p.name + (net ? (net.kind === 'host' ? ' (방장)' : ' (멀티)') : '');
    buildBar();
    $('speeds').style.display = net ? 'none' : ''; // 멀티는 모두 같은 속도
  }

  // ---------- 멀티: 방 만들기·참가 ----------
  const RELAY = new URLSearchParams(location.search).get('relay')
    || (['localhost', '127.0.0.1'].includes(location.hostname) ? 'ws://127.0.0.1:8787' : 'wss://dot-conquest-rooms.forest-companion.workers.dev');
  let lastPhase = null;
  function myToken() {
    let t = localStorage.getItem('pc_token');
    if (!t) { t = Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem('pc_token', t); }
    return t;
  }
  function myName() { const n = $('nameIn').value.trim() || '우리 나라'; localStorage.setItem('pc_name', $('nameIn').value.trim()); return n; }
  function roomLink(code) { return `${location.origin}${location.pathname}?room=${code}`; }
  function newCode() { const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let c = ''; for (let i = 0; i < 5; i++) c += A[(Math.random() * A.length) | 0]; return c; }
  function showLobby(code, isHost) {
    $('start').classList.add('hidden'); $('lobby').classList.remove('hidden');
    $('linkIn').value = roomLink(code);
    $('lobbyCode').textContent = code;
    $('lobbyStart').classList.toggle('hidden', !isHost);
    $('lobbyWait').classList.toggle('hidden', isHost);
    $('lobbyMsg').textContent = '서버에 연결하는 중…';
    $('lobbyList').innerHTML = '';
  }
  function renderLobby(m) {
    $('lobbyMsg').textContent = '';
    const diffName = { easy: '쉬움', normal: '보통', hard: '어려움' }[m.settings.diff] || m.settings.diff;
    $('lobbyInfo').textContent = `사람 ${m.players.length}명 + 컴퓨터 ${m.settings.bots}나라 · 난이도 ${diffName}`;
    $('lobbyList').innerHTML = m.players.map(q => `<div class="lp"><i class="c" style="background:rgb(${q.color})"></i>${esc(q.name)}${q.host ? ' <span class="t">(방장)</span>' : ''}${q.here ? '' : ' <span class="t">(연결 끊김)</span>'}</div>`).join('');
  }
  function leaveRoom(msg) {
    if (net) { try { net.close(); } catch (e) { /* 이미 닫힘 */ } }
    net = null;
    for (const [, f] of pending) f('연결이 끊겼어요');
    pending.clear();
    $('lobby').classList.add('hidden'); $('over').classList.add('hidden');
    for (const id of ['hud', 'board', 'bar', 'log']) $(id).classList.add('hidden');
    game = null;
    $('start').classList.remove('hidden');
    $('multiMsg').textContent = msg || '';
    history.replaceState(null, '', location.pathname);
  }
  function onPacket(pk) {
    if (!game) return;
    NET.applyPacket(game, pk);
    if (game.fullRepaint) { game.fullRepaint = false; repaintAll(); game.dirty.length = 0; }
    if (lastPhase === 'spawn' && game.phase === 'play') {
      const p = game.players[me];
      if (p && p.label) centerOn(p.label.x, p.label.y, Math.max(cam.s, Math.min(cw, ch) / 110));
    }
    lastPhase = game.phase;
  }
  function startMirror(pid, snap) {
    game = new Game(map, {});
    NET.applyPacket(game, snap);
    me = pid;
    enterGame();
  }
  let workerStart = () => {};
  function createRoom() {
    if (location.protocol === 'file:') { $('multiMsg').textContent = '멀티는 웹 주소(배포된 사이트나 npm start)로 열어야 해요'; return; }
    const code = newCode();
    const worker = new Worker('src/hostworker.js');
    net = {
      kind: 'host', code,
      send: m => worker.postMessage({ cmd: 'act', id: m.id, name: m.name, args: m.args }),
      close: () => { worker.postMessage({ cmd: 'close' }); setTimeout(() => worker.terminate(), 500); },
    };
    worker.onmessage = e => {
      const m = e.data;
      if (m.t === 'status') { if (m.state !== 'open') { if (game) toast(m.msg); else { $('lobbyMsg').textContent = m.msg; if (m.state === 'taken') leaveRoom(m.msg); } } }
      else if (m.t === 'lobby') renderLobby(m);
      else if (m.t === 'start') startMirror(m.pid, JSON.parse(m.snap));
      else if (m.t === 'pk') onPacket(JSON.parse(m.s));
      else if (m.t === 'res') onResult(m.id, m.result);
    };
    workerStart = () => worker.postMessage({ cmd: 'start' });
    worker.onerror = err => { $('lobbyMsg').textContent = '방장 게임 오류: ' + (err.message || ''); };
    worker.postMessage({ cmd: 'open', relay: RELAY, code, me: { name: myName(), color: myColor, token: myToken() }, settings: { bots: settings.bots, diff: settings.diff } });
    showLobby(code, true);
    history.replaceState(null, '', '?room=' + code);
  }
  function joinRoom(code) {
    code = (code || '').trim().toUpperCase();
    if (!/^[A-Z0-9]{4,8}$/.test(code)) { $('multiMsg').textContent = '방 코드를 확인해 주세요'; return; }
    let ws;
    try { ws = new WebSocket(RELAY + '/ws/' + code + '?role=guest'); } catch (e) { $('multiMsg').textContent = '서버에 연결할 수 없어요'; return; }
    let ping = null, ended = false;
    net = {
      kind: 'guest', code,
      send: m => { if (ws.readyState === 1) ws.send(JSON.stringify(m)); },
      close: () => { ended = true; clearInterval(ping); ws.close(); },
    };
    showLobby(code, false);
    ws.onopen = () => {
      ws.send(JSON.stringify({ t: 'hello', name: myName(), color: myColor, token: myToken() }));
      ping = setInterval(() => { if (ws.readyState === 1) ws.send('{"t":"ping"}'); }, 20000);
    };
    ws.onmessage = ev => {
      let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (m.t === 'delta') onPacket(m);
      else if (m.t === 'lobby') renderLobby(m);
      else if (m.t === 'start') { if (m.pid < 0) { leaveRoom('이미 시작한 게임이에요'); return; } startMirror(m.pid, m.snap); }
      else if (m.t === 'res') onResult(m.id, m.result);
      else if (m.t === 'refused') { ended = true; leaveRoom(m.msg); }
      else if (m.t === 'hostgone') { ended = true; leaveRoom(game ? '방장이 게임을 나가서 끝났어요' : '방이 없거나 방장이 나갔어요'); }
    };
    ws.onclose = () => { clearInterval(ping); if (!ended && net && net.kind === 'guest') leaveRoom('연결이 끊겼어요'); };
  }

  // ---------- 명령 통로 ----------
  // 혼자 할 때는 내 게임에서 바로 실행, 멀티면 방장 게임(워커/서버 너머)으로 보내고 답을 기다린다
  let net = null, actId = 0;
  const pending = new Map();
  function act(name, ...args) {
    if (!net) {
      try { return Promise.resolve(game[name](me, ...args)); } catch (e) { return Promise.resolve('오류: ' + e.message); }
    }
    const id = ++actId;
    return new Promise(res => {
      pending.set(id, res);
      net.send({ t: 'cmd', id, name, args });
      setTimeout(() => { if (pending.has(id)) { pending.delete(id); res('응답이 없어요 (연결을 확인해 주세요)'); } }, 8000);
    });
  }
  function onResult(id, result) { const f = pending.get(id); if (f) { pending.delete(id); f(result); } }

  // ---------- 아래 막대 ----------
  const BTN = [['village', '1'], ['city', '2'], ['farm', '3'], ['mine', '4'], ['port', '5'], ['market', '6'], ['fort', '7'], ['silo', '8'], ['warship', 'w'], ['missile', '9']];
  const bName = type => type === 'missile' ? '미사일' : type === 'warship' ? '전함' : BUILD[type].name;
  const bIcon = type => type === 'missile' ? '💥' : type === 'warship' ? '⛴' : BUILD[type].icon;
  function buildBar() {
    const b = $('builds');
    b.innerHTML = '';
    for (const [type, key] of BTN) {
      const el = document.createElement('button');
      el.id = 'b_' + type;
      el.title = type === 'missile' ? `반경 ${MISSILE_RADIUS}칸을 빈 땅으로 만들고 병력을 크게 깎음 (미사일 기지 필요)`
        : type === 'warship' ? '항구 필요. 바다를 클릭하면 가까운 내 항구에서 나와 그 근처를 지켜요. 적 무역선·전함·침공 배를 공격하고, 피가 30% 아래면 항구로 돌아가 수리해요. 내 전함을 클릭 → 바다 클릭으로 지킬 곳 변경'
        : `${BUILD[type].name} (${BUILD[type].size}×${BUILD[type].size}칸) — ${BUILD[type].desc}`;
      el.innerHTML = `${bIcon(type)} ${bName(type)}<span class="k">${key}</span><span class="cost"></span>`;
      el.onclick = () => setMode(mode === type ? null : type);
      b.appendChild(el);
    }
    const s = $('speeds');
    s.innerHTML = '';
    for (const v of [0, 1, 2, 4]) {
      const el = document.createElement('button');
      el.textContent = v === 0 ? '⏸' : v + '배';
      el.onclick = () => { if (v === 0) paused = !paused; else { speed = v; paused = false; } updateSpeedBtns(); };
      el.dataset.v = v;
      s.appendChild(el);
    }
    updateSpeedBtns();
  }
  function updateSpeedBtns() {
    for (const el of $('speeds').children) {
      const v = +el.dataset.v;
      el.classList.toggle('on', v === 0 ? paused : (!paused && v === speed));
    }
  }
  function setMode(m) {
    mode = m;
    for (const [type] of BTN) $('b_' + type).classList.toggle('on', mode === type);
    view.style.cursor = mode ? 'cell' : 'crosshair';
  }
  // 보낼 병력: 비율과 실제 병력 수
  function showRatio() {
    const pct = Math.round(ratio * 100);
    const p = game && game.players[me];
    $('ratioV').textContent = p ? `${pct}% · ${fmt(p.troops * ratio)}명` : `${pct}%`;
  }
  $('ratio').addEventListener('input', e => { ratio = +e.target.value / 100; showRatio(); });
  function setRatio(v) { v = Math.max(5, Math.min(100, v)); $('ratio').value = v; ratio = v / 100; showRatio(); }
  // 자동 건설
  function doAutoBuild() {
    if (!game || game.phase !== 'play' || !game.players[me].alive) return;
    act('autoBuild').then(r => {
      if (!r || typeof r === 'string') { toast(r || '실패했어요'); return; }
      const names = { warship: '⛴전함' };
      const parts = Object.entries(r.built).map(([k, v]) => `${names[k] || BUILD[k].icon + BUILD[k].name} ${v}`);
      toast(parts.length ? `⚡ 자동 건설: ${parts.join(' · ')} (금 ${fmt(r.spent)} 사용)` : (r.err || '지을 수 있는 게 없어요 (금이 부족하거나 자리가 없어요)'));
    });
  }
  $('autoBtn').addEventListener('click', doAutoBuild);

  // ---------- 알림 ----------
  let toastT = 0;
  function toast(msg) { const t = $('toast'); t.textContent = msg; t.style.opacity = 1; clearTimeout(toastT); toastT = setTimeout(() => t.style.opacity = 0, 1600); }
  let logSeen = 0;
  function updateLog() {
    const ev = game.events;
    if (logSeen >= ev.length) return;
    const box = $('log');
    for (; logSeen < ev.length; logSeen++) {
      const e = ev[logSeen];
      const mine = e.ids.includes(me);
      if (!mine && !['big', 'missile', 'death'].includes(e.kind)) continue;
      if (e.kind === 'death' && !mine && game.players.filter(p => p.alive).length > 12 && game.rng() < 0.5) continue;
      const d = document.createElement('div');
      d.className = 'ev-' + e.kind;
      if (e.kind === 'attack' && e.ids[0] === me) d.className = 'ev-ok';
      d.textContent = e.text;
      box.prepend(d);
      if (mine && e.kind === 'betray' && e.ids[1] === me) toast(`💔 ${game.players[e.ids[0]].name}이(가) 동맹을 깨고 배신했어요!`);
      else if (mine && e.kind === 'ally' && e.text.includes('성립')) toast(e.text);
      else if (mine && e.kind === 'ally-no' && e.ids[0] === me) toast(e.text);
      else if (mine && e.kind === 'vassal' && !e.text.includes('→')) toast(e.text);
      else if (mine && e.kind === 'aid' && e.ids[1] === me) toast(e.text);
      else if (mine && e.kind === 'attack' && e.text.startsWith('😠')) toast(e.text);
    }
    while (box.children.length > 8) box.lastChild.remove();
  }

  // ---------- 조작 ----------
  const pointers = new Map();
  let drag = null, pinch = null, hoverTile = -1, mouse = { x: 0, y: 0 }, longT = 0;
  view.addEventListener('pointerdown', e => {
    view.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    hideMenu();
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), s: cam.s };
      drag = null; clearTimeout(longT);
      return;
    }
    if (e.button === 2) return;
    drag = { sx: e.clientX, sy: e.clientY, cx: cam.x, cy: cam.y, moved: false };
    if (e.pointerType === 'touch') {
      longT = setTimeout(() => { if (drag && !drag.moved) { drag = null; openMenu(e.clientX, e.clientY); } }, 500);
    }
  });
  view.addEventListener('pointermove', e => {
    mouse.x = e.clientX; mouse.y = e.clientY;
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, (pinch.s * d / pinch.d) / cam.s);
      return;
    }
    if (drag) {
      const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
      if (!drag.moved && Math.hypot(dx, dy) > 5) { drag.moved = true; clearTimeout(longT); }
      if (drag.moved) { cam.x = drag.cx + dx; cam.y = drag.cy + dy; clampCam(); }
    }
    hoverTile = toTile(e.clientX, e.clientY);
  });
  view.addEventListener('pointerup', e => {
    pointers.delete(e.pointerId);
    clearTimeout(longT);
    if (pointers.size < 2) pinch = null;
    if (drag && !drag.moved && e.button === 0) clickTile(toTile(e.clientX, e.clientY), e.clientX, e.clientY);
    drag = null;
  });
  view.addEventListener('pointercancel', e => { pointers.delete(e.pointerId); drag = null; pinch = null; });
  view.addEventListener('pointerleave', () => { hoverTile = -1; });
  view.addEventListener('wheel', e => { e.preventDefault(); zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0015)); }, { passive: false });
  view.addEventListener('contextmenu', e => { e.preventDefault(); openMenu(e.clientX, e.clientY); });
  window.addEventListener('resize', resize);
  window.addEventListener('keydown', e => {
    if (!game || e.target.tagName === 'INPUT' && e.target.type === 'text') return;
    const k = e.key.toLowerCase();
    if (k === 'a') { doAutoBuild(); return; }
    const btn = BTN.find(([, key]) => key === k);
    if (btn) setMode(mode === btn[0] ? null : btn[0]);
    else if (k === 'escape') { setMode(null); hideMenu(); selShip = 0; }
    else if (k === ' ' && !net) { paused = !paused; updateSpeedBtns(); e.preventDefault(); }
    else if (k === 'q') setRatio(Math.round(ratio * 100) - 5);
    else if (k === 'e') setRatio(Math.round(ratio * 100) + 5);
    else if (k === 'h') { const p = game.players[me]; if (p.label) centerOn(p.label.x, p.label.y, Math.max(cam.s, 4)); }
  });

  function clickTile(t, sx, sy) {
    if (!game || t < 0) return;
    fx.push({ kind: 'ring', x: t % W, y: (t / W) | 0, t0: performance.now() });
    if (game.phase === 'spawn') {
      act('spawnPlayer', t).then(ok => toast(ok === true ? '여기서 시작해요! 시간이 끝나기 전엔 다시 고를 수 있어요' : '여기서는 시작할 수 없어요 (바다이거나 다른 나라와 너무 가까움)'));
      return;
    }
    if (game.phase !== 'play' || !game.players[me].alive) return;
    if (mode === 'missile') {
      act('launchMissile', t).then(err => { toast(err || '미사일 발사!'); if (!err) setMode(null); });
      return;
    }
    if (mode === 'warship') {
      act('buildWarship', t).then(err => toast(err || '⛴ 전함 출항! 그 바다를 지켜요'));
      return;
    }
    // 내 전함 누르기 → 선택, 선택된 상태에서 바다 누르기 → 지킬 곳 변경
    const near = shipNear(sx, sy, 14, x => x.kind === 'war' && x.owner === me);
    if (near) { selShip = near.id; toast('⛴ 전함 선택! 바다를 클릭하면 그곳을 지켜요 (Esc 로 해제)'); return; }
    if (selShip && !map.ter[t]) {
      act('setPatrol', selShip, t).then(err => toast(err || '⛴ 그 바다로 이동해서 지켜요'));
      return;
    }
    if (selShip && map.ter[t]) selShip = 0;
    if (mode) {
      const m0 = mode;
      act('build', m0, t).then(err => toast(err || `${BUILD[m0].icon} ${BUILD[m0].name} 완성!${m0 === 'city' ? '' : ' (계속 지으려면 다시 누르세요)'}`));
      return; // 짓기 모드는 유지 (Esc 나 같은 버튼으로 끄기)
    }
    const o0 = game.owner[t];
    act('orderAttack', t, ratio).then(r => {
      if (r === 'land') toast(o0 === NEUTRAL ? '빈 땅으로 넓혀요' : `${game.players[o0].name} 공격!`);
      else if (r === 'boat') toast('배를 보냈어요 ⛵');
      else toast(r);
    });
  }

  // 화면 위치 근처(px 이내)의 배
  function shipNear(sx, sy, px, filter) {
    let best = null, bd = px * px;
    for (const x of game.ships) {
      if (filter && !filter(x)) continue;
      const X = cam.x + (x.tile % W + 0.5) * cam.s, Y = cam.y + (((x.tile / W) | 0) + 0.5) * cam.s;
      const d = (X - sx) ** 2 + (Y - sy) ** 2;
      if (d < bd) { bd = d; best = x; }
    }
    return best;
  }
  function openMenu(sx, sy) {
    if (!game || game.phase !== 'play' || !game.players[me].alive) return;
    const t = toTile(sx, sy);
    if (t < 0) return;
    const m = $('menu');
    m.innerHTML = '';
    const p = game.players[me];
    const o = game.owner[t];
    const add = (label, fn, dis) => { const b = document.createElement('button'); b.innerHTML = label; b.disabled = !!dis; b.onclick = () => { hideMenu(); fn(); }; m.appendChild(b); };
    const head = txt => { const d = document.createElement('div'); d.className = 'h'; d.textContent = txt; m.appendChild(d); };
    if (o === me) {
      const here = game.structureAt(t);
      if (here && here.owner === me) {
        head(`${BUILD[here.type].icon} ${BUILD[here.type].name}`);
        if (here.type === 'village') {
          const err = game.canBuild(me, 'city', t);
          add(`🏙 도시로 업그레이드 <span style="color:var(--accent)">${fmt(game.cost(p, 'city'))}</span>`, () => act('build', 'city', t).then(e => toast(e || '🏙 도시로 바뀌었어요!')), err);
        } else {
          const d = document.createElement('div'); d.className = 'h'; d.style.maxWidth = '220px'; d.textContent = BUILD[here.type].desc; m.appendChild(d);
        }
      } else {
        head('여기에 짓기 (이 칸이 가운데)');
        for (const type of ['village', 'farm', 'mine', 'port', 'market', 'fort', 'silo']) {
          const err = game.canBuild(me, type, t);
          const why = err && err !== '금이 부족해요' ? ` <span style="color:var(--dim);font-size:10px">${err}</span>` : '';
          add(`${BUILD[type].icon} ${BUILD[type].name} <span style="color:var(--accent)">${fmt(game.cost(p, type))}</span>${why}`, () => act('build', type, t).then(e => toast(e || `${BUILD[type].icon} ${BUILD[type].name} 완성!`)), err);
        }
      }
    } else if (map.ter[t]) {
      head(o < 0 ? '빈 땅' : game.players[o].name);
      const ally = o >= 0 && game.allied(me, o);
      const free = p.troops;
      if (!ally) add(`⚔ 공격 (${fmt(free * ratio)})`, () => clickTile(t, sx, sy));
      if (o >= 0) {
        const myVassal = game.overlordOf(o) === me, myLord = game.overlordOf(me) === o;
        const say = (name, args, ok) => act(name, ...args).then(e => toast(e || ok));
        if (ally) {
          head('지원');
          add(`💪 병력 지원 (+${fmt(free * ratio)})`, () => say('sendAid', [o, 'troops', free * ratio], `${game.players[o].name}에 병력을 보냈어요`), free * ratio < 1);
          add(`💰 금 지원 (+${fmt(p.gold * ratio)})`, () => say('sendAid', [o, 'gold', p.gold * ratio], `${game.players[o].name}에 금을 보냈어요`), p.gold * ratio < 1);
        }
        head('관계');
        if (myVassal) {
          add('🕊 속국 풀어주기 (동맹은 유지)', () => say('releaseVassal', [o], '속국을 풀어줬어요'));
          add(`💔 관계 끊기 <span style="color:#ff8a8a;font-size:10px">${PC.BETRAY_SECS}초간 공격력 -50%</span>`, () => say('breakAlliance', [o], `속국과의 관계를 끊었어요. ${PC.BETRAY_SECS}초 동안 이 나라를 칠 때 공격력 -50%예요`));
        } else if (myLord) {
          add(`🔥 독립 선언 <span style="color:#ff8a8a;font-size:10px">${PC.BETRAY_SECS}초간 공격력 -50%</span>`, () => say('breakAlliance', [o], `독립을 선언했어요! ${PC.BETRAY_SECS}초 동안 이 나라를 칠 때 공격력 -50%예요`));
        } else {
          if (!ally) add('🤝 동맹 요청', () => say('requestAlliance', [o], '동맹 요청을 보냈어요. 잠시 뒤 답이 와요'));
          add(`👑 복종 요구 (상대 생산의 ${Math.round(PC.TRIBUTE * 100)}% 받기)`, () => say('requestDemand', [o], '복종을 요구했어요. 잠시 뒤 답이 와요'));
          add(`🏳 복종하기 (내 생산의 ${Math.round(PC.TRIBUTE * 100)}% 바치기)`, () => say('requestSubmit', [o], '복종하겠다고 전했어요. 잠시 뒤 답이 와요'));
          if (ally) add(`💔 동맹 끊기 <span style="color:#ff8a8a;font-size:10px">${PC.BETRAY_SECS}초간 이 나라 공격력 -50%</span>`, () => say('breakAlliance', [o], `동맹을 끊었어요. ${PC.BETRAY_SECS}초 동안 이 나라를 칠 때 공격력 -50%예요`));
        }
      }
    }
    if (p.counts.silo > 0 && o !== me) add(`미사일 <span style="color:var(--accent)">${fmt(MISSILE_COST)}</span>`, () => act('launchMissile', t).then(e => toast(e || '미사일 발사!')), p.gold < MISSILE_COST);
    if (!m.children.length) return;
    m.classList.remove('hidden');
    m.style.left = Math.min(sx, cw - 180) + 'px';
    m.style.top = Math.min(sy, ch - m.offsetHeight - 10) + 'px';
  }
  function hideMenu() { $('menu').classList.add('hidden'); }

  // ---------- 그리기 ----------
  function draw(now) {
    if (!isFinite(cam.x) || !isFinite(cam.y) || !isFinite(cam.s)) fitCam();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = 'rgb(20,46,92)';
    ctx.fillRect(0, 0, cw, ch);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(mapCv, cam.x, cam.y, W * cam.s, H * cam.s);
    if (!game) return;
    const S = cam.s;
    const sx = x => cam.x + (x + 0.5) * S, sy = y => cam.y + (y + 0.5) * S;

    // 건물: 차지하는 정사각형 칸을 그대로 그린다
    for (const st of game.structures) {
      const c = game.players[st.owner].color, n = st.half * 2 + 1;
      const x0 = cam.x + (st.x - st.half) * S, y0 = cam.y + (st.y - st.half) * S, side = n * S;
      if (x0 > cw + 20 || y0 > ch + 20 || x0 + side < -20 || y0 + side < -20) continue;
      const big = side >= 10;
      const spr = big && window.SPRITES ? SPRITES.get(st.type, c) : null;
      if (spr) {
        // 그림자 → 바닥판(주인 색) → 도트 그림
        ctx.fillStyle = 'rgba(0,0,0,0.28)';
        ctx.fillRect(x0 + side * 0.06, y0 + side * 0.08, side, side);
        ctx.fillStyle = `rgba(${c[0] * 0.35 | 0},${c[1] * 0.35 | 0},${c[2] * 0.35 | 0},0.55)`;
        ctx.fillRect(x0, y0, side, side);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(spr, x0, y0, side, side);
        if (st.owner === me && side >= 18) { // 내 건물은 모서리 표시
          ctx.strokeStyle = '#ffffffcc'; ctx.lineWidth = 1.5;
          const k = side * 0.22;
          ctx.beginPath();
          ctx.moveTo(x0, y0 + k); ctx.lineTo(x0, y0); ctx.lineTo(x0 + k, y0);
          ctx.moveTo(x0 + side - k, y0 + side); ctx.lineTo(x0 + side, y0 + side); ctx.lineTo(x0 + side, y0 + side - k);
          ctx.stroke();
        }
      } else if (S >= 1.2) {
        // 멀리서는 작은 점
        const z = Math.max(3, side);
        ctx.fillStyle = st.type === 'capital' ? '#ffd34d' : `rgb(${Math.min(255, c[0] + 80)},${Math.min(255, c[1] + 80)},${Math.min(255, c[2] + 80)})`;
        ctx.fillRect(x0 + side / 2 - z / 2, y0 + side / 2 - z / 2, z, z);
      }
    }
    // 짓기 미리보기: 차지할 칸(초록=가능, 빨강=불가) + 효과 범위
    if (hoverTile >= 0 && mode && BUILD[mode] && game.phase === 'play') {
      const b = BUILD[mode];
      const err = game.canBuild(me, mode, hoverTile);
      const ok = !err || err === '금이 부족해요';
      let hx = hoverTile % W, hy = (hoverTile / W) | 0, half = (b.size - 1) / 2;
      if (b.upgradeOf) { const v = game.structureAt(hoverTile); if (v) { hx = v.x; hy = v.y; half = v.half; } else half = 0; }
      ctx.fillStyle = ok ? 'rgba(80,255,120,0.28)' : 'rgba(255,70,70,0.3)';
      ctx.strokeStyle = ok ? '#6bff8f' : '#ff6b6b'; ctx.lineWidth = 2;
      const x0 = cam.x + (hx - half) * S, y0 = cam.y + (hy - half) * S, side = (half * 2 + 1) * S;
      ctx.fillRect(x0, y0, side, side); ctx.strokeRect(x0, y0, side, side);
      const R = mode === 'fort' ? FORT_RADIUS : mode === 'market' ? MARKET_RADIUS : 0;
      if (R) {
        ctx.strokeStyle = '#ffffffaa'; ctx.setLineDash([4, 4]); ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(sx(hx), sy(hy), R * S, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
      }
    }
    if (hoverTile >= 0 && mode === 'missile') {
      ctx.strokeStyle = '#ff5050dd'; ctx.setLineDash([4, 4]); ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(sx(hoverTile % W), sy((hoverTile / W) | 0), MISSILE_RADIUS * S, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
    }

    // 배
    for (const b of game.boats) {
      const t = b.path[Math.min(b.path.length - 1, Math.floor(b.pos))];
      const X = sx(t % W), Y = sy((t / W) | 0), c = game.players[b.owner].color;
      const z = Math.max(4, Math.min(12, S * 1.6));
      ctx.fillStyle = `rgb(${c})`; ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(X - z, Y - z * 0.2); ctx.lineTo(X + z, Y - z * 0.2); ctx.lineTo(X + z * 0.6, Y + z * 0.5); ctx.lineTo(X - z * 0.6, Y + z * 0.5); ctx.closePath(); ctx.fill(); ctx.stroke();
      if (b.owner === me || S >= 3) label(fmt(b.troops), X, Y - z - 6, 11, '#fff');
      if (b.owner === me) { // 목적지 표시
        const d = b.dest;
        ctx.strokeStyle = '#ffffff55'; ctx.setLineDash([3, 5]);
        ctx.beginPath(); ctx.moveTo(X, Y); ctx.lineTo(sx(d % W), sy((d / W) | 0)); ctx.stroke(); ctx.setLineDash([]);
      }
    }
    // 무역선·전함
    for (const x of game.ships) {
      const X = sx(x.tile % W), Y = sy((x.tile / W) | 0);
      if (X < -30 || Y < -30 || X > cw + 30 || Y > ch + 30) continue;
      const c = game.players[x.owner].color, mine = x.owner === me;
      if (x.kind === 'trade') {
        const z = Math.max(2.5, Math.min(6, S * 0.9));
        ctx.fillStyle = `rgb(${c})`; ctx.strokeStyle = '#ffd34d'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(X, Y, z, 0, 7); ctx.fill(); ctx.stroke();
        continue;
      }
      // 전함: 뾰족한 배 모양 + 피 막대
      const z = Math.max(6, Math.min(14, S * 2));
      const sel = x.id === selShip;
      if (sel) {
        const C = x.center;
        ctx.strokeStyle = '#ffffff88'; ctx.setLineDash([4, 4]); ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(sx(C % W), sy((C / W) | 0), PC.SHIP.patrolR * S, 0, 7); ctx.stroke(); ctx.setLineDash([]);
        ctx.beginPath(); ctx.moveTo(X, Y); ctx.lineTo(sx(C % W), sy((C / W) | 0)); ctx.stroke();
      }
      ctx.fillStyle = `rgb(${c})`;
      ctx.strokeStyle = sel ? '#ffd34d' : mine ? '#ffffff' : '#000000';
      ctx.lineWidth = sel ? 2.5 : 1.5;
      ctx.beginPath();
      ctx.moveTo(X - z, Y - z * 0.25); ctx.lineTo(X + z * 0.7, Y - z * 0.25); ctx.lineTo(X + z * 1.1, Y); ctx.lineTo(X + z * 0.7, Y + z * 0.35); ctx.lineTo(X - z * 0.8, Y + z * 0.35); ctx.closePath();
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#ffffffcc'; ctx.fillRect(X - z * 0.3, Y - z * 0.6, z * 0.5, z * 0.35);
      if (x.hp < x.maxHp || mine) {
        const bw = z * 2, f = Math.max(0, x.hp / x.maxHp);
        ctx.fillStyle = '#000a'; ctx.fillRect(X - bw / 2, Y - z - 4, bw, 3);
        ctx.fillStyle = f > 0.6 ? '#6be38f' : f > 0.3 ? '#ffd34d' : '#ff6b6b'; ctx.fillRect(X - bw / 2, Y - z - 4, bw * f, 3);
      }
      if (x.state === 'repair' && S >= 2) label('🔧', X + z, Y - z, 10, '#fff');
    }
    // 전함 만들기 미리보기: 지킬 범위
    if (hoverTile >= 0 && mode === 'warship' && !map.ter[hoverTile]) {
      ctx.strokeStyle = '#9fd8ffcc'; ctx.setLineDash([4, 4]); ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(sx(hoverTile % W), sy((hoverTile / W) | 0), PC.SHIP.patrolR * S, 0, 7); ctx.stroke(); ctx.setLineDash([]);
    }
    // 미사일
    for (const m of game.missiles) {
      const k = m.t / m.dur;
      const X0 = sx(m.fx), Y0 = sy(m.fy), X1 = sx(m.tx), Y1 = sy(m.ty);
      const arc = Math.hypot(X1 - X0, Y1 - Y0) * 0.35;
      const X = X0 + (X1 - X0) * k, Y = Y0 + (Y1 - Y0) * k - Math.sin(k * Math.PI) * arc;
      ctx.strokeStyle = '#ff505088'; ctx.lineWidth = 1.5; ctx.beginPath();
      for (let j = 0; j <= 20; j++) { const kk = k * j / 20; const xx = X0 + (X1 - X0) * kk, yy = Y0 + (Y1 - Y0) * kk - Math.sin(kk * Math.PI) * arc; j ? ctx.lineTo(xx, yy) : ctx.moveTo(xx, yy); }
      ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(X, Y, 3, 0, 7); ctx.fill();
      const blink = (now / 200 | 0) % 2;
      ctx.strokeStyle = blink ? '#ff3030' : '#ff303055'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(X1, Y1, MISSILE_RADIUS * S, 0, 7); ctx.stroke();
    }
    // 폭발
    if (game.blasts) {
      for (let i = game.blasts.length - 1; i >= 0; i--) {
        const b = game.blasts[i];
        const age = (game.tick - b.tick) / 15;
        if (age > 1) { game.blasts.splice(i, 1); continue; }
        ctx.fillStyle = `rgba(255,${180 - age * 150},60,${0.8 * (1 - age)})`;
        ctx.beginPath(); ctx.arc(sx(b.x), sy(b.y), MISSILE_RADIUS * S * (0.5 + age * 0.9), 0, 7); ctx.fill();
      }
    }
    // 글씨가 겹치지 않게 자리 잡기
    // 우선순위: 내 싸움 배지 → 내 나라 이름 → 다른 나라 이름(큰 나라부터) → 남의 싸움 배지
    slots.length = 0;
    drawFronts(true);
    drawLabels();
    drawFronts(false);
    // 마우스 칸
    if (hoverTile >= 0 && S >= 4) {
      ctx.strokeStyle = '#ffffffcc'; ctx.lineWidth = 1;
      ctx.strokeRect(cam.x + (hoverTile % W) * S + 0.5, cam.y + ((hoverTile / W) | 0) * S + 0.5, S - 1, S - 1);
    }
    // 클릭 물결
    for (let i = fx.length - 1; i >= 0; i--) {
      const f = fx[i], age = Math.max(0, (now - f.t0) / 400);
      if (age > 1) { fx.splice(i, 1); continue; }
      ctx.strokeStyle = `rgba(255,255,255,${1 - age})`; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(sx(f.x), sy(f.y), 4 + age * 18, 0, 7); ctx.stroke();
    }
    // 시작 단계: 내 위치 표시
    if (game.phase === 'spawn' && game.players[me].spawned) {
      const t = game.players[me].spawnTile;
      const r = 10 + Math.sin(now / 180) * 3;
      ctx.strokeStyle = '#ffd34d'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(sx(t % W), sy((t / W) | 0), r + S * 3, 0, 7); ctx.stroke();
    }
  }
  // 나라 이름 + 병력. 다른 글씨와 겹치면 살짝 비키거나 줄이고, 그래도 안 되면 (내 나라가 아니면) 이번엔 안 그린다
  function drawLabels() {
    const S = cam.s;
    const list = game.players.filter(p => p.alive && p.label)
      .sort((a, b) => (b.id === me) - (a.id === me) || b.label.size - a.label.size);
    for (const p of list) {
      const L = p.label;
      const mine = p.id === me;
      if (L.size * S < 5 && !mine) continue;
      const X = cam.x + (L.x + 0.5) * S, Y = cam.y + (L.y + 0.5) * S;
      if (X < -100 || X > cw + 100 || Y < -40 || Y > ch + 40) continue;
      const ally = game.allied(me, p.id);
      const color = mine ? '#ffd34d' : ally ? '#b8ffcf' : '#fff';
      const base = Math.max(Math.min(34, L.size * S * 0.55), mine ? 11 : 8);
      let done = false;
      for (const fs of [base, base * 0.75, 8]) {
        if (fs < 8 && !mine) break;
        let name = fs < 11 && p.name.length > 6 ? p.name.split(' ')[0] : p.name;
        if (game.overlordOf(p.id) === me) name = '⛓' + name;
        else if (game.overlordOf(me) === p.id) name = '👑' + name;
        else if (ally) name = '🤝' + name;
        ctx.font = `bold ${Math.round(fs)}px 'Malgun Gothic', sans-serif`;
        const w = Math.max(ctx.measureText(name).width, ctx.measureText(fmt(p.troops)).width * 0.85) + 4;
        const h = fs * 2.0;
        // 이름표 상자 가운데가 나라 안쪽 지점에 오도록
        for (const k of mine ? [0, 1, -1, 2, -2, 3] : [0, 1, -1]) {
          const cy = Y + fs * 0.2 + k * (h * 0.6);
          const r = { x: X - w / 2, y: cy - h / 2, w, h };
          const hit = slots.some(o => r.x < o.x + o.w && o.x < r.x + r.w && r.y < o.y + o.h && o.y < r.y + r.h);
          if (hit && !(mine && fs === 8 && k === 3)) continue;
          slots.push(r);
          label(name, X, cy - fs * 0.55, fs, color);
          label(fmt(p.troops), X, cy + fs * 0.55, fs * 0.85, '#fff');
          done = true;
          break;
        }
        if (done) break;
      }
    }
  }
  // ---------- 배지 자리 잡기 ----------
  // 이번 프레임에 그린 배지 상자들. 새 배지가 겹치면 위·아래로 한 칸씩 비켜 본다.
  const slots = [];
  function placeBox(X, Y, w, h, above, force) {
    const base = above ? Y - h - 8 : Y + 6, step = h + 4;
    for (const k of [0, -1, 1, -2, 2, -3, 3, -4, 4]) {
      const r = { x: X - w / 2 - 2, y: base + k * step - 2, w: w + 4, h: h + 4 };
      if (!slots.some(o => r.x < o.x + o.w && o.x < r.x + r.w && r.y < o.y + o.h && o.y < r.y + r.h)) {
        slots.push(r);
        return { x: X - w / 2, y: base + k * step, moved: k !== 0 };
      }
    }
    if (!force) return null; // 자리가 없으면 그리지 않는다
    slots.push({ x: X - w / 2 - 2, y: base - 2, w: w + 4, h: h + 4 });
    return { x: X - w / 2, y: base, moved: false };
  }
  // 배지가 원래 자리에서 밀려났으면 가는 선으로 실제 위치를 이어 준다
  function leader(X, Y, b, w, h) {
    const ey = b.y > Y ? b.y : b.y + h;
    ctx.strokeStyle = '#ffffffaa'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(X, Y); ctx.lineTo(Math.max(b.x + 6, Math.min(b.x + w - 6, X)), ey); ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(X, Y, 2.5, 0, 7); ctx.fill();
  }

  // 싸움 판세 배지: 앞선 쪽 색으로 차이만큼 표시. mineOnly 면 내 싸움만, 아니면 남의 싸움만
  function drawFronts(mineOnly) {
    const S = cam.s;
    const isMine = a => a.att === me || a.def === me;
    let list = game.attacks.filter(a => a.def >= 0 && a.fx != null && isMine(a) === mineOnly);
    // 멀리서 볼 때는 큰 싸움 8개만
    if (!mineOnly && S < 4) list = list.sort((a, b) => b.pool - a.pool).slice(0, 8);
    for (const a of list) {
      const mine = mineOnly;
      const X = cam.x + (a.fx + 0.5) * S, Y = cam.y + (a.fy + 0.5) * S;
      if (X < -60 || X > cw + 60 || Y < -30 || Y > ch + 30) continue;
      const edge = game.battleEdge(a);
      // 이기고 있는 쪽 색으로 배지를 칠한다 (테두리는 지고 있는 쪽 색)
      const lead = game.players[edge >= 0 ? a.att : a.def];
      const lose = game.players[edge >= 0 ? a.def : a.att];
      const c = lead.color, lc = lose.color;
      const lum = 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
      const fg = lum > 150 ? '#141414' : '#ffffff', fgDim = lum > 150 ? '#141414cc' : '#ffffffcc';
      const fs = mine ? 16 : (S < 4 ? 10 : 11);
      const meAhead = (edge >= 0) === (a.att === me);
      const main = mine ? `${meAhead ? '▲' : '▼'} ${fmt(Math.abs(edge))} ${meAhead ? '우세' : '열세'}` : `⚔ ${fmt(Math.abs(edge))}`;
      // 내 싸움은 여러 줄: 누가 누구를 치는지 / 숫자 뜻 / 지금 상태
      const lines = [];
      if (mine) {
        const iAttack = a.att === me;
        const other = game.players[iAttack ? a.def : a.att];
        const left = game.tilesLeft(a);
        lines.push(iAttack ? `⚔ 내가 ${other.name} 공격 중` : `🔥 ${other.name}이(가) 쳐들어옴`);
        lines.push(iAttack ? `남은 공격 병력 ${fmt(a.pool)} vs 상대 병력 ${fmt(other.troops)}` : `적 공격 병력 ${fmt(a.pool)} vs 우리 병력 ${fmt(game.players[me].troops)}`);
        lines.push(iAttack ? `앞으로 약 ${fmt(left)}칸 더 빼앗아요` : `적이 약 ${fmt(left)}칸 더 빼앗아 가요 · 반격하려면 적 땅 클릭`);
        const bl = game.betrayLeft(a.att, a.def);
        if (bl) lines.splice(lines.length - 1, 0, iAttack ? `⚠ 배신 패널티 공격력 -50% (${bl}초)` : `⚠ 배신자라 적 공격력 -50% (${bl}초)`);
      }
      const subFont = `600 12px 'Malgun Gothic', sans-serif`;
      ctx.font = `bold ${fs}px 'Malgun Gothic', sans-serif`;
      let w = ctx.measureText(main).width;
      ctx.font = subFont;
      for (const l of lines) w = Math.max(w, ctx.measureText(l).width);
      const LH = 16;
      const bw = w + 18, bh = fs + 10 + lines.length * LH;
      const b = placeBox(X, Y, bw, bh, true, mine);
      if (!b) continue;
      const bx = b.x, by = b.y;
      if (b.moved) leader(X, Y, b, bw, bh);
      ctx.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},0.96)`;
      ctx.strokeStyle = `rgb(${lc})`;
      ctx.lineWidth = mine ? 3 : 1.5;
      ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, 6); ctx.fill(); ctx.stroke();
      if (!b.moved) { ctx.beginPath(); ctx.moveTo(X - 5, by + bh); ctx.lineTo(X, Y - 1); ctx.lineTo(X + 5, by + bh); ctx.closePath(); ctx.fill(); }
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      let ty = by + 6;
      if (lines.length) { ctx.font = subFont; ctx.fillStyle = fgDim; ctx.fillText(lines[0], X, ty + LH / 2); ty += LH; }
      ctx.font = `bold ${fs}px 'Malgun Gothic', sans-serif`;
      ctx.fillStyle = fg;
      ctx.fillText(main, X, ty + fs / 2 + 1); ty += fs + 4;
      ctx.font = subFont;
      for (let i = 1; i < lines.length; i++) {
        ctx.fillStyle = i === lines.length - 1 ? fg : fgDim;
        ctx.fillText(lines[i], X, ty + LH / 2); ty += LH;
      }
    }
  }
  function label(txt, x, y, size, color) {
    ctx.font = `bold ${Math.round(size)}px 'Malgun Gothic', sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineWidth = Math.max(2, size / 4); ctx.strokeStyle = '#000b'; ctx.lineJoin = 'round';
    ctx.strokeText(txt, x, y);
    ctx.fillStyle = color; ctx.fillText(txt, x, y);
  }

  // ---------- 화면 글자 ----------
  let uiT = 0;
  function updateUI() {
    const p = game.players[me];
    const max = game.maxTroops(p);
    $('hTroops').textContent = `${fmt(p.troops)} / ${fmt(max)}`;
    $('hTroopBar').style.width = (p.troops / max * 100).toFixed(1) + '%';
    $('hGold').textContent = `${fmt(p.gold)}  (+${fmt(game.goldRate(p) * TPS)}/초)`;
    $('bGold').textContent = fmt(p.gold);
    $('bGoldR').textContent = `+${fmt(game.goldRate(p) * TPS)}/초`;
    $('bTroops').textContent = fmt(p.troops);
    $('bTroopsM').textContent = `/ ${fmt(max)}`;
    showRatio();
    $('autoBtn').disabled = !p.alive || game.phase !== 'play';
    const order = ['capital', 'city', 'village', 'farm', 'mine', 'port', 'market', 'fort', 'silo'];
    const parts = order.filter(k => p.counts[k] > 0).map(k => `${BUILD[k].icon}${p.counts[k]}`);
    $('hBuild').textContent = parts.length ? parts.join(' ') : '없음';
    $('hLand').textContent = `${(p.tiles / game.land * 100).toFixed(1)}%  (${p.tiles}칸)`;
    const alive = game.phase === 'play' && p.alive ? game.tick : (p.deadTick > 0 ? p.deadTick : game.tick);
    $('hTime').textContent = mmss(Math.max(0, alive - (game.startTick || 0)));
    const allies = game.alliesOf(me);
    $('hAlly').textContent = allies.length ? allies.map(q => q.name).join(', ') : '없음';
    const lord = game.overlordOf(me), vs = game.vassalsOf(me), tr = p.trib || { inT: 0, inG: 0, outT: 0, outG: 0 };
    const vEl = $('hVassal');
    if (lord >= 0) { vEl.style.color = '#fc6'; vEl.textContent = `👑${game.players[lord].name}에 복종 · 초당 -${fmt(tr.outT * TPS)}명 -${fmt(tr.outG * TPS)}금`; }
    else if (vs.length) { vEl.style.color = '#8f8'; vEl.textContent = `속국 ${vs.length} · 초당 +${fmt(tr.inT * TPS)}명 +${fmt(tr.inG * TPS)}금`; }
    else { vEl.style.color = ''; vEl.textContent = '없음'; }
    if (selShip && !game.ships.some(x => x.id === selShip)) selShip = 0;
    const nW = game.warships(me).length, nT = game.traders(me).length;
    const tradeMin = (p.tradeLog || []).filter(e => game.tick - e[0] < 600).reduce((a, e) => a + e[1], 0);
    $('hFleet').textContent = (nW || nT || tradeMin) ? `⛴${nW} 🚢${nT} · 무역 +${fmt(tradeMin)}/분` : '없음';
    updateRequests();
    updateAllyPanel();
    for (const [type] of BTN) {
      const el = $('b_' + type);
      const c = game.cost(p, type);
      el.querySelector('.cost').textContent = fmt(c);
      el.disabled = !p.alive || game.phase !== 'play' || p.gold < c || (type === 'missile' && p.counts.silo === 0) || (type === 'city' && p.counts.village === 0) || (type === 'warship' && p.counts.port === 0);
      if (el.disabled && mode === type) setMode(null);
    }
    // 순위
    const list = game.players.filter(q => q.alive).sort((a, b) => b.tiles - a.tiles);
    const top = list.slice(0, 10);
    const myRank = list.indexOf(p);
    if (myRank >= 10) top.push(p);
    $('boardList').innerHTML = top.map(q => `<div class="it ${q.id === me ? 'me' : ''}" data-id="${q.id}"><span class="r" style="text-align:left">${list.indexOf(q) + 1}</span><i class="c" style="background:rgb(${q.color})"></i><span class="n">${relIcon(q.id)}${esc(q.name)}</span><span class="r">${(q.tiles / game.land * 100).toFixed(1)}%</span><span class="r r2">${fmt(q.troops)}</span></div>`).join('') +
      `<div style="color:var(--dim);margin-top:5px;font-size:11px">살아남은 나라 ${list.length} / ${game.players.length}</div>`;
    // 배너
    const bn = $('banner');
    if (game.phase === 'spawn') {
      bn.classList.remove('hidden');
      bn.innerHTML = `시작할 곳을 클릭하세요 · ${Math.ceil(game.spawnTicks / TPS)}초<small>${p.spawned ? '골랐어요! 다른 곳을 눌러 바꿀 수 있어요' : '안 고르면 무작위로 정해져요'}</small>`;
    } else if (paused) { bn.classList.remove('hidden'); bn.innerHTML = '일시정지<small>Space 로 계속</small>'; }
    else bn.classList.add('hidden');
    // 마우스 정보
    const tip = $('tip');
    if (hoverTile >= 0 && !drag && !pinch) {
      const o = game.owner[hoverTile], te = map.ter[hoverTile];
      let h;
      if (!te) h = '<span class="t">바다</span>';
      else if (o < 0) h = `빈 땅 <span class="t">· ${TER[te].name}</span>`;
      else { const q = game.players[o]; h = `<b style="color:rgb(${q.color})">■</b> ${esc(q.name)}${relText(o)} <span class="t">· ${TER[te].name}</span><br><span class="t">병력</span> ${fmt(q.troops)} <span class="t">영토</span> ${(q.tiles / game.land * 100).toFixed(1)}%`; }
      const hs = shipNear(mouse.x, mouse.y, 12);
      if (hs) {
        const q = game.players[hs.owner];
        h += hs.kind === 'war'
          ? `<br>⛴ <b>${esc(q.name)}의 전함</b> <span class="t">피</span> ${Math.round(hs.hp)}/${hs.maxHp}${hs.state === 'repair' ? ' <span class="t">(수리 중)</span>' : hs.state === 'return' ? ' <span class="t">(항구로 후퇴)</span>' : ''}`
          : `<br>🚢 <b>${esc(q.name)}의 무역선</b> <span class="t">싣고 있는 돈</span> ${fmt(hs.value)}`;
      }
      const s = game.structureAt(hoverTile);
      if (s) h += `<br>${BUILD[s.type].icon} <b>${BUILD[s.type].name}</b> <span class="t">${BUILD[s.type].desc}</span>`;
      if (mode && BUILD[mode] && game.phase === 'play') {
        const err = game.canBuild(me, mode, hoverTile);
        h += `<br>${err ? `<span style="color:#ff8a8a">✗ ${err}</span>` : `<span style="color:#8f8">✓ ${BUILD[mode].name} 지을 수 있어요 (${fmt(game.cost(p, mode))}금)</span>`}`;
      }
      tip.innerHTML = h;
      tip.classList.remove('hidden');
      tip.style.left = Math.min(mouse.x + 14, cw - tip.offsetWidth - 6) + 'px';
      tip.style.top = Math.min(mouse.y + 16, ch - tip.offsetHeight - 6) + 'px';
    } else tip.classList.add('hidden');
  }
  function relText(o) {
    if (o === me) return '';
    if (game.overlordOf(o) === me) return ' <span style="color:#8f8">⛓내 속국</span>';
    if (game.overlordOf(me) === o) return ' <span style="color:#fc6">👑내 종주국</span>';
    if (game.allied(me, o)) return ' <span style="color:#8f8">🤝동맹</span>';
    const lord = game.overlordOf(o);
    return lord >= 0 ? ` <span class="t">(${esc(game.players[lord].name)}의 속국)</span>` : '';
  }
  function relIcon(id) {
    if (game.overlordOf(id) === me) return '⛓ ';
    if (game.overlordOf(me) === id) return '👑 ';
    return game.allied(me, id) ? '🤝 ' : '';
  }
  // 외교 패널: 동맹·속국·종주국 목록과 병력·금 지원 버튼 (보낼 양 = 아래 막대 비율)
  let allyKey = '';
  function updateAllyPanel() {
    const box = $('allyPanel');
    const p = game.players[me];
    const list = game.players.filter(q => q.alive && q.id !== me && (game.allied(me, q.id) || game.isVassalPair(me, q.id)));
    const key = list.map(q => q.id + ':' + game.overlordOf(q.id) + ':' + game.overlordOf(me)).join(',');
    if (key !== allyKey) {
      allyKey = key;
      box.classList.toggle('hidden', !list.length || !p.alive);
      box.innerHTML = '<div class="ah">🤝 외교 · 지원 <span class="t">(보낼 양 = 아래 비율)</span></div>' + list.map(q => {
        const rel = game.overlordOf(q.id) === me ? '⛓속국' : game.overlordOf(me) === q.id ? '👑종주국' : '🤝동맹';
        return `<div class="ar" data-id="${q.id}"><i class="c" style="background:rgb(${q.color})"></i><span class="an" title="눌러서 그 나라로 이동">${esc(q.name)}</span><span class="rel">${rel}</span>`
          + `<span class="at"></span><button class="aT">💪</button><button class="aG">💰</button></div>`;
      }).join('');
      for (const row of box.querySelectorAll('.ar')) {
        const id = +row.dataset.id;
        row.querySelector('.aT').onclick = () => { const amt = game.players[me].troops * ratio; act('sendAid', id, 'troops', amt).then(e => toast(e || `💪 ${game.players[id].name}에 병력 ${fmt(amt)} 보냈어요`)); };
        row.querySelector('.aG').onclick = () => { const amt = game.players[me].gold * ratio; act('sendAid', id, 'gold', amt).then(e => toast(e || `💰 ${game.players[id].name}에 금 ${fmt(amt)} 보냈어요`)); };
        row.querySelector('.an').onclick = () => { const q = game.players[id]; if (q.label) centerOn(q.label.x, q.label.y, Math.max(cam.s, 3)); };
      }
    }
    // 숫자만 바꾸기 (버튼을 새로 만들지 않아야 누르기가 안 끊김)
    for (const row of box.querySelectorAll('.ar')) {
      const q = game.players[+row.dataset.id];
      if (!q) continue;
      row.querySelector('.at').textContent = `${fmt(q.troops)}명`;
      row.querySelector('.aT').title = `병력 ${fmt(p.troops * ratio)}명 보내기`;
      row.querySelector('.aG').title = `금 ${fmt(p.gold * ratio)} 보내기`;
    }
  }
  // 나에게 온 동맹 요청 창
  const reqEls = new Map();
  function updateRequests() {
    const box = $('reqs');
    const mineReq = game.requests.filter(r => r.to === me);
    const ids = new Set(mineReq.map(r => r.id));
    for (const [id, el] of reqEls) if (!ids.has(id)) { el.remove(); reqEls.delete(id); }
    for (const r of mineReq) {
      let el = reqEls.get(r.id);
      const from = game.players[r.from];
      if (!el) {
        el = document.createElement('div');
        el.className = 'req panel';
        const T = Math.round(PC.TRIBUTE * 100);
        const kind = r.type || 'ally';
        const msg = kind === 'ally' ? '동맹을 원해요'
          : kind === 'submit' ? `복종하겠대요 <span style="color:var(--good)">(생산의 ${T}%를 우리에게)</span>`
          : `<span style="color:var(--bad)">복종을 요구해요!</span> <span class="t">(받으면 내 생산의 ${T}%를 바침, 거절하면 쳐들어올 수도)</span>`;
        const yes = kind === 'ally' ? '수락' : kind === 'submit' ? '받아주기' : '복종';
        el.innerHTML = `<div><i class="c" style="background:rgb(${from.color})"></i><b>${esc(from.name)}</b>이(가) ${msg}<br><span class="t">병력 ${fmt(from.troops)} · 영토 ${(from.tiles / game.land * 100).toFixed(1)}%${(from.traitorUntil || 0) > game.tick ? ' · <span style="color:var(--bad)">최근 배신함</span>' : ''}</span></div><div class="btns"><button class="yes">${yes}</button><button class="no">거절 <span class="cd"></span></button></div>`;
        if (kind === 'demand') el.style.borderColor = '#ff6b6b88';
        el.querySelector('.yes').onclick = () => { el.remove(); act('answerRequestById', r.id, true); };
        el.querySelector('.no').onclick = () => { el.remove(); act('answerRequestById', r.id, false); };
        box.appendChild(el);
        reqEls.set(r.id, el);
      }
      el.querySelector('.cd').textContent = Math.max(0, Math.ceil((r.tick + 15 * TPS - game.tick) / TPS)) + '초';
    }
  }
  $('boardList').addEventListener('click', e => {
    const it = e.target.closest('.it');
    if (!it || !game) return;
    const q = game.players[+it.dataset.id];
    if (q.label) centerOn(q.label.x, q.label.y, Math.max(cam.s, 3));
  });
  function esc(s) { return s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  function checkOver() {
    if (overShown || watching) return;
    const p = game.players[me];
    const lost = !p.alive && game.phase !== 'spawn';
    if (!lost && game.phase !== 'over') return;
    overShown = true;
    const won = game.phase === 'over' && game.winner === me;
    const alive = game.players.filter(q => q.alive).length;
    const rank = lost ? alive + 1 : game.players.filter(q => q.alive && q.tiles > p.tiles).length + 1;
    const lived = (p.alive ? game.tick : p.deadTick) - (game.startTick || 0);
    const rec = loadRec();
    rec.games++; if (won) rec.wins++; rec.best = Math.max(rec.best, lived);
    localStorage.setItem('pc_rec', JSON.stringify(rec));
    $('overTitle').innerHTML = won ? '🏆 <span>승리!</span>' : lost ? '멸망했어요' : '다른 나라가 이겼어요';
    $('overStats').innerHTML = `생존 시간 <b>${mmss(lived)}</b><br>최대 영토 <b>${(p.peakTiles / game.land * 100).toFixed(1)}%</b><br>순위 <b>${rank}위</b> / ${game.players.length}나라`;
    $('watchBtn').classList.toggle('hidden', game.phase === 'over');
    $('over').classList.remove('hidden');
  }

  // ---------- 반복 ----------
  function frame(now) {
    const dt = Math.min(250, now - (last || now));
    last = now;
    if (game && !net && !paused && game.phase !== 'over') {
      acc += dt * speed;
      const tickMs = 1000 / TPS;
      let n = 0;
      while (acc >= tickMs && n < 40) {
        const wasSpawn = game.phase === 'spawn';
        try { game.step(); } catch (err) { if (!frame.stepWarned) { console.error(err); frame.stepWarned = true; } }
        if (wasSpawn && game.phase === 'play') { game.startTick = game.tick; const p = game.players[me]; if (p.label) centerOn(p.label.x, p.label.y, Math.max(cam.s, Math.min(cw, ch) / 110)); }
        acc -= tickMs; n++;
      }
      if (n >= 40) acc = 0;
    }
    if (game) {
      if (game.allianceVer !== allyVer) { allyVer = game.allianceVer; repaintAll(); game.dirty.length = 0; }
      flushDirty();
      if (now - uiT > 150) { uiT = now; try { updateUI(); updateLog(); checkOver(); } catch (err) { console.error(err); } }
    }
    // 그리다가 오류가 나도 게임 반복은 멈추지 않게
    try { draw(now); } catch (err) { if (!frame.warned) { console.error(err); frame.warned = true; } }
    requestAnimationFrame(frame);
  }
  for (let t = 0; t < N; t++) { px[t * 4] = base[t * 3]; px[t * 4 + 1] = base[t * 3 + 1]; px[t * 4 + 2] = base[t * 3 + 2]; px[t * 4 + 3] = 255; }
  mctx.putImageData(img, 0, 0);
  resize(); fitCam();
  requestAnimationFrame(frame);

  // 자동 점검용
  window.__pc = { get game() { return game; }, cam, startGame, clickTile, toTile, get me() { return me; }, setSpeed: v => { speed = v; }, createRoom, joinRoom, get net() { return net; }, act };
})();
