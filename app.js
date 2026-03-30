/* ═══════════════════════════════════════════════════ */
/*  NEXUS PRO — Complete JavaScript Engine              */
/* ═══════════════════════════════════════════════════ */
const tg=window.Telegram?.WebApp;if(tg){tg.ready();tg.expand();tg.setHeaderColor('#060b14');tg.setBackgroundColor('#020408')}
const BN='https://api.binance.com/api/v3',BF='https://fapi.binance.com/fapi/v1',CG='https://api.coingecko.com/api/v3';
const WL=['BTC','ETH','SOL','BNB','XRP','LINK','AVAX','DOGE','ADA','DOT','MATIC','UNI','ATOM','ARB','OP','INJ','SUI','SEI','TIA','FTM','NEAR','APT','LTC','PEPE','WIF'];
const COL={BTC:'#f7931a',ETH:'#627eea',SOL:'#9945ff',BNB:'#f0b90b',XRP:'#23292f',LINK:'#2a5ada',AVAX:'#e84142',DOGE:'#c2a633',ADA:'#0033ad',DOT:'#e6007a',MATIC:'#8247e5',UNI:'#ff007a',ATOM:'#2e3148',ARB:'#28a0f0',OP:'#ff0420',INJ:'#00f2fe',SUI:'#4da2ff',SEI:'#9b1c1c',TIA:'#7c3aed',FTM:'#1969ff',NEAR:'#00c08b',APT:'#00bfa6',LTC:'#bfbbbb',PEPE:'#4c8c2f',WIF:'#8b5cf6'};
let T={},FR={},OI={},LS={},ws=null,curCoin='BTC',curTF='1h',inds={vol:1,sma:0,bb:0,rsi:0,sr:0};
let portfolio=JSON.parse(localStorage.getItem('nxp6')||'[]');

const fmt=n=>{if(n>=1e9)return'$'+(n/1e9).toFixed(1)+'B';if(n>=1e6)return'$'+(n/1e6).toFixed(1)+'M';if(n>=1e3)return'$'+(n/1e3).toFixed(1)+'K';return'$'+n.toFixed(0)};
const fP=p=>{if(!p)return'$0';if(p>=1e3)return'$'+p.toLocaleString('en',{maximumFractionDigits:2});if(p>=1)return'$'+p.toFixed(2);if(p>=.01)return'$'+p.toFixed(4);return'$'+p.toFixed(6)};
const fj=async u=>{try{const r=await fetch(u);if(!r.ok)throw 0;return r.json()}catch{return null}};
const sparkH=(vals,color)=>vals.map(v=>`<b style="height:${v}px;background:var(--${color})"></b>`).join('');
const mkSpark=(data)=>{if(!data||data.length<4)return'';const mn=Math.min(...data),mx=Math.max(...data),r=mx-mn||1;return data.slice(-8).map(v=>`<b style="height:${Math.max(2,((v-mn)/r)*14)}px;background:var(--${data[data.length-1]>=data[0]?'up':'dn'})"></b>`).join('')};

/* ═══════ THEME ═══════ */
function togTh(){const d=document.body.dataset.theme==='dark'?'light':'dark';document.body.dataset.theme=d;document.getElementById('thB').textContent=d==='dark'?'🌙':'☀️';if(tg){tg.setHeaderColor(d==='dark'?'#060b14':'#f7f9fc');tg.setBackgroundColor(d==='dark'?'#020408':'#f0f4f8')}localStorage.setItem('nxt6',d)}
(()=>{if(localStorage.getItem('nxt6')==='light')togTh()})();

/* ═══════ NAV ═══════ */
document.querySelectorAll('.bb,.side-b').forEach(b=>b.onclick=()=>sp(b.dataset.p));
function sp(id){document.querySelectorAll('.pg').forEach(p=>p.classList.remove('act'));document.querySelectorAll('.bb,.side-b').forEach(b=>b.classList.remove('act'));document.getElementById('pg-'+id)?.classList.add('act');document.querySelectorAll(`[data-p="${id}"]`).forEach(b=>b.classList.add('act'));({scan:runScan,intel:loadIntel,market:loadMkt,me:renderPort})[id]?.();window.scrollTo({top:0,behavior:'smooth'})}
function openMo(id){document.getElementById(id).classList.add('show')}
function closeMo(id){document.getElementById(id).classList.remove('show')}
document.querySelectorAll('.mo').forEach(m=>m.onclick=e=>{if(e.target===m)m.classList.remove('show')});
function stab(c,i,btn){c.querySelectorAll('.tab').forEach(b=>b.classList.remove('act'));btn.classList.add('act')}
function iTab(i,btn){stab(document.getElementById('pg-intel'),i,btn);for(let j=0;j<6;j++)document.getElementById('i'+j).style.display=j===i?'block':'none';if(i===1)loadFR();if(i===2)loadOIPage();if(i===3)loadLSPage();if(i===4)loadCorrelation()}
function mTab(i,btn){stab(document.getElementById('pg-market'),i,btn);for(let j=0;j<6;j++)document.getElementById('m'+j).style.display=j===i?'block':'none';if(i===0)loadHM();if(i===1)loadLiq();if(i===2)loadSig();if(i===3)loadNews();if(i===4)loadUnlocks();if(i===5)loadSocial()}
function pTab(i,btn){stab(document.getElementById('pg-me'),i,btn);['p0','p1','p2'].forEach((id,j)=>document.getElementById(id).style.display=j===i?'block':'none')}
function sf(btn){btn.parentElement.querySelectorAll('.flt-b').forEach(b=>b.classList.remove('act'));btn.classList.add('act');runScan()}

/* ═══════ SEARCH ═══════ */
function onSrch(v){const el=document.getElementById('sRes');if(!v){el.classList.remove('show');return}v=v.toUpperCase();const m=Object.entries(T).filter(([s])=>s.includes(v)).slice(0,8);if(!m.length){el.classList.remove('show');return}el.innerHTML=m.map(([s,d])=>`<div class="sr-i" onclick="openCoin('${s}')"><span style="font-weight:700;font-size:12px">${s}</span><span style="font-family:var(--fm);font-size:10px">${fP(d.p)} <span class="cr-ch ${d.c>=0?'up':'dn'}">${d.c>=0?'+':''}${d.c.toFixed(1)}%</span></span></div>`).join('');el.classList.add('show')}
document.addEventListener('click',e=>{if(!e.target.closest('.srch'))document.getElementById('sRes').classList.remove('show')});

