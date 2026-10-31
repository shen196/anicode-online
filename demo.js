'use strict';
// A scripted mini-round, shown step by step in the 「如何游玩」 dialog. It reuses
// the real card classes, so the demo follows any change to the board's look.
(()=>{
  const cover=path=>'https://lain.bgm.tv/r/400/pic/cover/l/'+path;
  const CARDS=[
    {name_cn:'新世纪福音战士',image_url:cover('e5/69/265_Z5Uou.jpg'),type:'red'},
    {name_cn:'进击的巨人',image_url:cover('78/c9/55770_HsJfh.jpg'),type:'blue'},
    {name_cn:'猫和老鼠',image_url:cover('fd/60/25961_WDKz6.jpg'),type:'neutral'},
    {name_cn:'命运石之门',image_url:cover('a9/79/10380_YwP4R.jpg'),type:'blue'},
    {name_cn:'天元突破 红莲螺岩',image_url:cover('4e/a0/770_EvrMq.jpg'),type:'red'},
    {name_cn:'你的名字。',image_url:cover('20/15/160209_2UzU8.jpg'),type:'assassin'},
    {name_cn:'轻音少女',image_url:cover('48/9d/1424_q8FMQ.jpg'),type:'blue'},
    {name_cn:'钢之炼金术师',image_url:cover('06/63/1428_xwkMI.jpg'),type:'neutral'},
    {name_cn:'间谍过家家',image_url:cover('de/4a/329906_hmtVD.jpg'),type:'red'}
  ];
  const TEAM={red:'红队',blue:'蓝队'};
  // Each step is the state after it; a step with `reveal` is flipped by team `by`.
  // A caption is text, or a list of text and [text, card type] parts coloured by type.
  const STEPS=[
    {view:'guesser',team:'red',status:'红队回合',
      caption:['每张牌是一部动画，可能属于',['红队','red'],'、',['蓝队','blue'],'、',['中立','neutral'],'或',['刺客牌','assassin']],
      detail:'正式对局有 25 部动画（5×5），这里用 9 张牌演示。'},
    {view:'captain',team:'red',status:'红队回合',
      caption:'只有队长能看到每张牌的颜色',
      detail:'两队各有一名队长，其余人是猜词人。猜词人要根据队长的提示找出本队卡片。'},
    {view:'captain',team:'red',status:'红队队长出题',clue:['机器人',2],
      caption:'红队队长给出提示「机器人 2」',
      detail:'提示是一个词加一个数字，意思是有 2 部本队动画和「机器人」有关。提示最好避开对方的牌，尤其是刺客牌。'},
    {view:'guesser',team:'red',status:'红队猜词人行动',clue:['机器人',2],reveal:0,by:'red',
      caption:'红队猜词人翻开《新世纪福音战士》：正确',
      detail:'翻到本队的牌可以继续猜，也可以结束回合'},
    {view:'guesser',team:'red',status:'红队猜词人行动',clue:['机器人',2],reveal:4,by:'red',
      caption:'继续翻开《天元突破 红莲螺岩》：正确',
      detail:'默认规则下最多可以猜「提示数+1」张，所以红队还有一次尝试机会（但有风险！）'},
    {view:'guesser',team:'blue',status:'轮到蓝队',reveal:7,by:'red',
      caption:'再试《钢之炼金术师》：中立牌，回合结束',
      detail:'翻到中立牌或对方的牌，回合立刻结束；如果翻到蓝色牌会算进蓝队的进度！'},
    {view:'captain',team:'blue',status:'蓝队队长出题',clue:['时间',1],
      caption:'蓝队队长提示「时间 1」，想指《命运石之门》',
      detail:'但《你的名字。》也有时间穿越元素！'},
    {view:'guesser',team:'red',status:'红队获胜',clue:['时间',1],reveal:5,by:'blue',winner:'red',
      caption:'蓝队翻开《你的名字。》：刺客，直接判负',
      detail:'翻到刺客的队伍立即输掉。没有人踩中刺客时，先找齐本队全部动画的一方获胜。'}
  ];
  const reducedMotion=()=>window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const revealedBy=index=>STEPS.slice(0,index+1).filter(step=>step.reveal!==undefined).map(step=>step.reveal);

  function createScene(){
    const root=el('div','demo-scene');root.setAttribute('aria-hidden','true');
    const top=el('div','demo-top'),status=el('strong','demo-status'),view=el('span','demo-view');
    const clue=el('span','demo-clue'),clueWord=el('b'),clueNumber=el('i');clue.append(el('small','','提示'),clueWord,clueNumber);
    top.append(status,view,clue);
    const board=el('div','demo-board'),result=el('div','demo-result');result.hidden=true;
    const cards=CARDS.map(anime=>{
      const card=el('div','card'),face=el('div','cover'),placeholder=el('div','cover-placeholder','✦');
      placeholder.append(el('small','','ANIME CODE'));face.append(placeholder);
      const img=coverImage(anime);if(img)face.append(img);
      const name=el('div','card-name');name.append(el('span','',anime.name_cn));
      card.append(face,name);board.append(card);return card;
    });
    const wrap=el('div','demo-board-wrap');wrap.append(board,result);root.append(top,wrap);
    let run=0;
    function header(state){
      root.dataset.team=state.team;status.textContent=state.status;
      view.textContent=state.view==='captain'?'◇ 队长视角':'◎ 猜词人视角';
      clue.classList.toggle('is-empty',!state.clue);
      clueWord.textContent=state.clue?state.clue[0]:'等待提示';clueNumber.textContent=state.clue?state.clue[1]:'';
      result.hidden=!state.winner;
      if(state.winner){result.dataset.team=state.winner;result.replaceChildren(el('strong','',TEAM[state.winner]+'获胜'),el('span','','蓝队翻到了刺客'));}
    }
    function paint(view,revealed){
      board.classList.toggle('captain-board',view==='captain');
      cards.forEach((card,index)=>{
        const type=CARDS[index].type,open=revealed.includes(index),known=view==='captain'||open;
        card.className='card '+type+(known?' known':'')+(open?' revealed':'');
        card.querySelectorAll('.reveal-mark,.reveal-front,.demo-tap').forEach(node=>node.remove());
        if(open){const mark=el('div','reveal-mark');if(type==='assassin')mark.append(el('b','','×'));card.querySelector('.cover').append(mark);}
      });
    }
    const wait=(ms,token)=>new Promise(resolve=>setTimeout(()=>resolve(token===run),ms));
    // Resolves false when a newer step interrupted this one.
    async function show(index,animate){
      const token=++run,step=STEPS[index],after=revealedBy(index);
      if(!animate||step.reveal===undefined||reducedMotion()){
        paint(step.view,after);header(step);
        if(animate&&step.reveal!==undefined)cards[step.reveal].classList.add(CARDS[step.reveal].type===step.by?'flash-correct':'flash-wrong');
        return true;
      }
      const card=cards[step.reveal],previous=STEPS[index-1];
      paint(step.view,after.filter(i=>i!==step.reveal));
      header({...previous,view:step.view,team:step.by,status:TEAM[step.by]+'猜词人行动',winner:null});
      if(!await wait(260,token))return false;
      card.classList.add('selected');card.append(el('span','demo-tap'));
      if(!await wait(700,token))return false;
      // Keep the unflipped face on top until the card turns edge-on, as in the game.
      const front=el('div','reveal-front');
      front.append(...Array.from(card.children,child=>child.cloneNode(true)));
      front.querySelector('.demo-tap')?.remove();
      if(card.classList.contains('known')){front.classList.add('known-front');front.style.setProperty('--front-color',`var(--${CARDS[step.reveal].type})`);}
      paint(step.view,after);card.append(front);card.classList.add('is-flipping');
      if(!await wait(440,token))return false;
      front.remove();card.classList.remove('is-flipping');
      card.classList.add(CARDS[step.reveal].type===step.by?'flash-correct':'flash-wrong');
      if(!await wait(520,token))return false;
      header(step);return true;
    }
    return {root,show};
  }

  function buildGuide(){
    const dialog=el('dialog');dialog.id='guideDialog';dialog.setAttribute('aria-labelledby','guideTitle');
    const body=el('div','dialog-body'),head=el('div','panel-title'),title=el('h2','','如何游玩');title.id='guideTitle';
    const close=el('button','icon-button','×');close.type='button';close.setAttribute('aria-label','关闭玩法演示');close.onclick=()=>dialog.close();
    head.append(title,close);
    const scene=createScene(),text=el('div','guide-text');text.setAttribute('aria-live','polite');
    const count=el('span','guide-count'),caption=el('h3'),detail=el('p');text.append(count,caption,detail);
    const actions=el('div','dialog-actions'),prev=el('button','button secondary','上一步'),next=el('button','button primary');
    // The rules video opens on Bilibili in a new tab, kept left of the step buttons.
    const video=el('a','button secondary guide-video','视频规则');video.append(el('span','','↗'));video.lastChild.setAttribute('aria-hidden','true');
    video.href='https://www.bilibili.com/video/BV1HwHC67EYq';video.target='_blank';video.rel='noopener noreferrer';
    prev.type=next.type='button';actions.append(video,prev,next);
    body.append(head,scene.root,text,actions);dialog.append(body);document.body.append(dialog);
    let step=0;
    function go(index,animate){
      step=index;const data=STEPS[index],last=index===STEPS.length-1;
      count.textContent=`${index+1} / ${STEPS.length}`;caption.replaceChildren(...[].concat(data.caption).map(part=>typeof part==='string'?part:el('b','tone '+part[1],part[0])));detail.textContent=data.detail;
      prev.disabled=index===0;next.textContent=last?'开始游戏':'下一步 →';
      scene.show(index,animate);
    }
    prev.onclick=()=>go(step-1,false);
    next.onclick=()=>{if(step<STEPS.length-1)go(step+1,true);else{dialog.close();document.getElementById('playerName')?.focus();}};
    dialog.addEventListener('keydown',event=>{
      if(event.key==='ArrowRight'&&step<STEPS.length-1)go(step+1,true);
      else if(event.key==='ArrowLeft'&&step>0)go(step-1,false);
    });
    return {dialog,open(){go(0,false);dialog.showModal();next.focus();}};
  }

  // Built on first use.
  let guide=null;
  window.AniDemo={openGuide:()=>(guide||(guide=buildGuide())).open()};
})();
