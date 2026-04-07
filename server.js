/**
 * 台灣麻將 多人連線伺服器
 * Node.js + WebSocket (ws)
 *
 * 安裝: npm install ws
 * 啟動: node server.js
 * 預設 port: 3001
 */

const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3001;

// ══════════════════════════════════════
// HTTP Server (serves the HTML file)
// ══════════════════════════════════════
const httpServer = http.createServer((req, res) => {
  let filePath = path.join(__dirname, 'mahjong-multi.html');

  // Allow ?room=XXXX in URL — just serve the same HTML
  if (req.url.startsWith('/')) {
    if (fs.existsSync(filePath)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(fs.readFileSync(filePath));
    } else {
      res.writeHead(404);
      res.end('mahjong-multi.html not found');
    }
  }
});

// ══════════════════════════════════════
// WebSocket Server
// ══════════════════════════════════════
const wss = new WebSocket.Server({ server: httpServer });

// rooms: Map<roomCode, Room>
const rooms = new Map();

function genRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  do { code = Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join(''); }
  while (rooms.has(code));
  return code;
}

// ══════════════════════════════════════
// MAHJONG CONSTANTS
// ══════════════════════════════════════
const SUIT_N = ['萬', '索', '餅'];
const HONORS = ['東', '南', '西', '北', '中', '發', '白'];
const WINDS = ['東', '南', '西', '北'];
const FLOWER_LABELS = ['梅', '蘭', '菊', '竹', '春', '夏', '秋', '冬'];

function buildDeck() {
  const d = [];
  for (let s = 0; s < 3; s++)
    for (let n = 1; n <= 9; n++)
      for (let c = 0; c < 4; c++)
        d.push({ suit: s, num: n, uid: `s${s}n${n}c${c}` });
  for (let h = 0; h < 7; h++)
    for (let c = 0; c < 4; c++)
      d.push({ honor: h, uid: `h${h}c${c}` });
  for (let f = 0; f < 8; f++)
    d.push({ flower: f, uid: `f${f}` });
  return d;
}

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function isFlower(t) { return t.flower != null; }

function tileKey(t) {
  if (t.flower != null) return `F${t.flower}`;
  if (t.honor != null) return `H${t.honor}`;
  return `${t.suit}${t.num}`;
}

function tileLabel(t) {
  if (t.flower != null) return FLOWER_LABELS[t.flower];
  if (t.honor != null) return HONORS[t.honor];
  return t.num + SUIT_N[t.suit];
}

function sortHand(hand) {
  return [...hand].sort((a, b) => {
    if (a.honor != null && b.honor != null) return a.honor - b.honor;
    if (a.honor != null) return 1;
    if (b.honor != null) return -1;
    if (a.suit !== b.suit) return a.suit - b.suit;
    return a.num - b.num;
  });
}

// ══════════════════════════════════════
// WIN CHECK
// ══════════════════════════════════════
function canWin(hand, melds) {
  const tiles = sortHand(hand.filter(t => !isFlower(t)));
  const setsNeeded = 4 - melds.length;
  return checkWinHand(tiles, setsNeeded);
}

function checkWinHand(tiles, setsNeeded) {
  if (setsNeeded === 0 && tiles.length === 2)
    return tileKey(tiles[0]) === tileKey(tiles[1]);
  if (tiles.length < 2) return false;
  for (let pi = 0; pi < tiles.length; pi++) {
    for (let pj = pi + 1; pj < tiles.length; pj++) {
      if (tileKey(tiles[pi]) === tileKey(tiles[pj])) {
        const rest = tiles.filter((_, i) => i !== pi && i !== pj);
        if (canFormSets(rest, setsNeeded)) return true;
      }
    }
  }
  return false;
}

function canFormSets(tiles, n) {
  if (n === 0 && tiles.length === 0) return true;
  if (n === 0 || tiles.length === 0) return false;
  const t = tiles[0];
  // Triplet
  const trip = [0];
  for (let i = 1; i < tiles.length && trip.length < 3; i++)
    if (tileKey(tiles[i]) === tileKey(t)) trip.push(i);
  if (trip.length === 3) {
    const rest = tiles.filter((_, i) => !trip.includes(i));
    if (canFormSets(rest, n - 1)) return true;
  }
  // Sequence
  if (t.honor == null && t.flower == null) {
    const i2 = tiles.findIndex((x, i) => i > 0 && x.suit === t.suit && x.num === t.num + 1);
    const i3 = tiles.findIndex((x, i) => i > 0 && x.suit === t.suit && x.num === t.num + 2);
    if (i2 !== -1 && i3 !== -1) {
      const rest = tiles.filter((_, i) => i !== 0 && i !== i2 && i !== i3);
      if (canFormSets(rest, n - 1)) return true;
    }
  }
  return false;
}