/* ═══════ WEBSOCKET ═══════ */
function initWS(){if(ws)ws.close();ws=new WebSocket('wss://stream.binance.com:9443/stream?streams='+WL.map(s=>s.toLowerCase()+'usdt@miniTicker').join('/'));ws.onmessage=e=>{const d=JSON.parse(e.data).data;if(!d)return;const s=d.s.replace('USDT','');T[s]={...T[s],p:+d.c,c:+d.P,v:+d.q,h:+d.h,l:+d.l,src:'BN'}};ws.onclose=()=>setTimeout(initWS,3000);ws.onerror=()=>ws.close()}

/* ═══════ LOAD TICKERS ═══════ */
async function loadTk(){
  const bn=await fj(BN+'/ticker/24hr');if(bn)bn.filter(t=>t.symbol.endsWith('USDT')).forEach(t=>{const s=t.symbol.replace('USDT','');T[s]={p:+t.lastPrice,c:+t.priceChangePercent,v:+t.quoteVolume,h:+t.highPrice,l:+t.lowPrice,src:'BN'}});
  try{const by=await fj('https://api.bybit.com/v5/market/tickers?category=spot');if(by?.result?.list)by.result.list.filter(t=>t.symbol.endsWith('USDT')).forEach(t=>{const s=t.symbol.replace('USDT','');if(!T[s])T[s]={p:+t.lastPrice,c:+t.price24hPcnt*100,v:+t.turnover24h,h:+t.highPrice24h,l:+t.lowPrice24h,src:'BY'};else T[s].by=+t.lastPrice})}catch{}
  // Ticker bar with sparklines
  const el=document.getElementById('tkrEl');const items=WL.filter(s=>T[s]).slice(0,16);let h='';
  for(let r=0;r<2;r++)items.forEach(s=>{const d=T[s],up=d.c>=0;
    const sp=up?[4,6,5,8,7,10,12,14]:[14,12,10,8,6,5,4,3];
    h+=`<div class="tkr-i"><span class="tkr-sym">${s}</span><span style="font-family:var(--fm);font-size:9px;color:var(--t2)">${fP(d.p)}</span><div class="spark">${sp.map(v=>`<b style="height:${v}px;background:var(--${up?'up':'dn'})"></b>`).join('')}</div><span class="tkr-c ${up?'up':'dn'}">${up?'+':''}${d.c.toFixed(1)}%</span></div>`});
  el.innerHTML=h;
}

/* ═══════ FUTURES DATA ═══════ */
async function loadFutures(){
  // Funding Rate
  const frData=await fj(BF+'/premiumIndex');if(frData)frData.forEach(d=>{const s=d.symbol.replace('USDT','');FR[s]={rate:+d.lastFundingRate*100,mark:+d.markPrice}});
  const btcFR=FR.BTC;if(btcFR)document.getElementById('pFR').textContent=(btcFR.rate>=0?'+':'')+btcFR.rate.toFixed(4)+'%';
  // OI for top coins
  for(const s of WL.slice(0,8)){const d=await fj(BF+`/openInterest?symbol=${s}USDT`);if(d)OI[s]=(+d.openInterest)*(T[s]?.p||0)}
  // Long/Short
  for(const s of WL.slice(0,6)){const d=await fj(BF+`/topLongShortPositionRatio?symbol=${s}USDT&period=1h&limit=1`);if(d&&d[0])LS[s]={long:+d[0].longAccount*100,short:+d[0].shortAccount*100,ratio:+d[0].longShortRatio}}
}

/* ═══════ ANALYSIS ENGINE ═══════ */
async function analyzeAll(){
  if(!Object.keys(T).length)await loadTk();
  const results=[];
  for(const[s,d]of Object.entries(T)){
    if(d.v<500000)continue;let brk=0,acc=0,wh=0,reasons=[];
    if(d.c>=8){brk+=40;reasons.push('💥BRK')}else if(d.c>=5){brk+=25;reasons.push('⚡MOM')}else if(d.c>=3){brk+=15;reasons.push('📈UP')}
    if(d.h&&d.p&&((d.h-d.p)/d.p*100)<2){brk+=15;reasons.push('🎯RESIST')}
    if(Math.abs(d.c)<2){acc+=25;reasons.push('STABLE')}
    if(d.v>1e8&&Math.abs(d.c)<3){acc+=20;reasons.push('HIGHVOL')}
    if(d.h&&d.l&&d.h!==d.l&&((d.p-d.l)/(d.h-d.l))*100<30){acc+=20;reasons.push('LOW')}
    if(d.v>5e7&&Math.abs(d.c)>3){wh+=30;reasons.push('🐋')}
    if(d.v>2e8){wh+=15;reasons.push('MEGA')}
    const fr=FR[s];if(fr){if(fr.rate<-0.02){brk+=10;reasons.push('FR⬇️')}if(fr.rate>0.08)reasons.push('FR⚠️')}
    if((brk>=25||acc>=40||wh>=30)&&WL.includes(s)){try{const ob=await fj(BN+`/depth?symbol=${s}USDT&limit=10`);if(ob){const bv=ob.bids.reduce((s,b)=>s+ +b[0]* +b[1],0),av=ob.asks.reduce((s,a)=>s+ +a[0]* +a[1],0),r=bv/Math.max(av,1);if(r>1.5){acc+=25;brk+=10;reasons.push(`BID${r.toFixed(1)}x`)}else if(r>1.2){acc+=15;reasons.push(`BID${r.toFixed(1)}x`)}}}catch{}}
    const total=Math.min(100,brk+acc+wh),ultra=brk>=25&&(acc>=40||wh>=30);
    if(total>=30)results.push({s,p:d.p,c:d.c,v:d.v,score:total,brk,acc,wh,ultra,reasons,by:d.by,fr:fr?.rate});
  }
  return results.sort((a,b)=>b.score-a.score);
}

