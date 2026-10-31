/* Online room client. It reuses the local board renderer from app.js and swaps
   the deal for a server-owned draft between the two captains. */
(() => {
  'use strict';
  const q = id => document.getElementById(id);
  const TEAM = { red: '红队', blue: '蓝队' };
  const SESSION_KEY = 'anicode-online';
  const NAME_KEY = 'anicode-name';

  let ws = null, net = null, token = null, roomCode = null;
  let reconnectTimer = null, leaving = false;
  let draftCandidates = null, draftCacheStep = null;
  let resultShown = false, lastGameKey = '';

  const myTeam = () => net?.you?.team || null;
  const isCaptain = () => net?.you?.role === 'captain' && !!myTeam();
  const myTurn = () => !!net?.game && net.you.team === net.game.turn;
  const playing = () => net?.phase === 'playing' && !!net?.game;
  const totalFor = team => team === 'red' ? 9 : 8;

  function nameValue() { return q('onlineName').value.trim(); }
  function setNotice(text) {
    q('onlineNotice').textContent = text || '';
    q('onlineRoomNotice').textContent = text || '';
  }
  function saveSession(name) {
    try { localStorage.setItem(NAME_KEY, name); } catch {}
    try { sessionStorage.setItem(SESSION_KEY, JSON.stringify({ code: roomCode, token, name })); } catch {}
  }
  function clearSession() {
    try { sessionStorage.removeItem(SESSION_KEY); } catch {}
  }
  function syncUrl(withRoom) {
    const url = new URL(location.href);
    if (withRoom) url.searchParams.set('room', roomCode); else url.searchParams.delete('room');
    history.replaceState(null, '', url.pathname + (url.search || ''));
  }

  async function api(path, body) {
    const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const value = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(value.error || '请求失败。');
    return value;
  }

  async function createRoom() {
    const name = nameValue();
    if (!name) { setNotice('先输入昵称。'); q('onlineName').focus(); return; }
    q('onlineCreate').disabled = true;
    try {
      const value = await api('/api/create', { name });
      roomCode = value.code; token = value.token;
      saveSession(name); syncUrl(true); leaving = false;
      setNotice('');
      connect();
    } catch (error) { setNotice(error.message); }
    finally { q('onlineCreate').disabled = false; }
  }

  async function joinRoom() {
    const name = nameValue();
    const code = q('onlineJoinCode').value.trim();
    if (!name) { setNotice('先输入昵称。'); q('onlineName').focus(); return; }
    if (!/^\d{6}$/.test(code)) { setNotice('房间号是 6 位数字。'); q('onlineJoinCode').focus(); return; }
    q('onlineJoin').disabled = true;
    try {
      const value = await api('/api/join', { name, code });
      roomCode = value.code; token = value.token;
      saveSession(name); syncUrl(true); leaving = false;
      setNotice('');
      connect();
    } catch (error) { setNotice(error.message); }
    finally { q('onlineJoin').disabled = false; }
  }

  function connect() {
    clearTimeout(reconnectTimer);
    if (ws) { ws.onclose = null; try { ws.close(); } catch {} }
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${proto}//${location.host}/ws?code=${encodeURIComponent(roomCode)}&token=${encodeURIComponent(token)}`);
    ws.onopen = () => setNotice('');
    ws.onmessage = event => {
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      if (message.type === 'state') { net = message.state; renderAll(); }
      else if (message.type === 'error') setNotice(message.message || '操作失败。');
    };
    ws.onclose = event => {
      if (leaving) return;
      if (event.code === 4004) {
        clearSession(); net = null; roomCode = null; token = null;
        renderAll(); setNotice('房间已结束或身份过期，请重新创建或加入。');
        return;
      }
      setNotice('连接断开，正在重连…');
      reconnectTimer = setTimeout(connect, 1600);
    };
    ws.onerror = () => {};
  }

  function send(message) {
    if (!ws || ws.readyState !== WebSocket.OPEN) { setNotice('还在连接，稍等一下。'); return; }
    ws.send(JSON.stringify(message));
  }

  function leaveRoom() {
    if (ws && ws.readyState === WebSocket.OPEN) send({ type: 'leave' });
    leaving = true;
    clearTimeout(reconnectTimer);
    setTimeout(() => { try { ws?.close(); } catch {} }, 80);
    clearSession(); net = null; roomCode = null; token = null;
    syncUrl(false); renderAll(); setNotice('已离开房间。');
    q('onlineName').value = (() => { try { return localStorage.getItem(NAME_KEY) || ''; } catch { return ''; } })();
  }

  // ---------- render ----------
  function roleText() {
    if (!net) return '';
    if (!net.you.team) return '观战';
    return `${TEAM[net.you.team]}${net.you.role === 'captain' ? '队长' : '猜词人'}`;
  }

  function renderAll() {
    if (!net) {
      document.body.classList.remove('playing');
      q('onlineEntry').hidden = false;
      q('onlineBar').hidden = true;
      q('onlineRoom').hidden = true;
      q('onlineDraftWait').hidden = true;
      q('onlineChat').hidden = true;
      closeDraftDialog();
      return;
    }
    q('onlineEntry').hidden = true;
    q('onlineBar').hidden = false;
    q('onlineChat').hidden = false;
    // app.js reads this when drawing the share image.
    shareRoster = () => Object.fromEntries(['red', 'blue'].map(team => [team, net.players.filter(p => p.team === team).sort((a, b) => (b.role === 'captain') - (a.role === 'captain')).map(p => ({ name: p.name, captain: p.role === 'captain' }))]));
    q('onlineCode').textContent = net.code;
    q('onlineRoomCode').textContent = net.code;
    q('onlineIdentity').textContent = `${net.you.name} · ${roleText()}`;
    const isPlaying = playing();
    document.body.classList.toggle('playing', isPlaying);
    placeChat(isPlaying);
    q('onlineRoom').hidden = net.phase !== 'lobby';
    q('onlineDraftWait').hidden = !(net.phase === 'draft' && !net.draft?.canPick);
    if (net.phase === 'lobby') { closeDraftDialog(); renderLobby(); }
    if (net.phase === 'draft') renderDraftPhase();
    if (isPlaying) renderGame(); else if (net.phase !== 'draft') closeDraftDialog();
    if (net.phase !== 'playing' && q('resultDialog').open) q('resultDialog').close();
    renderChat();
  }

  function seatButton(label, team, role, current) {
    const button = el('button', 'button secondary' + (current ? ' is-current' : ''), label);
    button.type = 'button';
    button.dataset.seat = team + '-' + role;
    button.onclick = () => send(current ? { type: 'seat', team: null, role: 'guesser' } : { type: 'seat', team, role });
    return button;
  }

  function renderLobby() {
    const you = net.you;
    q('onlineRoomHint').textContent = '把房间号或邀请链接发给朋友。4 人起：红蓝各一名队长，各至少一名猜词人。';
    q('onlineReadyCount').textContent = `${net.players.filter(p => p.team && p.ready).length} / ${net.players.filter(p => p.team).length} 人已准备`;
    q('onlineBlockers').textContent = net.blockers.length ? net.blockers.join(' · ') : '全员就绪，房主可以开始。';
    q('onlineReady').textContent = you.ready ? '取消准备' : '准备';
    q('onlineReady').disabled = !you.team;
    q('onlineStart').hidden = !you.isHost;
    q('onlineStart').disabled = net.blockers.length > 0;
    q('onlineStart').textContent = net.blockers.length ? '还差条件' : '开始游戏 →';
    const teams = [];
    for (const team of ['red', 'blue']) {
      const box = el('section', 'online-team ' + team);
      const head = el('div', 'online-team-head');
      head.append(el('i'), el('b', '', TEAM[team]), el('small', '', `${net.players.filter(p => p.team === team).length} 人`));
      box.append(head);
      const captain = net.players.find(p => p.team === team && p.role === 'captain');
      const capRow = el('div', 'online-seat');
      capRow.append(el('span', 'online-seat-role', '队长'));
      const capName = el('span', 'online-seat-name' + (captain?.id === you.id ? ' me' : ''), captain ? captain.name + (captain.connected ? '' : '（离线）') : '空缺');
      capRow.append(capName);
      if (captain && you.isHost && captain.id !== you.id && !captain.connected) {
        const kick = el('button', 'text-button online-kick', '移除');
        kick.type = 'button';
        kick.onclick = () => send({ type: 'kick', id: captain.id });
        capRow.append(kick);
      }
      const iAmCaptain = you.team === team && you.role === 'captain';
      const capBtn = seatButton(iAmCaptain ? '离座' : captain ? '已满' : '加入', team, 'captain', iAmCaptain);
      capBtn.disabled = !iAmCaptain && !!captain;
      capRow.append(capBtn);
      box.append(capRow);
      const guessers = net.players.filter(p => p.team === team && p.role === 'guesser');
      for (const g of guessers) {
        const row = el('div', 'online-seat');
        row.append(el('span', 'online-seat-role', '猜词人'));
        row.append(el('span', 'online-seat-name' + (g.id === you.id ? ' me' : ''), g.name + (g.connected ? '' : '（离线）') + (g.ready ? ' ✓' : '')));
        if (you.isHost && g.id !== you.id && !g.connected) {
          const kick = el('button', 'text-button online-kick', '移除');
          kick.type = 'button';
          kick.onclick = () => send({ type: 'kick', id: g.id });
          row.append(kick);
        }
        row.append(el('span'));
        box.append(row);
      }
      const iAmGuesser = you.team === team && you.role === 'guesser';
      const iAmCaptainTeam = you.team === team && you.role === 'captain';
      const joinRow = el('div', 'online-seat');
      joinRow.append(el('span', 'online-seat-role', ''));
      joinRow.append(el('span', 'online-seat-name', net.players.filter(p => p.team === team && p.role === 'guesser').length ? '' : '还没有猜词人'));
      joinRow.append(iAmCaptainTeam ? el('span', 'online-muted', '队长已就座') : seatButton(iAmGuesser ? '离座' : '加入', team, 'guesser', iAmGuesser));
      box.append(joinRow);
      teams.push(box);
    }
    q('onlineTeams').replaceChildren(...teams);
  }

  function renderDraftPhase() {
    const d = net.draft;
    if (!d) return;
    const counts = `红 ${d.counts.red}/9 · 蓝 ${d.counts.blue}/8`;
    q('onlineDraftTitle').textContent = `${TEAM[d.step]}队长正在选牌`;
    q('onlineDraftCounts').textContent = counts;
    q('onlineDraftAbort').hidden = !net.you.isHost;
    if (!d.canPick) { closeDraftDialog(); return; }
    if (d.candidates) draftCandidates = d.candidates;
    if (!draftCandidates) return;
    const firstOpen = !draft || draftCacheStep !== d.step || !q('draftDialog').open;
    if (firstOpen) {
      draftCacheStep = d.step;
      draft = {
        pool: draftCandidates,
        byId: new Map(draftCandidates.map(a => [a.id, a])),
        list: draftCandidates,
        red: d.redPicks || [], blue: d.bluePicks || [],
        step: net.you.team,
        shown: 60, game: null, shuffled: false, gridStep: null
      };
      draft[net.you.team] = d.myPicks || draft[net.you.team] || [];
      openDialog('draftDialog');
      document.body.classList.add('drafting');
      renderDraft();
      decorateDraftDialog();
      q('draftSearch').value = '';
    } else {
      draft.red = d.redPicks || [];
      draft.blue = d.bluePicks || [];
      draft[net.you.team] = d.myPicks || draft[net.you.team] || [];
      for (const cardEl of q('draftGrid').children) updateDraftCard(Number(cardEl.dataset.id));
      renderDraftTray();
    }
    const picked = (d.myPicks || []).length, total = totalFor(net.you.team);
    q('draftStatus').textContent = picked >= total ? '选满了，正在交给对方…' : `已选 ${picked} / ${total} · 选满后自动继续`;
    if (d.myPicks) {
      q('draftCount').textContent = picked;
      q('draftPickedCount').textContent = picked;
    }
  }

  function decorateDraftDialog() {
    q('draftTitle').textContent = `${TEAM[net.you.team]}队长选牌`;
    q('draftSubtitle').textContent = `点选 ${totalFor(net.you.team)} 部本队要找的动画，选满后自动交给对方。`;
    q('draftBack').hidden = true;
    if (net.you.isHost) {
      q('draftBack').hidden = false;
      q('draftBack').textContent = '返回大厅';
      q('draftBack').onclick = () => send({ type: 'lobby' });
    }
    q('draftRandom').hidden = true;
    q('draftNext').hidden = true;
    q('draftFilter').hidden = true;
    q('draftFill').hidden = true;
    q('draftClose').hidden = true;
    q('draftUndo').onclick = () => send({ type: 'undo' });
    q('draftSearch').focus({ preventScroll: true });
    if (!q('draftGrid').dataset.onlineBound) {
      q('draftGrid').dataset.onlineBound = '1';
      q('draftGrid').addEventListener('click', event => {
        const cardEl = event.target.closest('.draft-card');
        if (!cardEl || cardEl.disabled) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        send({ type: 'pick', id: Number(cardEl.dataset.id) });
      }, true);
      q('draftDialog').addEventListener('cancel', event => {
        event.preventDefault();
        event.stopImmediatePropagation();
      }, true);
    }
  }

  function closeDraftDialog() {
    if (q('draftDialog').open) q('draftDialog').close();
    document.body.classList.remove('drafting');
    draft = null;
    draftCacheStep = null;
  }

  function renderGame() {
    game = net.game;
    const over = game.phase === 'over';
    view = over ? 'captain' : (net.you.role === 'captain' ? 'captain' : 'guesser');
    const key = `${game.round}:${game.phase}:${game.turn}:${game.clue?.word || ''}:${game.tiles.filter(t => t.revealed).length}`;
    if (key !== lastGameKey) { selected = null; lastGameKey = key; }
    closeDraftDialog();
    render();
    postRenderGame();
    if (game.phase === 'over' && !resultShown) {
      resultShown = true;
      q('againButton').textContent = net.you.isHost ? '再来一局' : '等房主开下一局';
      q('againButton').disabled = !net.you.isHost;
      showResult(game);
    }
    if (game.phase !== 'over') resultShown = false;
  }

  function postRenderGame() {
    q('captainStart').hidden = true;
    q('filterButton').hidden = true;
    q('draftCta').hidden = true;
    const over = game.phase === 'over';
    const teamTurn = net.you.team === game.turn;
    q('clueForm').hidden = over || !(teamTurn && net.you.role === 'captain' && game.phase === 'clue');
    q('guesserActions').hidden = over || !(teamTurn && net.you.role === 'guesser' && game.phase === 'guess');
    if (game.phase === 'clue' && net.you.role === 'captain' && teamTurn) $('clueDisplay').hidden = true;
    else if (game.clue) $('clueDisplay').hidden = false;
    q('phaseText').textContent = statusText();
    q('newButton').hidden = !net.you.isHost;
    q('newButton').textContent = '↩ 返回大厅';
    q('newButton').onclick = () => send({ type: 'lobby' });
    q('onlineChat').hidden = false;
    for (const card of q('board').children) {
      const old = card.onclick;
      card.onclick = event => { old?.(event); postRenderGame(); };
    }
  }

  function statusText() {
    if (!game) return '';
    if (game.phase === 'over') return game.reason || '本局结束';
    if (net.you.team !== game.turn) return `等待 ${TEAM[game.turn]}${game.phase === 'clue' ? '队长出题' : '猜词人行动'}`;
    if (net.you.role === 'captain') return game.phase === 'clue' ? '轮到你出题：给一个提示词和数字' : '本队猜词人正在翻牌';
    return game.phase === 'guess' ? '轮到你猜词：按提示选牌' : '本队队长正在出题';
  }

  function renderChat() {
    if (!net) return;
    const items = net.chat.map(message => {
      const row = el('li', 'chat-message' + (message.from === net.you.id ? ' is-me' : ''));
      const name = el('b', 'chat-name', message.name);
      if (message.team && message.role === 'captain') name.append(el('small', '', '队长'));
      row.append(name, el('span', 'chat-text', message.text));
      return row;
    });
    if (!items.length) items.push(el('li', 'chat-empty', '还没有人说话。'));
    const list = q('onlineChatList');
    const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 30;
    list.replaceChildren(...items);
    if (atBottom) list.scrollTop = list.scrollHeight;
    q('onlineChatCount').textContent = `${net.chat.length} 条`;
  }

  // In the room the chat spans the page; during a match it belongs under the
  // turn panel, where the original game keeps it.
  function placeChat(inGame) {
    const chat = q('onlineChat');
    if (!net) return;
    if (inGame) {
      const turn = document.querySelector('.turn-panel');
      if (turn && turn.nextElementSibling !== chat) turn.after(chat);
    } else {
      const room = q('onlineRoom');
      if (room && room.nextElementSibling !== chat) room.after(chat);
    }
  }

  // ---------- actions ----------
  function bind() {
    q('onlineCreate').onclick = createRoom;
    q('onlineJoin').onclick = joinRoom;
    for (const input of [q('onlineName'), q('onlineJoinCode')]) {
      input.addEventListener('keydown', event => {
        if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); if (q('onlineJoinCode').value.trim()) joinRoom(); else createRoom(); }
      });
    }
    q('onlineReady').onclick = () => { if (net?.you?.team) send({ type: 'ready', ready: !net.you.ready }); };
    q('onlineStart').onclick = () => send({ type: 'start' });
    q('onlineDraftAbort').onclick = () => { if (net?.you?.isHost) send({ type: 'lobby' }); };
    q('onlineLeave').onclick = leaveRoom;
    const copyLink = async () => {
      if (!net) return;
      const link = `${location.origin}${location.pathname}?room=${net.code}`;
      try { await navigator.clipboard.writeText(link); setNotice('邀请链接已复制。'); }
      catch { setNotice(link); }
    };
    q('onlineCopy').onclick = copyLink;
    q('onlineCopy2').onclick = copyLink;
    q('onlineChatForm').onsubmit = event => {
      event.preventDefault();
      const text = q('onlineChatInput').value.trim();
      if (!text) return;
      send({ type: 'chat', text });
      q('onlineChatInput').value = '';
    };
    q('clueForm').onsubmit = event => {
      event.preventDefault();
      if (!net || !game || net.you.team !== game.turn || net.you.role !== 'captain' || game.phase !== 'clue') return;
      const word = q('clueInput').value.trim();
      const raw = q('numberInput').value.trim();
      if (!word || /\s/.test(word)) { q('status').textContent = '提示词不能为空，也不能有空格。'; return; }
      send({ type: 'clue', word, count: raw === '' ? null : Number(raw) });
      q('clueInput').value = '';
    };
    q('confirmGuess').onclick = () => {
      if (!net || !game || selected === null) return;
      if (!(net.you.team === game.turn && net.you.role === 'guesser' && game.phase === 'guess')) return;
      const index = selected; selected = null;
      send({ type: 'flip', index });
    };
    q('endTurn').onclick = () => {
      if (!net || !game || !(net.you.team === game.turn && net.you.role === 'guesser' && game.phase === 'guess')) return;
      send({ type: 'endTurn' });
    };
    q('newButton').onclick = () => { if (net?.you?.isHost) send({ type: 'lobby' }); };
    q('restartConfirm').onclick = () => { if (net?.you?.isHost) send({ type: 'lobby' }); };
    q('againButton').onclick = () => {
      if (!net) return;
      if (net.you.isHost) send({ type: 'lobby' });
      else q('resultDialog').close();
    };
  }

  function loadName() {
    try { q('onlineName').value = localStorage.getItem(NAME_KEY) || ''; } catch {}
  }

  function boot() {
    bind();
    loadName();
    const params = new URLSearchParams(location.search);
    const linkCode = params.get('room');
    if (linkCode) q('onlineJoinCode').value = linkCode.replace(/\D/g, '').slice(0, 6);
    let saved = null;
    try { saved = JSON.parse(sessionStorage.getItem(SESSION_KEY)); } catch {}
    if (saved?.token && saved?.code && (!linkCode || linkCode === saved.code)) {
      roomCode = saved.code; token = saved.token;
      setNotice('正在回到房间…');
      connect();
    } else if (linkCode) {
      q('onlineName').focus();
    }
    // app.js loaded the local landing behind this page; remove any boot overlay.
    document.documentElement.classList.remove('booting', 'boot-slow');
    q('bootScreen')?.remove();
    renderAll();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