function findChiOptions(hand, tile) {
  if (tile.honor != null || tile.flower != null) return [];
  const s = tile.suit, n = tile.num;
  const opts = [];
  [[n - 2, n - 1, n], [n - 1, n, n + 1], [n, n + 1, n + 2]].forEach(pat => {
    if (pat.some(x => x < 1 || x > 9)) return;
    const need = pat.filter(x => x !== n);
    const copy = [...hand];
    const found = [];
    let ok = true;
    need.forEach(num => {
      const idx = copy.findIndex(h => h.suit === s && h.num === num);
      if (idx === -1) ok = false;
      else found.push(copy.splice(idx, 1)[0]);
    });
    if (ok) opts.push(pat.map(num => num === n ? tile : found.find(f => f.num === num)));
  });
  return opts;
}

// ══════════════════════════════════════
// YAKU CALCULATION
// ══════════════════════════════════════
function calcYaku(player, isSelfDraw, base, tai) {
  const yakus = [];
  const allTiles = [...player.hand, ...player.melds.flatMap(m => m.tiles)];
  const nonFlower = allTiles.filter(t => !isFlower(t));

  // Flowers
  const fc = player.flowers.length;
  if (fc > 0) yakus.push({ name: `花牌×${fc}`, tai: fc });
  if (fc === 8) yakus.push({ name: '全花', tai: 8 });
  // 正花
  const windFlower = player.flowers.some(f => f.flower === player.wind + 4);
  const suitFlower = player.flowers.some(f => f.flower === player.wind);
  if (windFlower) yakus.push({ name: '正花(季)', tai: 1 });
  if (suitFlower) yakus.push({ name: '正花(品)', tai: 1 });

  // Suit analysis
  const suits = [...new Set(nonFlower.filter(t => t.honor == null).map(t => t.suit))];
  const hasHonor = nonFlower.some(t => t.honor != null);
  const isOneSuit = suits.length === 1 && !hasHonor;
  const isMixed = suits.length === 1 && hasHonor;
  const isAllHonor = nonFlower.every(t => t.honor != null);

  if (isOneSuit) yakus.push({ name: '清一色', tai: 8 });
  else if (isAllHonor) yakus.push({ name: '字一色', tai: 16 });
  else if (isMixed) yakus.push({ name: '混一色', tai: 4 });

  // All triplets
  const counts = {};
  nonFlower.forEach(t => { const k = tileKey(t); counts[k] = (counts[k] || 0) + 1; });
  const vals = Object.values(counts);
  const pairs = vals.filter(v => v === 2).length;
  const trips = vals.filter(v => v >= 3).length;
  if (pairs === 1 && trips === Object.keys(counts).length - 1)
    yakus.push({ name: '對對胡', tai: 4 });

  // Sequences / ping hu
  const hasMeld = player.melds.length > 0;
  const allChi = player.melds.every(m => m.type === 'chi');
  if (hasMeld && allChi && !isOneSuit && !isMixed && !isAllHonor)
    yakus.push({ name: '平胡', tai: 1 });

  // Men qing
  if (player.melds.length === 0 && !isSelfDraw)
    yakus.push({ name: '門清', tai: 1 });

  // Self draw
  if (isSelfDraw) yakus.push({ name: '自摸', tai: 1 });

  // Dealer
  if (player.wind === 0) yakus.push({ name: '莊家', tai: 1 });

  // Wind triplet
  const wm = player.melds.find(m => (m.type === 'pong' || m.type === 'kong') && m.tiles[0].honor === player.wind);
  if (wm) yakus.push({ name: `${WINDS[player.wind]}風刻`, tai: 1 });

  // Dragons
  [[4, '中'], [5, '發'], [6, '白']].forEach(([h, n]) => {
    const m = player.melds.find(m => (m.type === 'pong' || m.type === 'kong') && m.tiles[0].honor === h);
    if (m) yakus.push({ name: `${n}刻`, tai: 1 });
  });

  // Kong bonus
  const kongCount = player.melds.filter(m => m.type === 'kong').length;
  if (kongCount > 0) yakus.push({ name: `槓×${kongCount}`, tai: kongCount });

  const totalTai = Math.max(yakus.reduce((s, y) => s + y.tai, 0), 1);
  const totalAmt = base + totalTai * tai;
  return { yakus, totalTai, totalAmt };
}

