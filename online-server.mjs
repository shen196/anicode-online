import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { WebSocketServer } from 'ws';

const require = createRequire(import.meta.url);
globalThis.ANICODE_DATA_DATE = '2026-10-31';
const G = require('./game.js');
const root = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8090);
const HOST = process.env.HOST || '0.0.0.0';
const DATA = JSON.parse(fs.readFileSync(path.join(root, 'anime_list.json'), 'utf8'));
const POOL = G.filter(DATA, G.defaults, G.dataDate);
const MAX_PLAYERS = 6;

console.log(`data ${DATA.length} · default pool ${POOL.length}`);

const rooms = new Map();
const tokens = new Map(); // token -> {code, playerId}

const now = () => Date.now();
const randomId = () => crypto.randomUUID();
const randomCode = () => {
  for (let i = 0; i < 100; i++) {
    const code = String(Math.floor(100000 + Math.random() * 900000));
    if (!rooms.has(code)) return code;
  }
  throw new Error('no room code');
};
const card = a => ({
  id: a.id,
  name_cn: G.name(a),
  name: a.name || '',
  image_url: a.image_url || null,
  air_date: a.air_date || null,
  score: typeof a.score === 'number' ? a.score : null,
  vote_count: Number(a.vote_count || 0)
});

function createRoom(host, name) {
  const code = randomCode();
  const player = { id: randomId(), token: crypto.randomBytes(16).toString('hex'), name, team: null, role: 'guesser', ready: false, connected: false, joinedAt: now() };
  const room = {
    code, host: player.id, players: [player], phase: 'lobby', game: null, draft: null,
    chat: [], createdAt: now(), updatedAt: now(), pool: null, poolCount: POOL.length,
    sockets: new Map()
  };
  rooms.set(code, room);
  tokens.set(player.token, { code, playerId: player.id });
  return { room, player };
}

function joinRoom(room, name) {
  if (room.players.length >= MAX_PLAYERS) throw new Error('房间已满（最多 6 人）。');
  if (room.phase !== 'lobby') throw new Error('房间已经开局，等这一局结束再加入。');
  const player = { id: randomId(), token: crypto.randomBytes(16).toString('hex'), name, team: null, role: 'guesser', ready: false, connected: false, joinedAt: now() };
  room.players.push(player);
  tokens.set(player.token, { code: room.code, playerId: player.id });
  return player;
}

function roomPlayer(room, id) { return room.players.find(p => p.id === id); }
function seated(room) { return room.players.filter(p => p.team); }
function captains(room, team) { return room.players.filter(p => p.team === team && p.role === 'captain'); }
function guessers(room, team) { return room.players.filter(p => p.team === team && p.role === 'guesser'); }

function blockers(room) {
  const out = [];
  for (const team of ['red', 'blue']) {
    if (!captains(room, team).length) out.push(`${G.label(team)}缺少队长`);
    if (!guessers(room, team).length) out.push(`${G.label(team)}至少需要一名猜词人`);
  }
  if (seated(room).length < 4) out.push('至少需要 4 人入座');
  if (room.players.some(p => p.team && !p.ready)) out.push('等待全员准备');
  if (room.players.some(p => p.team && !p.connected)) out.push('等待离线玩家重连，或由房主移除');
  return out;
}

function serializePlayer(p) {
  return { id: p.id, name: p.name, team: p.team, role: p.role, ready: !!p.ready, connected: !!p.connected, isHost: false };
}

function redactGame(game, player, room) {
  if (!game) return null;
  const g = structuredClone(game);
  g.remaining = { red: G.remaining(game, 'red'), blue: G.remaining(game, 'blue') };
  g.lineup = room.players.filter(p => p.team).map(p => ({ id: p.id, name: p.name, team: p.team, role: p.role }));
  const captain = player.role === 'captain' && !!player.team;
  if (!captain && game.phase !== 'over') {
    for (const tile of g.tiles) if (!tile.revealed) delete tile.type;
    delete g.banned;
    delete g.banUsed;
  }
  return g;
}