/* ═══════ RENDER HELPERS ═══════ */
function coinRow(s,d,i,sub){const up=d.c>=0;const sp=up?[4,6,5,8,12,16,19,22]:[22,18,14,10,8,6,5,4];const bg=COL[s]||'#444';
  return`<div class="cr" onclick="openCoin('${s}')"><div class="cr-l">${i!==undefined?`<div class="cr-rk">${i}</div>`:''}<div class="cr-ic" style="background:${bg}0a;color:${bg};border:1px solid ${bg}22">${s.slice(0,2)}</div><div><div class="cr-n">${s}</div><div class="cr-sub">${sub||fmt(d.v)}</div></div></div><div class="cr-spark">${sp.map(v=>`<b style="height:${v}px;background:var(--${up?'up':'dn'})"></b>`).join('')}</div><div class="cr-r"><div class="cr-p">${fP(d.p)}</div><div class="cr-ch ${up?'up':'dn'}">${up?'+':''}${d.c.toFixed(1)}%</div></div></div>`}

function ultraCard(r){
  const sp=[8,10,9,12,11,15,14,18,17,20,22,25,28,30,33,36];
  return`<div class="ultra" onclick="openCoin('${r.s}')"><div class="u-badge">⭐ ULTRA SIGNAL — ACTION REQUIRED</div><div class="u-head"><div><div class="u-sym">${r.s}/USDT</div><div class="u-price"><span class="u-ch">+${r.c.toFixed(1)}%</span>${fP(r.p)}</div></div><div><div class="u-score-val">${r.score}</div><div class="u-score-lbl">SCORE</div></div></div><div class="u-spark">${sp.map(v=>`<b style="height:${v}px"></b>`).join('')}</div><div class="u-tags"><span class="u-tag" style="background:var(--ud);color:var(--up)">🐋 Whale ✓</span><span class="u-tag" style="background:var(--dd);color:var(--dn)">💥 Breakout ✓</span>${r.fr!=null?`<span class="u-tag" style="background:var(--pd);color:var(--purple)">FR: ${r.fr.toFixed(3)}%</span>`:''}${r.by?`<span class="u-tag" style="background:var(--bd);color:var(--blue)">Bybit ✓</span>`:''}</div><div class="u-target"><span>🎯</span><span style="font-family:var(--fm);font-weight:800;font-size:14px;color:var(--up)">${fP(r.p*1.15)}</span><span style="font-family:var(--fm);font-weight:700;font-size:12px;color:var(--up);padding:2px 8px;background:var(--ud);border-radius:6px">+15%</span><span style="font-size:10px;color:var(--t3);font-family:var(--fm);margin-right:auto">⏱ ~2-6h</span></div></div>`}

function scanItem(r){const cls=r.ultra?'scan-r ultra-r':'scan-r';const sc=r.score>=80?'background:var(--ud);color:var(--up)':r.score>=60?'background:var(--wd);color:var(--warn)':'background:rgba(56,72,96,.3);color:var(--t2)';const lb=r.ultra?'⭐ULTRA':r.score>=80?'🔥HIGH':r.score>=60?'⚡MED':'📊';
  return`<div class="${cls}" onclick="openCoin('${r.s}')"><div class="scan-h"><div class="scan-sym">${r.ultra?'⭐':'💎'} ${r.s}</div><span class="scan-score" style="${sc}">${lb} ${r.score}</span></div><div class="scan-det"><span>💰 <b>${fP(r.p)}</b></span><span>${r.c>=0?'+':''}${r.c.toFixed(1)}%</span><span>${fmt(r.v)}</span>${r.fr!=null?`<span>FR:${r.fr.toFixed(3)}%</span>`:''}</div><div class="scan-checks">${r.reasons.slice(0,5).map(r=>`<span class="scan-chk chk-y">${r}</span>`).join('')}</div><div class="prw"><div class="prb" style="width:${r.score}%;background:${r.ultra?'linear-gradient(90deg,var(--ultra),var(--dn))':r.score>=70?'var(--up)':r.score>=50?'var(--warn)':'var(--dn)'}"></div></div></div>`}

/* ═══════ DASHBOARD ═══════ */
async function loadDash(){
  await loadTk();initWS();await loadFutures();
  const results=await analyzeAll();
  const ultras=results.filter(r=>r.ultra);
  // ULTRA
  document.getElementById('ultraL').innerHTML=ultras.length?ultras.slice(0,3).map(ultraCard).join(''):'<div class="muted">لا ULTRA حالياً — المسح مستمر</div>';
  // Breakouts
  const brks=results.filter(r=>r.brk>=25).slice(0,5);
  document.getElementById('dashBrk').innerHTML=brks.length?brks.map((r,i)=>coinRow(r.s,{p:r.p,c:r.c,v:r.v},i+1,`احتمال ${Math.min(95,r.brk+40)}%`)).join(''):'<div class="muted">لا انفجارات</div>';
  // Whales
  const whs=results.filter(r=>r.wh>=30).slice(0,5);
  document.getElementById('dashWh').innerHTML=whs.length?whs.map((r,i)=>coinRow(r.s,{p:r.p,c:r.c,v:r.v},i+1,`🐋 ${fmt(r.v*.05)}`)).join(''):'<div class="muted">لا تجميع</div>';
  // Funding Rate dashboard
  const frCoins=['BTC','ETH','SOL','DOGE'].filter(s=>FR[s]);
  document.getElementById('dashFR').innerHTML=frCoins.map(s=>{const d=FR[s];const cls=d.rate>0.05?'dn':d.rate<-0.01?'up':'warn';const w=Math.min(48,Math.abs(d.rate)*500);const side=d.rate>=0?'left:50%':`right:50%`;const lbl=d.rate>0.05?'⚠️ Danger':d.rate>0.02?'Elevated':d.rate<-0.01?'Opportunity':'Normal';
    return`<div class="fr-row"><span class="fr-sym">${s}</span><div class="fr-bar"><div class="fr-mid"></div><div class="fr-fill" style="${side};width:${w}%;background:var(--${cls})"></div></div><div><div class="fr-val" style="color:var(--${cls})">${d.rate>=0?'+':''}${d.rate.toFixed(4)}%</div><div class="fr-sub-t">${lbl}</div></div></div>`}).join('')||'<div class="muted">جاري التحميل...</div>';
  // Long/Short dashboard
  const lsCoins=['BTC','ETH','SOL'].filter(s=>LS[s]);
  document.getElementById('dashLS').innerHTML=lsCoins.map(s=>{const d=LS[s];return`<div class="ls-item"><div class="ls-head"><span class="ls-sym">${s}</span><span class="ls-ratio"${d.ratio<0.8?' style="color:var(--dn)"':''}>${d.ratio.toFixed(2)}${d.ratio<0.8?' ⚠️':''}</span></div><div class="ls-bar"><div class="ls-l" style="width:${d.long}%"></div><div class="ls-s" style="width:${d.short}%"></div></div><div class="ls-nums"><span style="color:var(--up)">🟢 ${d.long.toFixed(0)}% Long</span><span style="color:var(--dn)">🔴 ${d.short.toFixed(0)}% Short</span></div></div>`}).join('')||'<div class="muted">جاري التحميل...</div>';
  // Stats
  const fg=await fj('https://api.alternative.me/fng/?limit=1');if(fg?.data){document.getElementById('fgV').textContent=fg.data[0].value;document.getElementById('fgL').textContent=fg.data[0].value_classification;document.getElementById('pFG').textContent=fg.data[0].value}
  const gl=await fj(CG+'/global');if(gl?.data)document.getElementById('btcD').textContent=(gl.data.market_cap_percentage?.btc||0).toFixed(1)+'%';
  const brkCount=Object.values(T).filter(t=>t.c>=8).length;
  document.getElementById('brkC').textContent=brkCount;document.getElementById('pBrk').textContent=brkCount;
  document.getElementById('ulC').textContent=ultras.length;document.getElementById('pUl').textContent=ultras.length;
  document.getElementById('pWh').textContent=fmt(whs.reduce((s,w)=>s+w.v*.05,0));
  document.getElementById('notifB').dataset.c=ultras.length;
  // Top Movers
  document.getElementById('topMov').innerHTML=Object.entries(T).sort((a,b)=>Math.abs(b[1].c)-Math.abs(a[1].c)).slice(0,6).map(([s,d],i)=>coinRow(s,d,i+1)).join('');
}