function calcPays(winnerIdx, isSelfDraw, fromIdx, totalAmt, players) {
  const pays = {};
  players.forEach((_, i) => { pays[i] = 0; });
  if (isSelfDraw) {
    players.forEach((_, i) => {
      if (i === winnerIdx) return;
      pays[i] -= totalAmt;
      pays[winnerIdx] += totalAmt;
    });
  } else {
    const triple = totalAmt * 3;
    pays[fromIdx] -= triple;
    pays[winnerIdx] += triple;
  }
  return pays;
}

// ══════════════════════════════════════
// ROOM CLASS
// ══════════════════════════════════════
class Room {
  constructor(code) {
    this.code = code;
    this.clients = []; // [{ws, playerId, name, char, seatIdx}]
    this.hostId = null;
    this.base = 100;
    this.tai = 40;
    this.started = false;
    this.round = 1;
    this.dealer = 0;

    // Game state
    this.deck = [];
    this.players = []; // [{name, char, chips, hand, melds, flowers, wind}]
    this.discards = [];
    this.lastDiscard = null;
    this.lastDiscardBy = -1;
    this.currentTurn = 0;
    this.phase = 'waiting'; // waiting|dice|draw|discard|action
    this.pendingActions = {}; // seatIdx -> {canPong,canChi,canKong,canWin,chiOpts}
    this.actionTimer = null;
    this.actionDeadline = null;
  }

  send(ws, msg) {
    if (ws.readyState === WebSocket.OPEN)
      ws.send(JSON.stringify(msg));
  }

  broadcast(msg, exceptSeat = -1) {
    this.clients.forEach(c => {
      if (c.seatIdx !== exceptSeat)
        this.send(c.ws, msg);
    });
  }

  broadcastAll(msg) { this.clients.forEach(c => this.send(c.ws, msg)); }

  buildPublicState(forSeatIdx) {
    return {
      type: 'state',
      round: this.round,
      dealer: this.dealer,
      base: this.base,
      tai: this.tai,
      phase: this.phase,
      currentTurn: this.currentTurn,
      deckCount: this.deck.length,
      discards: this.discards,
      lastDiscard: this.lastDiscard,
      lastDiscardBy: this.lastDiscardBy,
      players: this.players.map((p, i) => ({
        name: p.name,
        char: p.char,
        chips: p.chips,
        wind: p.wind,
        flowers: p.flowers,
        melds: p.melds,
        handCount: p.hand.length,
        // Only reveal your own hand
        hand: i === forSeatIdx ? p.hand : null,
        isDealer: i === this.dealer,
      })),
      yourSeat: forSeatIdx,
      pendingAction: this.pendingActions[forSeatIdx] || null,
    };
  }

  broadcastState() {
    this.clients.forEach(c => {
      this.send(c.ws, this.buildPublicState(c.seatIdx));
    });
  }

  // ── Wind Draw (抽東南西北) ──
  startWindDraw() {
    const winds = ['東','南','西','北'];
    const shuffled = [...winds].sort(() => Math.random() - 0.5);
    const dealerSeat = shuffled.indexOf('東');
    // Save to room for later reference
    this.windAssignment = shuffled;
    this.windDealerSeat = dealerSeat;
    this.broadcastAll({
      type: 'windDraw',
      assignment: shuffled,   // seat[i] draws wind shuffled[i]
      dealerSeat: dealerSeat, // who gets 東 = dealer
    });
  }

  // ── Dice ──
  rollDiceAndStart() {
    const d1 = Math.floor(Math.random() * 6) + 1;
    const d2 = Math.floor(Math.random() * 6) + 1;
    const d3 = Math.floor(Math.random() * 6) + 1;
    const total = d1 + d2 + d3;
    // 莊家已由抽牌決定 (windDealerSeat)，骰子只決定發牌方向
    if (this.windDealerSeat !== undefined) {
      this.dealer = this.windDealerSeat;
    } else {
      this.dealer = (total - 1) % 4;
    }
    this.currentTurn = this.dealer;
    const dir = total % 2 === 0 ? '逆時針' : '順時針';
    this.broadcastAll({
      type: 'dice',
      values: [d1, d2, d3],
      total,
      dealer: this.dealer,
      dealerName: this.players[this.dealer]?.name || '',
      direction: dir,
    });
    setTimeout(() => this.initRound(), 2500);
  }