function draftView(room, player) {
  if (room.phase !== 'draft') return null;
  const d = room.draft, step = d.step;
  const base = {
    step,
    counts: { red: d.red.length, blue: d.blue.length },
    total: { red: 9, blue: 8 },
    canPick: false
  };
  // Both captains know both sides' picks: they are the two spymasters, and the
  // guessers never receive this field. Without it blue would keep clicking red's
  // locked cards and only get an error back.
  if (player.role === 'captain' && player.team) {
    base.redPicks = d.red.map(card);
    base.bluePicks = d.blue.map(card);
  }
  if (player.team === step && player.role === 'captain') {
    base.canPick = true;
    base.myPicks = d[step].map(card);
    if (player.draftSentStep !== step) {
      base.candidates = room.pool.map(card);
      player.draftSentStep = step;
    }
  }
  return base;
}

function viewFor(room, player) {
  const state = {
    code: room.code,
    phase: room.phase,
    host: room.host,
    maxPlayers: MAX_PLAYERS,
    poolCount: room.poolCount,
    players: room.players.map(p => ({ ...serializePlayer(p), isHost: p.id === room.host })),
    you: { id: player.id, name: player.name, team: player.team, role: player.role, ready: !!player.ready, isHost: player.id === room.host },
    blockers: room.phase === 'lobby' ? blockers(room) : [],
    draft: draftView(room, player),
    game: redactGame(room.game, player, room),
    chat: room.chat.slice(-80)
  };
  return state;
}

function broadcast(room) {
  room.updatedAt = now();
  for (const [playerId, ws] of room.sockets) {
    if (ws.readyState !== ws.OPEN) continue;
    const player = roomPlayer(room, playerId);
    if (!player) continue;
    ws.send(JSON.stringify({ type: 'state', state: viewFor(room, player), serverNow: now() }));
  }
}

function send(ws, msg) { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg)); }

function fail(ws, message) { send(ws, { type: 'error', message }); }

function addChat(room, player, text) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 100);
  if (!clean) return false;
  room.chat.push({ id: randomId(), from: player.id, name: player.name, team: player.team, role: player.role, text: clean, at: now() });
  if (room.chat.length > 120) room.chat.splice(0, room.chat.length - 120);
  return true;
}

function startDraft(room) {
  const pool = POOL.slice();
  room.pool = pool;
  room.poolCount = pool.length;
  room.draft = { step: 'red', red: [], blue: [] };
  room.phase = 'draft';
  room.game = null;
  room.chat = room.chat.filter(m => false); // fresh match keeps the room, not the old table talk
  for (const p of room.players) { p.ready = false; p.draftSentStep = null; }
  broadcast(room);
}

function finishDraft(room) {
  const d = room.draft;
  const game = G.createDraft(d.red, d.blue, room.pool);
  game.lineup = room.players.filter(p => p.team).map(p => ({ id: p.id, name: p.name, team: p.team, role: p.role }));
  game.voting = 'any';
  game.deadline = null;
  game.prepUntil = null;
  room.game = game;
  room.phase = 'playing';
  room.draft = null;
  room.pool = null;
  broadcast(room);
}

function resetLobby(room) {
  room.phase = 'lobby';
  room.game = null;
  room.draft = null;
  room.pool = null;
  room.chat = [];
  for (const p of room.players) { p.ready = false; p.draftSentStep = null; }
  broadcast(room);
}