/* ═══════ SCANNER ═══════ */
async function runScan(){
  const results=await analyzeAll();const mode=document.querySelector('#fltM .flt-b.act')?.dataset.m||'all';
  let f=results;
  if(mode==='ultra')f=results.filter(r=>r.ultra);else if(mode==='brk')f=results.filter(r=>r.brk>=25);else if(mode==='whale')f=results.filter(r=>r.wh>=30);else if(mode==='fr')f=Object.entries(FR).filter(([s])=>WL.includes(s)).sort((a,b)=>Math.abs(b[1].rate)-Math.abs(a[1].rate)).map(([s,d])=>({s,p:T[s]?.p||0,c:T[s]?.c||0,v:T[s]?.v||0,score:Math.min(100,Math.round(Math.abs(d.rate)*1000)),brk:0,acc:0,wh:0,ultra:false,reasons:[`FR:${d.rate.toFixed(4)}%`],fr:d.rate}));
  document.getElementById('scanI').textContent=`📊 ${Object.keys(T).length} عملة | ✅ ${f.length} نتيجة`;
  document.getElementById('scanR').innerHTML=f.length?f.slice(0,25).map(scanItem).join(''):'<div class="empty"><div class="empty-ic">📡</div><div class="empty-tx">لا نتائج</div></div>';
}

/* ═══════ INTELLIGENCE ═══════ */
async function loadIntel(){
  const results=await analyzeAll();const whs=results.filter(r=>r.wh>=30||r.acc>=40).slice(0,12);
  const tot=whs.reduce((s,w)=>s+w.v*.05,0);
  document.getElementById('whT').textContent=fmt(tot);
  document.getElementById('whB').textContent=fmt(whs.filter(w=>w.c>0).reduce((s,w)=>s+w.v*.05,0));
  document.getElementById('whS').textContent=fmt(whs.filter(w=>w.c<0).reduce((s,w)=>s+w.v*.05,0));
  document.getElementById('whAL').innerHTML=whs.map(r=>scanItem({...r,score:Math.min(100,r.acc+r.wh)})).join('')||'<div class="empty"><div class="empty-ic">🐋</div><div class="empty-tx">لا تجميع</div></div>';
}
async function loadFR(){
  if(!Object.keys(FR).length)await loadFutures();
  const sorted=Object.entries(FR).filter(([s])=>WL.includes(s)).sort((a,b)=>Math.abs(b[1].rate)-Math.abs(a[1].rate));
  document.getElementById('frList').innerHTML='<div class="muted">🔴 FR عالي = خطر | 🟢 FR سلبي = فرصة</div>'+sorted.map(([s,d])=>{const cls=d.rate>0.05?'dn':d.rate<-0.01?'up':'warn';const w=Math.min(48,Math.abs(d.rate)*500);const side=d.rate>=0?'left:50%':'right:50%';
    return`<div class="fr-row"><span class="fr-sym">${s}</span><div class="fr-bar"><div class="fr-mid"></div><div class="fr-fill" style="${side};width:${w}%;background:var(--${cls})"></div></div><span class="fr-val" style="color:var(--${cls})">${d.rate>=0?'+':''}${d.rate.toFixed(4)}%</span></div>`}).join('');
}
async function loadOIPage(){
  if(!Object.keys(OI).length)await loadFutures();
  document.getElementById('oiList').innerHTML='<div class="muted">📈 OI ↑ مع السعر = حركة حقيقية</div>'+Object.entries(OI).sort((a,b)=>b[1]-a[1]).map(([s,v])=>{const t=T[s];return`<div class="fr-row"><span class="fr-sym">${s}</span><span style="font-family:var(--fm);font-size:11px;color:var(--neon);font-weight:700">${fmt(v)}</span><span class="cr-ch ${t&&t.c>=0?'up':'dn'}">${t?(t.c>=0?'+':'')+t.c.toFixed(1)+'%':'--'}</span></div>`}).join('');
}
async function loadLSPage(){
  if(!Object.keys(LS).length)await loadFutures();
  document.getElementById('lsList').innerHTML='<div class="muted">⚖️ نسبة Long/Short للمتداولين الكبار</div>'+Object.entries(LS).map(([s,d])=>`<div class="ls-item" style="background:var(--glass);border:1px solid var(--bdr);border-radius:10px;padding:10px;margin-bottom:5px"><div class="ls-head"><span class="ls-sym">${s}</span><span class="ls-ratio">${d.ratio.toFixed(2)}</span></div><div class="ls-bar"><div class="ls-l" style="width:${d.long}%"></div><div class="ls-s" style="width:${d.short}%"></div></div><div class="ls-nums"><span style="color:var(--up)">🟢 ${d.long.toFixed(1)}%</span><span style="color:var(--dn)">🔴 ${d.short.toFixed(1)}%</span></div></div>`).join('');
}
async function loadCorrelation(){
  const coins=['BTC','ETH','SOL','BNB','XRP','LINK','DOGE','ADA'];const prices={};
  for(const s of coins){const kl=await fj(BN+`/klines?symbol=${s}USDT&interval=1d&limit=14`);if(kl)prices[s]=kl.map(k=>+k[4])}
  function corr(a,b){const n=Math.min(a.length,b.length);const ma=a.slice(-n).reduce((s,v)=>s+v,0)/n,mb=b.slice(-n).reduce((s,v)=>s+v,0)/n;let num=0,da=0,db=0;for(let i=0;i<n;i++){const x=a[a.length-n+i]-ma,y=b[b.length-n+i]-mb;num+=x*y;da+=x*x;db+=y*y}return da&&db?num/Math.sqrt(da*db):0}
  let h=`<div class="muted">🔗 Correlation Matrix (14D) | 🟢 مترابط | 🔴 عكسي</div><div style="display:grid;grid-template-columns:auto repeat(${coins.length},1fr);gap:2px;font-size:8px;font-family:var(--fm)"><div></div>`;
  coins.forEach(s=>h+=`<div style="text-align:center;font-weight:700">${s}</div>`);
  coins.forEach(a=>{h+=`<div style="font-weight:700">${a}</div>`;coins.forEach(b=>{if(!prices[a]||!prices[b]){h+=`<div style="text-align:center">--</div>`;return}
    const c=a===b?1:corr(prices[a],prices[b]);const bg=c>.7?'var(--ud)':c<-.3?'var(--dd)':'transparent';const col=c>.5?'var(--up)':c<-.3?'var(--dn)':'var(--t2)';
    h+=`<div style="text-align:center;padding:3px;border-radius:3px;background:${bg};color:${col};font-weight:700">${c.toFixed(2)}</div>`})});
  h+='</div>';document.getElementById('corGrid').innerHTML=h;
}