  // ── Round Init ──
  initRound() {
    const deck = shuffle(buildDeck());
    this.deck = deck.filter(t => !isFlower(t));
    const flowers = deck.filter(t => isFlower(t));
    flowers.forEach(f => {
      const pos = Math.floor(Math.random() * this.deck.length);
      this.deck.splice(pos, 0, f);
    });

    this.discards = [];
    this.lastDiscard = null;
    this.lastDiscardBy = -1;
    this.pendingActions = {};
    this.phase = 'dealing';

    this.players.forEach((p, i) => {
      p.hand = [];
      p.melds = [];
      p.flowers = [];
      p.wind = (4 + i - this.dealer) % 4;
    });

    // Deal 16 each
    for (let i = 0; i < 16; i++)
      this.players.forEach(p => { if (this.deck.length) p.hand.push(this.deck.pop()); });

    // Collect initial flowers
    this.players.forEach((_, i) => this.collectFlowers(i));

    this.broadcastAll({ type: 'roundStart', round: this.round });
    this.broadcastState();

    setTimeout(() => this.startTurn(), 800);
  }

  collectFlowers(seatIdx) {
    const p = this.players[seatIdx];
    let fls = p.hand.filter(t => isFlower(t));
    while (fls.length > 0) {
      fls.forEach(f => {
        const i = p.hand.indexOf(f);
        p.hand.splice(i, 1);
        p.flowers.push(f);
        if (this.deck.length) p.hand.push(this.deck.pop());
      });
      fls = p.hand.filter(t => isFlower(t));
    }
  }

  // ── Turn ──
  startTurn() {
    if (this.phase === 'ended') return;
    this.phase = 'draw';
    this.broadcastState();
    // Auto-timeout for disconnected players
    const p = this.players[this.currentTurn];
    const client = this.clients.find(c => c.seatIdx === this.currentTurn);
    if (!client || client.ws.readyState !== WebSocket.OPEN) {
      // Auto-play for missing player
      setTimeout(() => this.autoDraw(this.currentTurn), 500);
    }
  }

  autoDraw(seatIdx) {
    if (this.currentTurn !== seatIdx) return;
    this.processDraw(seatIdx);
  }

  processDraw(seatIdx) {
    if (this.deck.length === 0) { this.exhaust(); return; }
    const p = this.players[seatIdx];
    const tile = this.deck.pop();
    if (isFlower(tile)) {
      p.flowers.push(tile);
      if (this.deck.length) p.hand.push(this.deck.pop());
      this.broadcastAll({ type: 'flower', seat: seatIdx, flower: tile });
      this.broadcastState();
      // Check if drawn replacement is also flower
      const last = p.hand[p.hand.length - 1];
      if (last && isFlower(last)) {
        p.hand.pop();
        p.flowers.push(last);
        if (this.deck.length) p.hand.push(this.deck.pop());
      }
      setTimeout(() => this.checkAfterDraw(seatIdx), 300);
      return;
    }
    p.hand.push(tile);
    this.broadcastAll({ type: 'drew', seat: seatIdx });
    this.broadcastState();
    this.checkAfterDraw(seatIdx);
  }

  checkAfterDraw(seatIdx) {
    const p = this.players[seatIdx];
    const client = this.clients.find(c => c.seatIdx === seatIdx);
    if (!client || client.ws.readyState !== WebSocket.OPEN) {
      // Auto discard
      setTimeout(() => {
        const idx = this.aiChooseDiscard(p.hand);
        const tile = p.hand.splice(idx, 1)[0];
        this.processDiscard(seatIdx, tile);
      }, 600);
      return;
    }
    this.phase = 'discard';
    const winnable = canWin(p.hand, p.melds);
    this.pendingActions[seatIdx] = { canWin: winnable };
    this.broadcastState();
    // Set action timer (30s)
    this.setActionTimer(seatIdx, 30000, () => {
      // Auto discard if timeout
      const idx = this.aiChooseDiscard(p.hand);
      const tile = p.hand.splice(idx, 1)[0];
      this.processDiscard(seatIdx, tile);
    });
  }

  processDiscard(seatIdx, tile) {
    clearTimeout(this.actionTimer);
    this.pendingActions = {};
    const p = this.players[seatIdx];
    // Remove tile from hand if it's there
    const idx = p.hand.findIndex(t => t.uid === tile.uid);
    if (idx !== -1) p.hand.splice(idx, 1);
    this.lastDiscard = tile;
    this.lastDiscardBy = seatIdx;
    this.discards.push({ tile, by: seatIdx });
    this.broadcastAll({ type: 'discard', seat: seatIdx, tile, label: tileLabel(tile) });
    this.broadcastState();
    this.checkDiscardActions(tile, seatIdx);
  }

