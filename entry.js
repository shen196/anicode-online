'use strict';
// The page background: a board of real covers lying in perspective, drifting
// slowly while a card turns over now and then. It is built from the real card
// classes and loads covers through app.js, like the game board. It stays
// mounted from the entry page through the lobby and the match, so moving
// between them never reloads it; styles.css adapts it to each mode.
(()=>{
  // The 60 most-voted distinct titles in anime_list.json, as [name, cover path].
  const COVERS=[
    ['孤独摇滚！','e2/e7/328609_2EHLJ.jpg'],['命运石之门','a9/79/10380_YwP4R.jpg'],['魔法少女小圆','cb/57/9717_sAVag.jpg'],
    ['葬送的芙莉莲','13/c5/400602_ZI8Y9.jpg'],['你的名字。','20/15/160209_2UzU8.jpg'],['新世纪福音战士','e5/69/265_Z5Uou.jpg'],
    ['冰菓','cd/38/27364_1ZFmr.jpg'],['CLANNAD','67/d1/876_dCfrd.jpg'],["BanG Dream! It's MyGO!!!!!",'e7/a7/428735_1v11n.jpg'],
    ['进击的巨人','78/c9/55770_HsJfh.jpg'],['Fate/Zero','86/1f/10639_w4sHs.jpg'],['轻音少女','48/9d/1424_q8FMQ.jpg'],
    ['败犬女主太多了！','e4/dc/464376_NsZRw.jpg'],['龙与虎','a4/30/909_e5zhk.jpg'],['辉夜大小姐想让我告白','2a/f7/248175_2w4zT.jpg'],
    ['千与千寻','9d/fc/311_GAg3x.jpg'],['我们仍未知道那天所看见的花的名字。','6c/e8/10440_8HP6O.jpg'],['赛博浪客','39/83/309311_dJU58.jpg'],
    ['中二病也要谈恋爱！','3d/fd/29648_LOcOx.jpg'],['无职转生','8b/00/277554_z999u.jpg'],['死亡笔记','4a/be/1773_rldoC.jpg'],
    ['刀剑神域','2e/c8/23686_e36x9.jpg'],['日常','0e/14/9912_vHEd6.jpg'],['游戏人生','54/bd/79227_052R3.jpg'],
    ['秒速5厘米','1f/44/927_J2Q9a.jpg'],['化物语','64/7c/1671_vQ2W9.jpg'],['钢之炼金术师 FULLMETAL ALCHEMIST','06/63/1428_xwkMI.jpg'],
    ['青春猪头少年不会梦到兔女郎学姐','b9/45/240038_b5j7g.jpg'],['凉宫春日的消失','9b/9b/3375_33BCV.jpg'],['我的青春恋爱物语果然有问题','1e/f1/54433_JZ99l.jpg'],
    ['少女乐队的呐喊','75/c1/431767_bX7FZ.jpg'],['Re：从零开始的异世界生活','cb/78/140001_Ew1mo.jpg'],['天使的心跳！','ff/14/1851_ZFEg7.jpg'],
    ['四月是你的谎言','ec/c7/100444_96r3J.jpg'],['间谍过家家','de/4a/329906_hmtVD.jpg'],['为美好的世界献上祝福！','56/de/135275_G3liq.jpg'],
    ['某科学的超电磁炮','36/e7/2585_pn2eP.jpg'],['白箱','73/26/110467_Fx9tT.jpg'],['男子高中生的日常','c5/73/24790_4wdXB.jpg'],
    ['小林家的龙女仆','e9/15/179949_c2j50.jpg'],['紫罗兰永恒花园','1e/e2/183878_Fef1o.jpg'],['月刊少女野崎君','a0/20/100449_d101j.jpg'],
    ['Code Geass 反叛的鲁路修','da/8c/793_3y432.jpg'],['吹响吧！上低音号','37/df/115908_c0uQj.jpg'],['一拳超人','8c/a2/127563_nl66u.jpg'],
    ['鬼灭之刃','9d/d1/245665_5an54.jpg'],['奇巧计程车','65/90/325285_4688X.jpg'],['【我推的孩子】','98/5e/386809_1yR81.jpg'],
    ['超时空辉夜姬！','f6/0f/604826_2XWRN.jpg'],['夏日重现','d9/f5/326895_j1S2n.jpg'],['莉可丽丝','65/19/364450_xx2zx.jpg'],
    ['夏洛特','9b/d6/120925_Zp040.jpg'],['莉兹与青鸟','1d/35/216371_5926R.jpg'],['路人女主的养成方法','6b/01/100403_R8KN2.jpg'],
    ['异世界舅舅','1a/75/339326_v466V.jpg'],['星际牛仔','c2/4c/253_jJJj9.jpg'],['埃罗芒阿老师','87/bf/172498_wfm40.jpg'],
    ['樱花庄的宠物女孩','01/a2/41488_qw09G.jpg'],['来自深渊','f7/bf/203526_q2P6P.jpg'],['幸运星','db/8e/276_1Cr5K.jpg']
  ];
  const CARD_COUNT=108;
  const anime=i=>{const [name_cn,path]=COVERS[i%COVERS.length];return {name_cn,image_url:'https://lain.bgm.tv/r/400/pic/cover/l/'+path};};
  const reducedMotion=()=>window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  // Phones get a still background: any motion under the 3D board flickers in their compositors.
  const phone=()=>window.matchMedia('(max-width:700px),(hover:none) and (pointer:coarse)').matches;
  // A fixed seed deals the same board on every visit.
  let seed=7;
  const random=()=>(seed=(seed*16807)%2147483647)/2147483647;

  function setState(item,state){
    item.state=state;
    item.card.className='card '+item.type+(state!=='hidden'?' known':'')+(state==='revealed'?' revealed':'');
    item.card.querySelector('.reveal-mark')?.remove();
    if(state==='revealed'){const mark=el('div','reveal-mark');if(item.type==='assassin')mark.append(el('b','','×'));item.card.querySelector('.cover').append(mark);}
  }
  function buildBoard(layer){
    const board=el('div','bg-board'),plane=el('div','bg-plane'),cards=[];
    for(let i=0;i<CARD_COUNT;i++){
      const roll=random(),type=roll<.03?'assassin':roll<.36?'red':roll<.69?'blue':'neutral';
      const card=el('div','card'),cover=el('div','cover'),placeholder=el('div','cover-placeholder','✦');
      placeholder.append(el('small','','ANIME CODE'));cover.append(placeholder);
      const img=coverImage(anime(i));if(img)cover.append(img);
      const name=el('div','card-name');name.append(el('span','',anime(i).name_cn));
      card.append(cover,name);plane.append(card);
      const item={card,type,state:'hidden'},start=random();
      setState(item,start<.16?'revealed':start<.22?'known':'hidden');
      cards.push(item);
    }
    board.append(plane);layer.append(board);
    return cards;
  }
  // Turn one card now and then, only where it can be seen: on screen and away from the hero.
  function flipSomething(root,cards){
    if(document.hidden||reducedMotion()||phone()||!moving(root))return;
    const w=innerWidth,h=innerHeight;
    const visible=cards.filter(({card})=>{
      const r=card.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;
      return x>0&&x<w&&y>0&&y<h&&Math.hypot((x-w/2)/w,(y-h/2)/h)>.26;
    });
    if(!visible.length)return;
    const open=visible.filter(item=>item.state!=='hidden');
    // Past about a third open, close cards again so the board never fills up.
    const pool=open.length/visible.length>.3?open:visible.filter(item=>item.state==='hidden');
    const item=pool[Math.floor(Math.random()*pool.length)];
    if(!item)return;
    item.card.classList.add('is-turning');
    setTimeout(()=>{
      setState(item,item.state==='hidden'?(Math.random()<.75?'revealed':'known'):'hidden');
      // setState rewrites className, so put the edge-on class back before letting it turn open.
      item.card.classList.add('is-turning');void item.card.offsetWidth;item.card.classList.remove('is-turning');
    },240);
  }

  // Cards only turn on the entry page; the lobby blurs the board and the match hides it.
  const moving=root=>root.dataset.mode==='entry';

  // Adds the background to `container`; the board and its covers load on the first show().
  // setMode() switches between 'entry', 'lobby' and 'match'; setTeam() tints the match glows.
  function mount(container){
    const root=el('div','entry-bg');root.setAttribute('aria-hidden','true');
    root.dataset.mode='entry';
    const glows=el('div','bg-glows');glows.append(el('i','glow red'),el('i','glow blue'));
    const layer=el('div','bg-layer');
    root.append(glows,layer,el('div','bg-scrim'));container.prepend(root);
    let cards=null;
    return {
      show(){
        if(cards)return;
        cards=buildBoard(layer);
        setInterval(()=>flipSomething(root,cards),1700);
      },
      setMode(mode){root.dataset.mode=mode;},
      setTeam(team){if(team)root.dataset.team=team;else delete root.dataset.team;}
    };
  }
  window.AniEntry={mount};
})();