function handle(ws, msg) {
  const { room, player } = ws;
  if (!room || !player) return;
  if (!msg || typeof msg.type !== 'string') return;
  switch (msg.type) {
    case 'seat': {
      if (room.phase !== 'lobby') return fail(ws, '开局后不能再换座位。');
      const team = msg.team === 'red' || msg.team === 'blue' ? msg.team : null;
      const role = msg.role === 'captain' ? 'captain' : 'guesser';
      if (team && role === 'captain' && captains(room, team).some(p => p.id !== player.id)) return fail(ws, '这个队长位已经有人了。');
      player.team = team; player.role = role; player.ready = false;
      broadcast(room);
      return;
    }
    case 'ready': {
      if (room.phase !== 'lobby') return fail(ws, '现在不能准备。');
      if (!player.team) return fail(ws, '先选一个队伍。');
      player.ready = !!msg.ready;
      broadcast(room);
      return;
    }
    case 'start': {
      if (room.phase !== 'lobby') return fail(ws, '已经开局了。');
      if (player.id !== room.host) return fail(ws, '只有房主能开始游戏。');
      const blocked = blockers(room);
      if (blocked.length) return fail(ws, blocked.join('；'));
      startDraft(room);
      return;
    }
    case 'pick': {
      if (room.phase !== 'draft' || !room.draft) return fail(ws, '当前不在选牌阶段。');
      const d = room.draft, team = d.step;
      if (!(player.team === team && player.role === 'captain')) return fail(ws, '现在不是你的选牌回合。');
      const total = team === 'red' ? 9 : 8;
      if (d[team].length >= total) return fail(ws, '本队已经选满了。');
      const anime = room.pool.find(a => String(a.id) === String(msg.id));
      if (!anime) return fail(ws, '这部动画不在当前牌池里。');
      if (d.red.some(a => a.id === anime.id) || d.blue.some(a => a.id === anime.id)) return fail(ws, '这部动画已经被选走了。');
      d[team].push(anime);
      if (d[team].length >= total) {
        if (team === 'red') { d.step = 'blue'; for (const p of room.players) p.draftSentStep = null; }
        else { finishDraft(room); return; }
      }
      broadcast(room);
      return;
    }
    case 'undo': {
      if (room.phase !== 'draft' || !room.draft) return;
      const d = room.draft, team = d.step;
      if (!(player.team === team && player.role === 'captain')) return fail(ws, '现在不是你的选牌回合。');
      d[team].pop();
      broadcast(room);
      return;
    }
    case 'clue': {
      if (!room.game || room.game.phase !== 'clue') return fail(ws, '现在不能出题。');
      if (!(player.team === room.game.turn && player.role === 'captain')) return fail(ws, '现在不是你的回合。');
      const count = msg.count === null || msg.count === undefined || msg.count === '' ? null : Number(msg.count);
      if (!G.giveClue(room.game, String(msg.word || ''), count)) return fail(ws, '提示词或张数不合法。');
      broadcast(room);
      return;
    }
    case 'flip': {
      if (!room.game || room.game.phase !== 'guess') return fail(ws, '现在不能翻牌。');
      if (!(player.team === room.game.turn && player.role === 'guesser')) return fail(ws, '现在不是你的回合。');
      const result = G.guess(room.game, Number(msg.index));
      if (!result) return fail(ws, '这张牌不能翻。');
      broadcast(room);
      return;
    }
    case 'endTurn': {
      if (!room.game || room.game.phase !== 'guess') return fail(ws, '现在不能结束回合。');
      if (!(player.team === room.game.turn && player.role === 'guesser')) return fail(ws, '现在不是你的回合。');
      if (!G.stop(room.game)) return fail(ws, '现在不能结束回合。');
      broadcast(room);
      return;
    }
    case 'lobby': {
      if (player.id !== room.host) return fail(ws, '只有房主能结束本局。');
      resetLobby(room);
      return;
    }
    case 'kick': {
      if (player.id !== room.host) return fail(ws, '只有房主能移除玩家。');
      const target = roomPlayer(room, msg.id);
      if (!target || target.id === room.host) return fail(ws, '不能移除该玩家。');
      room.players = room.players.filter(p => p.id !== target.id);
      const targetWs = room.sockets.get(target.id);
      room.sockets.delete(target.id);
      tokens.delete(target.token);
      if (targetWs) { try { targetWs.close(); } catch {} }
      if (room.phase !== 'lobby') resetLobby(room);
      else broadcast(room);
      return;
    }
    case 'chat': {
      if (addChat(room, player, msg.text)) broadcast(room);
      return;
    }
    case 'leave': {
      leaveRoom(ws);
      return;
    }
    default:
      fail(ws, '未知操作。');
  }
}

function leaveRoom(ws) {
  const { room, player } = ws;
  if (!room || !player) return;
  room.players = room.players.filter(p => p.id !== player.id);
  room.sockets.delete(player.id);
  tokens.delete(player.token);
  if (!room.players.length) { rooms.delete(room.code); try { ws.close(); } catch {} return; }
  if (room.host === player.id) room.host = room.players[0].id;
  if (room.phase !== 'lobby') resetLobby(room);
  else broadcast(room);
  try { ws.close(1000, 'left'); } catch {}
}