  checkDiscardActions(tile, fromSeat) {
    // Check other players for win/pong/chi
    const actions = {};
    let anyAction = false;

    for (let offset = 1; offset < 4; offset++) {
      const pi = (fromSeat + offset) % 4;
      const p = this.players[pi];
      const act = {};

      // Win on discard
      const testHand = [...p.hand, tile];
      if (canWin(testHand, p.melds)) act.canWin = true;

      // Pong
      const cnt = p.hand.filter(t => tileKey(t) === tileKey(tile)).length;
      if (cnt >= 2) act.canPong = true;
      if (cnt >= 3) act.canKong = true;

      // Chi (only next player)
      if (offset === 1) {
        const chiOpts = findChiOptions(p.hand, tile);
        if (chiOpts.length > 0) { act.canChi = true; act.chiOpts = chiOpts; }
      }

      if (Object.keys(act).length > 0) {
        actions[pi] = act;
        anyAction = true;
      }
    }

    if (!anyAction) {
      // Next player draws
      this.currentTurn = (fromSeat + 1) % 4;
      this.pendingActions = {};
      this.broadcastState();
      setTimeout(() => this.startTurn(), 400);
      return;
    }

    this.pendingActions = actions;
    this.phase = 'action';
    this.broadcastState();

    // Auto-resolve for disconnected/AI players
    // Check win first (highest priority), then pong, then chi
    const nextPlayer = (fromSeat + 1) % 4;
    let resolved = false;

    // Priority check: win > pong > chi, check in player order
    for (let offset = 1; offset < 4; offset++) {
      const pi = (fromSeat + offset) % 4;
      const act = actions[pi];
      if (!act) continue;
      const client = this.clients.find(c => c.seatIdx === pi);
      const isHuman = client && client.ws.readyState === WebSocket.OPEN;

      if (!isHuman) {
        // AI: win ~40%, pong ~30%
        if (act.canWin && Math.random() < 0.4) {
          setTimeout(() => this.processWin(pi, false, fromSeat), 800);
          resolved = true; break;
        }
        if (act.canPong && Math.random() < 0.3) {
          setTimeout(() => this.processPong(pi, tile), 800);
          resolved = true; break;
        }
      }
    }

    if (!resolved) {
      // Set timer for human decisions (15s)
      this.setActionTimer(null, 15000, () => {
        this.pendingActions = {};
        this.currentTurn = nextPlayer;
        this.broadcastState();
        this.startTurn();
      });
    }
  }

  processPong(seatIdx, tile) {
    clearTimeout(this.actionTimer);
    this.pendingActions = {};
    const p = this.players[seatIdx];
    let rm = 0;
    p.hand = p.hand.filter(t => { if (rm < 2 && tileKey(t) === tileKey(tile)) { rm++; return false; } return true; });
    p.melds.push({ type: 'pong', tiles: [tile, tile, tile] });
    this.discards.pop();
    this.currentTurn = seatIdx;
    this.broadcastAll({ type: 'pong', seat: seatIdx, tile, label: tileLabel(tile) });
    this.broadcastState();

    const client = this.clients.find(c => c.seatIdx === seatIdx);
    const isHuman = client && client.ws.readyState === WebSocket.OPEN;
    if (!isHuman) {
      setTimeout(() => {
        const idx = this.aiChooseDiscard(p.hand);
        const t = p.hand.splice(idx, 1)[0];
        this.processDiscard(seatIdx, t);
      }, 700);
    } else {
      this.phase = 'discard';
      this.pendingActions[seatIdx] = {};
      this.broadcastState();
      this.setActionTimer(seatIdx, 30000, () => {
        const idx = this.aiChooseDiscard(p.hand);
        const t = p.hand.splice(idx, 1)[0];
        this.processDiscard(seatIdx, t);
      });
    }
  }

  processChi(seatIdx, chiOpt) {
    clearTimeout(this.actionTimer);
    this.pendingActions = {};
    const p = this.players[seatIdx];
    const tile = this.lastDiscard;
    const meldTiles = [tile];
    chiOpt.filter(o => tileKey(o) !== tileKey(tile)).forEach(need => {
      const idx = p.hand.findIndex(h => tileKey(h) === tileKey(need));
      if (idx !== -1) meldTiles.push(p.hand.splice(idx, 1)[0]);
    });
    meldTiles.sort((a, b) => (a.num || 0) - (b.num || 0));
    p.melds.push({ type: 'chi', tiles: meldTiles });
    this.discards.pop();
    this.currentTurn = seatIdx;
    this.broadcastAll({ type: 'chi', seat: seatIdx });
    this.phase = 'discard';
    this.pendingActions[seatIdx] = {};
    this.broadcastState();
    this.setActionTimer(seatIdx, 30000, () => {
      const idx = this.aiChooseDiscard(p.hand);
      const t = p.hand.splice(idx, 1)[0];
      this.processDiscard(seatIdx, t);
    });
  }

