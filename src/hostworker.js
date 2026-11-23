// 도트 정복전 — 방장 브라우저 뒤에서 도는 진짜 게임 (웹 워커)
// 탭이 뒤로 가도 멈추지 않게 워커에서 돌린다. 화면(main.js)에는 참가자와 똑같이 상태를 보내 준다.
/* global importScripts, PC, NET */
importScripts('mapdata.js', 'game.js', 'net.js');

const map = PC.decodeMap(self.MAP_DATA);
const MAX_HUMANS = 16;
const SEND_MS = 300;

let ws = null, code = '', settings = null;
let lobby = []; // { name, color, token, cid(null=방장 본인 또는 나감), pid }
let game = null, st = null, timer = null, lastTime = 0, acc = 0, lastSend = 0, pingTimer = null;

const post = m => self.postMessage(m);
const toAll = obj => { if (ws && ws.readyState === 1) ws.send('A' + JSON.stringify(obj)); };
const toOne = (cid, obj) => { if (ws && ws.readyState === 1 && cid) ws.send('T' + cid + '|' + JSON.stringify(obj)); };
const lobbyView = () => lobby.map(e => ({ name: e.name, color: e.color, here: !!e.host || !!e.cid, host: !!e.host }));

function sendLobby() {
  const m = { t: 'lobby', code, players: lobbyView(), settings };
  post(m);
  toAll(m);
}

self.onmessage = e => {
  const m = e.data;
  if (m.cmd === 'open') {
    code = m.code; settings = m.settings;
    lobby = [{ name: m.me.name, color: m.me.color, token: m.me.token, cid: null, host: true, pid: 0 }];
    try { ws = new WebSocket(m.relay + '/ws/' + code + '?role=host'); } catch (err) { post({ t: 'status', state: 'error', msg: '서버에 연결할 수 없어요' }); return; }
    ws.onopen = () => { post({ t: 'status', state: 'open' }); sendLobby(); };
    ws.onerror = () => post({ t: 'status', state: 'error', msg: '서버 연결 오류' });
    ws.onclose = () => post({ t: 'status', state: 'closed', msg: '서버 연결이 끊겼어요' });
    ws.onmessage = ev => onRelay(ev.data);
    // 대기실에서도 연결이 잠들지 않게
    pingTimer = setInterval(() => { if (!game) sendLobby(); }, 15000);
  } else if (m.cmd === 'start') startGame();
  else if (m.cmd === 'act') {
    const result = game ? NET.runCommand(game, 0, m.name, m.args) : '아직 시작 전이에요';
    post({ t: 'res', id: m.id, result });
  } else if (m.cmd === 'kick') {
    const ent = lobby[m.index];
    if (ent && !ent.host && !game) { if (ent.cid && ws) ws.send('K' + ent.cid); lobby.splice(m.index, 1); sendLobby(); }
  } else if (m.cmd === 'close') {
    clearInterval(timer); clearInterval(pingTimer);
    if (ws) ws.close();
    self.close();
  }
};

function onRelay(data) {
  if (typeof data !== 'string') return;
  if (data[0] === '{') { // 서버가 보낸 것
    let o; try { o = JSON.parse(data); } catch (e) { return; }
    if (o.t === 'taken') post({ t: 'status', state: 'taken', msg: '같은 방 코드가 이미 쓰이고 있어요. 다시 만들어 주세요' });
    return;
  }
  if (data[0] === 'L') { // 참가자가 나감
    const ent = lobby.find(x => x.cid === data.slice(1));
    if (ent) {
      ent.cid = null;
      if (!game) lobby.splice(lobby.indexOf(ent), 1);
      sendLobby();
    }
    return;
  }
  if (data[0] !== 'C') return;
  const bar = data.indexOf('|');
  const cid = data.slice(1, bar);
  let o; try { o = JSON.parse(data.slice(bar + 1)); } catch (e) { return; }
  if (o.t === 'hello') {
    const name = String(o.name || '손님').slice(0, 14);
    const color = Array.isArray(o.color) && o.color.length === 3 ? o.color.map(v => Math.max(0, Math.min(255, v | 0))) : [200, 200, 200];
    let ent = lobby.find(x => x.token === o.token && !x.host);
    if (ent) { ent.cid = cid; ent.name = name; } // 다시 들어옴
    else if (game) { toOne(cid, { t: 'refused', msg: '이미 시작한 게임이에요. 다음 판에 같이 해요' }); return; }
    else if (lobby.length >= MAX_HUMANS) { toOne(cid, { t: 'refused', msg: '방이 꽉 찼어요' }); return; }
    else { ent = { name, color, token: o.token, cid, pid: -1 }; lobby.push(ent); }
    if (game) toOne(cid, { t: 'start', pid: ent.pid, snap: NET.makeSnapshot(game) });
    sendLobby();
  } else if (o.t === 'cmd') {
    const ent = lobby.find(x => x.cid === cid);
    const result = game && ent && ent.pid >= 0 ? NET.runCommand(game, ent.pid, o.name, o.args) : '게임에 참가하지 않았어요';
    toOne(cid, { t: 'res', id: o.id, result });
  }
}

function startGame() {
  if (game) return;
  game = new PC.Game(map, { spawnTicks: 200 }); // 시작 위치 고르는 시간 20초
  for (const ent of lobby) ent.pid = game.addPlayer({ name: ent.name, color: ent.color, isBot: false });
  for (let i = 0; i < settings.bots; i++) game.addPlayer({ isBot: true, difficulty: settings.diff });
  for (const p of game.players) if (p.isBot) game.randomSpawn(p.id);
  game.netDirty = [];
  st = NET.newSendState(game);
  const snap = NET.makeSnapshot(game);
  post({ t: 'start', pid: 0, snap: JSON.stringify(snap) });
  for (const ent of lobby) if (!ent.host && ent.cid) toOne(ent.cid, { t: 'start', pid: ent.pid, snap });
  lastTime = Date.now(); acc = 0; lastSend = lastTime;
  timer = setInterval(loop, 50);
}

function loop() {
  const now = Date.now();
  acc += Math.min(5000, now - lastTime);
  lastTime = now;
  let n = 0;
  while (acc >= 100 && n < 30) { // 늦으면 따라잡는다
    try { game.step(); } catch (err) { post({ t: 'status', state: 'error', msg: '게임 오류: ' + err.message }); }
    acc -= 100; n++;
  }
  if (n >= 30) acc = 0;
  if (now - lastSend >= SEND_MS) {
    lastSend = now;
    const s = JSON.stringify(NET.makeDelta(game, st));
    post({ t: 'pk', s });
    if (ws && ws.readyState === 1) ws.send('A' + s);
  }
}
