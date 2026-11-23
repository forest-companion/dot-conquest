# 도트 정복전

도트로 된 지구 지도에서 땅을 넓히고 끝까지 살아남는 웹 땅따먹기 게임.

**플레이:** https://forest-companion.github.io/dot-conquest/

- 혼자 하기: 컴퓨터 나라들과 대결
- 친구와 하기: [방 만들기] → 링크를 친구에게 보내면 같은 방에서 함께 플레이 (방장 브라우저가 게임을 돌리고, 서버는 메시지만 전달)

## 구조
- `index.html`, `src/` — 게임 (정적 파일, GitHub Pages)
  - `game.js` 규칙 · `main.js` 화면 · `net.js` 멀티 동기화 · `hostworker.js` 방장 쪽 게임 · `mapdata.js` 지도
- `server/` — 멀티 중계 서버 (Cloudflare Worker + Durable Object, `npx wrangler deploy`)
- `tools/` — 지도 만들기(`build-map.js`), 점검(`test.js`, `nettest.js`, `sim.js`)

지도 원본: [Natural Earth](https://www.naturalearthdata.com/) 1:50m 육지 (public domain).
`tools/raw/land50.geojson` 은 저장소에 없으니, 지도를 다시 만들 땐 Natural Earth 의 `ne_50m_land.geojson` 을 그 이름으로 받아 두세요.