/* ═══════ MARKET ═══════ */
async function loadMkt(){loadHM()}
async function loadHM(){if(!Object.keys(T).length)await loadTk();document.getElementById('hmG').innerHTML=WL.filter(s=>T[s]).sort((a,b)=>T[b].v-T[a].v).slice(0,24).map(s=>{const d=T[s],ch=d.c;let bg;if(ch>10)bg='rgba(0,255,136,.75)';else if(ch>5)bg='rgba(0,255,136,.5)';else if(ch>2)bg='rgba(0,255,136,.3)';else if(ch>0)bg='rgba(0,255,136,.15)';else if(ch>-2)bg='rgba(255,56,96,.15)';else if(ch>-5)bg='rgba(255,56,96,.3)';else if(ch>-10)bg='rgba(255,56,96,.5)';else bg='rgba(255,56,96,.75)';return`<div class="hm-c" style="background:${bg}" onclick="openCoin('${s}')"><div class="hm-s">${s}</div><div class="hm-ch">${ch>=0?'+':''}${ch.toFixed(1)}%</div></div>`}).join('')}
async function loadLiq(){if(!Object.keys(T).length)await loadTk();
  document.getElementById('liqL').innerHTML=Object.entries(T).sort((a,b)=>b[1].v-a[1].v).slice(0,15).map(([s,d],i)=>coinRow(s,d,i+1)).join('');
  let h='';for(const s of['BTC','ETH','SOL','BNB','XRP']){const ob=await fj(BN+`/depth?symbol=${s}USDT&limit=10`);if(!ob)continue;const bids=ob.bids.map(b=>+b[0]*+b[1]),asks=ob.asks.map(a=>+a[0]*+a[1]),bT=bids.reduce((a,b)=>a+b,0),aT=asks.reduce((a,b)=>a+b,0),r=aT>0?bT/aT:1,mx=Math.max(...bids,...asks);let pr,pc;if(r>1.5){pr='BUY';pc='up'}else if(r>1.1){pr='BUY';pc='up'}else if(r<.65){pr='SELL';pc='dn'}else if(r<.9){pr='SELL';pc='dn'}else{pr='NEUTRAL';pc='warn'}
    h+=`<div class="cd" style="padding:8px"><div style="display:flex;justify-content:space-between;margin-bottom:4px"><span style="font-weight:700;font-family:var(--fd)">${s}</span><span style="font-size:9px;font-family:var(--fm);color:var(--${pc})">${pr} ${r.toFixed(2)}x</span></div><div class="ob-v">${bids.reverse().map(v=>`<div class="ob-b bid" style="height:${Math.max(3,v/mx*100)}%"></div>`).join('')}<div style="width:1px;background:var(--t3);height:100%"></div>${asks.map(v=>`<div class="ob-b ask" style="height:${Math.max(3,v/mx*100)}%"></div>`).join('')}</div></div>`}
  document.getElementById('obS').innerHTML=h;
}
async function loadSig(){const el=document.getElementById('sigL');let h='';
  for(const s of WL.slice(0,12)){const t=T[s];if(!t)continue;const kl=await fj(BN+`/klines?symbol=${s}USDT&interval=1h&limit=26`);if(!kl||kl.length<20)continue;const cl=kl.map(k=>+k[4]);let g=0,l=0;for(let i=cl.length-14;i<cl.length;i++){const df=cl[i]-cl[i-1];if(df>0)g+=df;else l+=Math.abs(df)}const rsi=100-100/(1+g/Math.max(l,.01));
    let act,cls,sc;if(rsi<30){act='شراء قوي';cls='sig-buy';sc=''}else if(rsi<40){act='شراء';cls='sig-buy';sc=''}else if(rsi>75){act='بيع';cls='sig-sell';sc='sell'}else{act='انتظار';cls='sig-hold';sc='hold'}
    const fr=FR[s];h+=`<div class="sig ${sc}"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px"><span style="font-weight:800;font-family:var(--fd);font-size:13px">${s} <span style="font-size:10px;color:var(--t2)">${fP(t.p)}</span></span><span class="sig-act ${cls}">${act}</span></div><div class="sig-inds"><span class="sig-ind">RSI:${rsi.toFixed(0)}</span>${fr?`<span class="sig-ind">FR:${fr.rate.toFixed(3)}%</span>`:''}</div></div>`}
  el.innerHTML=h||'<div class="muted">جاري الحساب</div>';
}
async function loadNews(){const d=await fj(CG+'/search/trending');document.getElementById('newsL').innerHTML=d?.coins?d.coins.slice(0,10).map(c=>`<div class="cr" style="margin-bottom:4px"><div class="cr-l"><div class="cr-ic" style="background:var(--ud);color:var(--up);border:1px solid rgba(0,255,136,.1)">🔥</div><div><div class="cr-n">${c.item.name}</div><div class="cr-sub">${c.item.symbol} • Rank #${c.item.market_cap_rank||'N/A'}</div></div></div><div class="cr-r"><span class="cr-ch up">Trending</span></div></div>`).join(''):'<div class="muted">لا أخبار</div>'}
async function loadUnlocks(){const unlocks=[{sym:'ARB',date:'2026-04-16',amount:'$92M',pct:'3.5%'},{sym:'OP',date:'2026-04-30',amount:'$78M',pct:'2.8%'},{sym:'SUI',date:'2026-05-01',amount:'$120M',pct:'4.2%'},{sym:'TIA',date:'2026-04-20',amount:'$85M',pct:'5.1%'},{sym:'APT',date:'2026-05-15',amount:'$65M',pct:'2.1%'},{sym:'SEI',date:'2026-04-10',amount:'$45M',pct:'3.8%'}];
  document.getElementById('unlockL').innerHTML='<div class="muted">🔓 فتح التوكنات القادمة</div>'+unlocks.map(u=>{const days=Math.ceil((new Date(u.date)-new Date)/864e5);const cls=days<7?'dn':days<30?'warn':'up';return`<div class="fr-row"><div><span class="fr-sym">${u.sym}</span><span style="font-size:9px;color:var(--t3);margin-right:6px">${u.date}</span></div><div style="text-align:left"><div style="font-family:var(--fm);font-size:11px;font-weight:700">${u.amount}</div><div style="font-size:9px;color:var(--${cls})">${days>0?days+' يوم':'اليوم!'} | ${u.pct}</div></div></div>`}).join('')}
