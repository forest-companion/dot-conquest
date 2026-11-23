// 도트 정복전 — 건물 도트 그림
// 글자 하나 = 점 하나. P/p/Q 는 주인 나라 색(보통/어둡게/밝게)이라 지붕·깃발만 봐도 누구 건물인지 보인다.
(function (root) {
  'use strict';
  const PAL = {
    w: [236, 228, 210], W: [190, 176, 152], b: [139, 94, 52], B: [94, 60, 32], k: [34, 30, 38],
    s: [162, 162, 170], S: [104, 104, 116], L: [204, 204, 212], g: [96, 170, 72], G: [56, 116, 46],
    y: [232, 198, 88], Y: [190, 150, 56], o: [246, 192, 52], c: [64, 132, 204], C: [128, 186, 238],
    m: [188, 194, 206], M: [120, 126, 140], r: [214, 62, 56], n: [255, 228, 122],
  };
  const SPR = {
    village: [
      '................',
      '..pp............',
      '.pPPp......pp...',
      'pPPPPp....pPPp..',
      'PPPPPPp..pPPPPp.',
      '.wwwww..pPPPPPPp',
      '.wnwnw...wwwwww.',
      '.wwwww...wnwwnw.',
      '.wwbww...wwwwww.',
      '.WWbWW...wwbbww.',
      '.........WWbbWW.',
      '..gg............',
      '.gGGg....b..gg..',
      '.gGGg...bbb.gGGg',
      '..bb.....b...bb.',
      '................',
    ],
    city: [
      '......PP........',
      '......pp....PP..',
      '.....LsLs...pp..',
      '.....snsn..LssL.',
      '.PP..ssss..snns.',
      '.pp..snsn..ssss.',
      'LsL..ssss..snns.',
      'sns..snsn..ssss.',
      'sss..ssss..snns.',
      'sns.LsnsnL.ssss.',
      'sssLssssssLsnns.',
      'snsLsnsnsnLssss.',
      'sssLssssssLsnns.',
      'SSSSSSSSSSSSSSSS',
      'kkkkkkkkkkkkkkkk',
      '................',
    ],
    farm: [
      '........pp......',
      '.......pPPp.....',
      '......pPPPPp....',
      '.....pPPPPPPp...',
      '......wwwwww....',
      '......wBBBBw....',
      '......wBkkBw....',
      '......wBkkBw....',
      'yyyyyyyyyyyyyyyy',
      'YgYgYgYgYgYgYgYg',
      'yyyyyyyyyyyyyyyy',
      'gGgGgGgGgGgGgGgG',
      'gggggggggggggggg',
      'yyyyyyyyyyyyyyyy',
      'YgYgYgYgYgYgYgYg',
      '................',
    ],
    mine: [
      '..........P.....',
      '..........PP....',
      '.....LL...k.....',
      '....LssL..k.....',
      '...LsssSL.k.....',
      '..LsssssSL......',
      '.LssSssssSL.....',
      'LsssskkksssL....',
      'ssssbkkkbsssS...',
      'SsssbkkkbSssS...',
      'SSSSbkkkbSSSSS..',
      '....MMMMMMMMMM..',
      '...b...oo.b.....',
      '...bbbbooobb....',
      '...bMMMMMMMb....',
      '....k.....k.....',
    ],
    port: [
      '..M.............',
      '..MMMMMM....P...',
      '..M....M....PP..',
      '..M....k....PPP.',
      '..M....k....P...',
      '..M.........k...',
      'bbbbbbbb...bbbbb',
      'bBbBbBbb...pPPPp',
      'bbbbbbbbcccCpPpC',
      'b..b..bbcccccccc',
      'b..b..bbcCccccCc',
      'cccccccccccccccc',
      'cCcccccCcccccccc',
      'cccccccccccCcccc',
      'ccCccccccccccccc',
      '................',
    ],
    market: [
      '................',
      'PwPwPwPwPwPwPwPw',
      'PwPwPwPwPwPwPwPw',
      'pWpWpWpWpWpWpWpW',
      '.b............b.',
      '.b..oo..rr..y.b.',
      '.b.oooo.rrr.yyb.',
      '.bbbbbbbbbbbbbb.',
      '.bBBBBBBBBBBBBb.',
      '.bBBBBBBBBBBBBb.',
      '................',
      '..bb..gg...oo...',
      '.bBBb.gGg.oyyo..',
      '.bBBb.gGg.oyyo..',
      '................',
      '................',
    ],
    fort: [
      '.......P........',
      '.......PPP......',
      '.......PPPPP....',
      '.......k........',
      'L.L....k....L.L.',
      'sss....k....sss.',
      'sSs.L.L.L.L.sSs.',
      'ssssssssssssssss',
      'sSssssskkssssSss',
      'ssssssskkkksssss',
      'sSsssskkkkkssSss',
      'sssssskkkkkkssss',
      'SSSSSSSSSSSSSSSS',
      '................',
      '................',
      '................',
    ],
    silo: [
      '.......rr.......',
      '......rMMr......',
      '......MmmM......',
      '......mPPm......',
      '......mmmm......',
      '......mPPm......',
      '......mmmm......',
      '.....rmmmmr.....',
      '....r.MkkM.r....',
      '..SSSSSSSSSSSS..',
      '.SssssssssssssS.',
      'SsLssssssssssLsS',
      'SssssskkkksssssS',
      'SSSSSSSSSSSSSSSS',
      '................',
      '................',
    ],
    capital: [
      '...........P............',
      '...........PPP..........',
      '...........PPPPP........',
      '...........k............',
      '..L.L.L....k.....L.L.L..',
      '..sssss...LLL....sssss..',
      '..sSnSs..LsssL...sSnSs..',
      '..sssss..snsns...sssss..',
      '..sPPPs..sssss...sPPPs..',
      '..sPPPs.LsnsnsL..sPPPs..',
      '..sssssLsssssssLLsssss..',
      '..sSnSsssnsnsnsssssSnSs.',
      '..ssssssssssssssssssss..',
      '..sSsssssskkksssssssSs..',
      '..sssssssskkkkssssssss..',
      '..sSsssssskkkkssssssSs..',
      '..sssssssskkkkssssssss..',
      '..SSSSSSSSSSSSSSSSSSSS..',
      '.gg.......bbbb......gg..',
      'gGGg......bbbb.....gGGg.',
      'gGGg......bbbb.....gGGg.',
      '.bb.......bbbb......bb..',
      '........................',
      '........................',
    ],
  };
  const cache = new Map();
  const shade = (c, k) => c.map(v => Math.max(0, Math.min(255, Math.round(v * k))));
  const light = (c, a) => c.map(v => Math.min(255, v + a));
  // 건물 종류·주인 색에 맞는 도트 그림(캔버스). 처음 한 번만 그리고 다시 씀
  function get(type, color) {
    const key = type + '|' + color.join(',');
    let cv = cache.get(key);
    if (cv) return cv;
    const rows = SPR[type];
    if (!rows) return null;
    const w = Math.max(...rows.map(r => r.length)), h = rows.length;
    cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const c2 = cv.getContext('2d');
    const img = c2.createImageData(w, h);
    const P = color, p = shade(color, 0.62), Q = light(color, 70);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const ch = rows[y][x] || '.';
      if (ch === '.') continue;
      const col = ch === 'P' ? P : ch === 'p' ? p : ch === 'Q' ? Q : PAL[ch];
      if (!col) continue;
      const i = (y * w + x) * 4;
      img.data[i] = col[0]; img.data[i + 1] = col[1]; img.data[i + 2] = col[2]; img.data[i + 3] = 255;
    }
    c2.putImageData(img, 0, 0);
    cache.set(key, cv);
    return cv;
  }
  root.SPRITES = { get, SPR };
})(typeof window !== 'undefined' ? window : globalThis);