  processKong(seatIdx, tile) {
    clearTimeout(this.actionTimer);
    this.pendingActions = {};
    const p = this.players[seatIdx];
    const fromDiscard = this.lastDiscard && tileKey(this.lastDiscard) === tileKey(tile);
    if (fromDiscard) {
      let rm = 0;
      p.hand = p.hand.filter(t => { if (rm < 3 && tileKey(t) === tileKey(tile)) { rm++; return false; } return true; });
    } else {
      p.hand = p.hand.filter(t => tileKey(t) !== tileKey(tile));
    }
    p.melds.push({ type: 'kong', tiles: [tile, tile, tile, tile], isOpen: fromDiscard });
    if (fromDiscard) this.discards.pop();
    this.currentTurn = seatIdx;
    this.broadcastAll({ type: 'kong', seat: seatIdx });
    // Draw replacement
    setTimeout(() => this.processDraw(seatIdx), 400);
  }

  processWin(seatIdx, isSelfDraw, fromSeat) {
    clearTimeout(this.actionTimer);
    this.phase = 'ended';
    const p = this.players[seatIdx];
    if (!isSelfDraw && this.lastDiscard) {
      p.hand.push(this.lastDiscard);
      if (this.discards.length) this.discards.pop();
    }

    const { yakus, totalTai, totalAmt } = calcYaku(p, isSelfDraw, this.base, this.tai);
    const pays = calcPays(seatIdx, isSelfDraw, fromSeat, totalAmt, this.players);

    Object.keys(pays).forEach(i => { this.players[i].chips += pays[i]; });

    const method = isSelfDraw ? '自摸' : `點砲 (${this.players[fromSeat]?.name || ''})`;
    this.broadcastAll({
      type: 'win',
      seat: seatIdx,
      winnerName: p.name,
      winnerChar: p.char,
      yakus,
      totalTai,
      totalAmt,
      pays,
      playerNames: this.players.map(pl => pl.name),
      playerChars: this.players.map(pl => pl.char),
      playerChips: this.players.map(pl => pl.chips),
      method,
    });
  }

  exhaust() {
    this.phase = 'ended';
    this.broadcastAll({ type: 'exhaust' });
    setTimeout(() => {
      this.round++;
      this.dealer = (this.dealer + 1) % 4;
      this.initRound();
    }, 3000);
  }

  aiChooseDiscard(hand) {
    const counts = {};
    hand.forEach(t => { const k = tileKey(t); counts[k] = (counts[k] || 0) + 1; });
    for (let i = 0; i < hand.length; i++) { const t = hand[i]; if (t.honor != null && counts[tileKey(t)] === 1) return i; }
    for (let i = 0; i < hand.length; i++) {
      const t = hand[i];
      if (t.honor != null) continue;
      const hasL = hand.some(h => h.suit === t.suit && h.num === t.num - 1);
      const hasR = hand.some(h => h.suit === t.suit && h.num === t.num + 1);
      if (!hasL && !hasR && counts[tileKey(t)] === 1) return i;
    }
    for (let i = 0; i < hand.length; i++) { if (hand[i].honor != null) return i; }
    return hand.length - 1;
  }

  setActionTimer(seatIdx, ms, cb) {
    clearTimeout(this.actionTimer);
    this.actionDeadline = Date.now() + ms;
    this.actionTimer = setTimeout(cb, ms);
  }
}