async function loadSocial(){const d=await fj(CG+'/search/trending');document.getElementById('socialL').innerHTML='<div class="muted">📱 الأكثر بحثاً ونقاشاً</div>'+(d?.coins?d.coins.slice(0,10).map((c,i)=>`<div class="fr-row"><span style="font-size:10px;color:var(--t3)">${i+1}</span><span class="fr-sym">${c.item.symbol}</span><span style="font-size:10px;color:var(--t2)">${c.item.name}</span><span class="cr-ch up">🔥</span></div>`).join(''):'<div class="muted">لا بيانات</div>')}

/* ═══════ COIN DETAIL + CHART ═══════ */
async function openCoin(sym){curCoin=sym;curTF='1h';document.getElementById('sRes').classList.remove('show');document.getElementById('sInp').value='';
  const t=T[sym]||{p:0,c:0,v:0,h:0,l:0};document.getElementById('cmT').textContent=sym+'/USDT';document.getElementById('cmP').textContent=fP(t.p);
  document.getElementById('cmC').style.color=t.c>=0?'var(--up)':'var(--dn)';document.getElementById('cmC').textContent=(t.c>=0?'+':'')+t.c.toFixed(2)+'%';
  document.getElementById('cmSts').innerHTML=`<div class="st"><div class="st-l">VOL</div><div class="st-v" style="color:var(--neon)">${fmt(t.v)}</div></div><div class="st"><div class="st-l">HIGH</div><div class="st-v" style="color:var(--up)">${fP(t.h)}</div></div><div class="st"><div class="st-l">LOW</div><div class="st-v" style="color:var(--dn)">${fP(t.l)}</div></div>`;
  let ex='';const fr=FR[sym];if(fr)ex+=`<div class="fr-row" style="margin-top:6px"><span>📊 Funding Rate</span><span class="fr-val" style="color:${fr.rate>0.05?'var(--dn)':fr.rate<-0.01?'var(--up)':'var(--warn)'}">${fr.rate>=0?'+':''}${fr.rate.toFixed(4)}%</span></div>`;
  if(OI[sym])ex+=`<div class="fr-row"><span>📈 Open Interest</span><span class="fr-val" style="color:var(--neon)">${fmt(OI[sym])}</span></div>`;
  if(LS[sym])ex+=`<div class="fr-row"><span>⚖️ Long/Short</span><span class="fr-val">${LS[sym].long.toFixed(0)}%L / ${LS[sym].short.toFixed(0)}%S</span></div>`;
  if(t.by)ex+=`<div class="fr-row"><span>🔄 Bybit</span><span class="fr-val">${fP(t.by)} (Δ${((t.by-t.p)/t.p*100).toFixed(2)}%)</span></div>`;
  document.getElementById('cmExtra').innerHTML=ex;
  openMo('coinMo');document.querySelectorAll('.chart-tf').forEach(b=>{b.classList.remove('act');if(b.dataset.t==='1h')b.classList.add('act')});await drawChart(sym,'1h')}
function cTF(tf,btn){curTF=tf;document.querySelectorAll('.chart-tf').forEach(b=>b.classList.remove('act'));btn.classList.add('act');drawChart(curCoin,tf)}
function tgI(ind,btn){inds[ind]=inds[ind]?0:1;btn.classList.toggle('act');drawChart(curCoin,curTF)}

