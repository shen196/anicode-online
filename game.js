/* Pure game rules, shared by the browser and Node tests. */
(function (root) {
  'use strict';
  const banned = new Set([150955,185761,190704,226677,231647,262162,278429,339266,303399,321117,381212,386475,236657,467909,488960,425587,449154,529995,518413,567417]);
  const excludedTags = ['国产', '剧场版', 'OVA', '泡面番', '欧美', '短片', '总集篇'];
  // Dataset cutoff: nothing airing after this date exists in the data, so it is
  // also the newest year any year filter can usefully reach. In the browser it
  // comes from fallback-data.js, which scripts/update-data.cjs writes from the
  // crawl date; Node and the Worker never load the data and use this stand-in.
  const dataDate = /^\d{4}-\d{2}-\d{2}$/.test(root.ANICODE_DATA_DATE) ? root.ANICODE_DATA_DATE : '2026-06-27';
  const dataYear = Number(dataDate.slice(0,4));
  // The filter uses a 0–10 score range, matching Bangumi's native score scale.
  // `poolIds` narrows the data to anime picked from Bangumi collections before
  // any other filter runs; null means the whole list. `poolUsers` only records
  // whose collections they came from.
  const defaults = {minVotes:2500,minYear:0,maxYear:dataYear,minScore:0,maxScore:10,excluded:excludedTags,included:[],poolIds:null,poolUsers:[]};
  // A room keeps at most this many picked anime, and merges at most this many users.
  const poolLimit = 5000, poolUserLimit = 10;
  // Cold-start pool presets. Picking a chip beats reasoning about vote counts,
  // so each one only moves the numeric filters and leaves tag choices alone.
  const presets = [
    {name:'热门',     hint:'评分人数 ≥ 5000',              filters:{minVotes:5000,minYear:0,maxYear:dataYear,minScore:0,maxScore:10}},
    {name:'人气佳作', hint:'≥ 2500 人评分 · 7 分以上',     filters:{minVotes:2500,minYear:0,maxYear:dataYear,minScore:7,maxScore:10}},
    {name:'经典高分', hint:'≥ 2000 人评分 · 7.5 分以上',   filters:{minVotes:2000,minYear:0,maxYear:dataYear,minScore:7.5,maxScore:10}},
    {name:'近五年',   hint:`${dataYear-4} 年至今`,         filters:{minVotes:1000,minYear:dataYear-4,maxYear:dataYear,minScore:0,maxScore:10}},
    {name:'近十年',   hint:`${dataYear-9} 年至今`,         filters:{minVotes:1000,minYear:dataYear-9,maxYear:dataYear,minScore:0,maxScore:10}}
  ];
  const presetKeys = ['minVotes','minYear','maxYear','minScore','maxScore'];
  // Optional rules a room can switch on. They travel with the board so the
  // snapshot every client reads already says which ones are live.
  // `maxFlips:'clue'` is the classic budget: the clue number plus one bonus card.
  // `banMode:'game'` gives each captain one ban for the whole game; 'round'
  // hands them a fresh one every time they are back on the clue.
  // Blank clue numbers are always allowed online; `freeCount` stays only for the
  // frozen server.cjs, which still lets a room switch them off.
  const ruleDefaults = {maxFlips:'clue',freeCount:true,ban:false,banMode:'game'};
  const flipModes = ['clue','unlimited'];
  const banModes = ['game','round'];
  // The longest clue any room accepts; a room may set a tighter cap of its own.
  const clueLimit = 30;
  const name = a => (a.name_cn || a.name || '').trim();
  const other = team => team === 'red' ? 'blue' : 'red';
  const label = type => ({red:'红队',blue:'蓝队',neutral:'中立',assassin:'刺客'})[type];
  function shuffle(items, random = Math.random) {
    const result = [...items];
    for (let i=result.length-1;i>0;i--) {const j=Math.floor(random()*(i+1)); [result[i],result[j]]=[result[j],result[i]];}
    return result;
  }
  function filter(data, options=defaults, cutoff=dataDate) {
    const f = {...defaults,...options};
    const minScore=Number(f.minScore), maxScore=Number(f.maxScore);
    if(!Number.isFinite(minScore)||!Number.isFinite(maxScore)||minScore<0||maxScore>10||minScore>maxScore) return [];
    if(f.minYear>f.maxYear) return [];
    const excluded=Array.isArray(f.excluded)?f.excluded:[];
    const included=Array.isArray(f.included)?f.included:[];
    const scoreActive=minScore!==0||maxScore!==10;
    const picked=Array.isArray(f.poolIds)?new Set(f.poolIds):null;
    const seen = new Set();
    return data.filter(a => {
      if(picked && !picked.has(a.id)) return false;
      const title = name(a), year = Number((a.air_date || '').slice(0,4));
      if(!title || banned.has(a.id) || Number(a.vote_count || 0)<f.minVotes) return false;
      if(year && (year<f.minYear || year>f.maxYear)) return false;
      if(cutoff && a.air_date && a.air_date>cutoff) return false;
      const tags=Array.isArray(a.tags)?a.tags:[];
      if(excluded.some(tag => tags.includes(tag))) return false;
      if(included.length&&!included.every(tag => tags.includes(tag))) return false;
      if(scoreActive){
        const score=Number(a.score);
        if(a.score===null||a.score===undefined||a.score===''||!Number.isFinite(score)||score<minScore||score>maxScore) return false;
      }
      if(seen.has(title)) return false;
      seen.add(title); return true;
    });
  }
  // The data has no series links, so seasons of one show are told apart by title,
  // in two ways. First, two titles opening with the same 4+ units count as one
  // franchise. A unit is one CJK character or one whole Latin word or number, and
  // punctuation is ignored, so DARKER THAN BLACK and DARLING in the FRANXX share
  // nothing. Common openings that many unrelated shows use need one unit more
  // than the opening itself. Second, short titles the prefix cannot reach (银魂,
  // 黑执事Ⅱ) match when the Chinese or original titles are equal once season
  // markers are stripped. Renamed sequels (化物语/伪物语) still slip through; a
  // false match only costs a redraw.
  const prefixUnits = 4;
  const units = text => text.match(/[\p{Script=Latin}\p{N}]+|[^\s\p{P}\p{S}]/gu) || [];
  const clean = text => (text || '').normalize('NFKC').toLowerCase().replace(/^\s*(剧场版|劇場版|剧场总集篇|劇場総集編)/,'');
  const seasonMarks = /第\s*[0-9一二三四五六七八九十]+\s*(季|期|部分|部|クール|シーズン)|\d+\s*(st|nd|rd|th)\s*season|(the\s*)?final\s*season|season\s*\d+|part\s*\.?\s*\d+|最终季/g;
  function baseTitle(text) {
    const words = clean(text).replace(seasonMarks,' ').replace(/[\p{P}\p{S}]/gu,' ').split(/\s+/).filter(w => w && !/^(续|続|完|ova|oad|tv)$/.test(w));
    // No lookbehind: Safari before 16.4 rejects the whole file over one.
    return units(words.join(' ').replace(/(^|[^a-z])(ii|iii|iv)$|\d+$/,'$1')).join(' ');
  }
  const genericOpenings = ['异世界','关于我','只有我','魔法少女'].map(t => units(t));
  function seriesKey(a) {return {units:units(clean(name(a))), bases:[baseTitle(a.name_cn),baseTitle(a.name)].filter(Boolean)};}
  function sameSeries(a, b) {
    if(a.bases.some(base => b.bases.includes(base))) return true;
    let shared=0;while(shared<a.units.length&&a.units[shared]===b.units[shared])shared++;
    const opening=genericOpenings.find(g => g.every((unit,i) => a.units[i]===unit&&b.units[i]===unit));
    return shared>=Math.max(prefixUnits,opening?opening.length+1:0);
  }
  // Draws `count` cards, redrawing any that look like the same franchise as a card
  // already on the board. Past `retries` redraws, or once the pool runs dry, the
  // rest are dealt unchecked so the board always fills.
  function deal(pool, random=Math.random, count=25, retries=200) {
    const picked=[], keys=[], skipped=[];
    for(const anime of shuffle(pool,random)) {
      if(picked.length===count) break;
      const key=seriesKey(anime);
      if(skipped.length<retries&&keys.some(k=>sameSeries(k,key))) {skipped.push(anime);continue;}
      picked.push(anime);keys.push(key);
    }
    return picked.concat(skipped).slice(0,count);
  }
  function create(pool, random=Math.random, firstTeam='red', rules) {
    if(pool.length<25) throw new Error('至少需要 25 部不同的动画。');
    const types=shuffle([...Array(9).fill(firstTeam),...Array(8).fill(other(firstTeam)),...Array(7).fill('neutral'),'assassin'],random);
    return {tiles:deal(pool,random).map((anime,i)=>({anime,type:types[i],revealed:false})),firstTeam,turn:firstTeam,round:1,phase:'clue',clue:null,winner:null,reason:'',turns:[],rules:{...ruleDefaults,...rules},flips:0,banned:{red:null,blue:null},banUsed:{red:false,blue:false}};
  }
  // A drafted board: the captains bring their own sides instead of the server
  // dealing the colours. Red's captain picks nine cards and blue's picks eight;
  // the last eight come from the remaining pool as seven neutrals and one
  // assassin, so neither captain can hand the assassin to the other team.
  // Red is always the first team, because it is the side with nine cards.
  function createDraft(pickedRed, pickedBlue, pool, random = Math.random, rules) {
    if (!Array.isArray(pickedRed) || pickedRed.length !== 9) throw new Error('红队要选 9 部动画。');
    if (!Array.isArray(pickedBlue) || pickedBlue.length !== 8) throw new Error('蓝队要选 8 部动画。');
    const chosen = [...pickedRed, ...pickedBlue];
    const ids = new Set(chosen.map(a => a.id));
    if (ids.size !== chosen.length) throw new Error('两队不能选同一部动画。');
    const rest = pool.filter(a => !ids.has(a.id));
    if (rest.length < 8) throw new Error('牌池不足，无法补上中立和刺客。');
    // Keep the filler from repeating a franchise already on the board, the same
    // way `deal` does, but fall back to an unchecked draw if the pool is tiny.
    const keys = chosen.map(seriesKey), fill = [];
    for (const anime of shuffle(rest, random)) {
      if (fill.length === 8) break;
      const key = seriesKey(anime);
      if (keys.some(k => sameSeries(k, key))) continue;
      fill.push(anime); keys.push(key);
    }
    if (fill.length < 8) for (const anime of rest) {
      if (fill.length === 8) break;
      if (!fill.includes(anime)) fill.push(anime);
    }
    const deck = [
      ...pickedRed.map(anime => ({anime, type:'red'})),
      ...pickedBlue.map(anime => ({anime, type:'blue'})),
      ...fill.slice(0, 7).map(anime => ({anime, type:'neutral'})),
      {anime:fill[7], type:'assassin'}
    ];
    const tiles = shuffle(deck, random).map(({anime, type}) => ({anime, type, revealed:false}));
    return {tiles, firstTeam:'red', turn:'red', round:1, phase:'clue', clue:null, winner:null, reason:'', turns:[], rules:{...ruleDefaults, ...rules}, flips:0, banned:{red:null, blue:null}, banUsed:{red:false, blue:false}};
  }
  function remaining(g,team) {return g.tiles.filter(t=>t.type===team&&!t.revealed).length;}
  // How many cards this round may still turn over. A clue without a number, or a
  // room that lifted the cap, means the guessers stop when they choose to.
  function flipLimit(g) {
    if(g.rules?.maxFlips!=='clue'||!g.clue||g.clue.count===null) return Infinity;
    return g.clue.count+1;
  }
  function flipsLeft(g) {const limit=flipLimit(g);return Number.isFinite(limit)?Math.max(0,limit-(g.flips||0)):Infinity;}
  function giveClue(g,word,count) {
    if(g.phase!=='clue') return false;
    word=word.trim();
    if(!word || word.length>30 || /\s/.test(word)) return false;
    // A blank number is a deliberate "as many as you like".
    if(count===null){if(!g.rules?.freeCount) return false;}
    else if(!Number.isInteger(count) || count<0) return false;
    spend(g);g.clue={word,count};g.phase='guess';g.flips=0;
    record(g,word,count);return true;
  }
  // One entry per team turn, for the sidebar replay: the clue, then the cards in the
  // order they were turned. A clue phase that ran out leaves a turn without a word.
  // Games stored before the record existed start it from their next turn.
  function record(g,word,count) {(g.turns??=[]).push({team:g.turn,round:g.round,word,count,flips:[]});}
  // Only the captains are shown the ban. It does not stop anyone from taking the
  // card — it makes that card cost the rest of the round, right or wrong. Each
  // team holds its own ban, set while its captain gives the clue. In a 'round'
  // room it stays live through the other team's turn and only clears when this
  // captain's next clue phase opens. In a 'game' room a ban still standing when
  // the clue phase ends is spent: it stays live until someone turns it over, and
  // that captain cannot ban another card. A banned card that gets turned over
  // records the ban on the tile and keeps its mark for the rest of the game, so
  // everyone can still see why a round ended after the live ban has cleared.
  function ban(g,index) {
    if(!g.rules?.ban||g.phase!=='clue'||g.banUsed?.[g.turn]) return false;
    const team=g.turn;
    if(index===null){g.banned={...g.banned,[team]:null};return true;}
    const tile=g.tiles[index];
    if(!tile||tile.revealed||g.banned?.[other(team)]===index) return false;
    g.banned={...g.banned,[team]:index};return true;
  }
  // Leaving the clue phase settles the ban: in a one-ban game, a ban left
  // standing is the captain's only one. Games without the field act as 'round'.
  function spend(g) {if(g.rules?.banMode==='game'&&(g.banned?.[g.turn]??null)!==null)g.banUsed={...g.banUsed,[g.turn]:true};}
  // The team whose ban covers this card, live or recorded at the flip, or null.
  function bannedBy(g,index) {return g.tiles[index]?.bannedBy||['red','blue'].find(team=>g.banned?.[team]===index)||null;}
  function next(g) {g.turn=other(g.turn);g.round++;g.phase='clue';g.clue=null;g.flips=0;if(!g.banUsed?.[g.turn])g.banned={...g.banned,[g.turn]:null};}
  function stop(g) {if(g.phase!=='guess')return false;next(g);return true;}
  // A room's turn timer ran out. Either phase hands over exactly like a stop.
  function timeout(g) {if(g.phase==='over')return false;if(g.phase==='clue'){spend(g);record(g,null,null);}next(g);return true;}
  function guess(g,index) {
    const tile=g.tiles[index];
    if(g.phase!=='guess'||!tile||tile.revealed)return null;
    tile.revealed=true;g.flips=(g.flips||0)+1;
    const actor=g.turn, banTeam=bannedBy(g,index);
    if(banTeam) tile.bannedBy=banTeam;
    const turn=g.turns?.[g.turns.length-1];if(turn?.round===g.round)turn.flips.push(index);
    if(tile.type==='assassin'){g.phase='over';g.winner=other(actor);g.reason=`${label(actor)}翻到了刺客牌《${name(tile.anime)}》。`;}
    else if(['red','blue'].includes(tile.type) && remaining(g,tile.type)===0){g.phase='over';g.winner=tile.type;g.reason=`${label(tile.type)}已经找齐所有目标作品。`;}
    else if(tile.type!==actor) next(g);
    // A correct card normally keeps the turn; the ban and the flip budget are the
    // two things that can still take it away.
    else if(banTeam||g.flips>=flipLimit(g)) next(g);
    return {type:tile.type,actor};
  }
  // The results screen. 最佳提示 is the clue that found the most of its own
  // team's cards; a tie goes to the one that turned up fewer wrong cards, then
  // to the earlier one. The two player awards judge every guesser's ballot, as
  // the room recorded it when a card was flipped, against the card's colour:
  // the card they picked, not the one the vote turned over, and the colour it
  // always had, ban or not. MVP is the winners' guesser who picked the most of
  // their own cards; 最佳第六人 the losers' guesser who handed out the most
  // points, 1 for a neutral, 2 for the other team's card and 100 for the
  // assassin, with the count of each kind. A unanimous team votes as one and
  // a single vote only speaks for one player, so those rooms only get 最佳提示.
  const misplay={neutral:1,opponent:2,assassin:100};
  function awards(g) {
    const lineup=g.lineup||[],turns=g.turns||[];
    let clue=null;
    for(const t of turns) {
      if(t.word===null) continue;
      const hits=t.flips.filter(i=>g.tiles[i].type===t.team).length,misses=t.flips.length-hits;
      if(hits&&(!clue||hits>clue.hits||(hits===clue.hits&&misses<clue.misses)))
        clue={team:t.team,round:t.round,word:t.word,count:t.count,hits,misses,captain:lineup.find(p=>p.team===t.team&&p.role==='captain')?.name??null};
    }
    const result={clue,mvp:[],sixth:[]};
    if(!['majority','majorityAll'].includes(g.voting)) return result;
    const stats=new Map(lineup.filter(p=>p.role==='guesser').map(p=>[p.id,{id:p.id,name:p.name,team:p.team,hits:0,score:0,neutral:0,opponent:0,assassin:0}]));
    for(const t of turns) for(const ballot of t.ballots||[]) for(const [id,choice] of Object.entries(ballot)) {
      // A vote to end the turn names no card.
      const s=stats.get(id),tile=Number.isInteger(choice)?g.tiles[choice]:null;
      if(!s||!tile) continue;
      if(tile.type===s.team) {s.hits++;continue;}
      const kind=tile.type==='neutral'||tile.type==='assassin'?tile.type:'opponent';
      s[kind]++;s.score+=misplay[kind];
    }
    // Everyone level with the leader on both counts shares the award.
    const top=(list,order)=>{list.sort(order);return list.filter(s=>order(s,list[0])===0);};
    const all=[...stats.values()];
    result.mvp=top(all.filter(s=>s.team===g.winner&&s.hits),(a,b)=>b.hits-a.hits||a.score-b.score);
    // Down to the kinds of card too, so the ones sharing it share one breakdown.
    result.sixth=top(all.filter(s=>s.team!==g.winner&&s.score),(a,b)=>b.score-a.score||a.hits-b.hits||b.assassin-a.assassin||b.opponent-a.opponent);
    return result;
  }
  // Name the side and the role that acts next. A generic "your captain's turn"
  // reads the same for both teams and for players who are not acting.
  function actorText(g) {return `${label(g.turn)}${g.phase==='clue'?'队长':'猜词人'}行动`;}
  // Pure description of the turn banner: `null` means nothing new to announce.
  // Kept here so the wording is covered by `npm test` instead of browser runs.
  function announcement(previous, next) {
    if(!next || next.phase==='over') return null;
    const banner = detail => ({team:next.turn,title:actorText(next),detail});
    if(!previous) return banner(`${label(next.turn)}先手 · 第 ${next.round} 回合`);
    if(next.phase==='guess'&&(previous.phase!=='guess'||previous.round!==next.round))
      return banner(next.clue.count===null?`提示「${next.clue.word}」 · 不限张数`:`提示「${next.clue.word}」 · ${next.clue.count} 张`);
    if(previous.round!==next.round||previous.turn!==next.turn) return banner(`第 ${next.round} 回合`);
    return null;
  }
  const api={defaults,poolLimit,poolUserLimit,presets,presetKeys,ruleDefaults,flipModes,banModes,clueLimit,excludedTags,dataDate,dataYear,name,other,label,shuffle,filter,deal,create,createDraft,remaining,flipLimit,flipsLeft,giveClue,ban,bannedBy,stop,timeout,guess,awards,actorText,announcement};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  else root.AniGame=api;
})(globalThis);