// ══════════════════════════════════════
// WebSocket Message Handler
// ══════════════════════════════════════
wss.on('connection', (ws) => {
  let clientRoom = null;
  let clientSeat = -1;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    switch (msg.type) {
      case 'createRoom': {
        const code = genRoomCode();
        const room = new Room(code);
        room.hostId = ws._socket.remoteAddress + Date.now();
        rooms.set(code, room);
        clientRoom = room;
        const seatIdx = 0;
        clientSeat = seatIdx;
        room.clients.push({ ws, seatIdx, name: msg.name, char: msg.char });
        room.players.push({ name: msg.name, char: msg.char, chips: 0, hand: [], melds: [], flowers: [], wind: 0, roundDelta: 0 });
        ws.send(JSON.stringify({ type: 'roomCreated', code, seatIdx, isHost: true }));
        room.broadcastAll({ type: 'lobby', players: room.players.map(p => ({ name: p.name, char: p.char })), isHost: false, code });
        break;
      }
      case 'joinRoom': {
        const room = rooms.get(msg.code?.toUpperCase());
        if (!room) { ws.send(JSON.stringify({ type: 'error', msg: '找不到房間' })); return; }
        if (room.started) { ws.send(JSON.stringify({ type: 'error', msg: '遊戲已開始' })); return; }
        if (room.clients.length >= 4) { ws.send(JSON.stringify({ type: 'error', msg: '房間已滿' })); return; }
        clientRoom = room;
        const seatIdx = room.clients.length;
        clientSeat = seatIdx;
        room.clients.push({ ws, seatIdx, name: msg.name, char: msg.char });
        room.players.push({ name: msg.name, char: msg.char, chips: 0, hand: [], melds: [], flowers: [], wind: 0, roundDelta: 0 });
        ws.send(JSON.stringify({ type: 'roomJoined', code: room.code, seatIdx, isHost: false }));
        room.broadcastAll({ type: 'lobby', players: room.players.map(p => ({ name: p.name, char: p.char })), code: room.code, hostSeat: 0 });
        break;
      }
      case 'setConfig': {
        if (!clientRoom) return;
        if (clientSeat !== 0) return; // only host
        clientRoom.base = parseInt(msg.base) || 100;
        clientRoom.tai = parseInt(msg.tai) || 40;
        clientRoom.broadcastAll({ type: 'configUpdated', base: clientRoom.base, tai: clientRoom.tai });
        break;
      }
      case 'startGame': {
        if (!clientRoom || clientSeat !== 0) return;
        if (clientRoom.clients.length < 2) { ws.send(JSON.stringify({ type: 'error', msg: '需要至少2人' })); return; }
        // Fill missing seats with AI
        while (clientRoom.players.length < 4) {
          const aiNames = ['AI-東', 'AI-南', 'AI-西', 'AI-北'];
          const aiChars = [{ e: '🤖', n: 'AI' }, { e: '🎮', n: 'AI2' }, { e: '💻', n: 'AI3' }];
          const si = clientRoom.players.length;
          clientRoom.players.push({
            name: aiNames[si], char: aiChars[si % 3], chips: 0,
            hand: [], melds: [], flowers: [], wind: 0, roundDelta: 0
          });
        }
        clientRoom.started = true;
        // 先廣播 gameStart，再進行抽東南西北
        clientRoom.broadcastAll({ type: 'gameStart' });
        // 發送抽牌請求（隨機分配風牌）
        setTimeout(() => clientRoom.startWindDraw(), 500);
        break;
      }
      // ── 抽牌決定莊家（客戶端完成後通知伺服器） ──
      case 'windDrawDone': {
        if (!clientRoom) return;
        // 任何人都可以送，但只有莊家（抽到東的人）有效
        // dealerSeat is stored in the room from startWindDraw
        if (clientSeat !== clientRoom.windDealerSeat && clientSeat !== 0) return;
        // Now roll dice (just for direction, dealer already decided)
        clientRoom.rollDiceAndStart();
        break;
      }
      // ── 每個玩家翻自己的牌 ──
      case 'windFlip': {
        if (!clientRoom) return;
        // Broadcast to all that this seat flipped their card
        clientRoom.broadcastAll({
          type: 'windFlip',
          seat: clientSeat,
          wind: clientRoom.windAssignment?.[clientSeat] || '?',
        });
        break;
      }
      // ── 一方要求結束遊戲 ──
      case 'endGame': {
        if (!clientRoom) return;
        const p = clientRoom.players[clientSeat];
        clientRoom.broadcastAll({
          type: 'endGame',
          requestBy: clientSeat,
          requestName: p?.name || '',
          chips: clientRoom.players.map(pl => pl.chips),
        });
        break;
      }
      case 'draw': {
        if (!clientRoom || clientSeat !== clientRoom.currentTurn) return;
        if (clientRoom.phase !== 'draw') return;
        clientRoom.processDraw(clientSeat);
        break;
      }
      case 'discard': {
        if (!clientRoom || clientSeat !== clientRoom.currentTurn) return;
        if (clientRoom.phase !== 'discard') return;
        const tile = msg.tile;
        clientRoom.processDiscard(clientSeat, tile);
        break;
      }
      case 'pong': {
        if (!clientRoom) return;
        const act = clientRoom.pendingActions[clientSeat];
        if (!act || !act.canPong) return;
        clientRoom.processPong(clientSeat, clientRoom.lastDiscard);
        break;
      }
      case 'chi': {
        if (!clientRoom) return;
        const act = clientRoom.pendingActions[clientSeat];
        if (!act || !act.canChi) return;
        const opt = msg.optIdx != null ? act.chiOpts[msg.optIdx] : act.chiOpts[0];
        clientRoom.processChi(clientSeat, opt);
        break;
      }
      case 'kong': {
        if (!clientRoom) return;
        clientRoom.processKong(clientSeat, msg.tile || clientRoom.lastDiscard);
        break;
      }
      case 'win': {
        if (!clientRoom) return;
        const selfDraw = clientRoom.phase === 'discard' && clientRoom.currentTurn === clientSeat;
        const fromSeat = selfDraw ? null : clientRoom.lastDiscardBy;
        clientRoom.processWin(clientSeat, selfDraw, fromSeat);
        break;
      }
      case 'nextRound': {
        if (!clientRoom || clientSeat !== 0) return;
        clientRoom.round++;
        // 每將第一局才抽牌；其他局直接骰骰子
        if (clientRoom.round % 4 === 1) {
          clientRoom.broadcastAll({ type: 'gameStart' });
          setTimeout(() => clientRoom.startWindDraw(), 300);
        } else {
          clientRoom.dealer = (clientRoom.dealer + 1) % 4;
          clientRoom.rollDiceAndStart();
        }
        break;
      }
      case 'passAction': {
        if (!clientRoom) return;
        delete clientRoom.pendingActions[clientSeat];
        if (Object.keys(clientRoom.pendingActions).length === 0) {
          const nextIdx = (clientRoom.lastDiscardBy + 1) % 4;
          clientRoom.currentTurn = nextIdx;
          clientRoom.pendingActions = {};
          clientRoom.broadcastState();
          setTimeout(() => clientRoom.startTurn(), 300);
        }
        break;
      }
      case 'hurry': {
        if (!clientRoom) return;
        const fromPlayer = clientRoom.players[clientSeat];
        const targetPlayer = clientRoom.players[msg.targetSeat];
        if (!fromPlayer || !targetPlayer) return;
        clientRoom.broadcastAll({ type: 'hurry', fromName: fromPlayer.name, targetName: targetPlayer.name });
        break;
      }
      // ── Chat ──
      case 'chat': {
        if (!clientRoom) return;
        const p = clientRoom.players[clientSeat];
        if (!p) return;
        const text = String(msg.text || '').substring(0, 200).trim();
        if (!text) return;
        clientRoom.broadcastAll({
          type: 'chat',
          seat: clientSeat,
          name: p.name,
          char: p.char,
          text,
          ts: Date.now(),
        });
        break;
      }
      // ── Taunt / Quick reaction ──
      case 'taunt': {
        if (!clientRoom) return;
        const p = clientRoom.players[clientSeat];
        if (!p) return;
        const TAUNTS = ['😂','😤','🤣','😱','🥶','🔥','💀','👏','🤡','😎'];
        const taunt = String(msg.taunt || '').substring(0, 50);
        clientRoom.broadcastAll({
          type: 'taunt',
          seat: clientSeat,
          name: p.name,
          char: p.char,
          taunt,
          ts: Date.now(),
        });
        break;
      }
      // ── WebRTC signaling (for voice call) ──
      case 'rtc-offer':
      case 'rtc-answer':
      case 'rtc-ice': {
        if (!clientRoom) return;
        // Forward to target seat
        const targetClient = clientRoom.clients.find(c => c.seatIdx === msg.to);
        if (targetClient) {
          clientRoom.send(targetClient.ws, { ...msg, from: clientSeat });
        }
        break;
      }
      case 'rtc-join': {
        // Broadcast that this player wants to join voice
        if (!clientRoom) return;
        const p = clientRoom.players[clientSeat];
        clientRoom.broadcastAll({ type: 'rtc-join', seat: clientSeat, name: p?.name });
        break;
      }
      case 'rtc-leave': {
        if (!clientRoom) return;
        clientRoom.broadcastAll({ type: 'rtc-leave', seat: clientSeat });
        break;
      }
    }
  });

  ws.on('close', () => {
    if (clientRoom) {
      const ci = clientRoom.clients.findIndex(c => c.seatIdx === clientSeat);
      if (ci !== -1) clientRoom.clients.splice(ci, 1);
      clientRoom.broadcastAll({ type: 'playerLeft', seat: clientSeat });
      // Clean up empty rooms
      if (clientRoom.clients.length === 0) rooms.delete(clientRoom.code);
    }
  });
});

httpServer.listen(PORT, () => {
  console.log(`\n🀄  台灣麻將伺服器啟動！`);
  console.log(`   HTTP: http://localhost:${PORT}`);
  console.log(`   WebSocket: ws://localhost:${PORT}`);
  console.log(`\n   同一台電腦開4個分頁即可測試多人連線\n`);
});
