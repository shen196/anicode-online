'use strict';
// HTTP mode uses the authoritative room server. This build opens the same-screen
// draft game by default; ?online selects the room client when its backend exists.
if (location.protocol !== 'file:' && (window.ANICODE_MODE || 'online') === 'online') {
  // Stand-ins for browsers a few years old (Safari before 16, Chrome before 103),
  // which some players are still on. timeoutSignal comes from app.js.
  const randomId=()=>crypto.randomUUID?crypto.randomUUID():'10000000-1000-4000-8000-100000000000'.replace(/[018]/g,c=>(c^crypto.getRandomValues(new Uint8Array(1))[0]&15>>c/4).toString(16));
  const hasOwn=(object,key)=>Object.prototype.hasOwnProperty.call(object,key);
  let room = null, connected = false, session = null, queue = Promise.resolve(), stopped = false, revealing = false;
  // The room pushes every change over one socket per tab. Snapshots are full and
  // versioned per room id, so a late one is simply dropped.
  let socket=null,retryTimer=null,attempts=0,pingTimer=null,pongTimer=null,openTimer=null,lastRoomId=null,lastVersion=0,clockOffset=0;
  // The full list replaces the bundled fallback once it loads; the host deals from it.
  let poolReady=false,poolCache={key:'',count:0},countdownTimer=null;
  // One action at a time: {id, done, timer}. Its result follows the state broadcast.
  let pendingAction=null;
  // All tabs of a browser are the same player, so the session is shared through localStorage.
  const SESSION_KEY='anicode-room';
  // One id per browser, sent with every create or join. A join whose answer was
  // lost on a slow network is then retried as the same player, not a new one.
  const CLIENT_KEY='anicode-client';
  const clientId=(()=>{const fresh=randomId();try{const known=localStorage.getItem(CLIENT_KEY);if(/^[\w-]{16,64}$/.test(known||''))return known;localStorage.setItem(CLIENT_KEY,fresh);}catch{}return fresh;})();
  // The last nickname used to enter a room, offered again on the next visit.
  const NAME_KEY='anicode-name';
  const readSession=()=>{try{const value=JSON.parse(localStorage.getItem(SESSION_KEY));return value&&typeof value.code==='string'&&typeof value.token==='string'?value:null;}catch{return null;}};
  // What the single ban button would do on the next click: an index to ban, or
  // null to lift the ban already in place.
  let banTarget=null;
  // A spectator picks which map to watch; players get the one their seat allows.
  let spectatorView='captain';
  // Matches room-core's MAX_PLAYERS: only seat holders count, spectators are unlimited.
  const maxPlayers=16;
  let copyTimer=null;
  const roomIcons={
    copy:'<rect x="9" y="9" width="11" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    link:'<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
    check:'<path d="m5 12 4 4L19 6"/>',
    eye:'<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
    eyeOff:'<path d="m3 3 18 18M10.6 5.1A12 12 0 0 1 12 5c6.5 0 10 7 10 7a20 20 0 0 1-3 3.9M6.3 6.3A21 21 0 0 0 2 12s3.5 7 10 7a12 12 0 0 0 5.7-1.7M10 10a3 3 0 0 0 4 4"/>',
    crown:'<path d="M4 18.5h16M4.6 18.5 3 7.6l5.1 3.3L12 4.2l3.9 6.7L21 7.6l-1.6 10.9"/>'
  };
  const roomIcon=name=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${roomIcons[name]}</svg>`;
  // The host is marked with a crown so the label does not read as part of a name.
  function hostMark() {
    const mark=el('span','host-mark');mark.innerHTML=roomIcon('crown');
    mark.title='房主';mark.setAttribute('role','img');mark.setAttribute('aria-label','房主');return mark;
  }
  const connectionNotices=new Set();
  // Silence reads as a frozen page. A strip states the connection is being
  // retried and, once it is back, confirms it briefly instead of just vanishing.
  // A drop that is over within STRIP_DELAY shows neither.
  const STRIP_DELAY=2000;
  let strip=null,stripTimer=null,offlineTimer=null,offlineShown=false;
  function connectionStrip(state,text){
    if(!strip){
      strip=el('div','connection-strip');strip.id='connectionStrip';strip.hidden=true;
      strip.setAttribute('role','status');strip.setAttribute('aria-live','polite');
      strip.append(el('span','connection-strip-dot'),el('span','connection-strip-text'));
      document.body.append(strip);
    }
    clearTimeout(stripTimer);
    if(!state){strip.hidden=true;return;}
    strip.dataset.state=state;strip.querySelector('.connection-strip-text').textContent=text;strip.hidden=false;
    if(state==='online')stripTimer=setTimeout(()=>{strip.hidden=true;},2400);
  }
  function syncConnectionStrip(){
    if(session&&!connected){
      if(offlineShown||offlineTimer)return;
      // A strip still saying the connection is back must not linger through a new drop.
      if(strip&&!strip.hidden)showOffline();else offlineTimer=setTimeout(showOffline,STRIP_DELAY);
      return;
    }
    clearTimeout(offlineTimer);offlineTimer=null;
    const back=!!session&&offlineShown;offlineShown=false;
    connectionStrip(back?'online':null,'已恢复连接');
  }
  function showOffline(){offlineTimer=null;offlineShown=true;connectionStrip('offline','连接中… 正在重连，恢复后会自动同步');}
  session = readSession();
  // A room link is /123456. Opening another room's link shows the entry with that
  // code filled in; this tab ignores the stored session, which other tabs keep.
  const linkCode=location.pathname.match(/^\/(\d{6})$/)?.[1]||null;
  if(linkCode&&session?.code!==linkCode)session=null;
  document.body.classList.add('multiplayer');
  // The entry page is a hero over a board of covers; it takes the place of the page header.
  const entry = el('section','entry-hero'); entry.id = 'roomEntry';
  entry.innerHTML = `<div class="hero-inner"><p class="hero-eyebrow">ANIME CODE</p><h1 class="hero-title">动画代号</h1><p class="hero-tagline"><b class="red">红队</b> vs <b class="blue">蓝队</b>，<span>比对方更快找到所有动画！</span></p><div class="hero-create"><input id="playerName" maxlength="20" placeholder="你的昵称" aria-label="你的昵称" autocomplete="nickname"><button id="createRoom" class="button primary" type="button">创建房间</button></div><form id="joinRoomForm" class="hero-join"><span>有房间号？</span><input id="roomCodeInput" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" required placeholder="六位房间号" aria-label="六位房间号"><button class="text-button">加入 →</button></form><button class="text-button hero-browse" id="browseRooms" type="button">浏览公开房间 →</button><p class="hero-notice" id="entryNotice" role="status"></p><a class="text-button hero-browse hero-local" href="?local">队长选牌 · 同屏版 →</a><button class="hero-guide" id="guideButton" type="button"><span class="play" aria-hidden="true"></span>如何游玩</button></div>`;
  // The background sits on the page itself, so the lobby and the match open over
  // the same board instead of a fresh page.
  const backdrop = window.AniEntry?.mount(document.body);
  const lounge = el('section','panel room-panel'); lounge.id = 'roomPanel'; lounge.hidden = true;
  lounge.innerHTML = `
    <div class="room-top">
      <div><p class="room-eyebrow">ANIME CODE · 动画代号</p><div class="room-heading"><h2>房间 <span id="roomCode"></span></h2><button id="copyCode" class="room-icon-button" aria-label="复制房间号" title="复制房间号">${roomIcon('copy')}</button><button id="toggleCode" class="room-icon-button" aria-label="隐藏房间号" title="隐藏房间号" aria-pressed="false">${roomIcon('eye')}</button><button id="copyLink" class="room-icon-button" aria-label="复制房间链接" title="复制房间链接">${roomIcon('link')}</button><span id="connectionState" role="status"></span></div><p id="myIdentity"></p></div>
      <div class="room-tools"><button id="manageMembers" class="text-button" type="button" hidden>成员管理</button><button id="leaveRoom" class="text-button">离开房间</button><button id="roomHelp" class="icon-button" type="button" aria-label="游戏规则">?</button></div>
    </div>
    <p id="roomNotice" class="room-notice" role="status" aria-live="polite"></p>
    <div id="lobbyControls">
      <div class="room-teams" id="roomTeams"></div>
      <aside class="room-settings" aria-label="房间设置">
        <div class="lobby-section-heading"><h3>本局设置</h3></div>
        <div class="lobby-pool"><span class="lobby-field-label">动画牌池</span><strong><span id="roomPoolCount"></span><small> 部</small></strong><div class="lobby-pool-bottom"><p id="settingsSummary"></p><button id="roomFilters" class="text-button">调整牌池 ↗</button></div><p id="dataHint" class="lobby-data-hint" hidden></p></div>
        <div class="lobby-rules"><span class="lobby-field-label">规则设置</span><div class="lobby-rules-bottom"><p id="rulesSummary"></p><button id="roomRules" class="text-button" type="button">调整规则 ↗</button></div></div>
        <label class="lobby-public"><input type="checkbox" id="publicRoom" aria-describedby="publicRoomHint"><span><b>公开房间</b><small id="publicRoomHint">在公开房间列表中展示，任何人都能加入</small></span></label>
        <button id="clueTips" class="lobby-tip" type="button"><b>报词小贴士 ↗</b></button>
      </aside>
      <section class="unseated" id="unseatedSection" aria-label="观战席"><h3><span id="unseatedLabel">观战席</span> <span id="unseatedCount"></span></h3><div id="unseatedPlayers"></div></section>
      <div class="ready-row">
        <div class="lobby-ready-state"><span class="lobby-ready-icon" aria-hidden="true">✓</span><div><strong id="readyCount"></strong><p id="startBlockers" role="status" aria-live="polite"></p></div></div>
        <div class="lobby-ready-actions"><button id="shuffleTeams" class="button secondary" type="button">随机分队</button><button id="readyButton" class="button secondary">准备</button><button id="startRoom" class="button primary">开始游戏 →</button></div>
      </div>
    </div>
    <details id="matchRoster" class="match-roster" hidden><summary><span>房间成员</span><span id="matchRosterSummary"></span></summary><div id="matchRosterList"></div></details>`;
  document.querySelector('.header').after(entry,lounge);
  // The pool keeps its place in the lobby; the rules that only matter once play
  // starts move behind one button, where there is room to explain each of them.
  // Only the host edits the pool; everyone else opens the same dialog to read it.
  const includeEmptyText = $('includeTagsEmpty').textContent;
  function showRoomFilters() {
    const readOnly=!room||room.host!==room.me;
    showFilters();
    $('filterDialog').classList.toggle('is-readonly',readOnly);
    for(const node of $('filterForm').elements)if(node.id!=='applyFilters'&&!node.hasAttribute('data-close')&&!node.hasAttribute('data-browse'))node.disabled=readOnly;
    const title=readOnly?'查看牌池':'调整牌池';
    $('filterTitle').textContent=title;$('filterDialog').querySelector('.panel-title [data-close]').setAttribute('aria-label','关闭'+title);
    $('filterForm').querySelector('[data-close]').textContent=readOnly?'关闭':'取消';
    $('applyFilters').hidden=readOnly;
    $('includeTagsEmpty').textContent=readOnly?'暂无包含标签':includeEmptyText;
    // Only the host reads collections; a reader sees the saved picks as one list.
    if(!readOnly)hydratePool();
    syncPoolSummary();
    $('filterDialog').querySelector('.bangumi-import').hidden=readOnly&&!room?.settings.filters.poolIds;
  }
  const votingText = {majorityAll:'全员投票',unanimous:'全员一致',majority:'过半执行',any:'一票执行'};
  // One line when both phases share a limit, otherwise one per phase that has one.
  const timerText = ({clueSeconds:clue,guessSeconds:guess}) => clue&&clue===guess?[`每阶段限时 ${clue} 秒`]:[...(clue?[`队长限时 ${clue} 秒`]:[]),...(guess?[`猜词人限时 ${guess} 秒`]:[])];
  const rules = el('dialog'); rules.id = 'rulesDialog';
  rules.innerHTML = `<div class="dialog-body">
    <div class="panel-title"><h2 id="rulesTitle">规则设置</h2><button class="icon-button" data-close aria-label="关闭规则设置">×</button></div>
    <div class="rule-list">
      <div class="rule-row"><div><label for="votingRule">猜词人行动</label><p>复数猜词人时的行动规则</p></div><select id="votingRule"><option value="majorityAll">全员投票</option><option value="unanimous">全员一致</option><option value="majority">过半执行</option><option value="any">一票执行</option></select></div>
      <div class="rule-row"><div><label for="maxFlipsRule">最多翻牌数量</label><p>每轮能翻开的牌数上限</p></div><select id="maxFlipsRule"><option value="clue">提示数 + 1</option><option value="unlimited">不限</option></select></div>
      <div class="rule-row"><div><label for="clueMaxRule">提示词上限</label><p>每条提示词最多的字数，留空为不限</p></div><input type="number" id="clueMaxRule" min="1" max="${G.clueLimit}" step="1" inputmode="numeric" placeholder="不限"></div>
      <div class="rule-row"><div><label for="banRule">队长禁牌</label><p>额外玩法：队长出题时可以禁掉一张牌，只有双方队长看得到。无论哪一队翻开禁用牌，无论对错当轮立刻结束。</p></div><div class="rule-controls"><input type="checkbox" id="banRule"><select id="banModeRule" aria-label="禁牌次数"><option value="game">每局一次</option><option value="round">每轮重置</option></select></div></div>
      <div class="rule-row"><div><label for="awardsRule">结算奖项</label><p>每局结束时显示 MVP、最佳第六人和最佳提示</p></div><input type="checkbox" id="awardsRule"></div>
      <div class="rule-row"><div><b>回合限时</b></div><div class="rule-controls"><label class="rule-pick">队长<select id="clueSecondsRule"><option value="">不限</option><option value="60">60 秒</option><option value="90">90 秒</option><option value="120">120 秒</option><option value="180">180 秒</option></select></label><label class="rule-pick">猜词人<select id="guessSecondsRule"><option value="">不限</option><option value="60">60 秒</option><option value="90">90 秒</option><option value="120">120 秒</option><option value="180">180 秒</option></select></label></div></div>
    </div>
    <div class="dialog-actions"><button class="button primary" data-close>完成</button></div>
  </div>`;
  document.body.append(rules);
  // app.js wires `[data-close]` once at load, before this dialog exists.
  for(const button of rules.querySelectorAll('[data-close]'))button.onclick=()=>rules.close();
  // Public rooms, as they last reported themselves. The list refreshes while it is open.
  const roomsDialog = el('dialog'); roomsDialog.id = 'roomsDialog'; roomsDialog.setAttribute('aria-labelledby','roomsTitle');
  roomsDialog.innerHTML = `<div class="dialog-body">
    <div class="panel-title"><h2 id="roomsTitle">公开房间</h2><div class="rooms-tools"><button class="text-button" id="refreshRooms" type="button">刷新</button><button class="icon-button" data-close aria-label="关闭公开房间">×</button></div></div>
    <p class="rooms-status" id="roomsStatus" role="status" aria-live="polite"></p>
    <ul class="rooms-list" id="roomsList"></ul>
  </div>`;
  document.body.append(roomsDialog);
  for(const button of roomsDialog.querySelectorAll('[data-close]'))button.onclick=()=>roomsDialog.close();
  // Offered when this browser dropped out of a room that is still there. The code
  // is left out in case it was hidden; the join fills it in.
  const rejoinDialog = el('dialog'); rejoinDialog.id = 'rejoinDialog'; rejoinDialog.setAttribute('aria-labelledby','rejoinTitle');
  rejoinDialog.innerHTML = `<div class="dialog-body"><h2 id="rejoinTitle">回到上次的房间？</h2><div class="dialog-actions"><button class="button secondary" type="button" data-close>不用了</button><button class="button primary" type="button" id="rejoinRoom">回去</button></div></div>`;
  document.body.append(rejoinDialog);
  for(const button of rejoinDialog.querySelectorAll('[data-close]'))button.onclick=()=>rejoinDialog.close();
  function offerRejoin(code,name){
    $('rejoinRoom').onclick=()=>{rejoinDialog.close();$('roomCodeInput').value=code;if(name)$('playerName').value=name;enterRoom('join');};
    rejoinDialog.showModal();
  }
  // The host's member list: anyone but the host can be removed, online or not.
  const membersDialog = el('dialog'); membersDialog.id = 'membersDialog'; membersDialog.setAttribute('aria-labelledby','membersTitle');
  membersDialog.innerHTML = `<div class="dialog-body">
    <div class="panel-title"><h2 id="membersTitle">成员管理</h2><button class="icon-button" data-close aria-label="关闭成员管理">×</button></div>
    <p class="rooms-status" id="membersStatus"></p>
    <p class="room-notice" id="membersNotice" role="status" aria-live="polite"></p>
    <ul class="rooms-list" id="membersList"></ul>
  </div>`;
  document.body.append(membersDialog);
  for(const button of membersDialog.querySelectorAll('[data-close]'))button.onclick=()=>membersDialog.close();
  // Only advice: the room enforces none of it, players agree among themselves.
  const tipsDialog = el('dialog'); tipsDialog.id = 'tipsDialog'; tipsDialog.setAttribute('aria-labelledby','tipsTitle');
  tipsDialog.innerHTML = `<div class="dialog-body">
    <h2 id="tipsTitle">报词小贴士</h2>
    <p>建议开局前大家先商量好哪些报法不能用，推荐这两条：</p>
    <ol class="help-list"><li><span><b>不报标题的字面特征</b>：比如字数、牌的位置、是否含英文，像「六个字以上」「左上角」「含英文」。</span></li><li><span><b>不把几个无关的词拼在一起报</b>：比如用「恋爱+战斗 4」表示两部恋爱番加两部战斗番，或者把本队几张牌的制作公司连起来报成「京阿尼+A1+CW」。只报其中一个是可以的。</span></li></ol>
    <p class="help-tip">商量好后，可以把约定发到房间的公共聊天里，方便大家随时看，比如：「本局约定：不报标题字数和位置，不拼无关词」。</p>
    <div class="dialog-actions"><button class="button primary" type="button" data-close>知道了</button></div>
  </div>`;
  document.body.append(tipsDialog);
  for(const button of tipsDialog.querySelectorAll('[data-close]'))button.onclick=()=>tipsDialog.close();
  $('clueTips').onclick=()=>openDialog('tipsDialog');
  let roomsTimer=null,roomsLoading=false;
  function roomRow(r){
    const row=el('li','rooms-row'+(r.playing?' is-playing':''));
    const info=el('div','rooms-info'),title=el('div','rooms-title');
    title.append(el('b','',`${r.host||'玩家'}的房间`),el('span','rooms-code',r.code));
    // A room mid-match only takes newcomers as spectators, so it says so up front.
    if(r.playing)title.append(el('span','rooms-phase','游戏中'));
    const full=r.seated>=r.max;
    info.append(title,el('small','',`房间内 ${r.players} 人${full&&!r.playing?' · 位置已满，可观战':''}`));
    const watch=r.playing||full,button=el('button','button '+(watch?'secondary':'primary'),watch?'观战':'加入');button.type='button';
    button.setAttribute('aria-label',`${watch?'观战':'加入'} ${r.host||'玩家'}的房间 ${r.code}`);
    button.onclick=()=>{
      roomsDialog.close();$('roomCodeInput').value=r.code;
      if(!$('playerName').value.trim()){notice('请先输入昵称，再点「加入 →」。');$('playerName').focus();return;}
      enterRoom('join');
    };
    row.append(info,button);
    return row;
  }
  async function loadRooms(){
    if(roomsLoading)return;roomsLoading=true;
    const first=!$('roomsList').children.length;
    if(first)$('roomsStatus').textContent='加载中…';
    try{
      const response=await fetch('/api/rooms',{signal:timeoutSignal(10000)}),value=await response.json();
      if(!response.ok||!Array.isArray(value.rooms))throw new Error();
      $('roomsList').replaceChildren(...value.rooms.map(roomRow));
      $('roomsStatus').textContent=value.rooms.length?'':'暂时没有公开房间。创建房间后，在房间设置里勾选「公开房间」即可出现在这里。';
    }catch{if(roomsDialog.open)$('roomsStatus').textContent='无法加载公开房间，请稍后重试。';}
    finally{roomsLoading=false;}
  }
  $('browseRooms').onclick=()=>{
    $('roomsList').replaceChildren();openDialog('roomsDialog');loadRooms();
    clearInterval(roomsTimer);roomsTimer=setInterval(loadRooms,15000);
  };
  $('refreshRooms').onclick=loadRooms;
  roomsDialog.addEventListener('close',()=>{clearInterval(roomsTimer);roomsTimer=null;});
  $('guideButton').onclick = () => window.AniDemo?.openGuide();
  // The lobby hides the page header, so it carries its own way to the rules.
  $('roomHelp').onclick = () => $('helpButton').click();
  function showEntry(visible) {
    entry.hidden=!visible;document.body.classList.toggle('on-entry',visible);
    if(visible){backdrop?.show();backdrop?.setMode('entry');backdrop?.setTeam(null);document.body.classList.remove('on-lobby');}
  }
  showEntry(true);
  // Banning uses the same card selection as guessing, so it sits with the clue
  // form the captain is already looking at.
  const banButton = el('button','button secondary'); banButton.id = 'banCard'; banButton.type = 'button'; banButton.hidden = true;
  $('clueForm').after(banButton);
  // Votes are tallied per choice against the room's threshold; a voter takes
  // their vote back from their own row here, not from the main button.
  const votes = el('div','vote-panel'); votes.id = 'votePanel';
  votes.innerHTML = `<div class="vote-head"><b>投票</b><span id="voteRule"></span></div><ol id="voteList" role="status" aria-live="polite"></ol>`;
  $('guesserActions').after(votes);
  // After the match each player leaves the review on their own, so the way out
  // sits in the sidebar at the same weight as the 翻开 button it replaces —
  // the small link in the result dialog was easy to miss once that was closed.
  const over = el('div','over-actions'); over.id = 'overActions'; over.hidden = true;
  over.innerHTML = `<button class="button primary full" id="backToLobby">返回大厅</button><button class="button secondary full" id="reviewMap">查看完整地图</button><button class="button secondary full" id="shareMatch" type="button">分享对局</button>`;
  votes.after(over);
  // The share image in app.js lists who played on each side.
  // A match keeps who played in it, so a player who has since left still shows.
  shareRoster = () => Object.fromEntries(['red','blue'].map(team=>[team,(game?.lineup||room.players).filter(p=>p.team===team).sort((a,b)=>(b.role==='captain')-(a.role==='captain')).map(p=>({name:p.name,captain:p.role==='captain'}))]));
  // Chat rides the room socket but is never part of the state. Each tab keeps
  // what it heard, per room, so a reload does not wipe the conversation; nobody
  // can catch up on lines sent while they were away.
  const CHAT_KEY='anicode-chat',CHAT_KEEP=200;
  let chatLog=[],chatChannel='public',chatShown='',chatPending=null,chatOpen=localStorage.getItem('anicode-chat-open')!=='false';
  const chatUnread=new Set();
  const chatPanel=el('section','panel chat-panel');chatPanel.id='chatPanel';chatPanel.hidden=true;chatPanel.setAttribute('aria-label','聊天');
  chatPanel.innerHTML=`<div class="panel-title"><h3><button type="button" class="panel-toggle" id="chatToggle" aria-expanded="true" aria-controls="chatList">聊天<i aria-hidden="true"></i></button></h3><div class="chat-tabs" id="chatTabs" role="group" aria-label="聊天频道"></div></div><ol class="chat-list" id="chatList"></ol><form class="chat-form" id="chatForm"><input id="chatInput" maxlength="100" autocomplete="off" aria-label="聊天消息" aria-describedby="chatNotice"><button class="button primary" type="submit">发送</button></form><p class="status" id="chatNotice" role="status"></p>`;
  // In the document from the start, so `$()` finds its parts; renderRoom moves it to its place.
  lounge.after(chatPanel);
  const chatAudience={public:'公共频道：房间内所有人可见。',captain:'队长频道：双方队长可见。',team:'队内频道：本队猜词人可见。'};
  const chatPlaceholder={public:'发给所有人',captain:'发给双方队长',team:'发给本队猜词人'};
  function loadChat(roomId){
    chatUnread.clear();chatShown='';
    try{const value=JSON.parse(sessionStorage.getItem(CHAT_KEY));chatLog=value?.roomId===roomId&&Array.isArray(value.messages)?value.messages:[];}catch{chatLog=[];}
    try{sessionStorage.setItem(CHAT_KEY,JSON.stringify({roomId,messages:chatLog}));}catch{}
  }
  function saveChat(){try{sessionStorage.setItem(CHAT_KEY,JSON.stringify({roomId:lastRoomId,messages:chatLog}));}catch{}}
  function clearChat(){chatLog=[];chatUnread.clear();chatShown='';chatChannel='public';try{sessionStorage.removeItem(CHAT_KEY);}catch{}}
  // A fresh match starts its private channels empty: the seats behind them may have changed.
  function clearMatchChat(){chatLog=chatLog.filter(m=>m.channel==='public');chatUnread.clear();chatShown='';saveChat();}
  function addChat(m){
    if(!m||typeof m.id!=='string'||typeof m.text!=='string'||chatLog.some(x=>x.id===m.id))return;
    chatLog.push(m);if(chatLog.length>CHAT_KEEP)chatLog.splice(0,chatLog.length-CHAT_KEEP);saveChat();
    if(m.channel!==chatChannel)chatUnread.add(m.channel);
    if(room)renderChat(m.from===room.me);
  }
  // A guesser only ever hears their own team's channel, so it reads as 队内.
  const chatKind=channel=>['red','blue'].includes(channel)?'team':channel;
  const chatLabel=channel=>({public:'公共',captain:'队长'})[channel]||'队内';
  function chatRow(m){
    const row=el('li','chat-message'+(m.from===room.me?' is-me':''));
    if(m.team)row.dataset.team=m.team;
    row.title=new Date(m.at).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'});
    const name=el('b','chat-name',m.name);
    // Only the public channel mixes seats, so only there does a captain need a tag.
    if(m.channel==='public'&&m.team&&m.role==='captain')name.append(el('small','chat-role','队长'));
    row.append(name,el('span','chat-text',m.text));
    return row;
  }
  // `follow` scrolls to the newest line even when the reader had scrolled up.
  function renderChat(follow=false){
    chatPanel.classList.toggle('collapsed',!chatOpen);$('chatToggle').setAttribute('aria-expanded',String(chatOpen));
    const {hear}=room.chat||{hear:['public']};
    if(!hear.includes(chatChannel)){chatChannel='public';follow=true;}
    chatUnread.delete(chatChannel);
    for(const channel of [...chatUnread])if(!hear.includes(channel))chatUnread.delete(channel);
    $('chatTabs').hidden=hear.length<2;
    $('chatTabs').replaceChildren(...hear.map(channel=>{
      const unread=chatUnread.has(channel),tab=el('button','chat-tab'+(unread?' has-unread':''),chatLabel(channel));
      tab.type='button';tab.dataset.channel=channel;tab.setAttribute('aria-pressed',String(channel===chatChannel));
      if(unread)tab.setAttribute('aria-label',chatLabel(channel)+'，有新消息');
      tab.onclick=()=>{if(chatChannel===channel)return;chatChannel=channel;$('chatNotice').textContent='';renderChat(true);};
      return tab;
    }));
    const lines=chatLog.filter(m=>m.channel===chatChannel),list=$('chatList');
    // Rebuilding on every state would lose a reader's text selection, so only new lines or a new channel do.
    const key=`${chatChannel}:${lines.length}:${lines[lines.length-1]?.id||''}`;
    if(key!==chatShown){
      const atBottom=list.scrollHeight-list.scrollTop-list.clientHeight<24;
      chatShown=key;
      list.replaceChildren(...(lines.length?lines.map(chatRow):[el('li','chat-empty',chatAudience[chatKind(chatChannel)])]));
      if(follow||atBottom)list.scrollTop=list.scrollHeight;
    } else if(follow)list.scrollTop=list.scrollHeight;
    // Only sending waits for the connection: disabling the input would blur a line being typed.
    $('chatInput').placeholder=!connected?'连接中…':chatPlaceholder[chatKind(chatChannel)];
    $('chatForm').querySelector('button').disabled=!connected||!!chatPending;
  }
  function sendChat(){
    const raw=$('chatInput').value,text=raw.replace(/\s+/g,' ').trim();
    if(!text||chatPending||!connected||socket?.readyState!==WebSocket.OPEN)return;
    const id=randomId();
    // The line itself comes back over the socket like everyone else's; this only settles the input.
    const done=outcome=>{
      if(chatPending?.id!==id)return;
      clearTimeout(chatPending.timer);chatPending=null;
      if(outcome.ok){if($('chatInput').value===raw)$('chatInput').value='';$('chatNotice').textContent='';}
      else $('chatNotice').textContent=outcome.error||'消息可能没有发出，请重试。';
      if(!room)return;
      renderChat();
      if(document.activeElement===document.body||chatPanel.contains(document.activeElement))$('chatInput').focus({preventScroll:true});
    };
    chatPending={id,done,timer:setTimeout(()=>done({error:'发送超时，消息可能没有发出。'}),12000)};
    renderChat();
    try{socket.send(JSON.stringify({type:'chat',id,channel:chatChannel,text}));}catch{done({error:'连接暂时中断，消息没有发出。'});}
  }
  $('chatForm').onsubmit=e=>{e.preventDefault();sendChat();};
  // A hidden list can't scroll, so reopening jumps to the newest line.
  $('chatToggle').onclick=()=>{chatOpen=!chatOpen;localStorage.setItem('anicode-chat-open',String(chatOpen));renderChat(chatOpen);};
  const filterNotice=el('p','room-notice');filterNotice.id='filterNotice';filterNotice.setAttribute('role','status');
  $('poolCount').after(filterNotice);
  $('clueForm').noValidate=true;$('joinRoomForm').noValidate=true;
  if(linkCode&&!session)$('roomCodeInput').value=linkCode;
  try{$('playerName').value=localStorage.getItem(NAME_KEY)||'';}catch{}
  for(const id of ['clueInput','numberInput'])$(id).setAttribute('aria-describedby','status');
  for(const id of ['playerName','roomCodeInput'])$(id).setAttribute('aria-describedby','entryNotice');
  // Online identity determines the map; view switching belongs to local play.
  document.querySelector('.view-tabs').hidden = true;
  const roleBadge = el('div','role-badge'); roleBadge.id = 'roleBadge';
  document.querySelector('.turn-panel .section-label').replaceWith(roleBadge);
  const turnHeading = el('div','turn-heading');
  $('turnTitle').before(turnHeading);
  const waiting = el('span','waiting-dots'); waiting.id = 'turnWaiting'; waiting.hidden = true;
  waiting.setAttribute('aria-hidden','true');
  waiting.append(el('i'),el('i'),el('i'));
  // The countdown runs on the server clock; at zero it waits for the server's hand-over.
  const turnTimer = el('span','turn-timer'); turnTimer.id = 'turnTimer'; turnTimer.hidden = true;
  turnTimer.setAttribute('role','timer');
  turnHeading.append($('turnTitle'),waiting,turnTimer);
  $('turnTitle').setAttribute('role','status');
  $('newButton').textContent = '↩ 返回大厅';
  $('againButton').textContent = '返回大厅';
  $('applyFilters').textContent = '保存房间牌池';
  $('clueForm').querySelector('button').textContent = '发布提示 →';
  document.querySelector('.table-note').hidden = true;
  $('helpDialog').querySelector('.dialog-body').innerHTML = `<h2>玩法说明</h2><ol class="help-list"><li><span>25 部动画里藏着<b class="tone red">红队</b>、<b class="tone blue">蓝队</b>、<b class="tone neutral">中立牌</b>和一张<b class="tone assassin">刺客</b>，队长知道每张牌的颜色。</span></li><li>队长每回合给出一个提示词和一个数字，比如「机器人 2」，意思是有 2 部本队动画和「机器人」有关。</li><li>猜词人按提示翻牌：翻到本队的可以接着猜，也可以随时结束回合；翻到中立或对方的牌，回合马上结束。</li><li>先翻出本队全部动画的一方获胜；翻到刺客，直接判负。</li></ol><p class="help-tip">先手队要找 9 部，后手队 8 部；默认每回合最多翻「提示数 + 1」张。</p><div class="dialog-actions"><button class="button secondary" id="helpGuide" type="button">▶ 如何游玩</button><button class="button primary" data-close>知道了</button></div>`;
  $('helpDialog').querySelector('[data-close]').onclick = () => $('helpDialog').close();
  $('helpGuide').onclick = openGuideFromHelp;
  $('newDialog').querySelector('h2').textContent = '中止本局并回大厅？';
  $('newDialog').querySelector('p').textContent = '返回大厅会清空本局进度。可以调整牌池、重新分队，开启下一局。';
  $('restartConfirm').textContent = '中止并全员返回';
  const areas = ['.scoreboard','.toolbar','.game-layout'];
  function showGame(visible) {
    for (const selector of areas) document.querySelector(selector).hidden=!visible;
    document.body.classList.toggle('in-match',visible);
    const anchor=document.querySelector(visible?'.game-layout':'.header');
    if(anchor.nextElementSibling!==lounge)anchor.after(lounge);
    if(!visible)document.title='动画代号 · Anime Code';
  }
  showGame(false);
  function notice(text) { (room ? $('roomNotice') : $('entryNotice')).textContent = text; }
  function operation(text) { if ($('status')) $('status').textContent = text || ''; }
  function actionUsesOperation(action) { return action === 'clue' || action === 'vote'; }
  function feedbackId(action) {return actionUsesOperation(action)?'status':action==='settings'&&$('filterDialog').open?'filterNotice':action==='kick'&&$('membersDialog').open?'membersNotice':room?'roomNotice':'entryNotice';}
  function clearConnectionNotices(){for(const id of connectionNotices)$(id).textContent='';connectionNotices.clear();}
  // `persist` is false when following another tab, which already wrote the change.
  function saveSession(value, persist=true) {
    clearTimeout(copyTimer);setCopyFeedback(null);
    disconnect();session=value;lastRoomId=null;lastVersion=0;attempts=0;
    if(persist){if(value)localStorage.setItem(SESSION_KEY,JSON.stringify(value));else localStorage.removeItem(SESSION_KEY);}
    if(value)connect();
  }
  // Closes this tab's socket on purpose: a pending action is dropped without a message.
  // `code` 4000 tells the room the page itself is going away.
  function disconnect(code){
    clearTimeout(retryTimer);retryTimer=null;clearInterval(pingTimer);clearTimeout(pongTimer);pongTimer=null;clearTimeout(openTimer);openTimer=null;
    if(pendingAction){clearTimeout(pendingAction.timer);pendingAction=null;}
    if(chatPending){clearTimeout(chatPending.timer);chatPending=null;}
    const old=socket;socket=null;connected=false;
    if(old){old.onopen=old.onmessage=old.onclose=old.onerror=null;try{if(code)old.close(code);else old.close();}catch{}}
  }
  function connect(){
    if(!session||stopped||socket)return;
    clearTimeout(retryTimer);retryTimer=null;
    const identity=session,ws=new WebSocket(`${location.protocol==='https:'?'wss:':'ws:'}//${location.host}/api/room/${encodeURIComponent(identity.code)}/ws`);
    socket=ws;
    // A handshake on a bad link can hang for minutes, and pings only start once it
    // opens. No state in time, opened or not, and the attempt starts over; each
    // retry waits longer, so a link that is merely slow still gets through.
    clearTimeout(openTimer);openTimer=setTimeout(()=>{openTimer=null;if(socket===ws&&!connected)lost(ws,1006,'');},Math.min(30000,15000+5000*attempts));
    ws.onopen=()=>{
      if(socket!==ws)return;
      ws.send(JSON.stringify({type:'hello',token:identity.token}));
      clearInterval(pingTimer);pingTimer=setInterval(ping,20000);
    };
    ws.onmessage=event=>{
      if(socket!==ws)return;
      if(event.data==='pong'){clearTimeout(pongTimer);pongTimer=null;return;}
      let message;try{message=JSON.parse(event.data);}catch{return;}
      if(message.type==='state')receive(message);
      else if(message.type==='result'&&pendingAction?.id===message.id)pendingAction.done(message);
      else if(message.type==='result'&&chatPending?.id===message.id)chatPending.done(message);
      else if(message.type==='chat')addChat(message.message);
    };
    ws.onclose=event=>lost(ws,event.code,event.reason);
    ws.onerror=()=>{};
  }
  // A socket is gone: closed by the server, dropped by the network, or silent past its pong.
  function lost(ws,code,reason){
    if(socket!==ws)return;
    socket=null;clearInterval(pingTimer);clearTimeout(pongTimer);pongTimer=null;clearTimeout(openTimer);openTimer=null;
    try{ws.onclose=null;ws.close();}catch{}
    // 4003 and 4004 are final: the identity or the room is gone for good. 4005 is
    // a drop past the grace period from a room that is still there, so it offers a way back.
    if(code===4005&&session){const last=session,name=last.name||room?.players.find(p=>p.id===room.me)?.name||'';resetEntry();offerRejoin(last.code,name);return;}
    if(code===4003||code===4004){resetEntry();notice(reason||'房间不存在或已过期，请重新创建或加入。');return;}
    connected=false;
    pendingAction?.done({reason:'连接暂时中断'});
    chatPending?.done({error:'连接暂时中断，消息可能没有发出。'});
    syncConnectionStrip();if(room&&!revealing)renderRoom();
    if(session&&!stopped&&!retryTimer){
      const delay=Math.min(5000,500*2**attempts);attempts++;
      retryTimer=setTimeout(()=>{retryTimer=null;connect();},delay);
    }
  }
  // The platform answers `ping` without waking the room. No answer in 20 s means the
  // socket is dead even if the browser has not noticed yet; a slow link gets that long.
  function ping(){
    const ws=socket;if(!ws||ws.readyState!==WebSocket.OPEN||pongTimer)return;
    try{ws.send('ping');}catch{}
    pongTimer=setTimeout(()=>{pongTimer=null;lost(ws,1006,'');},20000);
  }
  function receive(message){
    // A code can be reused after a room expires, so ordering is per room id.
    if(message.roomId!==lastRoomId){lastRoomId=message.roomId;lastVersion=0;loadChat(message.roomId);}
    // A new socket can hear the version this tab already has: when the drop never
    // reached the room, nothing changed. It still means the connection is back.
    if(!(message.version>lastVersion||!connected&&message.version===lastVersion))return;
    lastVersion=message.version;
    if(Number.isFinite(message.serverNow))clockOffset=message.serverNow-Date.now();
    if(!connected){connected=true;attempts=0;clearTimeout(openTimer);openTimer=null;clearConnectionNotices();syncConnectionStrip();notice('');}
    enqueue(()=>accept(message.state));
  }
  function enqueue(fn) { queue=queue.then(fn,fn); return queue; }
  async function api(route, payload) {
    let response,value;
    try {
      response = await fetch(route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),signal:timeoutSignal(15000)});
      value = await response.json();
    } catch(error) {const failure=new Error('联机请求失败。');failure.name=error.name;failure.connectionFailure=true;throw failure;}
    if(response.status>=500){const error=new Error('联机服务暂时不可用。');error.connectionFailure=true;throw error;}
    if(!response.ok)throw new Error(value.error||'请求失败，请稍后重试。');return value;
  }
  function resetEntry(persist=true) {hideTransition();saveSession(null,persist);clearChat();chatPanel.hidden=true;$('chatNotice').textContent='';room=null;game=null;selected=null;clearConnectionNotices();syncConnectionStrip();operation('');closeDialogs();showEntry(true);lounge.hidden=true;showGame(false);countdown();syncAddress();document.title='动画代号 · Anime Code';}
  // The address bar carries the room link, except while the code is hidden.
  function syncAddress(){
    const path=room&&!room.codeHidden?`/${room.code}`:'/';
    if(location.pathname!==path)history.replaceState(history.state,'',path+location.search+location.hash);
  }
  function connectionFailure(reason, action='') {
    const text=session?`${reason}，正在重连；恢复后会自动同步。${actionUsesOperation(action)?'本次操作结果待确认，请以同步后的状态为准。':''}`:`${reason}，请稍后重试创建或加入房间。`;
    const id=feedbackId(action);$(id).textContent=text;connectionNotices.add(id);
    syncConnectionStrip();
  }
  function handleError(error, action='') {
    if (error.connectionFailure || ['TimeoutError','AbortError'].includes(error.name)) connectionFailure(error.name==='TimeoutError'?'请求超时':'连接暂时中断',action);
    else $(feedbackId(action)).textContent=error.message;
  }
  function command(action, extra={}) {
    if(!connected||!session||pendingAction||socket?.readyState!==WebSocket.OPEN)return;
    if(action==='vote'&&((extra.choice===null&&!hasOwn(room.votes,room.me))||room.votes[room.me]===extra.choice))return;
    // Capture the board version at click time so delayed requests cannot act on a new turn.
    const id=randomId(),epoch=room?.epoch,feedback=feedbackId(action);
    $(feedback).textContent=actionUsesOperation(action)?'正在提交…':'';
    let settled=false;
    const done=outcome=>{
      if(settled)return;settled=true;clearTimeout(timer);
      // The result follows the broadcast, so it is handled after that state is shown.
      enqueue(()=>{
        if(pendingAction?.id===id)pendingAction=null;
        if(outcome.left){resetEntry();return;}
        if(outcome.ok){
          $(feedback).textContent='';
          if(action==='settings'&&extra.filters)$('filterDialog').close();
          if(action==='vote'&&extra.choice===null&&room?.epoch===epoch)operation('已撤回投票');
        } else if(outcome.error)$(feedback).textContent=outcome.error;
        else connectionFailure(outcome.reason,action);
        if(room)renderRoom();
      });
    };
    // No answer in 12 s: the socket is treated as dead and a fresh one resyncs the state.
    const timer=setTimeout(()=>{done({reason:'请求超时'});if(socket)lost(socket,1006,'');},12000);
    pendingAction={id,done,timer};
    try{socket.send(JSON.stringify({type:'action',id,action,...extra,epoch}));}catch{done({reason:'连接暂时中断'});}
    if(game)renderOnlineActions();
  }
  async function enterRoom(action) {
    if($('createRoom').disabled)return;
    const name=$('playerName').value.trim();if(!name){notice('请先输入昵称。');$('playerName').focus();return;}
    if(name.length>20){notice('昵称最多 20 个字符。');$('playerName').focus();return;}
    if(action==='join'&&!/^\d{6}$/.test($('roomCodeInput').value.trim())){notice('请输入六位数字房间号。');$('roomCodeInput').focus();return;}
    $('createRoom').disabled=true;$('joinRoomForm').querySelector('button').disabled=true;
    // The room opens with the socket's first state, so it is never shown as reconnecting.
    try{const value=await api('/api/enter',{action,name,code:$('roomCodeInput').value.trim(),dataDate:G.dataDate,client:clientId});notice('');saveSession({code:value.code,token:value.token,name});try{localStorage.setItem(NAME_KEY,name);}catch{}}
    catch(error){handleError(error,'entry');}
    $('createRoom').disabled=false;$('joinRoomForm').querySelector('button').disabled=false;
  }
  async function accept(state) {
    if(!session)return;
    const previous=room, oldGame=game;
    // Compare authoritative snapshots on every client, including players who did not cast the deciding vote.
    const sameBoard=oldGame&&state.game&&oldGame.tiles.every((t,i)=>t.anime.id===state.game.tiles[i]?.anime.id);
    // The acting team is the turn before the flip, so compare against that.
    const flips=sameBoard?state.game.tiles.flatMap((t,i)=>t.revealed&&!oldGame.tiles[i].revealed?[{index:i,front:$('board').children[i],correct:t.type===oldGame.turn}]:[]):[];
    room=state;game=state.game;filters=state.settings.filters;
    if(game?.phase==='clue' && game.round!==oldGame?.round)$('clueInput').value='';
    if(!previous || state.epoch!==previous.epoch){selected=null;if(connected)operation('');}
    if(!previous?.game && game){closeDialogs();$('clueInput').value='';$('matchRoster').open=false;}
    if(previous && !previous.game && game)clearMatchChat();
    if(previous?.game && !game){hideTransition();closeDialogs();selected=null;}
    // Only a real settings edit invalidates an open pool dialog; a friend joining does not.
    // A host edit would be overwritten, so the host starts over; a read-only view just follows along.
    if(previous&&$('filterDialog').open&&JSON.stringify(previous.settings)!==JSON.stringify(state.settings)){
      if($('filterDialog').classList.contains('is-readonly'))showRoomFilters();else $('filterDialog').close();
    }
    revealing=flips.length>0;
    if(revealing)hideTransition();
    renderRoom();
    if(revealing){
      // Keep polling/action responses in order and prevent a local selection from replacing an animated card.
      // The chat sits in the sidebar but stays live: inert would blur a line being typed.
      const held=[...document.querySelectorAll('.game-layout > .arena, .sidebar > *')].filter(part=>part!==chatPanel);
      for(const part of held)part.inert=true;
      try{await Promise.all(flips.map(({index,front,correct})=>animateReveal(index,front,correct)));}
      finally{revealing=false;for(const part of held)part.inert=false;}
      if(room!==state)return;
      if(game.phase==='over')renderRoom();else renderOnlineActions();
    }
    if(previous)announcePhase(oldGame,game);
    if(game?.phase==='over' && oldGame?.phase!=='over'){
      showResult(game);
    }
  }
  function playerRow(p) {
    // A short drop is invisible: only a player gone past the grace period reads as offline.
    const row=el('div','player-row'+(p.id===room.me?' is-me':'')+(p.away?' is-offline':''));
    const name=el('span',game?'':'lobby-player-name',p.name);
    if(p.id===room.host)name.append(hostMark());
    if(game){
      row.append(name);
      if(p.away)row.append(el('small','lobby-player-status is-offline','离线'));
    } else {
      const avatar=el('span','lobby-avatar',Array.from(p.name)[0]);avatar.setAttribute('aria-hidden','true');
      row.append(avatar,name);
      // A player still on the review screen holds no seat here yet; say so
      // instead of showing them as simply "not ready".
      const status=p.away?'离线':p.inMatch?'看地图中':p.ready?'✓ 已准备':'未准备';
      row.append(el('small','lobby-player-status'+(p.ready&&!p.inMatch?' is-ready':'')+(p.away?' is-offline':'')+(p.inMatch&&!p.away?' is-reviewing':''),status));
    }
    return row;
  }
  // Removing a member mid-match only ends it when their team can no longer play.
  function removalEndsMatch(p){
    if(!game||game.phase==='over'||!p.team||!p.inMatch)return false;
    return p.role==='captain'||!room.players.some(q=>q.id!==p.id&&q.team===p.team&&q.role==='guesser');
  }
  function renderMembers(){
    const others=room.players.filter(p=>p.id!==room.me);
    $('membersList').replaceChildren(...others.map(p=>{
      const row=el('li','rooms-row'),info=el('div','rooms-info'),title=el('div','rooms-title');
      title.append(el('b','',p.name));
      if(p.away)title.append(el('span','rooms-phase','离线'));
      const seat=p.team?G.label(p.team)+' '+(p.role==='captain'?'队长':'猜词人'):p.inMatch?'观战':'观战席';
      info.append(title,el('small','',seat+(!game&&p.team?' · '+(p.ready?'已准备':'未准备'):'')));
      const button=el('button','button secondary','移除');button.type='button';
      button.setAttribute('aria-label','移除 '+p.name);button.disabled=!connected||!!pendingAction;
      button.onclick=()=>{
        const text=removalEndsMatch(p)?`移除 ${p.name} 后${G.label(p.team)}无法继续，本局将结束，全员返回大厅。确认移除？`:`确认将 ${p.name} 移出房间？`;
        if(confirm(text))command('kick',{player:p.id});
      };
      row.append(info,button);return row;
    }));
    $('membersStatus').textContent=others.length?'':'房间里暂时只有你一个人。';
  }
  function renderRoom() {
    showEntry(false);lounge.hidden=false;
    const me=room.players.find(p=>p.id===room.me), host=room.me===room.host;
    lounge.classList.toggle('is-lobby',!game);
    $('roomCode').textContent=room.codeHidden?'••••••':room.code;syncAddress();
    $('roomCode').setAttribute('aria-label',room.codeHidden?'房间号已隐藏':room.code);
    const toggle=$('toggleCode'),toggleLabel=room.codeHidden?'显示房间号':'隐藏房间号';
    toggle.innerHTML=roomIcon(room.codeHidden?'eyeOff':'eye');toggle.title=toggleLabel;toggle.setAttribute('aria-label',toggleLabel);toggle.setAttribute('aria-pressed',String(room.codeHidden));toggle.disabled=!connected||!!pendingAction;
    $('myIdentity').replaceChildren(`${me.name} · ${me.team?G.label(me.team)+' / '+(me.role==='captain'?'队长':'猜词人'):game?'观战中':'观战席'}`);
    if(host)$('myIdentity').append(hostMark());
    $('myIdentity').hidden=!game;
    $('connectionState').textContent=connected?'':'正在重连…';
    $('lobbyControls').hidden=!!game;$('matchRoster').hidden=!game;
    // A player who has not left the review yet holds no seat: show them as
    // unassigned so the teams reflect who is actually available for the next round.
    const inLobby=p=>!p.inMatch, seatedPlayers=room.players.filter(inLobby);
    // Once every player seat is taken, whoever is left watches the next round.
    const playing=seatedPlayers.filter(p=>p.team),seatsFull=playing.length>=maxPlayers;
    $('roomTeams').replaceChildren(...['red','blue'].map(team=>{
      const box=el('section','room-team '+team),heading=el('div','lobby-team-heading'),mark=el('span','lobby-team-mark',team==='red'?'✳':'✧');mark.setAttribute('aria-hidden','true');
      heading.append(mark,el('h3','',G.label(team)),el('span','lobby-team-count',`${seatedPlayers.filter(p=>p.team===team).length} 人`));box.append(heading);
      for(const role of ['captain','guesser']){
        const section=el('div','seat-section'),head=el('div','seat-heading');head.append(el('b','',role==='captain'?'队长':'猜词人'));
        const occupants=seatedPlayers.filter(p=>p.team===team&&p.role===role);
        const seated=me.team===team&&me.role===role,full=role==='captain'&&occupants.length>0;
        const button=el('button','button secondary'+(seated?' is-current':''),seated?'离座':full?'1 / 1':'加入 +');button.dataset.seat=team+'-'+role;
        const closed=!seated&&(full||(!me.team&&seatsFull));
        button.setAttribute('aria-label',`${seated?'离座':closed?'已满':'加入'}${G.label(team)}${role==='captain'?'队长':'猜词人'}`);
        button.disabled=!connected||!!pendingAction||closed;
        button.onclick=()=>command('seat',seated?{team:null,role:'guesser'}:{team,role});head.append(button);section.append(head,...occupants.map(playerRow));
        if(!occupants.length){const empty=el('div','empty-seat'),icon=el('span','lobby-avatar','+');icon.setAttribute('aria-hidden','true');empty.append(icon,el('span','',role==='captain'?'队长空缺':'等你入座'));section.append(empty);}
        box.append(section);
      }
      return box;
    }));
    const unseated=seatedPlayers.filter(p=>!p.team),reviewing=room.players.filter(p=>p.inMatch),ready=playing.filter(p=>p.ready).length;
    $('unseatedPlayers').replaceChildren(...[...unseated,...reviewing].map(playerRow));
    $('unseatedSection').hidden=!unseated.length&&!reviewing.length;$('unseatedCount').textContent=unseated.length+reviewing.length;
    const f=room.settings.filters;
    $('roomPoolCount').textContent=poolReady?poolSize(f).toLocaleString():'…';
    // The host deals from their own copy of the list; a different copy may count differently.
    const staleData=!!room.dataDate&&room.dataDate!==G.dataDate;
    $('dataHint').hidden=!staleData;
    $('dataHint').textContent=staleData?`你的动画数据（${G.dataDate}）与房间（${room.dataDate}）不同，牌池数量可能有出入，刷新页面可更新。`:'';
    const scoreText=f.minScore===0&&f.maxScore===10?'全部评分':`${Number(f.minScore).toFixed(1)}–${Number(f.maxScore).toFixed(1)} 分`;
    const includeText=(f.included||[]).length?` · 含 ${(f.included||[]).join('、')}`:'';
    const poolText=f.poolIds?`Bangumi 收藏（${(f.poolUsers||[]).join('、')||'已选'} · ${f.poolIds.length} 部）· `:'';
    $('settingsSummary').textContent=`${poolText}${f.minYear?`${f.minYear} — ${f.maxYear}`:`${f.maxYear} 年及以前`} · ${scoreText} · ≥ ${f.minVotes} 人评分${includeText}`;
    // Everyone can open the rules; only the host can move them. Reading the room
    // you are about to play in should not need permission.
    const roomRules=room.settings.rules;
    $('votingRule').value=room.settings.voting;
    $('maxFlipsRule').value=roomRules.maxFlips;
    $('banRule').checked=roomRules.ban;
    const banMode=roomRules.banMode||G.ruleDefaults.banMode;
    $('banModeRule').value=banMode;
    for(const key of ['clueSeconds','guessSeconds'])$(`${key}Rule`).value=roomRules[key]?String(roomRules[key]):'';
    $('awardsRule').checked=roomRules.awards!==false;
    // A snapshot must not overwrite the number the host is still typing.
    if(document.activeElement!==$('clueMaxRule'))$('clueMaxRule').value=roomRules.clueMax?String(roomRules.clueMax):'';
    for(const id of ['votingRule','maxFlipsRule','clueMaxRule','banRule','awardsRule','clueSecondsRule','guessSecondsRule'])$(id).disabled=!host||!connected||!!pendingAction;
    // The ban count only means something while the ban itself is on.
    $('banModeRule').disabled=$('banRule').disabled||!roomRules.ban;
    $('rulesSummary').textContent=[votingText[room.settings.voting],roomRules.maxFlips==='clue'?'每轮最多提示数 + 1 张':'每轮翻牌不限',...(roomRules.clueMax?[`提示词最多 ${roomRules.clueMax} 字`]:[]),...(roomRules.ban?[banMode==='game'?'队长禁牌每局一次':'队长禁牌每轮重置']:[]),...timerText(roomRules),...(roomRules.awards===false?['不显示结算奖项']:[])].join(' · ');
    $('publicRoom').checked=room.public;$('publicRoom').disabled=!host||!connected||!!pendingAction;
    $('publicRoomHint').textContent=host?'在公开房间列表中展示，任何人都能加入':room.public?'已在公开房间列表中展示':'仅知道房间号的人可以加入';
    $('roomFilters').textContent=host?'调整牌池 ↗':'查看牌池 ↗';$('roomFilters').disabled=!connected;
    $('roomRules').textContent=host?'调整规则 ↗':'查看规则 ↗';
    $('readyButton').textContent=me.ready?'取消准备':'准备';$('readyButton').disabled=!me.team||!connected;
    $('readyButton').setAttribute('aria-pressed',String(me.ready));
    $('shuffleTeams').hidden=!host;$('shuffleTeams').disabled=playing.length<2||!connected||!!pendingAction;
    $('startRoom').hidden=!host;$('startRoom').disabled=room.blockers.length>0||!connected||!poolReady;
    $('startRoom').textContent=poolReady?'开始游戏 →':'牌池加载中';
    $('readyCount').textContent=`${ready} / ${playing.length} 人已准备`;
    document.querySelector('.ready-row').classList.toggle('all-ready',!room.blockers.length&&connected);
    $('startBlockers').textContent=!connected?'正在重新连接':!me.team?(seatsFull?`玩家已满 ${maxPlayers} 人，下一局你将观战`:'你在观战席，选择队伍和位置即可加入游戏'):reviewing.length?`等待 ${reviewing.length} 位伙伴看完地图返回大厅`:room.blockers.includes('等待离线玩家重连，或由房主移除')?(room.players.some(p=>p.away)?'等待离线玩家重连，或由房主移除':'等待伙伴重新连接…'):room.blockers.find(text=>/缺少队长|至少需要/.test(text))||(ready<playing.length?`等待 ${playing.length-ready} 位伙伴准备`:room.blockers[0]||(host?'全员就绪，随时开局':'全员就绪，等待房主开局'));
    $('leaveRoom').disabled=!connected;
    $('manageMembers').hidden=!host;$('manageMembers').disabled=!connected;
    if($('membersDialog').open){if(host)renderMembers();else $('membersDialog').close();}
    $('restartConfirm').disabled=!connected;$('againButton').disabled=!connected;
    if($('filterDialog').open){updatePoolCount();$('applyFilters').disabled ||= !connected||!!pendingAction||!poolReady;}
    // In the match the members are grouped by team in the team's colour, captain
    // first, so whose side anyone is on reads at a glance.
    const rosterGroups=[['red',G.label('red')],['blue',G.label('blue')],[null,'观战']].map(([team,label])=>{
      const members=room.players.filter(p=>(p.team||null)===team).sort((a,b)=>(b.role==='captain')-(a.role==='captain'));
      return {team,label,members};
    });
    $('matchRosterList').replaceChildren(...rosterGroups.filter(g=>g.team||g.members.length).map(({team,label,members})=>{
      const group=el('section','roster-group '+(team||'spectator')),heading=el('h4');
      heading.append(el('span','roster-dot'),label,el('small','',`${members.length} 人`));
      const list=el('div','roster-members');
      for(const p of members){
        const row=playerRow(p);
        if(team&&p.role==='captain')row.prepend(el('b','roster-role','队长'));
        // After the match, whoever left the review is already back in the lobby.
        if(!p.inMatch&&!p.away)row.append(el('small','lobby-player-status','已回大厅'));
        list.append(row);
      }
      if(!members.length)list.append(el('span','roster-empty','暂无成员'));
      group.append(heading,list);return group;
    }));
    const offline=room.players.filter(p=>p.away).length;
    $('matchRosterSummary').textContent=rosterGroups.filter(g=>g.team||g.members.length).map(g=>`${g.label} ${g.members.length}`).join(' · ')+(offline?` · ${offline} 人离线`:'');
    if(host && room.players.some(p=>p.away))$('matchRoster').open=true;
    // One chat panel: under the lobby panel, or under the turn panel during a match.
    // Hiding the match and moving the panel blur its input and scroll its list back to
    // the top, so read both first: someone mid-line keeps typing, and a reader keeps
    // their place from the newest line once the list has its new height.
    const chatHome=game?document.querySelector('.turn-panel'):lounge,moveChat=chatHome.nextElementSibling!==chatPanel;
    const chatList=$('chatList'),typing=document.activeElement===$('chatInput'),fromBottom=chatList.scrollHeight-chatList.scrollTop-chatList.clientHeight;
    showGame(!!game);
    document.body.classList.toggle('on-lobby',!game);backdrop?.setMode(game?'match':'lobby');
    if(moveChat){
      chatHome.after(chatPanel);
      chatList.scrollTop=chatList.scrollHeight-chatList.clientHeight-fromBottom;
      if(typing)$('chatInput').focus({preventScroll:true});
    }
    chatPanel.hidden=false;renderChat();
    if(!game){backdrop?.setTeam(null);countdown();return;}
    // Joining mid-match leaves a player without a seat: they watch, and switch maps freely until it ends.
    const spectating=!me.team,fullMap=game.phase==='over'&&!revealing;
    document.querySelector('.view-tabs').hidden=!spectating||game.phase==='over';
    view=fullMap||(spectating?spectatorView==='captain':me.role==='captain')?'captain':'guesser';
    render(); renderOnlineActions();
  }
  function renderOnlineActions() {
    if(!game||!room)return;
    const me=room.players.find(p=>p.id===room.me), host=room.host===me.id, over=game.phase==='over';
    const ownTurn=me.team===game.turn, spectating=!me.team;
    const guessingTurn=!over&&ownTurn&&me.role==='guesser'&&game.phase==='guess';
    const active=connected&&!pendingAction&&!over&&!revealing&&ownTurn;
    const canGuess=active&&guessingTurn;
    const team=G.label(game.turn), panel=document.querySelector('.turn-panel');
    roleBadge.textContent=spectating?'观战中':`${G.label(me.team)} · ${me.role==='captain'?'队长':'猜词人'}`;
    roleBadge.dataset.team=spectating?'spectator':me.team;
    panel.dataset.team=game.turn;backdrop?.setTeam(over?game.winner:game.turn);
    let state, title;
    if(over){state='over';title=`${G.label(game.winner)}获胜！`;}
    else if(!connected){state='reconnecting';title='正在重新连接';}
    else if(revealing){state='revealing';title='正在揭晓卡片';}
    else if(!ownTurn){state='opponent';title=G.actorText(game);}
    else if(game.phase==='clue'&&me.role==='captain'){state='act';title='轮到你出题';}
    else if(game.phase==='clue'){state='teammate';title=`${team}队长出题中`;}
    else if(me.role==='captain'){state='teammate';title=`${team}猜词人行动`;}
    else{state='act';title='轮到你猜词';}
    panel.dataset.state=state;
    $('turnTitle').textContent=title;
    $('phaseText').textContent=over?game.reason:'';
    countdown();
    waiting.hidden=over||state==='act';
    $('guesserView').disabled=!spectating||revealing;$('captainView').disabled=revealing||(!spectating&&me.role!=='captain'&&!over);
    $('captainStart').hidden=true;
    $('clueForm').hidden=!(me.role==='captain'&&me.team===game.turn&&game.phase==='clue');
    $('clueForm').querySelector('button').disabled=!active;
    $('clueForm').querySelector('button').textContent=pendingAction==='clue'?'正在发布…':'发布提示 →';
    $('clueInput').disabled=!connected||pendingAction==='clue';$('numberInput').disabled=!connected||pendingAction==='clue';
    const roomRules=room.settings.rules;
    $('clueInput').maxLength=roomRules.clueMax||G.clueLimit;
    // The ban is the captain's move, and only while they still hold the clue.
    // One button: it bans the selected card, or lifts the ban already in place.
    const banning=!over&&ownTurn&&me.role==='captain'&&game.phase==='clue'&&roomRules.ban;
    $('banCard').hidden=!banning;
    if(banning){
      // A fresh selection is the one to ban; otherwise the button lifts the ban.
      // Each team holds its own ban, and the other team's card cannot be taken over.
      // A one-ban captain who already spent theirs keeps it, but cannot move it.
      const own=game.banned?.[me.team]??null, spent=!!game.banUsed?.[me.team];
      banTarget=!spent&&selected!==null&&selected!==own&&!game.tiles[selected]?.revealed&&!G.bannedBy(game,selected)?selected:null;
      $('banCard').replaceChildren(spent?'本局禁牌已用':banTarget===null&&own!==null?'取消禁用':'禁用',el('span','ban-mark inline','⊘'));
      $('banCard').dataset.banTeam=me.team;
      $('banCard').disabled=!active||spent||(banTarget===null&&own===null);
    }
    $('clueDisplay').hidden=!$('clueForm').hidden;
    $('guesserActions').hidden=!guessingTurn;
    const ownVote=hasOwn(room.votes,room.me)?room.votes[room.me]:null;
    $('confirmGuess').textContent=ownVote===selected&&ownVote!==null?'已投此牌':ownVote!==null?'改投此牌':'翻开';
    $('endTurn').textContent=ownVote==='end'?'已投结束':'结束回合';
    $('confirmGuess').disabled=!canGuess||selected===null||game.tiles[selected]?.revealed||ownVote===selected;
    $('endTurn').disabled=!canGuess||ownVote==='end';
    // The way back to the lobby is per player, so it stays until this player takes it.
    $('overActions').hidden=!over;
    $('backToLobby').disabled=!connected||!!pendingAction;
    $('reviewMap').hidden=view==='captain';
    $('filterButton').disabled=true;$('newButton').hidden=!host||over;$('newButton').disabled=!connected;
    $('clueWord').textContent=game.clue?.word||(over?'本局结束':'—');
    document.title=state==='act'?`${title} · 动画代号`:'动画代号 · Anime Code';
    const entries=Object.entries(room.votes);
    renderVotes(entries,ownVote,canGuess);
    for(const [index,card] of [...$('board').children].entries()){
      card.querySelector('.vote-avatars')?.remove();
      card.classList.toggle('voted-by-me',ownVote===index);
      // Every voter, this player included, sits at the right of the card's name bar.
      const voters=entries.filter(([,v])=>v===index).map(([id])=>({id,name:room.players.find(p=>p.id===id)?.name||'?'}));
      if(voters.length){
        const names=voters.map(v=>v.id===room.me?`${v.name}（你）`:v.name).join('、');
        const group=el('span','vote-avatars');group.title=`${voters.length} 票：${names}`;group.setAttribute('aria-label',group.title);
        // Past three faces, the rest collapse into a count.
        const shown=voters.length>3?voters.slice(0,2):voters;
        for(const v of shown){const face=el('span',v.id===room.me?'vote-avatar own':'vote-avatar',Array.from(v.name)[0]);face.setAttribute('aria-hidden','true');group.append(face);}
        if(shown.length<voters.length){const more=el('span','vote-avatar more',`+${voters.length-shown.length}`);more.setAttribute('aria-hidden','true');group.append(more);}
        card.querySelector('.card-name').append(group);
      }
      card.onclick=()=>{selected=selected===index?null:index;render();renderOnlineActions();$('board').children[index].focus({preventScroll:true});};
    }
  }
  // One row per choice, most votes first. As on the server, only guessers who
  // are still around count; an away voter keeps their name on the row, uncounted.
  let votesShown='';
  function renderVotes(entries,ownVote,canGuess){
    const threshold=room.threshold;
    // When one vote acts at once there is never a tally to show.
    $('votePanel').hidden=game.phase!=='guess'||(threshold<=1&&!entries.length);
    if($('votePanel').hidden){votesShown='';return;}
    const counted=new Set(room.players.filter(p=>p.team===game.turn&&p.role==='guesser'&&!p.away).map(p=>p.id));
    // Waiting for everyone needs saying how many are still out.
    $('voteRule').textContent=room.settings.voting==='majorityAll'?`全员投票 · 已投 ${entries.filter(([id])=>counted.has(id)).length}/${counted.size} · 过半需 ${threshold} 票`:`${votingText[room.settings.voting]} · 需 ${threshold} 票`;
    const options=new Map();
    for(const [id,choice] of entries){
      if(!options.has(choice))options.set(choice,{choice,count:0,voters:[]});
      const option=options.get(choice);option.voters.push(id);if(counted.has(id))option.count++;
    }
    const rows=[...options.values()].sort((a,b)=>b.count-a.count);
    // The list is a live region: rebuild it only when the tally itself changes.
    const shown=JSON.stringify([threshold,canGuess,rows.map(r=>[r.choice,r.voters.map(id=>[id,counted.has(id)])])]);
    if(shown===votesShown)return;votesShown=shown;
    $('voteList').replaceChildren(...(rows.length?rows.map(({choice,count,voters})=>{
      const mine=choice===ownVote;
      const row=el('li','vote-option'+(mine?' is-mine':'')),head=el('div','vote-option-head');
      if(choice==='end')head.append(el('span','vote-target','结束回合'));
      else{
        // Picking a row selects its card, so following a teammate's vote is one more click.
        const target=el('button','vote-target',G.name(game.tiles[choice].anime));target.type='button';
        target.onclick=()=>{selected=choice;render();renderOnlineActions();$('board').children[choice].focus({preventScroll:true});};
        head.append(target);
      }
      head.append(el('span','vote-count',`${count} / ${threshold}`));
      const bar=el('span','vote-bar'),fill=el('i');fill.style.width=`${Math.min(1,count/threshold)*100}%`;bar.setAttribute('aria-hidden','true');bar.append(fill);
      const foot=el('div','vote-option-foot'),names=el('span','vote-voters');
      voters.forEach((id,i)=>{
        const name=room.players.find(p=>p.id===id)?.name||'?',voter=el('span',(id===room.me?'is-me':'')+(counted.has(id)?'':' is-away'),id===room.me?`${name}（你）`:name);
        if(!counted.has(id))voter.title='已离线，不计票';
        if(i)names.append('、');names.append(voter);
      });
      foot.append(names);
      if(mine){const undo=el('button','text-button vote-withdraw','撤回');undo.type='button';undo.disabled=!canGuess;undo.onclick=()=>command('vote',{choice:null});foot.append(undo);}
      row.append(head,bar,foot);return row;
    }):[el('li','vote-empty','还没有人投票')]));
  }
  $('createRoom').onclick=()=>enterRoom('create');
  $('joinRoomForm').onsubmit=e=>{e.preventDefault();enterRoom('join');};
  $('playerName').addEventListener('keydown',event=>{
    if(event.key!=='Enter'||event.isComposing||event.repeat)return;
    event.preventDefault();
    enterRoom($('roomCodeInput').value.trim()?'join':'create');
  });
  const copyButtons={copyCode:{icon:'copy',label:'复制房间号',done:'已复制房间号',failed:'复制失败，请显示房间号后手动复制。'},copyLink:{icon:'link',label:'复制房间链接',done:'已复制房间链接',failed:'复制失败，请显示房间号后从地址栏复制链接。'}};
  // `copiedId` is the button that just copied, or null to reset both.
  function setCopyFeedback(copiedId) {
    for(const [id,{icon,label,done}] of Object.entries(copyButtons)){
      const button=$(id),copied=id===copiedId,text=copied?done:label;
      button.innerHTML=roomIcon(copied?'check':icon);button.classList.toggle('is-copied',copied);button.title=text;button.setAttribute('aria-label',text);
    }
  }
  async function copyRoom(id,text){
    const identity=session;
    try{
      await navigator.clipboard.writeText(text);
      if(session!==identity)return;
      clearTimeout(copyTimer);setCopyFeedback(id);copyTimer=setTimeout(()=>setCopyFeedback(null),2000);
    }catch{if(session===identity)notice(copyButtons[id].failed);}
  }
  $('copyCode').onclick=()=>copyRoom('copyCode',room.code);
  $('copyLink').onclick=()=>copyRoom('copyLink',`${location.origin}/${room.code}`);
  $('toggleCode').onclick=()=>command('codeVisibility',{hidden:!room.codeHidden});
  // Leaving mid-match only ends it when this player is a captain or their team's last guesser.
  function leavingEndsMatch(){
    if(!game||game.phase==='over')return false;
    const me=room.players.find(p=>p.id===room.me);if(!me?.team||!me.inMatch)return false;
    return me.role==='captain'||!room.players.some(p=>p.id!==me.id&&p.team===me.team&&p.role==='guesser');
  }
  $('manageMembers').onclick=()=>{$('membersNotice').textContent='';renderMembers();openDialog('membersDialog');};
  $('leaveRoom').onclick=()=>{if(leavingEndsMatch()&&!confirm('本局还没结束，你离开后本队无法继续，全员将返回大厅。确认离开？'))return;command('leave');};
  $('shuffleTeams').onclick=()=>command('shuffle');
  $('readyButton').onclick=()=>command('ready',{ready:!room.players.find(p=>p.id===room.me).ready});
  // The host's browser deals the board from its own list; the server only checks the cards.
  $('startRoom').onclick=()=>{
    if(!poolReady||!room)return;
    const pool=G.filter(allAnime,room.settings.filters,dataDate);
    if(pool.length<25){notice('当前牌池不足 25 部，请放宽筛选条件。');return;}
    const cards=G.deal(pool).map(a=>({id:a.id,name_cn:G.name(a),image_url:a.image_url||null,air_date:a.air_date||null,score:typeof a.score==='number'?a.score:null,vote_count:a.vote_count||0}));
    command('start',{cards});
  };
  $('votingRule').onchange=()=>command('settings',{voting:$('votingRule').value});
  $('maxFlipsRule').onchange=()=>command('settings',{rules:{maxFlips:$('maxFlipsRule').value}});
  // Blank is 不限; anything else must be a whole number the server will accept.
  $('clueMaxRule').oninput=()=>$('clueMaxRule').setCustomValidity('');
  $('clueMaxRule').onchange=()=>{
    const input=$('clueMaxRule'), raw=input.value.trim(), value=raw===''?null:Number(raw);
    if(input.validity.badInput||value!==null&&(!Number.isInteger(value)||value<1||value>G.clueLimit)){input.setCustomValidity(`请输入 1–${G.clueLimit} 的整数，留空为不限。`);input.reportValidity();return;}
    command('settings',{rules:{clueMax:value}});
  };
  $('banRule').onchange=()=>command('settings',{rules:{ban:$('banRule').checked}});
  $('awardsRule').onchange=()=>command('settings',{rules:{awards:$('awardsRule').checked}});
  $('banModeRule').onchange=()=>command('settings',{rules:{banMode:$('banModeRule').value}});
  for(const key of ['clueSeconds','guessSeconds'])$(`${key}Rule`).onchange=()=>command('settings',{rules:{[key]:$(`${key}Rule`).value?Number($(`${key}Rule`).value):null}});
  $('roomRules').onclick=()=>openDialog('rulesDialog');
  $('publicRoom').onchange=()=>command('publicRoom',{public:$('publicRoom').checked});
  $('banCard').onclick=()=>command('ban',{index:banTarget});
  $('roomFilters').onclick=showRoomFilters;
  $('filterForm').onsubmit=e=>{e.preventDefault();if(!poolReady)return;updatePoolCount();if(!$('applyFilters').disabled)command('settings',{filters:readFilters()});};
  $('clueForm').onsubmit=e=>{
    e.preventDefault();
    if(!connected||pendingAction)return;
    const word=$('clueInput').value.trim(), raw=$('numberInput').value.trim();
    if(!word){operation('提示词不能为空。');$('clueInput').focus();return;}
    const limit=room&&room.settings.rules.clueMax||G.clueLimit;
    if(word.length>limit){operation(`提示词最多 ${limit} 个字符。`);$('clueInput').focus();return;}
    if(/\s/.test(word)){operation('提示词不能包含空格。');$('clueInput').focus();return;}
    // A blank field is the unlimited clue, so it must not fall through to Number('') === 0.
    const count=raw===''?null:Number(raw);
    if(count!==null&&(!Number.isInteger(count)||count<0)){operation('提示张数必须是不小于 0 的整数。');$('numberInput').focus();return;}
    command('clue',{word,count});
  };
  $('confirmGuess').onclick=()=>{if(selected!==null)command('vote',{choice:selected});};
  $('endTurn').onclick=()=>command('vote',{choice:'end'});
  $('restartConfirm').onclick=()=>command('lobby');$('againButton').onclick=()=>command('lobby');
  $('backToLobby').onclick=()=>command('lobby');
  $('shareMatch').onclick=openShare;
  $('reviewMap').onclick=()=>{$('resultDialog').close();renderRoom();};
  $('reviewButton').onclick=()=>{$('resultDialog').close();renderRoom();};
  for(const [id,next] of [['guesserView','guesser'],['captainView','captain']])$(id).onclick=()=>{if(spectatorView===next)return;spectatorView=next;selected=null;renderRoom();};
  // The lobby count comes from this browser's copy of the list, cached per filter set.
  function poolSize(f){
    const key=JSON.stringify(f);
    if(poolCache.key!==key)poolCache={key,count:G.filter(allAnime,f,dataDate).length};
    return poolCache.count;
  }
  function countdown(){
    clearTimeout(countdownTimer);countdownTimer=null;
    const deadline=game&&game.phase!=='over'?game.deadline:null;
    if(!deadline){turnTimer.hidden=true;return;}
    // A timed match opens with a preparation countdown, then the captain's clock.
    const now=Date.now()+clockOffset,preparing=game.prepUntil>now;
    const remaining=(preparing?game.prepUntil:deadline)-now,left=Math.max(0,Math.ceil(remaining/1000));
    turnTimer.hidden=false;turnTimer.textContent=`${preparing?'准备 ':''}${Math.floor(left/60)}:${String(left%60).padStart(2,'0')}`;
    turnTimer.setAttribute('aria-label',preparing?`开局准备剩余 ${left} 秒`:`本阶段剩余 ${left} 秒`);
    turnTimer.classList.toggle('is-urgent',!preparing&&left<=10);
    // Wake on the next whole second of the server clock.
    if(left>0)countdownTimer=setTimeout(countdown,(remaining%1000)||1000);
  }
  // Another tab of this browser left or switched rooms: this tab follows it.
  window.addEventListener('storage',event=>{
    if(event.key!==SESSION_KEY&&event.key!==null)return;
    const next=readSession();
    if(next?.code===session?.code&&next?.token===session?.token)return;
    resetEntry(false);
    if(next)saveSession(next,false);
  });
  // Closed, reloaded or navigated away: the room lets go within seconds unless this
  // browser connects again, from a reload or another tab. Going to the background
  // fires no pagehide, so it keeps the full grace period.
  window.addEventListener('pagehide',()=>{stopped=true;disconnect(4000);});
  window.addEventListener('pageshow',e=>{if(e.persisted){stopped=false;attempts=0;connect();}});
  // Back in view or back online: check a live socket at once, or reconnect without waiting.
  const resume=()=>{
    if(document.hidden||stopped||!session)return;
    if(socket){ping();return;}
    attempts=0;connect();
  };
  document.addEventListener('visibilitychange',resume);window.addEventListener('online',resume);
  fetch('anime_list.json').then(r=>{if(!r.ok)throw new Error('data unavailable');return r.json();})
    .then(data=>{if(!Array.isArray(data)||data.length<25)throw new Error('invalid data');allAnime=data;})
    .catch(()=>{$('dataFallback').hidden=false;})
    .finally(()=>{poolReady=true;poolCache.key='';if($('filterDialog').open)updatePoolCount();if(room&&!revealing)renderRoom();});
  if(session)connect();
  // Set up without an error: the boot screen index.html shows until now can go.
  document.documentElement.classList.remove('booting','boot-slow');$('bootScreen').remove();
}
