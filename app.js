'use strict';
const $=id=>document.getElementById(id), G=window.AniGame;
let allAnime=window.ANICODE_FALLBACK || [], dataDate=G.dataDate;
let filters={...G.defaults,excluded:[...G.defaults.excluded],included:[...(G.defaults.included||[])]}, game=null, view='guesser', selected=null, coverMode=localStorage.getItem('anicode-cover-mode')||(localStorage.getItem('anicode-show-covers')==='false'?'none':'adaptive');
let tagCatalog={exclude:[...G.excludedTags],include:[]};
// The Bangumi mirror first, then another mirror reachable without a proxy, then the official host.
const imageHosts=['lain.bangumi.vip','bgmimg.anibt.net','lain.bgm.tv'];
// The host that answered first on the last visit is tried first, so a returning
// player neither waits on a host that is down for them nor misses the covers
// the browser has already cached under that host's URLs.
const savedHost=localStorage.getItem('anicode-image-host');
if(imageHosts.includes(savedHost))imageHosts.unshift(...imageHosts.splice(imageHosts.indexOf(savedHost),1));
let hostSaved=false;
function saveHost(src){if(hostSaved)return;hostSaved=true;const host=new URL(src).hostname;if(imageHosts.includes(host))localStorage.setItem('anicode-image-host',host);}
const imageCache=new Map();
function el(tag,cls,text){const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;}
function openDialog(id){if(!$(id).open)$(id).showModal();}
function closeDialogs(){document.querySelectorAll('dialog[open]').forEach(d=>d.close());}
function message(text=''){$('status').textContent=text;}
let transitionTimer;
function hideTransition(){clearTimeout(transitionTimer);if($('phaseTransition'))$('phaseTransition').hidden=true;}
function showTransition(team,title,detail){
  let panel=$('phaseTransition');
  if(!panel){
    panel=el('section','phase-transition');panel.id='phaseTransition';panel.hidden=true;
    const text=el('div');text.setAttribute('role','status');text.setAttribute('aria-live','polite');text.setAttribute('aria-atomic','true');
    const heading=el('strong');heading.id='transitionTitle';const description=el('p');description.id='transitionDetail';
    text.append(heading,description);const dismiss=el('button','icon-button','×');dismiss.type='button';dismiss.setAttribute('aria-label','关闭阶段提示');dismiss.onclick=hideTransition;
    panel.append(text,dismiss);document.querySelector('.turn-panel').append(panel);
  }
  hideTransition();panel.dataset.team=team;
  $('transitionTitle').textContent=title;$('transitionDetail').textContent=detail;
  // Cover the panel's own heading, which the banner restates, and nothing below it.
  const top=panel.parentElement.getBoundingClientRect().top;
  panel.style.minHeight=Math.max(64,Math.round($('turnTitle').getBoundingClientRect().bottom-top+12))+'px';
  panel.hidden=false;
  transitionTimer=setTimeout(hideTransition,2000);
}
// Wording lives in game.js so tests can assert it.
function announcePhase(previous,next){
  if(!next||next.phase==='over'){hideTransition();return;}
  const banner=G.announcement(previous,next);
  if(!banner)return;
  showTransition(banner.team,banner.title,banner.detail);
}
// Covers are adaptive (fit the screen), full or small (fixed sizes, board may scroll) or
// hidden; the older on/off setting maps onto adaptive or hidden.
const coverModes=['adaptive','full','small','none'];
function updateCoverToggle(){
  if(!coverModes.includes(coverMode))coverMode='adaptive';
  $('coverMode').value=coverMode;
  document.body.classList.toggle('full-covers',coverMode==='full');document.body.classList.toggle('small-covers',coverMode==='small');document.body.classList.toggle('no-covers',coverMode==='none');
}
// Card titles come in three sizes; medium is the original size.
const nameSizes=['small','medium','large'];
let nameSize=localStorage.getItem('anicode-name-size')||'medium';
function updateNameSize(){
  if(!nameSizes.includes(nameSize))nameSize='medium';
  $('nameSize').value=nameSize;
  document.body.classList.toggle('name-small',nameSize==='small');document.body.classList.toggle('name-large',nameSize==='large');
}
// Known cards show their team as a filled card (the default) or as coloured text on white.
const colorModes=['fill','text'];
let colorMode=localStorage.getItem('anicode-color-mode')||'fill';
function updateColorToggle(){
  if(!colorModes.includes(colorMode))colorMode='fill';
  $('colorMode').value=colorMode;
  document.body.classList.toggle('color-text',colorMode==='text');
}
// Desktop covers take the height left below the board's top edge, so all five rows fit on one screen.
function measureBoard(){
  const board=$('board');if(!board.offsetParent)return;
  const top=Math.round(board.getBoundingClientRect().top+scrollY)+'px',root=document.documentElement.style;
  if(root.getPropertyValue('--board-top')!==top)root.setProperty('--board-top',top);
}
function setView(next){view=next;selected=null;render();}
function requestCaptain(){if(!game)return;if(game.phase==='over')setView('captain');else if(view!=='captain')openDialog('privacyDialog');}
// ---- 队长选牌（同屏版） ----
// The board no longer arrives with random colours: each captain picks the anime
// their side has to find. Red picks nine because it moves first, blue picks
// eight, and the remaining eight cards become seven neutrals plus one assassin.
// The draft is deliberately one captain at a time; the guessers are asked to
// look away, and the full map is only shown again on the captain's confirm step.
const DRAFT={red:{label:'红队',count:9},blue:{label:'蓝队',count:8}};
let draft=null,draftExitArmed=false,draftExitTimer=null,draftSearchTimer=null,draftScrollTick=false;
function draftPool(){return G.filter(allAnime,filters,dataDate);}
function draftSorted(pool){
  return [...pool].sort((a,b)=>Number(b.vote_count||0)-Number(a.vote_count||0)||G.name(a).localeCompare(G.name(b),'zh-Hans'));
}
function start(){
  const pool=draftPool();
  if(pool.length<25){message('当前候选池不足 25 部，请放宽筛选条件。');return;}
  closeDialogs();
  draft={pool,byId:new Map(pool.map(a=>[a.id,a])),list:draftSorted(pool),red:[],blue:[],step:'intro',shown:60,game:null,shuffled:false,gridStep:null};
  draftExitArmed=false;clearTimeout(draftExitTimer);
  if(!game)renderIdle();
  renderDraft();
  document.body.classList.add('drafting');
  openDialog('draftDialog');
}
function renderIdle(){
  $('draftCta').hidden=false;
  const frag=document.createDocumentFragment();
  for(let i=0;i<25;i++){
    const card=el('div','card idle-card'),cover=el('div','cover');cover.append(el('div','cover-placeholder','?'));
    const name=el('div','card-name');name.append(el('span','','待选牌'));
    card.append(cover,name);frag.append(card);
  }
  $('board').replaceChildren(frag);
  $('redRemaining').textContent='9';$('blueRemaining').textContent='8';
  $('redRemaining').title='还剩 9 部';$('blueRemaining').title='还剩 8 部';
  $('redAgents').replaceChildren(...Array.from({length:9},()=>el('i')));
  $('blueAgents').replaceChildren(...Array.from({length:8},()=>el('i')));
  document.querySelectorAll('.team').forEach(team=>team.classList.remove('active'));
  $('round').textContent='等待开局';
  $('turnTitle').textContent='等待队长选牌';$('turnTitle').className='';
  $('phaseText').textContent='红蓝队长各自选牌后再开始对局';
  $('clueDisplay').hidden=true;$('flipsLeft').hidden=true;
  $('clueForm').hidden=true;$('guesserActions').hidden=true;$('captainStart').hidden=true;
  $('guesserView').disabled=true;$('captainView').disabled=true;
  $('boardLegend').hidden=true;$('detailPanel').hidden=true;
  document.querySelector('.log-panel').hidden=true;
  document.title='动画代号 · Anime Code';
  $('status').textContent='';
  measureBoard();
}
function setDraftStep(step){
  if(!draft)return;
  draft.step=step;draft.gridStep=null;$('draftSearch').value='';
  $('draftDialog').scrollTop=0;
  renderDraft();
  // A phone keyboard would cover half the board the moment the picker opens,
  // so only a mouse/keyboard device gets the search focused automatically.
  const finePointer=!window.matchMedia('(hover:none) and (pointer:coarse)').matches;
  if((step==='red'||step==='blue')&&finePointer)$('draftSearch').focus({preventScroll:true});
  else if(step==='handoff')$('draftNext').focus({preventScroll:true});
}
function renderDraft(){
  if(!draft)return;
  const step=draft.step,picking=step==='red'||step==='blue',team=step;
  $('draftDialog').dataset.step=step;
  $('draftIntro').hidden=step!=='intro';
  $('draftPicker').hidden=!picking;
  $('draftHandoff').hidden=step!=='handoff';
  $('draftConfirm').hidden=step!=='confirm';
  $('draftProgress').hidden=!picking;
  $('draftPrivacy').hidden=step==='handoff';
  $('draftBack').hidden=step==='intro'||step==='handoff';
  $('draftRandom').hidden=step!=='intro';
  $('draftNext').disabled=false;
  $('draftNext').textContent={intro:'开始选牌 →',red:'红队完成，交给蓝队 →',handoff:'我是蓝队队长，开始选牌 →',blue:'蓝队完成，确认牌阵 →',confirm:'交给红队队长 →'}[step];
  $('draftBack').textContent=step==='confirm'?'重新选牌':step==='blue'?'返回换人':step==='red'?'返回开始':'返回';
  $('draftTitle').textContent={intro:'本局由队长选牌',red:'红队队长选牌',handoff:'换蓝队队长',blue:'蓝队队长选牌',confirm:'队长确认牌阵'}[step];
  $('draftSubtitle').textContent={
    intro:'红队 9 部 · 蓝队 8 部 · 中立 7 · 刺客 1',
    red:'点选 9 部红队要找的动画，选满后交给蓝队队长。',
    handoff:'红队的 9 部已经锁好，蓝队还要选 8 部。',
    blue:'点选 8 部蓝队要找的动画，选满后确认牌阵。',
    confirm:'红队 9 部 · 蓝队 8 部 · 中立 7 · 刺客 1'
  }[step];
  $('draftPrivacy').textContent=step==='intro'?'◇ 选牌时请让猜词人移开视线。':step==='confirm'?'◇ 只给队长看：请猜词人保持移开视线。':'◇ 只给队长看：请猜词人现在移开视线。';
  if(picking){
    $('draftProgress').dataset.team=team;
    $('draftCount').textContent=draft[team].length;
    $('draftTotal').textContent=DRAFT[team].count;
    $('draftPickedTotal').textContent=DRAFT[team].count;
    $('draftPicker').dataset.team=team;
    if(draft.gridStep!==team){
      draft.gridStep=team;
      $('draftSearch').value='';
      $('draftShuffle').textContent=draft.shuffled?'按人气':'换一批';
      renderDraftGrid();
    }
    renderDraftTray();
  }
  if(step==='confirm'&&draft.game)renderDraftMap(draft.game);
  setDraftStatus('');
}
function setDraftStatus(text){$('draftStatus').textContent=text||'';}
function renderDraftGrid(reset=true){
  if(!draft)return;
  const query=$('draftSearch').value.trim().toLowerCase();
  draft.filtered=query?draft.list.filter(a=>[G.name(a),(a.name||'')].join(' ').toLowerCase().includes(query)):draft.list;
  if(reset){
    draft.shown=Math.min(60,draft.filtered.length);
    $('draftGrid').replaceChildren();
    $('draftScroll').scrollTop=0;
  }
  const from=$('draftGrid').childElementCount,end=Math.min(draft.shown,draft.filtered.length),frag=document.createDocumentFragment();
  for(let i=from;i<end;i++)frag.append(draftCardNode(draft.filtered[i]));
  $('draftGrid').append(frag);
  $('draftEmpty').hidden=!!draft.filtered.length;
  $('draftMore').hidden=end>=draft.filtered.length;
  if(!draft.filtered.length)setDraftStatus('换个关键词试试，或者点「换一批」看看别的动画。');
}
function draftCardNode(anime){
  const owner=draft.red.some(a=>a.id===anime.id)?'red':draft.blue.some(a=>a.id===anime.id)?'blue':null;
  const button=el('button','draft-card'+(owner?' is-picked owner-'+owner:''));
  button.type='button';button.dataset.id=anime.id;button.disabled=!!owner;
  button.setAttribute('aria-pressed',String(!!owner));button.title=G.name(anime);
  const cover=el('div','draft-card-cover'),img=coverImage(anime);
  cover.append(el('span','draft-card-placeholder','✦'));
  if(img)cover.append(img);
  cover.append(el('span','draft-card-mark',owner?G.label(owner):'+'));
  const year=(anime.air_date||'').slice(0,4),score=anime.score?`${anime.score} 分`:'';
  button.append(cover,el('span','draft-card-name',G.name(anime)),el('small','draft-card-meta',[year,score].filter(Boolean).join(' · ')));
  return button;
}
function updateDraftCard(id){
  const card=$('draftGrid').querySelector(`[data-id="${CSS.escape(String(id))}"]`);if(!card)return;
  const owner=draft.red.some(a=>a.id===id)?'red':draft.blue.some(a=>a.id===id)?'blue':null;
  card.classList.toggle('is-picked',!!owner);card.classList.toggle('owner-red',owner==='red');card.classList.toggle('owner-blue',owner==='blue');
  card.disabled=!!owner;card.setAttribute('aria-pressed',String(!!owner));
  const mark=card.querySelector('.draft-card-mark');if(mark)mark.textContent=owner?G.label(owner):'+';
}
function renderDraftTray(){
  if(!draft||!['red','blue'].includes(draft.step))return;
  const team=draft.step,picks=draft[team],total=DRAFT[team].count;
  $('draftCount').textContent=picks.length;$('draftPickedCount').textContent=picks.length;$('draftPickedTotal').textContent=total;
  $('draftPicked').replaceChildren(...picks.map(anime=>{
    const item=el('button','draft-picked-item');item.type='button';item.title=`移除 ${G.name(anime)}`;
    const thumb=el('span','draft-picked-cover'),img=coverImage(anime);if(img)thumb.append(img);
    item.append(thumb,el('span','draft-picked-name',G.name(anime)),el('span','draft-picked-x','×'));
    item.onclick=()=>removeDraftPick(anime.id);
    return item;
  }));
  $('draftTrayEmpty').hidden=!!picks.length;
  $('draftUndo').disabled=!picks.length;$('draftFill').disabled=picks.length>=total;
  $('draftNext').disabled=picks.length!==total;
}
function toggleDraftPick(id){
  if(!draft||!['red','blue'].includes(draft.step))return;
  const team=draft.step,total=DRAFT[team].count;
  if(draft[team].some(a=>a.id===id)){removeDraftPick(id);return;}
  if(draft.red.some(a=>a.id===id)||draft.blue.some(a=>a.id===id)){setDraftStatus('这部动画已经被另一队选走了。');return;}
  if(draft[team].length>=total){setDraftStatus(`本队已经选满 ${total} 部，可以撤销后再换。`);return;}
  const anime=draft.byId.get(id);if(!anime)return;
  draft[team].push(anime);setDraftStatus('');
  updateDraftCard(id);renderDraftTray();
}
function removeDraftPick(id){
  if(!draft||!['red','blue'].includes(draft.step))return;
  const team=draft.step,index=draft[team].findIndex(a=>a.id===id);if(index<0)return;
  draft[team].splice(index,1);setDraftStatus('');
  updateDraftCard(id);renderDraftTray();
}
function undoDraftPick(){
  if(!draft||!['red','blue'].includes(draft.step)||!draft[draft.step].length)return;
  removeDraftPick(draft[draft.step][draft[draft.step].length-1].id);
}
function fillDraftTeam(){
  if(!draft||!['red','blue'].includes(draft.step))return;
  const team=draft.step,total=DRAFT[team].count,need=total-draft[team].length;
  if(need<=0)return;
  const taken=new Set([...draft.red,...draft.blue].map(a=>a.id));
  const candidates=G.shuffle(draft.pool.filter(a=>!taken.has(a.id))).slice(0,need);
  draft[team].push(...candidates);
  for(const card of $('draftGrid').children)updateDraftCard(Number(card.dataset.id));
  renderDraftTray();setDraftStatus(`已随机补满 ${DRAFT[team].label}的 ${total} 部。`);
}
function shuffleDraftPool(){
  if(!draft)return;
  draft.shuffled=!draft.shuffled;
  draft.list=draft.shuffled?G.shuffle(draft.pool):draftSorted(draft.pool);
  $('draftShuffle').textContent=draft.shuffled?'按人气':'换一批';
  $('draftSearch').value='';renderDraftGrid();setDraftStatus('');
}
function searchDraft(){
  clearTimeout(draftSearchTimer);
  draftSearchTimer=setTimeout(()=>renderDraftGrid(),90);
}
function loadMoreDraft(){
  if(draftScrollTick||!draft)return;
  draftScrollTick=true;
  requestAnimationFrame(()=>{
    draftScrollTick=false;
    const box=$('draftScroll');
    if(!draft||box.scrollTop+box.clientHeight<box.scrollHeight-180)return;
    if(draft.shown>=draft.filtered.length)return;
    draft.shown+=60;renderDraftGrid(false);
  });
}
function buildDraftGame(){
  if(!draft)return false;
  try{draft.game=G.createDraft(draft.red,draft.blue,draft.pool);setDraftStatus('');return true;}
  catch(error){setDraftStatus(error.message);return false;}
}
function advanceDraft(){
  if(!draft)return;
  const step=draft.step;
  if(step==='intro'){setDraftStep('red');return;}
  if(step==='red'){
    if(draft.red.length!==9){setDraftStatus(`红队还要再选 ${9-draft.red.length} 部。`);return;}
    setDraftStep('handoff');return;
  }
  if(step==='handoff'){setDraftStep('blue');return;}
  if(step==='blue'){
    if(draft.blue.length!==8){setDraftStatus(`蓝队还要再选 ${8-draft.blue.length} 部。`);return;}
    if(!buildDraftGame())return;
    setDraftStep('confirm');return;
  }
  if(step==='confirm')launchDraftGame();
}
function backDraft(){
  if(!draft)return;
  if(draft.step==='confirm'){draft.red=[];draft.blue=[];draft.game=null;setDraftStep('red');return;}
  if(draft.step==='blue'){setDraftStep('handoff');return;}
  if(draft.step==='red'){setDraftStep('intro');return;}
}
function renderDraftMap(g){
  const frag=document.createDocumentFragment();
  g.tiles.forEach((tile,index)=>{
    const card=el('div','draft-map-card '+tile.type);
    const cover=el('div','draft-map-cover'),img=coverImage(tile.anime);
    cover.append(el('span','draft-map-placeholder','✦'));
    if(img)cover.append(img);
    cover.append(el('span','draft-map-coordinate',String.fromCharCode(65+Math.floor(index/5))+(index%5+1)));
    card.append(cover,el('span','draft-map-name',G.name(tile.anime)),el('small','draft-map-tag',G.label(tile.type)));
    frag.append(card);
  });
  $('draftMap').replaceChildren(frag);
}
function launchDraftGame(){
  if(!draft?.game)return;
  game=draft.game;view='guesser';selected=null;
  draft=null;closeDraftDialog();message('');$('clueInput').value='';
  render();announcePhase(null,game);
  setTimeout(()=>{if(game&&game.phase==='clue')$('captainStart').focus({preventScroll:true});},80);
}
function startRandom(){
  const pool=draftPool();
  if(pool.length<25){message('当前候选池不足 25 部，请放宽筛选条件。');return;}
  draft=null;closeDialogs();game=G.create(pool);view='guesser';selected=null;message('');
  render();announcePhase(null,game);
}
function closeDraftDialog(){if($('draftDialog').open)$('draftDialog').close();document.body.classList.remove('drafting');}
function attemptCloseDraft(){
  if(!draft)return;
  if(draftExitArmed){
    clearTimeout(draftExitTimer);draftExitArmed=false;
    draft=null;closeDraftDialog();
    if(game)render();else renderIdle();
    return;
  }
  draftExitArmed=true;
  setDraftStatus('再点一次 × 退出选牌；这一局不会开始。');
  clearTimeout(draftExitTimer);
  draftExitTimer=setTimeout(()=>{
    draftExitArmed=false;
    if(draft&&$('draftStatus').textContent.includes('再点一次'))setDraftStatus('');
  },3200);
}
function coverImage(anime){
  const img=el('img');img.alt='';img.referrerPolicy='no-referrer';img.decoding='async';
  return applyCoverImage(img,anime)?img:null;
}
function applyCoverImage(img,anime,detail=false){
  img.onload=null;img.onerror=null;img.referrerPolicy='no-referrer';img.decoding='async';
  const hide=()=>{img.removeAttribute('src');img.style.display='none';if(detail)$('detailImageFallback').style.display='grid';};
  const path=String(anime.image_url||'').match(/^https?:\/\/[^/]+(\/.*)$/)?.[1];
  if(!path){hide();return false;}
  const cached=imageCache.get(path);if(cached===false){hide();return false;}
  const candidates=[...new Set([cached,...imageHosts.map(host=>'https://'+host+path)].filter(Boolean))];
  // A cover we have already loaded is in the browser cache, so show it straight
  // away. Hiding every image until onload makes the whole board blink on each
  // re-render, and the board is rebuilt on every click and every state poll.
  const known=typeof cached==='string';
  img.style.display=known?'block':'none';
  if(detail)$('detailImageFallback').style.display=known?'none':'grid';
  let attempt=0;
  img.onload=()=>{imageCache.set(path,img.currentSrc||img.src);saveHost(img.currentSrc||img.src);img.style.display='block';if(detail)$('detailImageFallback')?.style.setProperty('display','none');};
  img.onerror=()=>{attempt++;if(attempt<candidates.length)img.src=candidates[attempt];else{imageCache.set(path,false);img.removeAttribute('src');img.style.display='none';if(detail)$('detailImageFallback')?.style.setProperty('display','grid');}};
  img.src=candidates[0];
  return true;
}
function renderBoard(){
  $('board').classList.toggle('captain-board',view==='captain');
  const fragment=document.createDocumentFragment();
  game.tiles.forEach((tile,index)=>{
    const known=view==='captain'||tile.revealed;
    const coordinate=String.fromCharCode(65+Math.floor(index/5))+(index%5+1);
    const button=el('button','card'+(known?' known '+tile.type:'')+(tile.revealed?' revealed':'')+(selected===index?' selected':''));
    button.type='button';button.dataset.index=index;
    button.disabled=false;
    button.setAttribute('aria-pressed',String(selected===index));
    button.setAttribute('aria-label',`${coordinate} ${G.name(tile.anime)}${known?'，'+G.label(tile.type):''}${tile.revealed?'，已翻开':''}`);
    button.title=G.name(tile.anime);
    const cover=el('div','cover'),placeholder=el('div','cover-placeholder','✦');placeholder.append(el('small','','ANIME CODE'));cover.append(placeholder);
    const img=coverImage(tile.anime);if(img)cover.append(img);
    if(tile.revealed){const mark=el('div','reveal-mark');if(tile.type==='assassin')mark.append(el('b','','×'));cover.append(mark);}
    // Only the captains are told about a live ban, so the guessers still have to
    // read their own captain's clue; once the card is turned over its mark is
    // shown to everyone for the rest of the game. The mark carries
    // the banning team's colour, since both teams' bans can be live at once.
    const banTeam=tile.revealed||view==='captain'?G.bannedBy(game,index):null, banned=!!banTeam;
    if(banned){
      button.classList.add('is-banned');button.dataset.banTeam=banTeam;
      button.setAttribute('aria-label',button.getAttribute('aria-label')+`，${G.label(banTeam)}禁用牌`);
      cover.append(el('div','ban-mark','⊘'));
    }
    const title=el('div','card-name');
    // Covers can be hidden, so the name carries the mark too. It leads, because a
    // long name clamps to two lines and would push a trailing mark out of view.
    if(banned)title.append(el('span','ban-mark inline','⊘'));
    title.append(el('span','',G.name(tile.anime)));
    button.append(cover,title);
    button.onclick=()=>{selected=selected===index?null:index;render();$('board').children[index].focus({preventScroll:true});};
    fragment.append(button);
  });
  $('board').replaceChildren(fragment);
}
function flashCard(card,correct){
  if(!card||correct===undefined)return;
  card.classList.add(correct?'flash-correct':'flash-wrong');
  setTimeout(()=>card.classList.remove('flash-correct','flash-wrong'),800);
}
async function animateReveal(index,previousCard,correct){
  const card=$('board').children[index];
  if(window.matchMedia('(prefers-reduced-motion: reduce)').matches||!card||!previousCard){flashCard(card,correct);return;}
  // Keep the original face visible until the card turns edge-on.
  const front=el('div','reveal-front');
  front.setAttribute('aria-hidden','true');
  front.append(...Array.from(previousCard.children,child=>child.cloneNode(true)));
  front.querySelectorAll('.vote-avatars,.reveal-front').forEach(n=>n.remove());
  if(previousCard.classList.contains('known')){
    front.classList.add('known-front');
    front.style.setProperty('--front-color',getComputedStyle(card).getPropertyValue('--card-color'));
  }
  card.append(front);
  card.classList.add('is-flipping');
  const animations=card.getAnimations({subtree:true});
  // Background animation clocks can stall. Finish on return instead of holding
  // the network update queue indefinitely behind an old cosmetic effect.
  const finish=()=>animations.forEach(animation=>{try{animation.finish();}catch{animation.cancel();}});
  const resume=()=>{if(!document.hidden)finish();};
  document.addEventListener('visibilitychange',resume);
  const deadline=setTimeout(finish,700);
  try{await Promise.all(animations.map(animation=>animation.finished.catch(()=>{})));}
  finally{clearTimeout(deadline);document.removeEventListener('visibilitychange',resume);}
  front.remove();
  card.classList.remove('is-flipping');
  flashCard(card,correct);
}
function render(){
  if(!game)return;
  // A launched draft replaces the idle prompt and gives the local view tabs back.
  $('draftCta').hidden=true;
  if(!document.body.classList.contains('multiplayer')){$('guesserView').disabled=false;$('captainView').disabled=false;}
  const over=game.phase==='over', captain=view==='captain', guessing=game.phase==='guess';
  if(!document.body.classList.contains('multiplayer'))document.title=!over&&captain&&game.phase==='clue'?'轮到你出题 · 动画代号':!over&&!captain&&guessing?'轮到你猜词 · 动画代号':'动画代号 · Anime Code';
  renderBoard();
  renderDetail();
  for(const team of ['red','blue']){
    const total=team===(game.firstTeam||'red')?9:8, left=game.remaining?.[team]??G.remaining(game,team);
    $(team+'Remaining').textContent=left;$(team+'Remaining').title=`还剩 ${left} 部`;
    $(team+'Agents').replaceChildren(...Array.from({length:total},(_,i)=>el('i',i>=left?'found':'')));
    document.querySelector('.team.'+team).classList.toggle('active',!over&&game.turn===team);
  }
  $('round').textContent=over?'行动结束':`第 ${game.round} 回合`;
  $('guesserView').setAttribute('aria-pressed',String(!captain));$('captainView').setAttribute('aria-pressed',String(captain));
  // The legend only explains colours when the whole map is visible.
  $('boardLegend').hidden=!captain;
  $('turnTitle').textContent=over?`${G.label(game.winner)}获胜！`:`${G.label(game.turn)}的回合`;
  $('turnTitle').className=over?game.winner:game.turn;
  $('phaseText').textContent=over?'本局复盘':guessing?'猜词中':captain?'出题中':'等待队长出题';
  $('clueWord').textContent=game.clue?.word||'等待灵感';$('clueNumber').textContent=game.clue?(game.clue.count===null?'不限':game.clue.count):'—';
  $('clueDisplay').hidden=captain&&!guessing&&!over;
  // A capped round is worth stating: the budget decides when the turn ends, not
  // only the cards that come up.
  const left=G.flipsLeft(game);
  $('flipsLeft').hidden=over||!guessing||!Number.isFinite(left);
  if(!$('flipsLeft').hidden)$('flipsLeft').textContent=`本轮还可翻 ${left} 张`;
  $('clueForm').hidden=!captain||game.phase!=='clue';
  $('guesserActions').hidden=captain||!guessing;
  $('captainStart').hidden=captain||game.phase!=='clue';
  $('confirmGuess').disabled=captain||!guessing||selected===null;
  $('endTurn').disabled=captain||!guessing;
  renderLog();
}
// The action log replays the game a round at a time: each team's clue, then the
// cards it turned, in order. Two team turns make a round, so `g.round` 1–2 is the
// first page. It follows the newest round until the player pages back; the pin is
// tied to the deal, so a new game starts on its newest round again.
let logPin=null,logOpen=localStorage.getItem('anicode-log-open')!=='false';
const logDeal=g=>g.tiles.map(t=>t.anime.id).join();
const logPageOf=round=>Math.floor((round-1)/2);
function logPages(){const turns=game.turns||[];return logPageOf(game.phase==='over'?(turns[turns.length-1]?.round||1):game.round);}
function renderLog(){
  const panel=document.querySelector('.log-panel'),turns=game.turns||[];
  // Nothing to show before the first clue; a game stored before the record existed has none at all.
  panel.hidden=!game.turns||!turns.length&&game.round===1;
  if(panel.hidden)return;
  // Folded away, the panel keeps only its heading.
  panel.classList.toggle('collapsed',!logOpen);$('logToggle').setAttribute('aria-expanded',String(logOpen));
  if(!logOpen)return;
  const last=logPages(),pinned=logPin?.deal===logDeal(game)?logPin.page:null,shown=pinned===null?last:Math.min(pinned,last);
  $('logPage').textContent=`第 ${shown+1} / ${last+1} 轮`;
  $('logPrev').disabled=shown===0;$('logNext').disabled=shown===last;$('logLatest').hidden=shown===last;
  const live=game.phase==='guess'?turns[turns.length-1]:null;
  const rows=turns.filter(t=>logPageOf(t.round)===shown).map(t=>logTurn(t,t!==live));
  // The captain of this turn is still thinking, so the round's slot waits for the clue.
  if(game.phase==='clue'&&shown===last&&!turns.some(t=>t.round===game.round)){
    const box=el('div','log-turn '+game.turn);box.append(logHead(game.turn),el('p','log-wait','等待队长给出提示'));rows.push(box);
  }
  $('logBody').replaceChildren(...rows);
}
function logHead(team){const head=el('div','log-head');head.append(el('i'),el('b','',G.label(team)));return head;}
function logTurn(t,ended){
  const box=el('div','log-turn '+t.team),clue=el('div','log-clue');
  box.append(logHead(t.team),clue);
  if(t.word===null)clue.append(el('strong','muted','未出题'));
  else{
    const hits=t.flips.filter(i=>game.tiles[i].type===t.team).length,short=ended&&t.count!==null&&hits<t.count;
    clue.append(el('strong','',t.word),el('em','',t.count===null?'不限':String(t.count)));
    // What the replay is for: a clue that still has cards left to find stands out.
    clue.append(el('span','log-hit'+(short?' short':''),short?`猜中 ${hits} · 差 ${t.count-hits}`:`猜中 ${hits}`));
  }
  if(t.flips.length){
    const flips=el('ol','log-flips');
    for(const i of t.flips){
      const tile=game.tiles[i],item=el('li','log-flip '+tile.type+(tile.type===t.team?' hit':''));
      item.title=G.name(tile.anime);
      const cover=el('div','log-cover'),img=coverImage(tile.anime);if(img)cover.append(img);
      const name=el('span','log-name');
      if(tile.bannedBy){item.dataset.banTeam=tile.bannedBy;name.append(el('span','ban-mark inline','⊘'));}
      name.append(G.name(tile.anime));
      item.append(cover,name,el('small','log-tag',{red:'红',blue:'蓝',neutral:'中立',assassin:'刺客'}[tile.type]));
      flips.append(item);
    }
    box.append(flips);
  }
  return box;
}
function pinLog(page){logPin=page>=logPages()?null:{deal:logDeal(game),page:Math.max(0,page)};renderLog();}
// The share image: the finished match drawn on a canvas from the turn record.
// A cover only goes on the canvas if its host allows cross-origin reads, or the
// canvas could not be saved, so covers are asked for with CORS from the mirrors
// known to allow it first, and a card whose cover won't come keeps a placeholder.
const shareColors={red:'#df6178',blue:'#619ada',neutral:'#a6a6b3',assassin:'#353541',text:'#252536',muted:'#8e8ea0',pink:'#d96f80',bg:'#f2f2f7',border:'#e0e0ea'};
const shareWidth=800,shareFont='-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif';
function shareCover(anime){
  const path=String(anime.image_url||'').match(/^https?:\/\/[^/]+(\/.*)$/)?.[1];
  if(!path)return Promise.resolve(null);
  const corsHosts=['lain.bangumi.vip','bgmimg.anibt.net'];
  const hosts=[...corsHosts,...imageHosts.filter(host=>!corsHosts.includes(host))];
  return new Promise(resolve=>{
    const img=new Image();let attempt=0;
    const timer=setTimeout(()=>{img.onload=img.onerror=null;resolve(null);},6000);
    img.crossOrigin='anonymous';img.referrerPolicy='no-referrer';
    img.onload=()=>{clearTimeout(timer);resolve(img);};
    img.onerror=()=>{if(++attempt<hosts.length)img.src='https://'+hosts[attempt]+path;else{clearTimeout(timer);resolve(null);}};
    img.src='https://'+hosts[0]+path;
  });
}
function shareBox(ctx,x,y,w,h,r){ctx.beginPath();ctx.moveTo(x+r,y);ctx.arcTo(x+w,y,x+w,y+h,r);ctx.arcTo(x+w,y+h,x,y+h,r);ctx.arcTo(x,y+h,x,y,r);ctx.arcTo(x,y,x+w,y,r);ctx.closePath();}
function shareFit(ctx,text,width){
  if(ctx.measureText(text).width<=width)return text;
  const chars=Array.from(text);while(chars.length&&ctx.measureText(chars.join('')+'…').width>width)chars.pop();
  return chars.join('')+'…';
}
function shareWrap(ctx,text,width){
  const lines=[];let line='';
  for(const ch of Array.from(text)){if(line&&ctx.measureText(line+ch).width>width){lines.push(line);line=ch;}else line+=ch;}
  return line?[...lines,line]:lines;
}
// Draws the whole image and returns its height, so a first pass on a scratch
// canvas measures it and a second one paints it. The layout follows the replay
// in the intro video: each turn is a label, then a row of the captain's clue
// with the flipped cards to its right, in the order they were turned.
function drawShare(ctx,g,covers,roster){
  const W=shareWidth,P=40,inner=W-P*2,C=shareColors,font=(size,weight=400)=>`${weight} ${size}px ${shareFont}`;
  const text=(value,x,y,size,color,weight=400,align='left')=>{ctx.font=font(size,weight);ctx.fillStyle=color;ctx.textAlign=align;ctx.fillText(value,x,y);ctx.textAlign='left';};
  const width=(value,size,weight=400)=>{ctx.font=font(size,weight);return ctx.measureText(value).width;};
  const dot=(x,y,r,color)=>{ctx.fillStyle=color;ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fill();};
  // Groups of [text, colour, weight] runs along one line; a group that doesn't fit ends it in an ellipsis.
  const runs=(groups,x,y,end,size)=>groups.some(parts=>{
    const need=parts.reduce((sum,[s,,w])=>sum+width(s,size,w),0);
    if(x+need>end-width('…',size)){text('…',x,y,size,C.muted);return true;}
    for(const [s,color,w] of parts){text(s,x,y,size,color,w);x+=width(s,size,w);}
  });
  // Award runs centred on cx, a dotted one led by a square of its colour. A line
  // too wide steps its size down to `min`, then cuts `parts` short with an
  // ellipsis; the `tail` runs after them always show whole.
  const centred=(parts,cx,y,room,size,min=size,tail=[])=>{
    const all=[...parts,...tail],lead=(i,sz)=>all[i][3]?sz*.6+5+(i&&all[i-1][3]?12:0):0;
    const measure=(sz,from=0)=>all.slice(from).reduce((sum,[s,,w],i)=>sum+lead(from+i,sz)+width(s,sz,w),0);
    while(size>min&&measure(size)>room)size-=2;
    const end=cx+room/2-measure(size,parts.length);let x=cx-Math.min(measure(size),room)/2;
    all.forEach(([s,color,w,dot],i)=>{
      const cut=i<parts.length;
      if(cut&&x>=end)return;
      if(dot){const r=size*.6;x+=lead(i,size)-r-5;shareBox(ctx,x,y-size*.36-r/2,r,r,3);ctx.fillStyle=C[color];ctx.fill();x+=r+5;}
      ctx.font=font(size,w);const fit=cut?shareFit(ctx,s,end-x):s;text(fit,x,y,size,C[color],w);x=fit===s?x+width(s,size,w):end;
    });
  };
  // A panel tinted with its team colour, like the clue boxes in the game.
  const tinted=(x,y,w,h,r,color)=>{shareBox(ctx,x,y,w,h,r);ctx.fillStyle='#fff';ctx.fill();ctx.fillStyle=color;ctx.globalAlpha=.05;ctx.fill();ctx.globalAlpha=.3;ctx.strokeStyle=color;ctx.lineWidth=1;ctx.stroke();ctx.globalAlpha=1;};
  const now=new Date(),date=`${now.getFullYear()}.${String(now.getMonth()+1).padStart(2,'0')}.${String(now.getDate()).padStart(2,'0')}`;
  const bar=ctx.createLinearGradient(0,0,W,0);bar.addColorStop(0,'#efbbc2');bar.addColorStop(.5,C.pink);bar.addColorStop(1,'#efbbc2');
  ctx.fillStyle=bar;ctx.fillRect(0,0,W,5);
  let y=P+8;
  text('动画代号 · 对局回顾',P,y+12,15,C.pink,700);text(date,W-P,y+12,13,C.muted,400,'right');
  // The result card: who won and why, then each side with what it found and who played.
  y+=34;const first=g.firstTeam||'red',teams=[first,G.other(first)];
  const awards=awardCards(g),awardH=136;
  ctx.font=font(16);const reason=shareWrap(ctx,g.reason,inner-56),cardH=134+reason.length*26+teams.length*34+(awards.length?awardH+22:0);
  shareBox(ctx,P,y,inner,cardH,20);ctx.fillStyle='#fff';ctx.fill();ctx.strokeStyle=C.border;ctx.lineWidth=1;ctx.stroke();
  text(`${G.label(g.winner)}获胜`,W/2,y+72,48,C[g.winner],800,'center');
  reason.forEach((line,i)=>text(line,W/2,y+108+i*26,16,'#5f5d72',400,'center'));
  let row=y+108+reason.length*26+8;ctx.fillStyle=C.border;ctx.fillRect(P+28,row-6,inner-56,1);
  for(const team of teams){
    const all=team===first?9:8,label=`${G.label(team)}  ${all-G.remaining(g,team)} / ${all}`;
    row+=30;dot(P+34,row-6,6,C[team]);text(label,P+48,row,17,C[team],700);
    // Names in the side's colour, as the chat shows them; what doesn't fit ends in an ellipsis.
    runs((roster?.[team]||[]).map((p,i)=>[i?['、',C.muted,400]:null,[p.name,C[team],700],p.captain?['（队长）',C[team],400]:null].filter(Boolean)),P+48+width(label,17,700)+16,row,W-P-28,14);
  }
  // The awards as the result dialog shows them: a card each, topped with the winner's colour.
  const awardW=(inner-56-12*(awards.length-1))/awards.length;
  awards.forEach(({label,team,head,tail,lines},i)=>{
    const x=P+28+i*(awardW+12),top=row+24,cx=x+awardW/2,room=awardW-28;
    tinted(x,top,awardW,awardH,12,C[team]);
    ctx.save();shareBox(ctx,x,top,awardW,awardH,12);ctx.clip();ctx.fillStyle=C[team];ctx.fillRect(x,top,awardW,4);ctx.restore();
    centred([['✦ '+label,'pink',700]],cx,top+30,room,13);
    centred(head,cx,top+70,room,24,16,tail);
    lines.forEach((line,j)=>centred(line,cx,top+100+j*22,room,14));
  });
  y+=cardH;
  const boxW=220,gap=12,perRow=4,cw=Math.floor((inner-boxW-16-gap*(perRow-1))/perRow),coverH=110,ch=coverH+50,left=P+boxW+16;
  for(const t of g.turns||[]){
    const color=C[t.team],label=`${G.label(t.team)}的回合`;
    y+=44;dot(P+7,y-7,7,color);text(label,P+22,y,22,color,700);
    text(`第 ${t.round} 回合`,P+22+width(label,22,700)+14,y,14,C.muted);
    y+=16;
    const lines=Math.ceil(t.flips.length/perRow),rowH=lines?lines*ch+(lines-1)*gap:96,boxH=Math.min(rowH,ch);
    tinted(P,y,boxW,boxH,14,color);
    text('队长提示',P+18,y+26,12,C.muted);
    if(t.word===null)text('未出题',P+18,y+boxH/2+14,22,C.muted,600);
    else{
      // Longer words step down so they keep clear of the number, then take two lines, then get cut.
      const numberW=60,room=boxW-36-numberW-10,mid=y+boxH/2+8;
      let size=36;while(size>22&&width(t.word,size,700)>room)size-=2;
      ctx.font=font(size,700);let word=[t.word];
      if(ctx.measureText(t.word).width>room){size=20;ctx.font=font(size,700);word=shareWrap(ctx,t.word,room);if(word.length>2)word=[word[0],shareFit(ctx,word.slice(1).join(''),room)];}
      word.forEach((line,i)=>text(line,P+18,mid+size*.36+(i-(word.length-1)/2)*(size+6),size,C.text,700));
      ctx.fillStyle=color;ctx.globalAlpha=.3;ctx.fillRect(P+boxW-18-numberW,mid-24,1,48);ctx.globalAlpha=1;
      text(t.count===null?'不限':String(t.count),P+boxW-18-numberW/2,mid+(t.count===null?7:14),t.count===null?20:38,color,700,'center');
      const hits=t.flips.filter(i=>g.tiles[i].type===t.team).length,short=t.count!==null&&hits<t.count;
      text(short?`猜中 ${hits} · 差 ${t.count-hits}`:`猜中 ${hits}`,P+18,y+boxH-16,12,short?color:C.muted,short?700:400);
    }
    // A flipped card as the board shows it: the side's colour, a faded cover with the side named over it.
    t.flips.forEach((index,i)=>{
      const tile=g.tiles[index],x=left+(i%perRow)*(cw+gap),top=y+Math.floor(i/perRow)*(ch+gap),c=C[tile.type],img=covers.get(index);
      ctx.save();shareBox(ctx,x,top,cw,ch,10);ctx.clip();
      ctx.fillStyle=c;ctx.fillRect(x,top,cw,ch);
      if(img){
        const s=Math.max(cw/img.naturalWidth,coverH/img.naturalHeight),sw=cw/s,sh=coverH/s;
        ctx.globalAlpha=.38;if('filter' in ctx)ctx.filter='grayscale(.75)';
        ctx.drawImage(img,(img.naturalWidth-sw)/2,(img.naturalHeight-sh)*.28,sw,sh,x,top,cw,coverH);
        ctx.globalAlpha=1;if('filter' in ctx)ctx.filter='none';
      }
      ctx.fillStyle='#fff';ctx.globalAlpha=.18;ctx.fillRect(x,top+coverH,cw,1);ctx.globalAlpha=1;
      text(G.label(tile.type),x+cw/2,top+coverH/2+9,24,'#fff',700,'center');
      ctx.font=font(13,600);const name=shareWrap(ctx,G.name(tile.anime),cw-20);
      if(name.length>2)name.splice(1,name.length,shareFit(ctx,name.slice(1).join(''),cw-20));
      name.forEach((line,j)=>text(line,x+10,top+coverH+(name.length>1?21:31)+j*18,13,'#fff',600));
      ctx.restore();
    });
    y+=Math.max(rowH,boxH);
  }
  y+=40;ctx.fillStyle=C.border;ctx.fillRect(P,y,inner,1);
  const brand='动画代号',url=location.protocol==='file:'?'本地对局':location.origin+location.pathname.replace(/[^/]*$/,''),spread=width(brand,16,700)+10+width(url,15);
  y+=36;text(brand,W/2-spread/2,y,16,C.pink,700);text(url,W/2-spread/2+width(brand,16,700)+10,y,15,C.muted);
  return y+P-6;
}
// The awards as cards, for the result dialog and the share image alike: the
// award, the side that won it, a headline of who or what, then two lines of
// detail. A headline's `tail` stays whole when the share image cuts it short,
// so a long clue still shows its number. Text comes as runs of [text, colour, weight, dot]; the colour is a
// card type or 'muted', and a run with `dot` is led by a square of its colour,
// like the board's legend. A room that switched the awards off gets none.
function awardCards(g){
  if(g.rules?.awards===false)return [];
  const {clue,mvp,sixth}=G.awards(g),names=list=>list.flatMap((s,i)=>[...(i?[['、','muted',400]]:[]),[s.name,s.team,700]]);
  const side=team=>[[G.label(team),team,700]],cards=[];
  if(mvp.length)cards.push({label:'MVP',team:mvp[0].team,head:names(mvp),lines:[side(mvp[0].team),[[`投中己方 ${mvp[0].hits} 张`,'muted',400]]]});
  if(clue)cards.push({label:'最佳提示',team:clue.team,head:[[`「${clue.word}`,clue.team,700]],tail:[['」',clue.team,700],[clue.count===null?'不限':String(clue.count),clue.team,400]],
    lines:[clue.captain?[[`${G.label(clue.team)}队长 `,'muted',400],[clue.captain,clue.team,700]]:side(clue.team),[[`猜中 ${clue.hits} 张`,'muted',400]]]});
  // The ones sharing 第六人 tie on every kind of card, so one breakdown speaks for them all.
  // Only the kinds they actually got wrong are listed.
  if(sixth.length){const s=sixth[0],wrong=[[s.neutral,'中立','neutral'],[s.opponent,'对方',G.other(s.team)],[s.assassin,'刺客','assassin']].filter(([n])=>n).map(([n,kind,color])=>[`${kind} ${n}`,color,700,true]);cards.push({label:'最佳第六人',team:s.team,head:names(sixth),lines:[side(s.team),wrong]});}
  return cards;
}
function showResult(g){
  $('resultTitle').textContent=G.label(g.winner)+'获胜！';$('resultText').textContent=g.reason;
  const cards=awardCards(g),runs=(cls,parts)=>{const box=el('div',cls);box.append(...parts.map(([s,color,weight,dot])=>el('span',`award-run ${color}${weight>=700?' strong':''}${dot?' dot':''}`,s)));return box;};
  $('resultAwards').replaceChildren(...cards.map(({label,team,head,tail=[],lines})=>{
    const card=el('div',`award-card ${team}`);
    card.append(el('b','award-label','✦ '+label),runs('award-head',[...head,...tail]),...lines.map(line=>runs('award-line',line)));return card;
  }));
  $('resultAwards').hidden=!cards.length;
  openDialog('resultDialog');
}
// Room play fills in shareRoster with who sat on each side, captain first, as
// {red:[{name,captain}],blue:[...]}; local practice has nobody to list.
let shareRoster=null;
// Rebuilt each time it opens, from the match as it is then.
// It is drawn at 1.5× and saved as JPEG: a 2× PNG took seconds to encode.
const shareScale=1.5;
let shareUrl=null,shareCanvas=null,shareRun=0;
async function openShare(){
  if(!game||game.phase!=='over')return;
  const g=game,run=++shareRun;
  $('shareStatus').textContent='正在生成图片…';$('sharePreview').hidden=true;$('shareSave').hidden=true;$('shareCopy').hidden=true;
  openDialog('shareDialog');
  const indexes=[...new Set((g.turns||[]).flatMap(t=>t.flips))];
  const covers=new Map(await Promise.all(indexes.map(async i=>[i,await shareCover(g.tiles[i].anime)])));
  if(run!==shareRun||!$('shareDialog').open)return;
  const roster=shareRoster?.()||null;
  const paint=covers=>{
    const height=Math.ceil(drawShare(document.createElement('canvas').getContext('2d'),g,covers,roster)),canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');
    canvas.width=Math.round(shareWidth*shareScale);canvas.height=Math.round(height*shareScale);ctx.scale(shareScale,shareScale);ctx.fillStyle=shareColors.bg;ctx.fillRect(0,0,shareWidth,height);
    drawShare(ctx,g,covers,roster);
    return new Promise((resolve,reject)=>{try{canvas.toBlob(blob=>resolve(blob&&{blob,canvas}),'image/jpeg',.9);}catch(error){reject(error);}});
  };
  let shot=null;
  // A cover that got through without CORS headers would lock the canvas; drop them all and try once more.
  try{shot=await paint(covers);}catch{try{shot=await paint(new Map());}catch{}}
  if(run!==shareRun||!$('shareDialog').open)return;
  if(!shot){$('shareStatus').textContent='图片生成失败，请稍后再试。';return;}
  if(shareUrl)URL.revokeObjectURL(shareUrl);
  shareUrl=URL.createObjectURL(shot.blob);shareCanvas=shot.canvas;
  const now=new Date(),stamp=`${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}-${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}`;
  $('shareImage').src=shareUrl;$('sharePreview').hidden=false;
  $('shareSave').href=shareUrl;$('shareSave').download=`动画代号-${stamp}.jpg`;$('shareSave').hidden=false;
  $('shareCopy').hidden=!(navigator.clipboard&&navigator.clipboard.write&&window.ClipboardItem);$('shareCopy').textContent='复制图片';
  $('shareStatus').textContent='手机上可以长按图片保存或分享。';
}
// The clipboard only takes PNG, so that is encoded on demand. The item gets the
// promise rather than the blob so Safari still counts the write as part of the tap.
$('shareCopy').onclick=async()=>{
  const canvas=shareCanvas,png=new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('encode')),'image/png'));
  $('shareCopy').textContent='复制中…';
  try{await navigator.clipboard.write([new ClipboardItem({'image/png':png})]);$('shareCopy').textContent='已复制';}
  catch{$('shareCopy').textContent='复制图片';$('shareStatus').textContent='复制失败，请保存图片后分享。';}
};
$('shareButton').onclick=openShare;
const filterKeys=['minVotes','minYear','maxYear','minScore','maxScore'];
// A preset is just the numeric dials, so it never touches the tag choices the
// host has made. Chips stay reflective: whichever one matches the current dials
// reads as pressed, and moving any slider drops that state on its own.
function presetMatches(preset){return G.presetKeys.every(key=>Number($(key).value||0)===preset.filters[key]);}
function syncPresetChips(){
  for(const chip of $('presetChips').children)
    chip.setAttribute('aria-pressed',String(presetMatches(G.presets[Number(chip.dataset.preset)])));
}
function applyPreset(preset){
  for(const key of G.presetKeys){
    $(key).value=key==='minYear'&&!preset.filters[key]?'':preset.filters[key];
    syncFilterRange(key);
  }
  syncPresetChips();updatePoolCount();
}
$('presetChips').replaceChildren(...G.presets.map((preset,index)=>{
  // type=button, or the chip would submit the filter form and reroll the board.
  const chip=el('button','preset-chip',preset.name);chip.type='button';chip.dataset.preset=index;
  chip.setAttribute('aria-pressed','false');chip.title=preset.hint;
  chip.onclick=()=>applyPreset(preset);
  return chip;
}));
function readFilters(){
  return {...Object.fromEntries(filterKeys.map(key=>[key,Number($(key).value)])),
    excluded:[...$('excludeTags').querySelectorAll('input:checked')].map(n=>n.value),
    included:[...$('includeTags').querySelectorAll('input:checked')].map(n=>n.value),
    excludeOptions:[...tagCatalog.exclude],includeOptions:[...tagCatalog.include],
    poolIds:picked?[...picked].sort((a,b)=>a-b):null,poolUsers:picked?[...poolUsers]:[]};
}
function updatePoolCount(){
  const f=readFilters(),valid=$('filterForm').checkValidity()&&f.minYear<=f.maxYear&&f.minScore<=f.maxScore;
  const count=valid?G.filter(allAnime,f,dataDate).length:0,tooMany=!!picked&&picked.size>G.poolLimit;
  const source=picked?`收藏牌池：已选 ${picked.size.toLocaleString()} 部 · 筛选后 `:'候选池：';
  $('poolCount').textContent=!valid?'请检查数值、年份和评分范围。':tooMany?`收藏牌池最多 ${G.poolLimit.toLocaleString()} 部，当前已选 ${picked.size.toLocaleString()} 部。`:`${source}${count.toLocaleString()} 部${count<25?' · 至少需要 25 部，请放宽条件':''}`;
  $('applyFilters').disabled=!valid||tooMany||count<25;
}
function syncFilterRange(key){
  const number=$(key),range=$(key+'Range'),value=Number(number.value);
  if(key==='minVotes'){range.max=Math.max(5000,value||0);$('votesRangeMax').textContent=Number(range.max).toLocaleString()+' 人';}
  range.value=key==='minYear'&&!value?range.min:value;
  range.style.setProperty('--range-fill',((Number(range.value)-Number(range.min))/(Number(range.max)-Number(range.min))*100)+'%');
  range.setAttribute('aria-valuetext',key==='minYear'&&range.value===range.min?'不限':range.value);
}
for(const key of filterKeys){
  $(key+'Range').oninput=()=>{
    $(key).value=key==='minYear'&&$(key+'Range').value===$(key+'Range').min?'':$(key+'Range').value;
    syncFilterRange(key);syncPresetChips();
  };
  $(key).oninput=()=>{syncFilterRange(key);syncPresetChips();};
}
function renderTagFilters(selected=filters){
  for(const kind of ['exclude','include']){
    const tags=tagCatalog[kind],active=selected[kind==='exclude'?'excluded':'included']||[];
    $(kind+'Tags').replaceChildren(...tags.map(tag=>{
      const row=el('div','tag-option'),label=el('label'),check=el('input');
      check.type='checkbox';check.value=tag;check.checked=active.includes(tag);
      label.append(check,el('span','',tag));row.append(label);
      if(kind!=='exclude'||!G.excludedTags.includes(tag)){
        const remove=el('button','tag-remove','×');remove.type='button';
        remove.setAttribute('aria-label',`删除${kind==='exclude'?'排除':'包含'}标签 ${tag}`);
        remove.onclick=()=>{
          const selected=readFilters();tagCatalog[kind]=tags.filter(item=>item!==tag);
          renderTagFilters(selected);$('tagStatus').textContent='';updatePoolCount();$(kind+'TagInput').focus();
        };
        row.append(remove);
      }
      return row;
    }));
    $(kind+'TagsEmpty').hidden=tags.length>0;
  }
}
function addTag(kind){
  const input=$(kind+'TagInput'),tag=input.value.trim(),selected=readFilters();
  if(!tag)return;
  if(tag.length>30){$('tagStatus').textContent='标签最多 30 个字符。';return;}
  if(!tagCatalog[kind].includes(tag)){
    if(tagCatalog[kind].length>=100){$('tagStatus').textContent='每栏最多添加 100 个标签。';return;}
    tagCatalog[kind].push(tag);
  }
  selected[kind==='exclude'?'excluded':'included'].push(tag);
  renderTagFilters(selected);input.value='';$('tagStatus').textContent='';updatePoolCount();input.focus();
}
// Stand-in for AbortSignal.timeout, which browsers before Safari 16 and Chrome 103 lack.
const timeoutSignal=ms=>{if(AbortSignal.timeout)return AbortSignal.timeout(ms);const controller=new AbortController();setTimeout(()=>controller.abort(new DOMException('signal timed out','TimeoutError')),ms);return controller.signal;};
// Bangumi collections as the pool. The official API is tried first, then the
// mirror; whichever answered last time goes first, as with the cover hosts.
const bangumiApis=['https://api.bgm.tv','https://api.bangumi.vip'];
const savedApi=localStorage.getItem('anicode-bangumi-api');
if(bangumiApis.includes(savedApi))bangumiApis.unshift(...bangumiApis.splice(bangumiApis.indexOf(savedApi),1));
// Collection types in list order. Watched and watching start ticked; the rest are
// listed for picking by hand. Type 0 holds saved picks whose collection this
// browser has not read.
const collectionTypes=[[2,'看过',true],[3,'在看',true],[4,'搁置',false],[5,'抛弃',false],[1,'想看',false],[0,'其他已选',true]];
// The dialog's pool: whose collections are merged and which ids are ticked.
// `picked` is null while the pool is the whole list. Collections once read stay
// cached for the visit, keyed by lower-case name and by the UID typed for it.
let poolUsers=[],picked=null,poolJob=0,poolBusy=false;
const bangumiCache=new Map();
function bangumiError(text,final,missing=false){const error=new Error(text);error.final=final;error.missing=missing;return error;}
async function bangumiPage(api,user,offset){
  const response=await fetch(`${api}/v0/users/${encodeURIComponent(user)}/collections?subject_type=2&limit=50&offset=${offset}`,{signal:timeoutSignal(15000)});
  let body=null;try{body=await response.json();}catch{}
  // Only Bangumi's own error body is a verdict on the name; anything else means
  // this host failed, and the next one gets a try.
  if(!response.ok){
    if(body&&typeof body.title==='string'&&(response.status===404||response.status===400))
      throw bangumiError(response.status===404?`找不到 Bangumi 用户「${user}」。`:`「${user}」不是有效的 Bangumi 用户名。`,true,response.status===404);
    throw bangumiError('',false);
  }
  if(!body||!Array.isArray(body.data)||!Number.isInteger(body.total))throw bangumiError('',false);
  return body;
}
// The old user API takes a UID as well as a name and answers with the name.
// An unknown user still gets a 200, with the 404 in the body.
async function bangumiUsername(api,uid){
  const response=await fetch(`${api}/user/${uid}`,{signal:timeoutSignal(15000)});
  let body=null;try{body=await response.json();}catch{}
  if(response.ok&&body&&typeof body.username==='string'&&body.username)return body.username;
  if(body&&body.code===404)throw bangumiError(`找不到 Bangumi 用户「${uid}」。`,true);
  throw bangumiError('',false);
}
// Resolves to the user's name and their collection, subject id to type.
async function readCollections(user,progress){
  const key=user.toLowerCase();
  if(bangumiCache.has(key))return bangumiCache.get(key);
  for(const api of bangumiApis){
    const items=new Map(),add=page=>{for(const c of page.data)if(Number.isInteger(c.subject_id)&&!items.has(c.subject_id))items.set(c.subject_id,c.type);};
    try{
      // Collections are looked up by name. A UID only doubles as one for
      // accounts that never set a name, so for the rest it is swapped for theirs.
      let name=user,first;
      try{first=await bangumiPage(api,name,0);}
      catch(error){
        if(!error.missing||!/^\d+$/.test(user))throw error;
        name=await bangumiUsername(api,user);
        if(name===user)throw error;
        if(bangumiCache.has(name.toLowerCase()))return bangumiCache.get(name.toLowerCase());
        first=await bangumiPage(api,name,0);
      }
      const offsets=[];
      add(first);progress(items.size,first.total);
      for(let offset=50;offset<first.total;offset+=50)offsets.push(offset);
      // Three pages at a time keeps a long list quick without hammering the API.
      const pages=async()=>{
        try{while(offsets.length){add(await bangumiPage(api,name,offsets.shift()));progress(items.size,first.total);}}
        catch(error){offsets.length=0;throw error;}
      };
      await Promise.all([pages(),pages(),pages()]);
      localStorage.setItem('anicode-bangumi-api',api);
      const read={name,items};
      bangumiCache.set(key,read);bangumiCache.set(name.toLowerCase(),read);return read;
    }catch(error){if(error.final)throw error;}
  }
  throw bangumiError('连不上 Bangumi，请稍后再试。',true);
}
let animeIndex={data:null,byId:null};
function animeById(){
  if(animeIndex.data!==allAnime)animeIndex={data:allAnime,byId:new Map(allAnime.map(a=>[a.id,a]))};
  return animeIndex.byId;
}
// One entry per anime in the list: its best collection type across the merged
// users, and who collected it. Collected anime the dataset lacks are only counted.
function poolEntries(collectedOnly=false){
  const byId=animeById(),entries=new Map(),missing=new Set(),rank=type=>collectionTypes.findIndex(t=>t[0]===type);
  for(const user of poolUsers){
    const read=bangumiCache.get(user.toLowerCase());if(!read)continue;
    read.items.forEach((type,id)=>{
      const anime=byId.get(id);if(!anime){missing.add(id);return;}
      const entry=entries.get(id);
      if(!entry)entries.set(id,{id,anime,type,users:[user]});
      else{entry.users.push(user);if(rank(type)<rank(entry.type))entry.type=type;}
    });
  }
  if(picked&&!collectedOnly)picked.forEach(id=>{const anime=byId.get(id);if(anime&&!entries.has(id))entries.set(id,{id,anime,type:0,users:[]});});
  return {entries:[...entries.values()],missing:missing.size};
}
function poolStatus(text){$('bangumiStatus').textContent=text;}
// Readers of a room see the host's picks but cannot change them.
const poolReadOnly=()=>$('filterDialog').classList.contains('is-readonly');
function renderPool(){
  const {entries,missing}=poolEntries(),active=!!picked||poolUsers.length>0,readOnly=poolReadOnly();
  $('poolPanel').hidden=!active;$('clearPool').hidden=!active||readOnly;
  $('bangumiDialog').classList.toggle('is-readonly',readOnly);
  $('bangumiTitle').textContent=readOnly?'Bangumi 收藏牌池':'从 Bangumi 收藏导入';$('bangumiDone').textContent=readOnly?'关闭':'完成';
  $('bangumiUsers').replaceChildren(...poolUsers.map(user=>{
    const chip=el('span','bangumi-user'),remove=el('button','tag-remove','×');
    chip.append(el('span','',user));remove.type='button';remove.setAttribute('aria-label',`移除 ${user} 的收藏`);
    remove.disabled=poolBusy;remove.onclick=()=>removePoolUser(user);chip.append(remove);return chip;
  }));
  const typed=entries.some(e=>e.type!==0),many=poolUsers.length>1;
  $('poolList').replaceChildren(...collectionTypes.map(([type,label,on])=>{
    const rows=entries.filter(e=>e.type===type);if(!rows.length)return null;
    rows.sort((a,b)=>Number(b.anime.vote_count||0)-Number(a.anime.vote_count||0));
    const group=el('div','pool-group'),head=el('div','pool-group-head'),toggle=el('label'),all=el('input'),fold=el('button','text-button pool-fold');
    group.dataset.type=type;group.classList.toggle('is-collapsed',!on);
    all.type='checkbox';all.className='pool-group-check';all.disabled=readOnly;
    toggle.append(all,el('span','',type===0&&!typed?'牌池中的动画':label),el('small','pool-group-count'));
    fold.type='button';fold.dataset.browse='';fold.textContent=on?'收起':'展开';fold.setAttribute('aria-expanded',String(on));
    fold.onclick=()=>{const collapsed=group.classList.toggle('is-collapsed');fold.textContent=collapsed?'展开':'收起';fold.setAttribute('aria-expanded',String(!collapsed));};
    head.append(toggle,fold);group.append(head);
    for(const {id,anime,users} of rows){
      const row=el('label','pool-option'),check=el('input'),year=(anime.air_date||'').slice(0,4);
      check.type='checkbox';check.value=id;check.checked=!!picked&&picked.has(id);check.disabled=readOnly;
      row.dataset.search=[G.name(anime),anime.name||''].join(' ').toLowerCase();
      const meta=[year,anime.score?`${anime.score} 分`:'',many?users.join('、'):''].filter(Boolean).join(' · ');
      row.append(check,el('span','',G.name(anime)),el('small','',meta));group.append(row);
    }
    return group;
  }).filter(Boolean));
  $('poolMissing').hidden=!missing;$('poolMissing').textContent=`另有 ${missing.toLocaleString()} 部收藏不在动画数据中，无法加入牌池。`;
  searchPool();syncPool();
}
// Counts and group checkboxes follow the ticks without rebuilding the list.
function syncPool(){
  let shown=0;
  for(const group of $('poolList').children){
    const checks=[...group.querySelectorAll('.pool-option input')],on=checks.filter(c=>c.checked).length,all=group.querySelector('.pool-group-check');
    all.checked=on===checks.length;all.indeterminate=on>0&&on<checks.length;
    group.querySelector('.pool-group-count').textContent=`${on} / ${checks.length}`;shown+=checks.length;
  }
  $('poolPicked').textContent=picked?`已选 ${picked.size.toLocaleString()} / ${shown.toLocaleString()}`:'';
  syncPoolSummary();updatePoolCount();
}
// The filter dialog only sums the pool up; the import dialog holds the rest.
function syncPoolSummary(){
  $('poolSummary').textContent=picked?[poolUsers.join('、'),`已选 ${picked.size.toLocaleString()} 部`].filter(Boolean).join(' · '):'未导入，从全部动画中抽取。';
  $('openBangumi').textContent=!picked?'从收藏导入':poolReadOnly()?'查看收藏':'编辑收藏';
}
function searchPool(){
  const query=$('poolSearch').value.trim().toLowerCase();
  $('poolList').classList.toggle('is-searching',!!query);
  for(const group of $('poolList').children){
    let any=false;
    for(const row of group.querySelectorAll('.pool-option')){row.hidden=!!query&&!row.dataset.search.includes(query);any||=!row.hidden;}
    group.hidden=!!query&&!any;
  }
}
$('poolList').addEventListener('change',event=>{
  const target=event.target;if(!picked||target.type!=='checkbox')return;
  const checks=target.classList.contains('pool-group-check')?[...target.closest('.pool-group').querySelectorAll('.pool-option input')]:[target];
  for(const check of checks){check.checked=target.checked;if(target.checked)picked.add(Number(check.value));else picked.delete(Number(check.value));}
  syncPool();
});
$('poolSearch').oninput=searchPool;
// A user can only be removed once their collection is in, or what only they
// collected could not be told apart.
function setPoolBusy(busy){poolBusy=busy;$('readBangumi').disabled=busy;$('readBangumi').textContent=busy?'读取中…':'读取';for(const button of $('bangumiUsers').querySelectorAll('button'))button.disabled=busy;}
async function addPoolUser(){
  const user=$('bangumiUser').value.trim();
  if(!user)return;
  if(/\s/.test(user)){poolStatus('用户名不能包含空格。');return;}
  if(poolUsers.some(u=>u.toLowerCase()===user.toLowerCase())){poolStatus(`已经导入了「${user}」的收藏。`);return;}
  if(poolUsers.length>=G.poolUserLimit){poolStatus(`最多合并 ${G.poolUserLimit} 位用户的收藏。`);return;}
  const job=++poolJob;setPoolBusy(true);poolStatus(`正在读取「${user}」的收藏…`);
  try{
    const {name,items}=await readCollections(user,(done,total)=>{if(job===poolJob)poolStatus(`正在读取「${user}」的收藏：${done} / ${total}`);});
    if(job!==poolJob)return;
    if(poolUsers.some(u=>u.toLowerCase()===name.toLowerCase())){poolStatus(`已经导入了「${name}」的收藏。`);return;}
    if(!items.size){poolStatus(`「${user}」没有公开的动画收藏。`);return;}
    // Anime new to the list start ticked by their collection type; ones already
    // listed keep whatever the host chose.
    const known=new Set(poolEntries().entries.map(e=>e.id));
    poolUsers.push(name);if(!picked)picked=new Set();
    for(const entry of poolEntries().entries)if(!known.has(entry.id)&&collectionTypes.some(([type,,on])=>type===entry.type&&on))picked.add(entry.id);
    // A personal list is full of titles few people rated; the vote floor would hide them.
    $('minVotes').value=0;syncFilterRange('minVotes');syncPresetChips();
    $('bangumiUser').value='';poolStatus(`已读取「${name===user?user:`${name}（UID ${user}）`}」的 ${items.size.toLocaleString()} 部动画收藏。`);
    renderPool();
  }catch(error){if(job===poolJob)poolStatus(error.message||'读取失败，请稍后再试。');}
  finally{if(job===poolJob)setPoolBusy(false);}
}
function removePoolUser(user){
  const read=bangumiCache.get(user.toLowerCase()),items=read&&read.items;
  poolUsers=poolUsers.filter(u=>u!==user);
  if(!poolUsers.length){clearPool();return;}
  // Drop what only this user collected; saved picks nobody here has read stay.
  if(items&&picked){const kept=new Set(poolEntries(true).entries.map(e=>e.id));items.forEach((type,id)=>{if(!kept.has(id))picked.delete(id);});}
  poolStatus('');renderPool();
}
function clearPool(){poolJob++;setPoolBusy(false);poolUsers=[];picked=null;$('poolSearch').value='';poolStatus('');renderPool();}
// Re-reads the saved users' collections, so a reopened dialog lists them by
// type again. The ticks stay exactly as saved.
async function hydratePool(){
  const job=++poolJob,users=poolUsers.filter(u=>!bangumiCache.has(u.toLowerCase()));
  if(!users.length)return;
  let failed=false;setPoolBusy(true);
  try{
    for(const user of users){
      try{await readCollections(user,(done,total)=>{if(job===poolJob)poolStatus(`正在重新读取「${user}」的收藏：${done} / ${total}`);});}
      catch(error){failed=true;if(job===poolJob)poolStatus(error.message);}
      if(job!==poolJob)return;
      renderPool();
    }
    if(!failed)poolStatus('');
  }finally{if(job===poolJob)setPoolBusy(false);}
}
$('readBangumi').onclick=addPoolUser;$('clearPool').onclick=clearPool;
$('openBangumi').onclick=()=>{renderPool();openDialog('bangumiDialog');if(!poolReadOnly()&&!poolUsers.length)$('bangumiUser').focus();};
$('filterDialog').addEventListener('close',()=>$('bangumiDialog').close());
$('bangumiUser').onkeydown=e=>{if(e.key==='Enter'&&!e.isComposing){e.preventDefault();addPoolUser();}};
function showFilters(){
  for(const key of filterKeys){$(key).value=key==='minYear'&&!filters[key]?'':filters[key];syncFilterRange(key);}
  poolJob++;setPoolBusy(false);poolStatus('');$('bangumiUser').value='';$('poolSearch').value='';
  picked=Array.isArray(filters.poolIds)?new Set(filters.poolIds):null;
  poolUsers=picked&&Array.isArray(filters.poolUsers)?[...filters.poolUsers]:[];
  tagCatalog={
    exclude:[...new Set([...G.excludedTags,...(filters.excludeOptions||[]),...(filters.excluded||[])])],
    include:[...new Set([...(filters.includeOptions||[]),...(filters.included||[])])]
  };
  $('excludeTagInput').value='';$('includeTagInput').value='';$('tagStatus').textContent='';
  if($('filterNotice'))$('filterNotice').textContent='';
  renderTagFilters();syncPresetChips();renderPool();openDialog('filterDialog');
}
document.querySelectorAll('[data-close]').forEach(button=>button.onclick=()=>button.closest('dialog').close());
$('helpButton').onclick=()=>openDialog('helpDialog');
function openGuideFromHelp(){$('helpDialog').close();window.AniDemo?.openGuide();}
$('helpGuide').onclick=openGuideFromHelp;$('newButton').onclick=()=>{if(!game)start();else openDialog('newDialog');};
$('restartConfirm').onclick=start;$('againButton').onclick=start;
// Draft controls are wired once; the dialog is reused for every new game.
$('draftCtaButton').onclick=start;
$('draftNext').onclick=advanceDraft;
$('draftBack').onclick=backDraft;
$('draftRandom').onclick=startRandom;
$('draftClose').onclick=attemptCloseDraft;
$('draftShuffle').onclick=shuffleDraftPool;
$('draftFilter').onclick=showFilters;
$('draftUndo').onclick=undoDraftPick;
$('draftFill').onclick=fillDraftTeam;
$('draftSearch').oninput=searchDraft;
$('draftScroll').onscroll=loadMoreDraft;
$('draftGrid').addEventListener('click',event=>{
  const card=event.target.closest('.draft-card');
  if(card&&!card.disabled)toggleDraftPick(Number(card.dataset.id));
});
$('draftDialog').addEventListener('cancel',event=>{event.preventDefault();attemptCloseDraft();});
$('draftDialog').addEventListener('close',()=>{draftExitArmed=false;clearTimeout(draftExitTimer);document.body.classList.remove('drafting');});
$('guesserView').onclick=()=>setView('guesser');$('captainView').onclick=requestCaptain;$('captainStart').onclick=requestCaptain;
$('unlockMap').onclick=()=>{$('privacyDialog').close();setView('captain');if(game.phase==='clue')$('clueInput').focus();};
// An empty number field is the "flip as many as you like" clue, so it is read as
// null rather than coerced to 0.
function clueCount(){const raw=$('numberInput').value.trim();return raw===''?null:Number(raw);}
$('clueForm').onsubmit=event=>{event.preventDefault();if(view!=='captain')return;const previous={...game};if(!G.giveClue(game,$('clueInput').value,clueCount())){message('请输入一个不含空格的提示词，张数留空或填不小于 0 的整数。');return;}$('clueInput').value='';message('');setView('guesser');announcePhase(previous,game);};
$('confirmGuess').onclick=async()=>{
  if(view!=='guesser'||selected===null)return;
  const index=selected,previousCard=$('board').children[index],currentGame=game,previous={...game};
  const result=G.guess(game,index);if(!result)return;
  selected=null;
  message(game.phase==='over'?game.reason:result.type===result.actor?'猜中己方':`翻到${G.label(result.type)}牌`);
  render();
  await animateReveal(index,previousCard,result.type===result.actor);
  if(game===currentGame)announcePhase(previous,game);
  if(game===currentGame&&game.phase==='over'&&view==='guesser')showResult(game);
};
$('endTurn').onclick=()=>{const previous={...game};if(view==='guesser'&&G.stop(game)){selected=null;message('');render();announcePhase(previous,game);}};
$('logPrev').onclick=()=>pinLog((logPin?.deal===logDeal(game)?logPin.page:logPages())-1);
$('logNext').onclick=()=>pinLog((logPin?.deal===logDeal(game)?logPin.page:logPages())+1);
$('logLatest').onclick=()=>pinLog(Infinity);
$('logToggle').onclick=()=>{logOpen=!logOpen;localStorage.setItem('anicode-log-open',String(logOpen));renderLog();};
$('reviewButton').onclick=()=>{$('resultDialog').close();setView('captain');};
$('coverMode').onchange=e=>{coverMode=e.target.value;localStorage.setItem('anicode-cover-mode',coverMode);localStorage.removeItem('anicode-show-covers');updateCoverToggle();};
$('nameSize').onchange=e=>{nameSize=e.target.value;localStorage.setItem('anicode-name-size',nameSize);updateNameSize();};
$('colorMode').onchange=e=>{colorMode=e.target.value;localStorage.setItem('anicode-color-mode',colorMode);updateColorToggle();};
$('filterButton').onclick=showFilters;$('filterForm').oninput=updatePoolCount;
$('addExcludeTag').onclick=()=>addTag('exclude');$('addIncludeTag').onclick=()=>addTag('include');
for(const kind of ['exclude','include'])$(kind+'TagInput').onkeydown=e=>{if(e.key==='Enter'&&!e.isComposing){e.preventDefault();addTag(kind);}};
$('filterForm').onsubmit=event=>{event.preventDefault();updatePoolCount();if($('applyFilters').disabled)return;filters=readFilters();start();};
// Switching away automatically conceals the map without changing any revealed cards.
document.addEventListener('visibilitychange',()=>{if(!document.body.classList.contains('multiplayer')&&!document.body.classList.contains('online')&&document.hidden&&view==='captain'&&game?.phase!=='over')setView('guesser');});
async function load(){
  if(location.protocol!=='file:'){
    try{const response=await fetch('anime_list.json');if(!response.ok)throw new Error('data unavailable');const data=await response.json();if(!Array.isArray(data)||data.length<25)throw new Error('invalid data');allAnime=data;}catch{$('dataFallback').hidden=false;}
  } else $('dataFallback').hidden=false;
  // Local mode owns the boot screen; room mode is removed by multiplayer.js.
  document.documentElement.classList.remove('booting','boot-slow');$('bootScreen')?.remove();
  start();
}
// The dataset cutoff drives the footer date and the newest selectable year.
$('dataUpdated').textContent=G.dataDate.slice(2).replaceAll('-','.');
for(const id of ['minYear','maxYear']){$(id).max=G.dataYear;$(id+'Range').max=G.dataYear;}
for(const node of document.querySelectorAll('[data-year-max]'))node.textContent=`${G.dataYear} 年`;
updateCoverToggle();updateNameSize();updateColorToggle();
const boardObserver=new ResizeObserver(measureBoard);for(const node of [$('board'),...document.querySelectorAll('.header,.scoreboard,.toolbar')])boardObserver.observe(node);
if(location.protocol==='file:' || window.ANICODE_MODE==='local')load();
function renderDetail(){
  const panel=$('detailPanel'),content=$('detailContent');
  panel.hidden=selected===null||!game;
  if(panel.hidden)return;
  const anime=game.tiles[selected].anime;content.hidden=false;
  $('detailName').textContent=G.name(anime);
  const year=(anime.air_date||'').slice(0,4),score=anime.score?`评分 ${anime.score}`:'';
  $('detailMeta').textContent=[year,score,anime.vote_count?`${Number(anime.vote_count).toLocaleString()} 人评分`:'' ].filter(Boolean).join(' · ')||'Bangumi 条目';
  const image=$('detailImage');image.alt=G.name(anime);
  applyCoverImage(image,anime,true);
  $('detailLink').href=anime.id?`https://bgm.tv/subject/${anime.id}`:'https://bgm.tv';
}
