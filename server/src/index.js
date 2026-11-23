// 도트 정복전 멀티 중계 서버 (Cloudflare Worker + Durable Object)
// 게임은 방장 브라우저가 돌린다. 이 서버는 방마다 메시지를 전달만 한다.
//
// 주소: /ws/<방코드>?role=host|guest
// 방장이 보내는 것:  "A" + 내용  → 모든 참가자에게
//                    "T" + 참가자번호 + "|" + 내용 → 그 참가자에게
//                    "K" + 참가자번호 → 그 참가자 내보내기
// 참가자가 보내는 것: 내용 → 방장에게 "C" + 참가자번호 + "|" + 내용 으로 전달
// 서버가 방장에게:   "L" + 참가자번호 (나감)
// 서버가 참가자에게: {"t":"hostgone"} (방장이 나감·방 없음)

const CORS = { 'Access-Control-Allow-Origin': '*' };

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const m = url.pathname.match(/^\/ws\/([A-Z0-9]{4,8})$/);
    if (m) {
      const id = env.ROOMS.idFromName(m[1]);
      return env.ROOMS.get(id).fetch(req);
    }
    return new Response('dot-conquest relay ok', { headers: CORS });
  },
};

export class Room {
  constructor(state) {
    this.state = state;
  }

  async fetch(req) {
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('websocket only', { status: 426, headers: CORS });
    const role = new URL(req.url).searchParams.get('role') === 'host' ? 'host' : 'guest';
    const host = this.state.getWebSockets('host')[0];
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    if (role === 'host' && host) {
      // 같은 코드로 방이 이미 열려 있음
      this.state.acceptWebSocket(server, ['dead']);
      server.send('{"t":"taken"}');
      server.close(4001, 'taken');
      return new Response(null, { status: 101, webSocket: client });
    }
    if (role === 'guest' && !host) {
      this.state.acceptWebSocket(server, ['dead']);
      server.send('{"t":"hostgone"}');
      server.close(4002, 'no host');
      return new Response(null, { status: 101, webSocket: client });
    }
    const cid = crypto.randomUUID().replace(/-/g, '').slice(0, 10);
    this.state.acceptWebSocket(server, [role, 'c' + cid]);
    server.serializeAttachment({ role, cid });
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, msg) {
    if (typeof msg !== 'string') return;
    const att = ws.deserializeAttachment();
    if (!att) return;
    if (att.role === 'host') {
      const k = msg[0];
      if (k === 'A') {
        const body = msg.slice(1);
        for (const g of this.state.getWebSockets('guest')) { try { g.send(body); } catch (e) { /* 끊긴 사람 */ } }
      } else if (k === 'T') {
        const bar = msg.indexOf('|');
        const to = this.state.getWebSockets('c' + msg.slice(1, bar))[0];
        if (to) { try { to.send(msg.slice(bar + 1)); } catch (e) { /* 끊김 */ } }
      } else if (k === 'K') {
        const to = this.state.getWebSockets('c' + msg.slice(1))[0];
        if (to) { try { to.close(4003, 'kicked'); } catch (e) { /* 끊김 */ } }
      }
      return;
    }
    const host = this.state.getWebSockets('host')[0];
    if (host) { try { host.send('C' + att.cid + '|' + msg); } catch (e) { /* 끊김 */ } }
    else { try { ws.send('{"t":"hostgone"}'); } catch (e) { /* 끊김 */ } }
  }

  async webSocketClose(ws) { this.gone(ws); }
  async webSocketError(ws) { this.gone(ws); }

  gone(ws) {
    const att = ws.deserializeAttachment();
    if (!att) return;
    if (att.role === 'host') {
      for (const g of this.state.getWebSockets('guest')) {
        try { g.send('{"t":"hostgone"}'); g.close(4002, 'host left'); } catch (e) { /* 끊김 */ }
      }
    } else {
      const host = this.state.getWebSockets('host')[0];
      if (host) { try { host.send('L' + att.cid); } catch (e) { /* 끊김 */ } }
    }
  }
}