// ---------- HTTP ----------
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const compressible = /\.(html|js|css|json|svg)$/i;

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; if (body.length > 200000) { reject(new Error('too large')); req.destroy(); } });
    req.on('end', () => { try { resolve(body ? JSON.parse(body) : {}); } catch { reject(new Error('bad json')); } });
    req.on('error', reject);
  });
}
function json(res, status, value) {
  const body = Buffer.from(JSON.stringify(value));
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': body.length, 'Cache-Control': 'no-store' });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const pathname = decodeURIComponent(url.pathname);
  if (req.method === 'POST' && pathname === '/api/create') {
    try {
      const body = await readBody(req);
      const name = String(body.name || '').trim().slice(0, 20);
      if (!name) return json(res, 400, { error: '先输入昵称。' });
      const { room, player } = createRoom(null, name);
      room.host = player.id;
      return json(res, 200, { code: room.code, token: player.token, playerId: player.id });
    } catch (e) { return json(res, 400, { error: e.message }); }
  }
  if (req.method === 'POST' && pathname === '/api/join') {
    try {
      const body = await readBody(req);
      const code = String(body.code || '').trim();
      const name = String(body.name || '').trim().slice(0, 20);
      if (!/^\d{6}$/.test(code)) return json(res, 400, { error: '房间号是 6 位数字。' });
      if (!name) return json(res, 400, { error: '先输入昵称。' });
      const room = rooms.get(code);
      if (!room) return json(res, 404, { error: '房间不存在或已过期。' });
      const player = joinRoom(room, name);
      broadcast(room);
      return json(res, 200, { code: room.code, token: player.token, playerId: player.id });
    } catch (e) { return json(res, 400, { error: e.message }); }
  }
  if (req.method === 'GET' && pathname === '/api/rooms') return json(res, 200, { rooms: [] });

  let file;
  if (pathname === '/' || pathname === '/online') file = path.join(root, 'online.html');
  else if (pathname === '/local') file = path.join(root, 'index.html');
  else file = path.join(root, pathname);
  if (!file.startsWith(root)) { res.writeHead(403); res.end('forbidden'); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    const headers = { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' };
    let body = data;
    if (compressible.test(file) && /\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
      body = zlib.gzipSync(data);
      headers['Content-Encoding'] = 'gzip';
      headers['Vary'] = 'Accept-Encoding';
    }
    headers['Content-Length'] = body.length;
    res.writeHead(200, headers);
    res.end(req.method === 'HEAD' ? undefined : body);
  });
});

const wss = new WebSocketServer({ noServer: true, perMessageDeflate: { threshold: 1024 } });
server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname !== '/ws') { socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
});

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'http://x');
  const code = url.searchParams.get('code') || '';
  const token = url.searchParams.get('token') || '';
  const room = rooms.get(code);
  const auth = tokens.get(token);
  if (!room || !auth || auth.code !== code) { ws.close(4004, '房间或身份不存在'); return; }
  const player = roomPlayer(room, auth.playerId);
  if (!player) { ws.close(4004, '玩家不存在'); return; }
  player.connected = true;
  // A reconnect has no local draft cache, so let the next state carry the
  // candidate pool again.
  player.draftSentStep = null;
  const previous = room.sockets.get(player.id);
  if (previous && previous !== ws) { try { previous.close(); } catch {} }
  ws.room = room; ws.player = player;
  room.sockets.set(player.id, ws);
  send(ws, { type: 'state', state: viewFor(room, player), serverNow: now() });
  broadcast(room);
  ws.on('message', data => {
    let msg; try { msg = JSON.parse(data.toString()); } catch { return; }
    try { handle(ws, msg); } catch (e) { fail(ws, e.message || '操作失败'); }
  });
  ws.on('close', () => {
    if (room.sockets.get(player.id) !== ws) return;
    player.connected = false;
    room.sockets.delete(player.id);
    broadcast(room);
  });
  ws.on('error', () => {});
});

server.listen(PORT, HOST, () => console.log(`online http://127.0.0.1:${PORT}/`));

setInterval(() => {
  const cutoff = now() - 2 * 60 * 60 * 1000;
  for (const [code, room] of rooms) {
    if (room.updatedAt < cutoff && room.sockets.size === 0) {
      for (const p of room.players) tokens.delete(p.token);
      rooms.delete(code);
    }
  }
}, 10 * 60 * 1000).unref();