async function drawChart(sym,tf){
  const cv=document.getElementById('chCv'),ctx=cv.getContext('2d');const dpr=window.devicePixelRatio||1;cv.width=cv.clientWidth*dpr;cv.height=250*dpr;ctx.scale(dpr,dpr);const W=cv.clientWidth,H=250;ctx.clearRect(0,0,W,H);
  const kl=await fj(BN+`/klines?symbol=${sym}USDT&interval=${tf}&limit=80`);if(!kl||!kl.length){ctx.fillStyle='#4a5568';ctx.font='11px Syne';ctx.textAlign='center';ctx.fillText('لا بيانات',W/2,H/2);return}
  const data=kl.map(k=>({o:+k[1],h:+k[2],l:+k[3],c:+k[4],v:+k[5]}));const mH=inds.rsi?H*.7:H-25;const pad={t:8,b:2,l:2,r:2},cw=(W-pad.l-pad.r)/data.length,ch=mH-pad.t-16;
  let maxP=Math.max(...data.map(d=>d.h)),minP=Math.min(...data.map(d=>d.l));
  const cs=getComputedStyle(document.body);const upC=cs.getPropertyValue('--up').trim()||'#00ff88',dnC=cs.getPropertyValue('--dn').trim()||'#ff3860';
  let bbU=[],bbL=[];if(inds.bb&&data.length>=20){for(let i=19;i<data.length;i++){const sl=data.slice(i-19,i+1).map(d=>d.c);const m=sl.reduce((a,b)=>a+b,0)/20;const std=Math.sqrt(sl.reduce((a,b)=>a+(b-m)**2,0)/20);bbU.push(m+2*std);bbL.push(m-2*std)}maxP=Math.max(maxP,...bbU);minP=Math.min(minP,...bbL)}
  const yS=p=>pad.t+ch-((p-minP)/(maxP-minP))*ch;
  // S/R
  let sups=[],ress=[];if(inds.sr){const lows=data.map(d=>d.l),highs=data.map(d=>d.h);for(let i=2;i<data.length-2;i++){if(lows[i]<lows[i-1]&&lows[i]<lows[i-2]&&lows[i]<lows[i+1]&&lows[i]<lows[i+2])sups.push(lows[i]);if(highs[i]>highs[i-1]&&highs[i]>highs[i-2]&&highs[i]>highs[i+1]&&highs[i]>highs[i+2])ress.push(highs[i])}sups=[...new Set(sups)].slice(-3);ress=[...new Set(ress)].slice(-3)}
  // Grid
  ctx.strokeStyle=cs.getPropertyValue('--bdr').trim()||'rgba(0,255,136,.05)';ctx.lineWidth=.5;for(let i=0;i<4;i++){const y=pad.t+ch/3*i;ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(W,y);ctx.stroke();ctx.fillStyle=cs.getPropertyValue('--t3').trim()||'#384860';ctx.font='7px Geist Mono';ctx.textAlign='left';ctx.fillText(fP(maxP-(maxP-minP)/3*i),2,y-2)}
  if(inds.vol){const mV=Math.max(...data.map(d=>d.v));data.forEach((d,i)=>{ctx.fillStyle=d.c>=d.o?'rgba(0,255,136,.08)':'rgba(255,56,96,.08)';ctx.fillRect(pad.l+i*cw+1,mH-d.v/mV*25,cw-2,d.v/mV*25)})}
  if(inds.bb&&bbU.length){const off=data.length-bbU.length;ctx.globalAlpha=.1;ctx.fillStyle='#b07cff';ctx.beginPath();bbU.forEach((v,i)=>{const x=pad.l+(i+off)*cw+cw/2;i===0?ctx.moveTo(x,yS(v)):ctx.lineTo(x,yS(v))});for(let i=bbL.length-1;i>=0;i--)ctx.lineTo(pad.l+(i+off)*cw+cw/2,yS(bbL[i]));ctx.fill();ctx.globalAlpha=1;ctx.strokeStyle='rgba(176,124,255,.25)';ctx.lineWidth=1;ctx.beginPath();bbU.forEach((v,i)=>{const x=pad.l+(i+off)*cw+cw/2;i===0?ctx.moveTo(x,yS(v)):ctx.lineTo(x,yS(v))});ctx.stroke();ctx.beginPath();bbL.forEach((v,i)=>{const x=pad.l+(i+off)*cw+cw/2;i===0?ctx.moveTo(x,yS(v)):ctx.lineTo(x,yS(v))});ctx.stroke()}
  if(inds.sma&&data.length>=7){ctx.beginPath();ctx.strokeStyle='rgba(91,156,255,.6)';ctx.lineWidth=1.5;for(let i=6;i<data.length;i++){const avg=data.slice(i-6,i+1).reduce((s,d)=>s+d.c,0)/7;const x=pad.l+i*cw+cw/2;i===6?ctx.moveTo(x,yS(avg)):ctx.lineTo(x,yS(avg))}ctx.stroke()}
  if(inds.sr){sups.forEach(p=>{if(p>=minP&&p<=maxP){ctx.strokeStyle='rgba(0,255,136,.35)';ctx.setLineDash([4,4]);ctx.beginPath();ctx.moveTo(0,yS(p));ctx.lineTo(W,yS(p));ctx.stroke();ctx.setLineDash([]);ctx.fillStyle='rgba(0,255,136,.5)';ctx.font='7px Geist Mono';ctx.fillText('S:'+fP(p),W-55,yS(p)-3)}});ress.forEach(p=>{if(p>=minP&&p<=maxP){ctx.strokeStyle='rgba(255,56,96,.35)';ctx.setLineDash([4,4]);ctx.beginPath();ctx.moveTo(0,yS(p));ctx.lineTo(W,yS(p));ctx.stroke();ctx.setLineDash([]);ctx.fillStyle='rgba(255,56,96,.5)';ctx.font='7px Geist Mono';ctx.fillText('R:'+fP(p),W-55,yS(p)-3)}})}
  data.forEach((d,i)=>{const x=pad.l+i*cw+cw/2,bw=Math.max(1,cw*.6),up=d.c>=d.o,col=up?upC:dnC;ctx.strokeStyle=col;ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(x,yS(d.h));ctx.lineTo(x,yS(d.l));ctx.stroke();ctx.fillStyle=col;const top=yS(Math.max(d.o,d.c)),bot=yS(Math.min(d.o,d.c));ctx.fillRect(x-bw/2,top,bw,Math.max(1,bot-top))});
  if(inds.rsi&&data.length>=14){const rsiY=mH+8,rsiH=H*.22;const closes=data.map(d=>d.c),rsis=[];for(let i=14;i<closes.length;i++){let g=0,l=0;for(let j=i-13;j<=i;j++){const df=closes[j]-closes[j-1];if(df>0)g+=df;else l+=Math.abs(df)}rsis.push(100-100/(1+g/Math.max(l,.01)))}
    ctx.strokeStyle=cs.getPropertyValue('--bdr').trim();ctx.lineWidth=.5;[rsiY,rsiY+rsiH].forEach(y=>{ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(W,y);ctx.stroke()});
    ctx.beginPath();ctx.strokeStyle='rgba(176,124,255,.7)';ctx.lineWidth=1.5;const off=data.length-rsis.length;rsis.forEach((v,i)=>{const x=pad.l+(i+off)*cw+cw/2,y=rsiY+rsiH-(v/100)*rsiH;i===0?ctx.moveTo(x,y):ctx.lineTo(x,y)});ctx.stroke();
    ctx.strokeStyle='rgba(255,56,96,.12)';ctx.setLineDash([3,3]);[70,30].forEach(lv=>{ctx.beginPath();ctx.moveTo(0,rsiY+rsiH-lv/100*rsiH);ctx.lineTo(W,rsiY+rsiH-lv/100*rsiH);ctx.stroke()});ctx.setLineDash([]);
    ctx.fillStyle=cs.getPropertyValue('--t3').trim();ctx.font='7px Geist Mono';ctx.fillText('RSI',3,rsiY+9)}
}

/* ═══════ PORTFOLIO ═══════ */
const sP=()=>localStorage.setItem('nxp6',JSON.stringify(portfolio));
function addPort(){const sym=document.getElementById('aSym').value.toUpperCase().trim(),amt=+document.getElementById('aAmt').value,pr=+document.getElementById('aPr').value;if(!sym||!amt)return;portfolio.push({sym,amt,bp:pr});sP();closeMo('addMo');renderPort()}
function rmPort(i){portfolio.splice(i,1);sP();renderPort()}
function renderPort(){let tV=0,tC=0;portfolio.forEach(p=>{const t=T[p.sym];if(t){tV+=t.p*p.amt;tC+=p.bp*p.amt}});const pnl=tC>0?((tV-tC)/tC*100):0;document.getElementById('pVal').textContent=tV>0?fmt(tV):'$0';const pE=document.getElementById('pCh');if(tC>0){pE.textContent=`${pnl>=0?'+':''}${pnl.toFixed(2)}% (${fmt(tV-tC)})`;pE.style.color=pnl>=0?'var(--up)':'var(--dn)'}else{pE.textContent='أضف عملات';pE.style.color='var(--t3)'}
  document.getElementById('pList').innerHTML=portfolio.length?portfolio.map((p,i)=>{const t=T[p.sym],cp=t?t.p:0,v=cp*p.amt,pnl=p.bp>0?((cp-p.bp)/p.bp*100):0;const bg=COL[p.sym]||'#444';return`<div class="port-i"><div style="display:flex;align-items:center;gap:8px"><div class="cr-ic" style="background:${bg}0a;color:${bg};border:1px solid ${bg}22;width:26px;height:26px;font-size:9px">${p.sym.slice(0,2)}</div><div><div class="cr-n">${p.sym}</div><div class="cr-sub">${p.amt} × ${fP(cp)}</div></div></div><div style="text-align:left"><div class="cr-p">${fmt(v)}</div><div style="font-family:var(--fm);font-size:9px;font-weight:700;color:${pnl>=0?'var(--up)':'var(--dn)'}">${p.bp>0?`${pnl>=0?'+':''}${pnl.toFixed(1)}%`:'--'}</div><div style="font-size:7px;color:var(--t3);cursor:pointer" onclick="rmPort(${i})">🗑</div></div></div>`}).join(''):'<div class="empty"><div class="empty-ic">💼</div><div class="empty-tx">فارغة</div></div>'}

/* ═══════ RISK CALCULATOR ═══════ */
function calcRisk(){const cap=+document.getElementById('rcCap').value,risk=+document.getElementById('rcRisk').value,entry=+document.getElementById('rcEntry').value,sl=+document.getElementById('rcSL').value,tp=+document.getElementById('rcTP').value;
  if(!cap||!entry||!sl){document.getElementById('rcRes').innerHTML='<div style="text-align:center;color:var(--t3);padding:12px;font-size:11px">ادخل البيانات</div>';return}
  const rAmt=cap*(risk/100),slD=Math.abs(entry-sl),pos=slD>0?rAmt/slD:0,posV=pos*entry,tpD=tp?Math.abs(tp-entry):0,rew=tp?pos*tpD:0,rr=tp&&rAmt>0?rew/rAmt:0,lev=cap>0?posV/cap:0;
  document.getElementById('rcRes').innerHTML=`<div class="rc-row"><span>💰 مبلغ المخاطرة</span><span class="rc-val" style="color:var(--dn)">${fmt(rAmt)}</span></div><div class="rc-row"><span>📦 حجم الصفقة</span><span class="rc-val">${pos.toFixed(4)}</span></div><div class="rc-row"><span>💵 قيمة الصفقة</span><span class="rc-val">${fmt(posV)}</span></div><div class="rc-row"><span>📊 الرافعة</span><span class="rc-val" style="color:${lev>10?'var(--dn)':lev>5?'var(--warn)':'var(--up)'}">${lev.toFixed(1)}x</span></div>${tp?`<div class="rc-row"><span>🎯 الربح المتوقع</span><span class="rc-val" style="color:var(--up)">${fmt(rew)}</span></div><div class="rc-row"><span>⚖️ Risk/Reward</span><span class="rc-val" style="color:${rr>=2?'var(--up)':rr>=1?'var(--warn)':'var(--dn)'}">1:${rr.toFixed(1)}</span></div>`:''}<div class="rc-row"><span>🛑 خسارة SL</span><span class="rc-val" style="color:var(--dn)">-${fmt(rAmt)}</span></div>`}

/* ═══════ INIT ═══════ */
async function init(){await loadDash();renderPort();setInterval(async()=>{if(!ws||ws.readyState!==1)await loadTk();await loadFutures()},120000)}
init();
