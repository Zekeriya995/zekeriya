/* NEXUS PRO V10 — Early Detection + Sound Alerts + Smart Cache + 6 Checks */
const tg=window.Telegram?.WebApp;if(tg){tg.ready();tg.expand();tg.setHeaderColor('#060b14');tg.setBackgroundColor('#020408')}
const BN='https://api.binance.com/api/v3',BF='https://fapi.binance.com/fapi/v1',CG='https://api.coingecko.com/api/v3',CB='https://api.coinbase.com/v2';
const WL=['BTC','ETH','SOL','BNB','XRP','LINK','AVAX','DOGE','ADA','DOT','MATIC','UNI','ATOM','ARB','OP','INJ','SUI','SEI','TIA','FTM','NEAR','APT','LTC','PEPE','WIF'];
const COL={BTC:'#f7931a',ETH:'#627eea',SOL:'#9945ff',BNB:'#f0b90b',XRP:'#23292f',LINK:'#2a5ada',AVAX:'#e84142',DOGE:'#c2a633',ADA:'#0033ad',DOT:'#e6007a',MATIC:'#8247e5',UNI:'#ff007a',ATOM:'#2e3148',ARB:'#28a0f0',OP:'#ff0420',INJ:'#00f2fe',SUI:'#4da2ff',SEI:'#9b1c1c',TIA:'#7c3aed',FTM:'#1969ff',NEAR:'#00c08b',APT:'#00bfa6',LTC:'#bfbbbb',PEPE:'#4c8c2f',WIF:'#8b5cf6'};
let T={},FR={},OI={},LS={},CBP={},ws=null,curCoin='BTC',curTF='1h',inds={vol:1,sma:0,rsi:0,sr:0};
let sparkHist={}; /* Real sparkline data per coin */
let whaleWaves=JSON.parse(localStorage.getItem('nxww10')||'{}'); /* Whale wave tracking */
let prevOB={}; /* Previous Order Book snapshots */
let portfolio=JSON.parse(localStorage.getItem('nxp10')||'[]');
let predictions=JSON.parse(localStorage.getItem('nxpred10')||'[]');
let sigHist=JSON.parse(localStorage.getItem('nxsig10')||'{}');
let notifiedSet=JSON.parse(localStorage.getItem('nxnot10')||'{}');
let lang=localStorage.getItem('nxlang')||'ar';
let fgValue=50,btcDom=50;
/* CACHE */
let cache={scan:null,scanTime:0,whale:null,whaleTime:0,fr:null,frTime:0};
const CACHE_TTL=60000;
const TR={nav_home:{ar:'الرئيسية',en:'Home'},nav_scan:{ar:'السكانر',en:'Scanner'},nav_whale:{ar:'حيتان',en:'Whales'},nav_ind:{ar:'مؤشرات',en:'Indicators'},nav_me:{ar:'حسابي',en:'Profile'},breakout:{ar:'على وشك الانفجار',en:'About to Breakout'},whales:{ar:'شراء حيتان',en:'Whale Buying'},scanning:{ar:'جاري المسح...',en:'Scanning...'},all:{ar:'الكل',en:'All'},full_scan:{ar:'مسح شامل',en:'Full Scan'},refresh:{ar:'تحديث',en:'Refresh'},total:{ar:'إجمالي',en:'Total'},buying:{ar:'شراء',en:'Buying'},selling:{ar:'بيع',en:'Selling'},success:{ar:'النجاح',en:'Success'},portfolio:{ar:'المحفظة',en:'Portfolio'},risk_calc:{ar:'حاسبة المخاطر',en:'Risk Calc'},alerts:{ar:'تنبيهات',en:'Alerts'},add_coins:{ar:'أضف عملات',en:'Add coins'},add_coin:{ar:'إضافة عملة',en:'Add Coin'},add:{ar:'إضافة',en:'Add'},cancel:{ar:'إلغاء',en:'Cancel'},back:{ar:'رجوع',en:'Back'},capital:{ar:'رأس المال',en:'Capital'},risk_pct:{ar:'المخاطرة',en:'Risk'},entry_price:{ar:'سعر الدخول',en:'Entry'},enter_data:{ar:'ادخل البيانات',en:'Enter data'},search_ph:{ar:'ابحث عن أي عملة...',en:'Search any coin...'},no_ultra:{ar:'لا ULTRA حالياً',en:'No ULTRA'},no_whale:{ar:'لا تجميع حيتان',en:'No whales'},confirmed:{ar:'مؤكدة',en:'Confirmed'},buy_strong:{ar:'شراء قوي',en:'Strong Buy'},buy:{ar:'شراء',en:'Buy'},sell:{ar:'بيع',en:'Sell'},hold:{ar:'انتظار',en:'Hold'},risk_amt:{ar:'💰 المخاطرة',en:'💰 Risk'},pos_size:{ar:'📦 الحجم',en:'📦 Size'},pos_val:{ar:'💵 القيمة',en:'💵 Value'},leverage:{ar:'📊 الرافعة',en:'📊 Leverage'},exp_profit:{ar:'🎯 الربح',en:'🎯 Profit'},sl_loss:{ar:'🛑 الخسارة',en:'🛑 Loss'},no_data:{ar:'لا بيانات',en:'No data'},empty_port:{ar:'فارغة',en:'Empty'},market_health:{ar:'🏥 صحة السوق',en:'🏥 Market Health'},smart_warn:{ar:'تحذيرات ذكية',en:'Smart Warnings'},sec_accuracy:{ar:'📈 نسبة النجاح',en:'📈 Accuracy'},scan_desc:{ar:'صيد مبكر — 6 فحوصات — 500+ عملة','en':'Early detection — 6 checks — 500+ coins'},days:{ar:'يوم',en:'days'},today:{ar:'اليوم!',en:'Today!'},instant:{ar:'فوري',en:'Instant'},strong_signal:{ar:'شراء/بيع قوي',en:'Strong signal'},before_unlock:{ar:'قبل الفك',en:'Before unlock'},gems:{ar:'جواهر',en:'Gems'},gem_desc:{ar:'💎 عملات صغيرة بحركة غير عادية — فرص أرباح كبيرة',en:'💎 Small caps with unusual moves — big profit potential'},wl_desc:{ar:'👁 أضف عملات لمراقبتها 24/7',en:'👁 Add coins to watch 24/7'},stable_flow:{ar:'تدفق العملات المستقرة',en:'Stablecoin Flow'},sf_index:{ar:'مؤشر التدفق',en:'Flow Index'},sf_buy:{ar:'شراء كريبتو',en:'Buying Crypto'},sf_sell:{ar:'بيع كريبتو',en:'Selling Crypto'},sf_neutral:{ar:'متوازن',en:'Balanced'},online:{ar:'متصل',en:'online'},settings:{ar:'الإعدادات',en:'Settings'},profile:{ar:'👤 الملف الشخصي',en:'👤 Profile'},general:{ar:'⚙️ عام',en:'⚙️ General'},language:{ar:'اللغة',en:'Language'},theme:{ar:'الثيم',en:'Theme'},sound:{ar:'الصوت',en:'Sound'},tone:{ar:'🔔 نغمة الإشعار',en:'🔔 Notification Tone'},t_bell:{ar:'جرس',en:'Bell'},t_horn:{ar:'بوق',en:'Horn'},t_pulse:{ar:'نبض',en:'Pulse'},t_silent:{ar:'صامت',en:'Silent'},about:{ar:'عن المنصة',en:'About'},clear_data:{ar:'مسح البيانات',en:'Clear Data'},mkt_dir:{ar:'اتجاه السوق',en:'Market Direction'},mkt_dir_sub:{ar:'تقرير مفصل — BTC & ETH — كل 4 ساعات',en:'Detailed Report — BTC & ETH — Every 4h'},nav_market:{ar:'حركة السوق',en:'Market'},top3:{ar:'أفضل 3 فرص الآن',en:'Top 3 Opportunities Now'}};
const t=k=>TR[k]?TR[k][lang]:(k||'');
const fmt=n=>{if(n>=1e9)return'$'+(n/1e9).toFixed(1)+'B';if(n>=1e6)return'$'+(n/1e6).toFixed(1)+'M';if(n>=1e3)return'$'+(n/1e3).toFixed(1)+'K';return'$'+n.toFixed(0)};
const fP=p=>{if(!p||isNaN(p))return'$0';if(p>=1e3)return'$'+p.toLocaleString('en',{maximumFractionDigits:2});if(p>=1)return'$'+p.toFixed(2);if(p>=.01)return'$'+p.toFixed(4);return'$'+p.toFixed(6)};
const safeC=c=>{return(c&&!isNaN(c))?c:0}; /* NaN-safe change % */
const fj=async u=>{try{var c=new AbortController();var tm=setTimeout(function(){c.abort()},8000);var r=await fetch(u,{signal:c.signal});clearTimeout(tm);if(!r.ok)throw 0;return r.json()}catch(e){return null}};
function calcRSI(c,p){p=p||14;if(c.length<p+1)return 50;var g=0,l=0;for(var i=c.length-p;i<c.length;i++){var d=c[i]-c[i-1];if(d>0)g+=d;else l+=Math.abs(d)}return 100-100/(1+g/Math.max(l,.001))}
function calcMACD(c){if(c.length<26)return{h:0,signal:0,cross:'none'};var ema=function(d,p){var k=2/(p+1),e=d[0];for(var i=1;i<d.length;i++)e=d[i]*k+e*(1-k);return e};var macdLine=ema(c.slice(-12),12)-ema(c,26);var macdHist=[];for(var i=26;i<=c.length;i++){macdHist.push(ema(c.slice(i-12,i),12)-ema(c.slice(0,i),26))}var signal=macdHist.length>=9?ema(macdHist.slice(-9),9):macdLine;var prev=macdHist.length>=2?macdHist[macdHist.length-2]:0;var cross=macdLine>signal&&prev<=signal?'bull':macdLine<signal&&prev>=signal?'bear':'none';return{h:macdLine,signal:signal,cross:cross}}
function timeAgo(ts){var d=Date.now()-ts,m=Math.floor(d/60000),h=Math.floor(d/3600000);if(m<2)return{text:lang==='ar'?'🆕 الآن':'🆕 Now',cls:'fresh'};if(m<60)return{text:lang==='ar'?'منذ '+m+' دقيقة':m+'m ago',cls:'fresh'};return{text:lang==='ar'?'منذ '+h+' ساعة':h+'h ago',cls:h<6?'':'old'}}
function timeBadge(ts){var a=timeAgo(ts);return'<span class="time-badge '+a.cls+'">⏱ '+a.text+'</span>'}
function recSig(sym,type){var k=sym+'_'+type;if(!sigHist[k])sigHist[k]=Date.now();localStorage.setItem('nxsig10',JSON.stringify(sigHist));return sigHist[k]}
function getSigTime(sym,type){return sigHist[sym+'_'+type]||Date.now()}
/* NOTIFICATION HISTORY */
var notifHist=JSON.parse(localStorage.getItem('nxnh10')||'[]');
function addNotifHist(icon,sym,type,body){notifHist.unshift({icon:icon,sym:sym,type:type,body:body,time:Date.now()});if(notifHist.length>50)notifHist=notifHist.slice(0,50);localStorage.setItem('nxnh10',JSON.stringify(notifHist))}
function renderNotifHist(){var el=document.getElementById('notifHistList');if(!el)return;el.innerHTML=notifHist.length?notifHist.slice(0,20).map(function(n){return'<div class="al-i" style="cursor:pointer" onclick="openCoin(\''+n.sym+'\')"><div class="al-l"><div style="font-size:18px">'+n.icon+'</div><div><div style="font-weight:600;font-size:11px">'+n.sym+' — '+n.type+'</div><div style="font-size:8px;color:var(--t3)">'+n.body+'</div></div></div><div style="font-size:8px;font-family:var(--fm);color:var(--t2)">'+timeBadge(n.time)+'</div></div>'}).join(''):'<div class="empty"><div class="empty-ic">🔔</div><div class="empty-tx">'+(lang==='ar'?'لا إشعارات':'No notifications')+'</div></div>'}
/* WATCHLIST ALERTS — check every update */
function checkWatchlistAlerts(){var wl=JSON.parse(localStorage.getItem('nxwl10')||'[]');wl.forEach(function(sym){var d=T[sym];if(!d)return;if(d.c>=5){var k='wl_'+sym+'_'+new Date().getHours();if(!notifiedSet[k]){notifiedSet[k]=true;localStorage.setItem('nxnot10',JSON.stringify(notifiedSet));playSound('whale');showPopup('👁',sym+' — '+(lang==='ar'?'عملة مراقبة تحركت!':'Watchlist coin moved!'),'+'+d.c.toFixed(1)+'% | '+fP(d.p));addNotifHist('👁',sym,'Watchlist','+'+d.c.toFixed(1)+'%')}}if(d.c<=-5){var k='wl_dn_'+sym+'_'+new Date().getHours();if(!notifiedSet[k]){notifiedSet[k]=true;localStorage.setItem('nxnot10',JSON.stringify(notifiedSet));playSound('whale');showPopup('⚠️',sym+' — '+(lang==='ar'?'عملة مراقبة هبطت!':'Watchlist coin dropped!'),d.c.toFixed(1)+'% | '+fP(d.p));addNotifHist('⚠️',sym,'Watchlist Drop',d.c.toFixed(1)+'%')}}})}
/* SOUND NOTIFICATIONS — respects user tone preference */
function playSound(type){if(!soundEnabled||soundPref==='silent')return;previewTone(soundPref)}
/* 📲 TELEGRAM GROUP NOTIFICATIONS */
var TG_BOT='8646467680:AAG1Pdy4lqIgIkXFTOV78rocgZ-rXsrFoZg';
var TG_CHAT='-1002485331567';
var tgSent={};
function sendTG(html){try{fetch('https://api.telegram.org/bot'+TG_BOT+'/sendMessage',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:TG_CHAT,text:html,parse_mode:'HTML',disable_web_page_preview:true})})}catch(e){}}
function tgNotify(sym,type,data){
  /* Dedup: same coin+type per hour */
  var k=sym+'_'+type+'_'+new Date().getHours();if(tgSent[k])return;tgSent[k]=true;
  var d=T[sym]||{p:0,c:0,v:0};var fr=FR[sym];var waves=whaleWaves[sym]?whaleWaves[sym].waves:[];
  var src=[];if(T[sym])src.push('Binance');if(d.by)src.push('Bybit');if(CBP[sym])src.push('Coinbase');
  var msg='';
  if(type==='ultra'){
    var checks=data.checks||{};var passed=data.passed||0;var total=data.total||6;
    msg='⭐ <b>ULTRA SIGNAL — '+sym+'/USDT</b>\n\n'
      +'📊 Score: <b>'+data.score+'</b> | '+passed+'/'+total+' Checks ✅\n'
      +'💰 <b>'+fP(d.p)+'</b> ('+(d.c>=0?'+':'')+d.c.toFixed(1)+'%)\n'
      +'📈 Vol: <b>'+fmt(d.v)+'</b>\n\n'
      +'✅ VOL '+(checks.vol?'✅':'❌')+' │ OB '+(checks.ob?'✅':'❌')+'\n'
      +'✅ RSI '+(checks.rsi?'✅':'❌')+' │ MACD '+(checks.macd?'✅':'❌')+'\n'
      +'✅ FR '+(checks.fr?'✅':'❌')+' │ OI '+(checks.oi?'✅':'❌')+'\n\n'
      +'🎯 هدف: <b>'+fP(d.p*1.08)+' — '+fP(d.p*1.15)+'</b>\n'
      +'🛑 وقف: <b>'+fP(d.p*0.93)+'</b>\n'
      +(waves.length>=2?'\n🐋 '+waves.length+' موجات حيتان | ⚡ تجميع قوي\n':'')
      +(fr?'\n💰 FR: '+(fr.rate>=0?'+':'')+fr.rate.toFixed(4)+'%\n':'')
      +'\n📍 '+src.join(' · ')+'\n'
      +'━━━━━━━━━━━━━━━━━\n'
      +'🤖 <b>NEXUS PRO</b> | ⏱ '+new Date().toLocaleTimeString('en',{hour:'2-digit',minute:'2-digit'})}
  else if(type==='whale'){
    var waveCount=waves.length;
    msg='🐋 <b>'+(waveCount>=3?'🐋🐋🐋':'🐋')+' تجميع حيتان — '+sym+'/USDT</b>\n\n'
      +'💰 <b>'+fP(d.p)+'</b> ('+(d.c>=0?'+':'')+d.c.toFixed(1)+'%)\n'
      +'📈 Vol: '+fmt(d.v)+'\n';
    if(waveCount>0){
      msg+='\n📊 <b>'+waveCount+' موجات تجميع:</b>\n';
      waves.forEach(function(w,i){
        msg+='🐋 #'+(i+1)+' | '+fmt(w.amount)+' | '+fP(w.price)+'\n'});
      var tot=waves.reduce(function(s,w){return s+w.amount},0);
      msg+='\n💎 إجمالي: <b>'+fmt(tot)+'</b>\n'}
    msg+='\n📍 '+src.join(' · ')+'\n'
      +'━━━━━━━━━━━━━━━━━\n'
      +'🤖 <b>NEXUS PRO</b> | ⏱ '+new Date().toLocaleTimeString('en',{hour:'2-digit',minute:'2-digit'})}
  else if(type==='gem'){
    msg='💎 <b>جوهرة مكتشفة — '+sym+'/USDT</b>\n\n'
      +'💰 <b>'+fP(d.p)+'</b> ('+(d.c>=0?'+':'')+d.c.toFixed(1)+'%)\n'
      +'📈 Vol: '+fmt(d.v)+'\n'
      +(d.c<3?'\n🟢 <b>صيد مبكر — ادخل!</b>\n':d.c<8?'\n🟡 لسا فيه فرصة\n':'\n🔴 متأخر — راقب فقط\n')
      +'\n📍 '+src.join(' · ')+'\n'
      +'━━━━━━━━━━━━━━━━━\n'
      +'🤖 <b>NEXUS PRO</b> | ⏱ '+new Date().toLocaleTimeString('en',{hour:'2-digit',minute:'2-digit'})}
  if(msg)sendTG(msg)}
/* ON-SCREEN POPUP NOTIFICATION */
function showPopup(icon,title,body){var el=document.getElementById('notifPopup');document.getElementById('npIcon').textContent=icon;document.getElementById('npTitle').textContent=title;document.getElementById('npBody').textContent=body;document.getElementById('npTime').textContent='🆕';el.style.top='12px';setTimeout(function(){el.style.top='-80px'},4000)}
function notify(sym,type,score,extra){var k=sym+'_'+type+'_'+new Date().getHours();if(notifiedSet[k])return;notifiedSet[k]=true;localStorage.setItem('nxnot10',JSON.stringify(notifiedSet));playSound(type);
  if(type==='ultra'){showPopup('⭐',sym+' — ULTRA Signal!','Score: '+score+' | '+(lang==='ar'?'ادخل الآن!':'Enter now!'));addNotifHist('⭐',sym,'ULTRA','Score: '+score);tgNotify(sym,'ultra',extra||{score:score})}
  else if(type==='whale'){showPopup('🐋',sym+' — '+(lang==='ar'?'تجميع حيتان!':'Whale detected!'),(lang==='ar'?'نشاط غير عادي':'Unusual activity'));addNotifHist('🐋',sym,lang==='ar'?'حوت':'Whale',fP(T[sym]?T[sym].p:0));tgNotify(sym,'whale',{})}
  else if(type==='gem'){showPopup('💎',sym+' — '+(lang==='ar'?'جوهرة مكتشفة!':'Gem found!'),(lang==='ar'?'عملة صغيرة بحركة قوية':'Small cap with strong move'));addNotifHist('💎',sym,lang==='ar'?'جوهرة':'Gem','+'+(T[sym]?T[sym].c.toFixed(1):0)+'%');tgNotify(sym,'gem',{})}}
/* LANG/THEME/NAV */
function togLang(){lang=lang==='ar'?'en':'ar';localStorage.setItem('nxlang',lang);document.documentElement.lang=lang;document.documentElement.dir=lang==='ar'?'rtl':'ltr';document.body.dataset.lang=lang;document.getElementById('sInp').placeholder=t('search_ph');document.querySelectorAll('[data-t]').forEach(function(el){var k=el.dataset.t;if(TR[k])el.textContent=TR[k][lang]});updateMenuLang()}
function togTh(){var d=document.body.dataset.theme==='dark'?'light':'dark';document.body.dataset.theme=d;if(tg){tg.setHeaderColor(d==='dark'?'#060b14':'#f7f9fc');tg.setBackgroundColor(d==='dark'?'#020408':'#f0f4f8')}localStorage.setItem('nxt10',d);updateMenuTheme()}
/* SIDEBAR MENU */
function toggleMenu(){document.getElementById('sideMenu').classList.toggle('open');document.getElementById('sideOverlay').classList.toggle('open')}
/* PROFILE */
var userProfile=JSON.parse(localStorage.getItem('nxprof10')||'{}');
function loadProfile(){if(userProfile.name)document.getElementById('userName').value=userProfile.name;if(userProfile.nick)document.getElementById('userNick').value=userProfile.nick;var av=document.getElementById('sideAvatar');if(userProfile.name)av.textContent=userProfile.name.charAt(0).toUpperCase();else av.textContent='👤'}
function saveProfile(){userProfile.name=document.getElementById('userName').value;userProfile.nick=document.getElementById('userNick').value;localStorage.setItem('nxprof10',JSON.stringify(userProfile));var av=document.getElementById('sideAvatar');if(userProfile.name)av.textContent=userProfile.name.charAt(0).toUpperCase()}
/* MENU STATE SYNC */
function updateMenuLang(){var isAr=lang==='ar';document.getElementById('sLangAr').classList.toggle('act',isAr);document.getElementById('sLangEn').classList.toggle('act',!isAr)}
function updateMenuTheme(){var isDark=document.body.dataset.theme==='dark';document.getElementById('sThDark').classList.toggle('act',isDark);document.getElementById('sThLight').classList.toggle('act',!isDark)}
/* SOUND PREFERENCES */
var soundPref=localStorage.getItem('nxsnd10')||'bell';
var soundEnabled=localStorage.getItem('nxsndon10')!=='off';
function saveSoundPref(){soundEnabled=document.getElementById('tglSound').classList.contains('on');localStorage.setItem('nxsndon10',soundEnabled?'on':'off')}
function selTone(el){document.querySelectorAll('.tone-opt').forEach(function(o){o.classList.remove('act')});el.classList.add('act');soundPref=el.dataset.tone;localStorage.setItem('nxsnd10',soundPref);previewTone(soundPref)}
function previewTone(tone){if(tone==='silent')return;try{var ac=new(window.AudioContext||window.webkitAudioContext)();var osc=ac.createOscillator();var gain=ac.createGain();osc.connect(gain);gain.connect(ac.destination);
  if(tone==='bell'){osc.frequency.value=880;osc.type='sine';gain.gain.value=0.3;osc.start();osc.stop(ac.currentTime+0.15);setTimeout(function(){var o2=ac.createOscillator();var g2=ac.createGain();o2.connect(g2);g2.connect(ac.destination);g2.gain.value=0.3;o2.frequency.value=1100;o2.type='sine';o2.start();o2.stop(ac.currentTime+0.15)},180)}
  else if(tone==='horn'){osc.frequency.value=440;osc.type='sawtooth';gain.gain.value=0.35;osc.start();osc.stop(ac.currentTime+0.4)}
  else if(tone==='pulse'){osc.frequency.value=1000;osc.type='square';gain.gain.value=0.2;osc.start();osc.stop(ac.currentTime+0.08);setTimeout(function(){var o2=ac.createOscillator();var g2=ac.createGain();o2.connect(g2);g2.connect(ac.destination);g2.gain.value=0.2;o2.frequency.value=1000;o2.type='square';o2.start();o2.stop(ac.currentTime+0.08)},120);setTimeout(function(){var o3=ac.createOscillator();var g3=ac.createGain();o3.connect(g3);g3.connect(ac.destination);g3.gain.value=0.2;o3.frequency.value=1200;o3.type='square';o3.start();o3.stop(ac.currentTime+0.12)},240)}
  }catch(e){}}
function loadToneUI(){var opts=document.querySelectorAll('.tone-opt');opts.forEach(function(o){o.classList.remove('act');if(o.dataset.tone===soundPref)o.classList.add('act')});if(!soundEnabled)document.getElementById('tglSound').classList.remove('on')}
/* Active users removed */
(function(){if(localStorage.getItem('nxt10')==='light'){document.body.dataset.theme='light'};if(lang==='en')togLang()})();
document.querySelectorAll('.bb').forEach(function(b){b.onclick=function(){sp(b.dataset.p)}});
function sp(id){document.querySelectorAll('.pg').forEach(function(p){p.classList.remove('act')});document.querySelectorAll('.bb').forEach(function(b){b.classList.remove('act')});var el=document.getElementById('pg-'+id);if(el)el.classList.add('act');document.querySelectorAll('[data-p="'+id+'"]').forEach(function(b){b.classList.add('act')});if(id==='scan')runScan();if(id==='whale')loadWhales();if(id==='ind')loadInd();if(id==='me')renderPort();if(id==='market')loadMarket();window.scrollTo({top:0})}
function openMo(id){document.getElementById(id).classList.add('show')}
function closeMo(id){document.getElementById(id).classList.remove('show')}
document.querySelectorAll('.mo').forEach(function(m){m.onclick=function(e){if(e.target===m)m.classList.remove('show')}});
function indTab(i,btn){document.getElementById('pg-ind').querySelectorAll('.tab').forEach(function(b){b.classList.remove('act')});btn.classList.add('act');['ind0','ind1','ind2','ind3','ind4'].forEach(function(id,j){document.getElementById(id).style.display=j===i?'block':'none'});if(i===0)loadFR();if(i===1)loadOI();if(i===2)loadCor();if(i===3)loadHM();if(i===4)renderWL()}
function whTab(i,btn){document.getElementById('pg-whale').querySelectorAll('.tab').forEach(function(b){b.classList.remove('act')});btn.classList.add('act');['wh0','wh1','wh2'].forEach(function(id,j){document.getElementById(id).style.display=j===i?'block':'none'});if(i===0)loadWhales();if(i===1)loadLiq();if(i===2)loadGems()}
function pTab(i,btn){document.getElementById('pg-me').querySelectorAll('.tab').forEach(function(b){b.classList.remove('act')});btn.classList.add('act');['p0','p1','p2','p3'].forEach(function(id,j){document.getElementById(id).style.display=j===i?'block':'none'});if(i===3)renderNotifHist()}
function sf(btn){btn.parentElement.querySelectorAll('.flt-b').forEach(function(b){b.classList.remove('act')});btn.classList.add('act');runScan()}
function onSrch(v){var el=document.getElementById('sRes');if(!v){el.classList.remove('show');return}v=v.toUpperCase();var m=Object.entries(T).filter(function(e){return e[0].includes(v)}).slice(0,8);if(!m.length){el.classList.remove('show');return}el.innerHTML=m.map(function(e){var s=e[0],d=e[1];return'<div class="sr-i" onclick="openCoin(\''+s+'\')"><span style="font-weight:700">'+s+'</span><span style="font-family:var(--fm);font-size:10px">'+fP(d.p)+' <span class="cr-ch '+(d.c>=0?'up':'dn')+'">'+(d.c>=0?'+':'')+d.c.toFixed(1)+'%</span></span></div>'}).join('');el.classList.add('show')}
document.addEventListener('click',function(e){if(!e.target.closest('.srch'))document.getElementById('sRes').classList.remove('show')});
/* WS */
function initWS(){if(ws)ws.close();ws=new WebSocket('wss://stream.binance.com:9443/stream?streams='+WL.map(function(s){return s.toLowerCase()+'usdt@miniTicker'}).join('/'));ws.onmessage=function(e){var d=JSON.parse(e.data).data;if(!d)return;var s=d.s.replace('USDT','');var price=+d.c;var chg=+d.P;if(isNaN(chg))chg=0;T[s]=Object.assign(T[s]||{},{p:price,c:chg,v:+d.q,h:+d.h,l:+d.l,src:'BN'});if(!sparkHist[s])sparkHist[s]=[];sparkHist[s].push(price);if(sparkHist[s].length>12)sparkHist[s]=sparkHist[s].slice(-12)};ws.onclose=function(){setTimeout(initWS,3000)};ws.onerror=function(){ws.close()}}
/* LOAD TICKERS — ALL 3 EXCHANGES */
async function loadTk(){
  var bn=await fj(BN+'/ticker/24hr');if(bn)bn.filter(function(x){return x.symbol.endsWith('USDT')&&+x.quoteVolume>100000}).forEach(function(x){var s=x.symbol.replace('USDT','');var chg=+x.priceChangePercent;T[s]={p:+x.lastPrice,c:isNaN(chg)?0:chg,v:+x.quoteVolume,h:+x.highPrice,l:+x.lowPrice,src:'BN'}});
  try{var by=await fj('https://api.bybit.com/v5/market/tickers?category=spot');if(by&&by.result&&by.result.list)by.result.list.filter(function(x){return x.symbol.endsWith('USDT')}).forEach(function(x){var s=x.symbol.replace('USDT','');if(!T[s])T[s]={p:+x.lastPrice,c:+x.price24hPcnt*100,v:+x.turnover24h,h:+x.highPrice24h,l:+x.lowPrice24h,src:'BY'};else T[s].by=+x.lastPrice})}catch(e){}
  try{var cbR=await fj(CB+'/exchange-rates?currency=USD');if(cbR&&cbR.data&&cbR.data.rates){var rates=cbR.data.rates;Object.keys(rates).forEach(function(c){var r=+rates[c];if(r>0){var cbPrice=1/r;/* Validate: if Binance has this coin, check price is within 50% */var bnPrice=T[c]?T[c].p:0;if(bnPrice>0){var diff=Math.abs(cbPrice-bnPrice)/bnPrice;if(diff<0.5)CBP[c]=cbPrice}else{CBP[c]=cbPrice}}})}}catch(e){}
  var el=document.getElementById('tkrEl');var items=WL.filter(function(s){return T[s]}).slice(0,16);var h='';for(var r=0;r<2;r++)items.forEach(function(s){var d=T[s],up=d.c>=0;h+='<div class="tkr-i"><span class="tkr-sym">'+s+'</span><span style="font-family:var(--fm);font-size:9px;color:var(--t2)">'+fP(d.p)+'</span><div class="spark">'+mkSpark(s)+'</div><span class="tkr-c '+(up?'up':'dn')+'">'+(up?'+':'')+d.c.toFixed(1)+'%</span></div>'});el.innerHTML=h}
async function loadFutures(){
  var fd=await fj(BF+'/premiumIndex');if(fd)fd.filter(function(d){return d.symbol.endsWith('USDT')}).forEach(function(d){var s=d.symbol.replace('USDT','');FR[s]={rate:+d.lastFundingRate*100,mark:+d.markPrice}});if(FR.BTC)document.getElementById('pFR').textContent=(FR.BTC.rate>=0?'+':'')+FR.BTC.rate.toFixed(4)+'%';
  var p1=WL.slice(0,8).map(function(s){return fj(BF+'/openInterest?symbol='+s+'USDT').then(function(d){if(d)OI[s]=(+d.openInterest)*(T[s]?T[s].p:0)}).catch(function(){})});
  var p2=WL.slice(0,6).map(function(s){return fj(BF+'/topLongShortPositionRatio?symbol='+s+'USDT&period=1h&limit=1').then(function(d){if(d&&d[0])LS[s]={long:+d[0].longAccount*100,short:+d[0].shortAccount*100,ratio:+d[0].longShortRatio}}).catch(function(){})});
  await Promise.all(p1.concat(p2));
  if(!Object.keys(LS).length)WL.slice(0,6).forEach(function(s){var fr=FR[s];if(fr){var b=fr.rate>0?55+Math.min(20,fr.rate*200):45-Math.min(15,Math.abs(fr.rate)*200);LS[s]={long:Math.round(b),short:Math.round(100-b),ratio:+(b/(100-b)).toFixed(2)}}});}
/* ═══ EARLY DETECTION SCANNER — catches coins BEFORE they pump ═══ */
function quickScan(){var cands=[];Object.entries(T).forEach(function(e){var s=e[0],d=e[1];
  /* Smart volume filter: lower threshold for small coins with momentum */
  var minVol=200000;
  if(d.p<0.1&&d.c>=3)minVol=50000;  /* Micro caps moving = lower bar */
  else if(d.p<1&&d.c>=2)minVol=100000; /* Small caps with momentum */
  if(d.v<minVol)return;
  var sc=0,tags=[];
  /* EARLY DETECTION: low change + high volume = accumulation before pump */
  if(d.c>=0.5&&d.c<3&&d.v>5e7){sc+=25;tags.push('🔍EARLY')}
  if(d.c>=0.5&&d.c<5&&d.v>1e8){sc+=20;tags.push('🔍STEALTH')}
  /* Already moving but still early */
  if(d.c>=3&&d.c<8){sc+=22;tags.push('📈RISING')}
  if(d.c>=8&&d.c<15){sc+=18;tags.push('⚡SURGE')}
  if(d.c>=15){sc+=10;tags.push('🚀LATE')} /* late = lower score */
  /* Volume anomaly = most important signal */
  if(d.v>1e9){sc+=25;tags.push('🔥MEGA_VOL')}
  else if(d.v>1e8){sc+=18;tags.push('📊HIGH_VOL')}
  else if(d.v>5e7){sc+=10;tags.push('📊VOL')}
  /* Near resistance with volume = breakout imminent */
  if(d.h>0&&d.p>0&&((d.h-d.p)/d.p)*100<1.5){sc+=12;tags.push('🎯AT_HIGH')}
  /* FR opportunity */
  var fr=FR[s];if(fr){if(fr.rate<-0.02){sc+=8;tags.push('FR⬇️')}else if(fr.rate>0.08){sc-=8;tags.push('FR⚠️')}}
  /* Accumulation pattern */
  if(Math.abs(d.c)<2&&d.v>8e7){sc+=20;tags.push('🐋ACC')}
  /* Bottom buying */
  if(d.h&&d.l&&d.h!==d.l&&((d.p-d.l)/(d.h-d.l))*100<25&&d.v>1e7){sc+=10;tags.push('📉BOTTOM')}
  if(sc>=15)cands.push({s:s,p:d.p,c:d.c,v:d.v,score:sc,tags:tags,fr:fr?fr.rate:null,by:d.by,cb:CBP[s]})});
  return cands.sort(function(a,b){return b.score-a.score})}
/* DEEP ANALYZE — 6 checks, parallel + Bybit fallback */
async function deepAnalyze(cands){var results=[];var top=cands.slice(0,30);
  var klData={},obData={};
  /* Parallel: Binance klines + OB */
  var klProms=top.slice(0,25).map(function(c){return fj(BN+'/klines?symbol='+c.s+'USDT&interval=1h&limit=30').then(function(d){klData[c.s]=d}).catch(function(){})});
  var obProms=top.slice(0,15).map(function(c){return fj(BN+'/depth?symbol='+c.s+'USDT&limit=10').then(function(d){obData[c.s]=d}).catch(function(){})});
  await Promise.all(klProms.concat(obProms));
  /* Bybit fallback: for coins without Binance klines */
  var byMissing=top.filter(function(c){return!klData[c.s]&&T[c.s]&&T[c.s].src==='BY'}).slice(0,10);
  if(byMissing.length){var byProms=byMissing.map(function(c){return fj('https://api.bybit.com/v5/market/kline?category=spot&symbol='+c.s+'USDT&interval=60&limit=30').then(function(d){if(d&&d.result&&d.result.list){klData[c.s]=d.result.list.reverse().map(function(k){return[+k[0],+k[1],+k[2],+k[3],+k[4],+k[5]]})}}).catch(function(){})});
    var byObProms=byMissing.map(function(c){return fj('https://api.bybit.com/v5/market/orderbook?category=spot&symbol='+c.s+'USDT&limit=10').then(function(d){if(d&&d.result){obData[c.s]={bids:(d.result.b||[]).map(function(x){return[x[0],x[1]]}),asks:(d.result.a||[]).map(function(x){return[x[0],x[1]]})}}}).catch(function(){})});
    await Promise.all(byProms.concat(byObProms))}
  for(var ci=0;ci<top.length;ci++){var c=top[ci];var ds=c.score,dt=c.tags.slice();
    var checks={vol:false,ob:false,rsi:false,macd:false,fr:false,oi:false};var passed=0;
    /* CHECK 1: Volume Spike 25% */
    var kl=klData[c.s];if(kl&&kl.length>=20){var vols=kl.map(function(k){return+k[5]});var closes=kl.map(function(k){return+k[4]});
      var avgVol=vols.slice(0,-3).reduce(function(a,b){return a+b},0)/Math.max(1,vols.length-3);var recentVol=(vols[vols.length-1]+vols[vols.length-2])/2;
      if(recentVol>avgVol*1.8){ds+=20;checks.vol=true;dt.push('VOL:'+Math.round(recentVol/avgVol*10)/10+'x')}
      else if(recentVol>avgVol*1.3){ds+=10;checks.vol=true;dt.push('VOL↑')}
      /* CHECK 3: RSI Zone 15% */
      var rsi=calcRSI(closes);if(rsi>=35&&rsi<=60){ds+=12;checks.rsi=true;dt.push('RSI:'+rsi.toFixed(0)+'✅')}
      else if(rsi<30){ds+=15;checks.rsi=true;dt.push('RSI:'+rsi.toFixed(0)+'🟢')}
      else if(rsi>70){ds-=5;dt.push('RSI:'+rsi.toFixed(0)+'⚠️')}
      /* CHECK 4: MACD Signal 15% */
      var macd=calcMACD(closes);if(macd.h>0){ds+=12;checks.macd=true;dt.push('MACD✅')}if(macd.cross==='bull'){ds+=5;dt.push('MACD🔀↑')}
    }
    /* CHECK 2: Order Book 20% */
    var ob=obData[c.s];if(ob){var bv=ob.bids.reduce(function(s,b){return s+ +b[0]* +b[1]},0);var av=ob.asks.reduce(function(s,a){return s+ +a[0]* +a[1]},0);var ratio=bv/Math.max(av,1);
      if(ratio>1.5){ds+=18;checks.ob=true;dt.push('OB:'+ratio.toFixed(1)+'x')}
      else if(ratio>1.2){ds+=10;checks.ob=true;dt.push('OB:'+ratio.toFixed(1)+'x')}}
    /* CHECK 5: Funding Rate 15% — negative FR first (best signal) */
    if(FR[c.s]){if(FR[c.s].rate<-0.02){ds+=15;checks.fr=true;dt.push('FR⬇️🟢')}
      else if(FR[c.s].rate<0.01){ds+=10;checks.fr=true;dt.push('FR✅')}}
    /* CHECK 6: OI Change 10% */
    if(OI[c.s]&&c.c>0){ds+=8;checks.oi=true;dt.push('OI↑')}
    passed=Object.values(checks).filter(Boolean).length;
    var isUltra=ds>=60&&passed>=4;var isConf=ds>=45&&passed>=3;
    /* Record signal + notify */
    if(isUltra){recSig(c.s,'ultra');notify(c.s,'ultra',ds,{score:ds,checks:checks,passed:passed,total:6})}
    if(c.tags.some(function(t){return t.includes('ACC')||t.includes('STEALTH')||t.includes('EARLY')})){recSig(c.s,'whale');if(c.v>5e7||checks.ob)notify(c.s,'whale',ds)}
    if(c.c>=3)recSig(c.s,'breakout');
    results.push({s:c.s,p:c.p,c:c.c,v:c.v,score:ds,tags:dt,checks:checks,passed:passed,total:6,ultra:isUltra,confirmed:isConf,fr:c.fr,by:c.by,cb:c.cb,detectedAt:getSigTime(c.s,isUltra?'ultra':'breakout')})}
  return results.sort(function(a,b){return b.score-a.score})}
/* MARKET HEALTH */
function calcHealth(){var sc=0,f=[];sc+=fgValue<25?5:fgValue<40?10:fgValue<60?15:fgValue<75?18:12;f.push({l:'Fear/Greed',v:fgValue,c:fgValue<30?'dn':fgValue>70?'up':'warn'});sc+=btcDom>60?8:btcDom>50?12:btcDom>40?15:10;f.push({l:'BTC Dom',v:btcDom.toFixed(1)+'%',c:btcDom>55?'warn':'neon'});var bk=Object.values(T).filter(function(x){return x.c>=8}).length;sc+=bk>20?15:bk>10?12:bk>5?10:5;f.push({l:lang==='ar'?'انفجارات':'Breakouts',v:bk,c:bk>15?'up':bk>5?'warn':'dn'});var rs=Object.values(T).filter(function(x){return x.c>0}).length,tt=Object.keys(T).length,bp=tt>0?Math.round(rs/tt*100):50;sc+=bp>60?15:bp>45?10:5;f.push({l:lang==='ar'?'صاعدة':'Bullish',v:bp+'%',c:bp>60?'up':bp>40?'warn':'dn'});var af=Object.values(FR).reduce(function(s,x){return s+x.rate},0)/Math.max(1,Object.keys(FR).length);sc+=af>0.05?5:af>0.02?10:af<-0.01?18:15;f.push({l:'Avg FR',v:(af>=0?'+':'')+af.toFixed(4)+'%',c:af>0.05?'dn':af<-0.01?'up':'warn'});var vc=Object.values(T).filter(function(x){return x.v>1e8}).length;sc+=vc>15?15:vc>8?10:5;f.push({l:'Vol>$100M',v:vc,c:vc>10?'up':'warn'});return{score:Math.min(100,sc),factors:f}}
function getWarnings(){var w=[];Object.entries(FR).filter(function(e){return WL.includes(e[0])}).forEach(function(e){if(e[1].rate>0.08)w.push({ic:'🔴',txt:e[0]+': FR '+e[1].rate.toFixed(3)+'% — '+(lang==='ar'?'خطر تصفية':'Liquidation risk')});if(e[1].rate<-0.05)w.push({ic:'🟢',txt:e[0]+': FR '+e[1].rate.toFixed(3)+'% — '+(lang==='ar'?'فرصة شراء':'Buy opportunity')})});Object.entries(LS).forEach(function(e){if(e[1].ratio>2)w.push({ic:'⚠️',txt:e[0]+': L/S '+e[1].ratio.toFixed(2)+' — '+(lang==='ar'?'Long مفرط':'Excessive Longs')});if(e[1].ratio<0.6)w.push({ic:'⚠️',txt:e[0]+': L/S '+e[1].ratio.toFixed(2)+' — Short Squeeze'})});return w.slice(0,4)}
/* ACCURACY */
function savePred(sym,p,tgt,sc){predictions.push({sym:sym,price:p,target:tgt,score:sc,time:Date.now(),checked:false,hit:false});if(predictions.length>100)predictions=predictions.slice(-100);localStorage.setItem('nxpred10',JSON.stringify(predictions))}
function getAcc(){var ch=false;predictions.forEach(function(p){if(!p.checked&&Date.now()-p.time>4*3600*1000){var cur=T[p.sym];if(cur){p.checked=true;p.hit=cur.p>=p.target*.95;ch=true}}});if(ch)localStorage.setItem('nxpred10',JSON.stringify(predictions));var c=predictions.filter(function(p){return p.checked});return{total:c.length,hits:c.filter(function(p){return p.hit}).length,rate:c.length>0?Math.round(c.filter(function(p){return p.hit}).length/c.length*100):0}}
function renderAcc(id){var a=getAcc();var el=document.getElementById(id);if(!el)return;
  var types={ultra:{h:0,t:0},whale:{h:0,t:0},brk:{h:0,t:0}};
  predictions.filter(function(p){return p.checked}).forEach(function(p){
    if(p.score>=60){types.ultra.t++;if(p.hit)types.ultra.h++}
    else if(p.score>=40){types.whale.t++;if(p.hit)types.whale.h++}
    else{types.brk.t++;if(p.hit)types.brk.h++}});
  var uR=types.ultra.t>0?Math.round(types.ultra.h/types.ultra.t*100):0;
  var wR=types.whale.t>0?Math.round(types.whale.h/types.whale.t*100):0;
  var bR=types.brk.t>0?Math.round(types.brk.h/types.brk.t*100):0;
  var accCol=a.rate>=70?'var(--up)':a.rate>=50?'var(--warn)':'var(--t2)';
  var recent=predictions.filter(function(p){return p.checked}).slice(-8).reverse();
  /* Calculate total profit estimation */
  var totalProfit=0;recent.forEach(function(p){if(p.hit)totalProfit+=((p.target-p.price)/p.price*100);else totalProfit-=7});
  el.innerHTML='<div class="cd" style="padding:14px">'
    /* Header: Big accuracy number + stats */
    +'<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;cursor:pointer" onclick="var det=document.getElementById(\'accDet_'+id+'\');det.style.display=det.style.display===\'none\'?\'block\':\'none\'">'
    +'<div style="display:flex;align-items:center;gap:14px">'
    +'<div style="position:relative;width:56px;height:56px"><svg viewBox="0 0 36 36" style="width:56px;height:56px;transform:rotate(-90deg)"><circle cx="18" cy="18" r="15.9" fill="none" stroke="var(--bdr)" stroke-width="2.5"/><circle cx="18" cy="18" r="15.9" fill="none" stroke="'+accCol+'" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="'+Math.round(a.rate)+' '+(100-Math.round(a.rate))+'"/></svg><div style="position:absolute;inset:0;display:grid;place-items:center;font-family:var(--fd);font-size:16px;font-weight:800;color:'+accCol+'">'+a.rate+'%</div></div>'
    +'<div><div style="font-family:var(--fd);font-size:13px;font-weight:700;color:var(--t0)">'+(lang==='ar'?'نسبة النجاح':'Success Rate')+'</div><div style="font-size:9px;color:var(--t2);font-family:var(--fm)">'+a.hits+' '+(lang==='ar'?'نجحت من':'hit of')+' '+a.total+' '+(lang==='ar'?'صفقة':'trades')+'</div><div style="font-size:8px;color:var(--t3);margin-top:2px">'+(lang==='ar'?'▼ اضغط للتفاصيل':'▼ Tap for details')+'</div></div></div>'
    +'<div style="text-align:center"><div style="font-size:24px">'+(a.rate>=70?'🏆':a.rate>=50?'📊':'📉')+'</div><div style="font-size:8px;font-family:var(--fm);color:'+(totalProfit>=0?'var(--up)':'var(--dn)');font-weight:700">'+(totalProfit>=0?'+':'')+totalProfit.toFixed(1)+'%</div></div></div>'
    /* Expandable details */
    +'<div id="accDet_'+id+'" style="display:none">'
    /* 3 type bars */
    +'<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;margin-bottom:10px">'
    +'<div style="background:var(--ultd);border-radius:10px;padding:10px;text-align:center"><div style="font-family:var(--fm);font-size:20px;font-weight:800;color:var(--ultra)">'+uR+'%</div><div style="font-size:8px;color:var(--t2);font-weight:600;margin-top:2px">⭐ ULTRA</div><div style="font-size:7px;font-family:var(--fm);color:var(--t3)">'+types.ultra.h+'/'+types.ultra.t+' '+(lang==='ar'?'صفقة':'trades')+'</div><div style="height:4px;border-radius:2px;background:var(--bg2);margin-top:4px;overflow:hidden"><div style="height:100%;width:'+uR+'%;background:var(--ultra);border-radius:2px"></div></div></div>'
    +'<div style="background:var(--nd);border-radius:10px;padding:10px;text-align:center"><div style="font-family:var(--fm);font-size:20px;font-weight:800;color:var(--neon)">'+wR+'%</div><div style="font-size:8px;color:var(--t2);font-weight:600;margin-top:2px">🐋 '+(lang==='ar'?'حيتان':'Whales')+'</div><div style="font-size:7px;font-family:var(--fm);color:var(--t3)">'+types.whale.h+'/'+types.whale.t+'</div><div style="height:4px;border-radius:2px;background:var(--bg2);margin-top:4px;overflow:hidden"><div style="height:100%;width:'+wR+'%;background:var(--neon);border-radius:2px"></div></div></div>'
    +'<div style="background:var(--dd);border-radius:10px;padding:10px;text-align:center"><div style="font-family:var(--fm);font-size:20px;font-weight:800;color:var(--dn)">'+bR+'%</div><div style="font-size:8px;color:var(--t2);font-weight:600;margin-top:2px">💥 '+(lang==='ar'?'انفجار':'Breakout')+'</div><div style="font-size:7px;font-family:var(--fm);color:var(--t3)">'+types.brk.h+'/'+types.brk.t+'</div><div style="height:4px;border-radius:2px;background:var(--bg2);margin-top:4px;overflow:hidden"><div style="height:100%;width:'+bR+'%;background:var(--dn);border-radius:2px"></div></div></div></div>'
    /* Recent trades table */
    +(recent.length?'<div style="font-size:10px;font-weight:700;color:var(--t1);margin-bottom:6px">📜 '+(lang==='ar'?'آخر الصفقات':'Recent Trades')+' ('+recent.length+')</div>'
    +'<div style="background:var(--bg2);border-radius:10px;overflow:hidden">'+recent.map(function(p,i){
      var pnl=p.hit?((p.target-p.price)/p.price*100):-7;
      var age=timeAgo(p.time);
      return'<div style="display:grid;grid-template-columns:40px 1fr 60px 50px;align-items:center;padding:7px 8px;font-size:8px;font-family:var(--fm);'+(i<recent.length-1?'border-bottom:1px solid var(--bdr)':'')+'">'
      +'<span style="font-weight:800;color:var(--t0)">'+p.sym+'</span>'
      +'<span style="color:var(--t3)">'+fP(p.price)+' → '+fP(p.target)+'</span>'
      +'<span style="text-align:center;font-weight:700;color:'+(p.hit?'var(--up)':'var(--dn)')+'">'+(p.hit?'✅ +'+pnl.toFixed(1)+'%':'❌ -7%')+'</span>'
      +'<span style="text-align:left;color:var(--t3);font-size:7px">'+age.text+'</span></div>'}).join('')+'</div>':'')
    +'</div></div>'}
/* 💰 STABLECOIN FLOW INDICATOR — uses already-loaded T data (no extra API calls) */
async function loadStableFlow(){
  try{
    /* Calculate from already-loaded ticker data — NO duplicate API call */
    var usdtVol=0,usdcVol=0,totalVol=0;
    Object.entries(T).forEach(function(e){var d=e[1];if(d.src==='BN'){totalVol+=d.v}});
    /* Estimate USDC volume from known USDC-heavy coins */
    var stableCoins=['USDC','TUSD','FDUSD','DAI','BUSD'];
    stableCoins.forEach(function(s){if(T[s])usdcVol+=T[s].v});
    usdtVol=totalVol-usdcVol;
    /* Calculate flow index based on market behavior */
    var btcChange=T['BTC']?T['BTC'].c:0;
    var ethChange=T['ETH']?T['ETH'].c:0;
    var avgTopChange=(btcChange+ethChange)/2;
    /* Rising coins count */
    var allCoins=Object.values(T);var risers=allCoins.filter(function(x){return x.c>0}).length;
    var riserPct=allCoins.length>0?risers/allCoins.length*100:50;
    /* Flow Index: 0=everyone buying crypto, 100=everyone selling to stables */
    var flowIndex=50;
    /* BTC trend: strongest signal */
    if(avgTopChange<-5)flowIndex+=20;else if(avgTopChange<-2)flowIndex+=10;
    else if(avgTopChange>5)flowIndex-=20;else if(avgTopChange>2)flowIndex-=10;
    /* Market breadth */
    if(riserPct>65)flowIndex-=15;else if(riserPct>55)flowIndex-=8;
    else if(riserPct<35)flowIndex+=15;else if(riserPct<45)flowIndex+=8;
    /* Fear & Greed */
    if(fgValue<25)flowIndex+=10;else if(fgValue>75)flowIndex-=10;
    /* Funding Rate trend */
    var avgFR=Object.values(FR).reduce(function(s,x){return s+x.rate},0)/Math.max(1,Object.keys(FR).length);
    if(avgFR>0.05)flowIndex+=8;else if(avgFR<-0.02)flowIndex-=8;
    /* Clamp */
    flowIndex=Math.max(5,Math.min(95,Math.round(flowIndex)));
    /* Update UI */
    document.getElementById('sfUSDT').textContent=fmt(usdtVol);
    document.getElementById('sfUSDC').textContent=fmt(usdcVol);
    document.getElementById('sfUSDTch').style.color=btcChange>=0?'var(--up)':'var(--dn)';
    document.getElementById('sfUSDTch').textContent=btcChange>=0?'📈 '+(lang==='ar'?'شراء كريبتو':'Buying crypto'):'📉 '+(lang==='ar'?'بيع كريبتو':'Selling crypto');
    document.getElementById('sfUSDCch').style.color=usdcVol>1e9?'var(--warn)':'var(--t2)';
    document.getElementById('sfUSDCch').textContent=usdcVol>1e9?(lang==='ar'?'نشاط عالي':'High activity'):(lang==='ar'?'طبيعي':'Normal');
    var idxColor=flowIndex<=30?'var(--up)':flowIndex<=55?'var(--warn)':'var(--dn)';
    document.getElementById('sfIndex').textContent=flowIndex;document.getElementById('sfIndex').style.color=idxColor;
    var idxLabel=flowIndex<=20?(lang==='ar'?'🟢 شراء قوي':'🟢 Strong Buy'):flowIndex<=35?(lang==='ar'?'🟢 شراء':'🟢 Buying'):flowIndex<=55?(lang==='ar'?'🟡 متوازن':'🟡 Balanced'):flowIndex<=75?(lang==='ar'?'🔴 بيع':'🔴 Selling'):(lang==='ar'?'🔴 بيع قوي':'🔴 Strong Sell');
    document.getElementById('sfIndexLbl').textContent=idxLabel;document.getElementById('sfIndexLbl').style.color=idxColor;
    document.getElementById('sfPt').style.left=flowIndex+'%';
    var signalEl=document.getElementById('sfSignal');
    if(flowIndex<=30){signalEl.textContent=lang==='ar'?'🟢 صعودي':'🟢 BULLISH';signalEl.style.background='var(--ud)';signalEl.style.color='var(--up)'}
    else if(flowIndex<=55){signalEl.textContent=lang==='ar'?'🟡 محايد':'🟡 NEUTRAL';signalEl.style.background='var(--wd)';signalEl.style.color='var(--warn)'}
    else{signalEl.textContent=lang==='ar'?'🔴 هبوطي':'🔴 BEARISH';signalEl.style.background='var(--dd)';signalEl.style.color='var(--dn)'}
    var advice=flowIndex<=25?(lang==='ar'?'💡 الناس تشتري كريبتو بقوة — السوق صاعد':'💡 People buying crypto aggressively — Bullish'):flowIndex<=40?(lang==='ar'?'💡 تدفق إيجابي — فرص شراء':'💡 Positive flow — Buy opportunities'):flowIndex<=60?(lang==='ar'?'💡 السوق متوازن — انتظر إشارة واضحة':'💡 Market balanced — Wait for clear signal'):flowIndex<=80?(lang==='ar'?'💡 الناس تبيع كريبتو — حذر':'💡 People selling crypto — Be cautious'):(lang==='ar'?'⚠️ تدفق كبير نحو المستقرة — خطر هبوط':'⚠️ Major flow to stables — Crash risk');
    document.getElementById('sfAdvice').textContent=advice;document.getElementById('sfAdvice').style.color=idxColor;
  }catch(e){document.getElementById('sfIndex').textContent='--'}}
/* RENDER — with real sparklines */
function mkSpark(s){var hist=sparkHist[s];var up=T[s]?(!isNaN(T[s].c)?T[s].c>=0:true):true;
  if(!hist||hist.length<3){var vals=up?[3,5,4,7,6,9,11,14,13,16,18,22]:[22,19,16,14,11,9,8,6,5,4,3,2];return vals.map(function(v,i){var op=0.3+i/vals.length*0.7;return'<b style="height:'+v+'px;background:var(--'+(up?'up':'dn')+');opacity:'+op.toFixed(2)+'"></b>'}).join('')}
  var mn=Math.min.apply(null,hist),mx=Math.max.apply(null,hist),rng=mx-mn||1;up=hist[hist.length-1]>=hist[0];
  return hist.slice(-12).map(function(v,i,a){var h=Math.max(3,Math.round((v-mn)/rng*24+3));var op=0.3+i/a.length*0.7;return'<b style="height:'+h+'px;background:var(--'+(up?'up':'dn')+');opacity:'+op.toFixed(2)+'"></b>'}).join('')}
function coinRow(s,d,i,sub){var up=d.c>=0;var bg=COL[s]||'#444';return'<div class="cr" onclick="openCoin(\''+s+'\')"><div class="cr-l">'+(i!==undefined?'<div class="cr-rk">'+i+'</div>':'')+'<div class="cr-ic" style="background:'+bg+'0a;color:'+bg+';border:1px solid '+bg+'22">'+s.slice(0,2)+'</div><div><div class="cr-n">'+s+'</div><div class="cr-sub">'+(sub||fmt(d.v))+'</div></div></div><div class="cr-spark">'+mkSpark(s)+'</div><div class="cr-r"><div class="cr-p">'+fP(d.p)+'</div><div class="cr-ch '+(up?'up':'dn')+'">'+(up?'+':'')+d.c.toFixed(1)+'%</div></div></div>'}
function ultraCard(r){/* Dedup: only save prediction once per coin per hour */var predKey=r.s+'_'+new Date().getHours();if(!predictions.some(function(p){return p.sym===r.s&&Date.now()-p.time<3600000}))savePred(r.s,r.p,r.p*1.1,r.score);var src=[];if(T[r.s])src.push('Binance');if(r.by)src.push('Bybit');if(CBP[r.s])src.push('Coinbase');return'<div class="ultra" onclick="openCoin(\''+r.s+'\')"><div class="u-badge">⭐ '+(r.ultra?'🟢 CONFIRMED':'🟡 PROBABLE')+' — '+r.passed+'/'+r.total+' CHECKS</div><div style="display:flex;justify-content:space-between;align-items:flex-start"><div><div class="u-sym">'+r.s+'/USDT</div><div class="u-price"><span style="color:'+(r.c>=0?'var(--up)':'var(--dn)')+';font-weight:700">'+(r.c>=0?'+':'')+r.c.toFixed(1)+'%</span> '+fP(r.p)+'</div></div><div style="text-align:center"><div class="u-score-val">'+r.score+'</div><div class="u-score-lbl">SCORE</div></div></div><div style="margin:8px 0">'+timeBadge(r.detectedAt)+'</div><div class="u-conf">'+Object.entries(r.checks).map(function(e){return'<div class="u-conf-i '+(e[1]?'pass':'fail')+'">'+e[0]+' '+(e[1]?'✅':'❌')+'</div>'}).join('')+'</div><div class="u-tags">'+r.tags.slice(0,6).map(function(x){return'<span class="u-tag" style="background:var(--ud);color:var(--up)">'+x+'</span>'}).join('')+'</div><div class="src-row">'+src.map(function(s){return'<span class="src-badge">'+s+'</span>'}).join('')+'</div><div class="u-range" style="margin-top:8px"><div style="font-size:10px;font-weight:700;margin-bottom:4px">🎯 Target</div><div class="u-range-row"><span style="color:var(--up)">Conservative</span><span style="font-weight:700">'+fP(r.p*1.08)+'</span></div><div class="u-range-row"><span style="color:var(--neon)">Target</span><span style="font-weight:700">'+fP(r.p*1.15)+'</span></div><div class="u-range-row"><span style="color:var(--dn)">🛑 Stop</span><span style="font-weight:700;color:var(--dn)">'+fP(r.p*0.93)+'</span></div></div></div>'}
/* 🐋 WHALE WAVE DETECTION — tracks multiple buying waves per coin */
async function detectWhaleWaves(candidates){
  if(!candidates||!candidates.length)return;
  var top=candidates.filter(function(x){return x.tags.some(function(t){return t.includes('ACC')||t.includes('STEALTH')||t.includes('EARLY')})||(x.v>5e7&&Math.abs(x.c)<3)}).slice(0,10);
  var proms=top.map(function(c){return fj(BN+'/depth?symbol='+c.s+'USDT&limit=20')});
  var obs=await Promise.all(proms);
  top.forEach(function(c,i){
    var ob=obs[i];if(!ob||!ob.bids)return;
    var buyVol=ob.bids.reduce(function(s,b){return s+ +b[0]* +b[1]},0);
    var sellVol=ob.asks.reduce(function(s,a){return s+ +a[0]* +a[1]},0);
    var ratio=buyVol/Math.max(sellVol,1);
    /* Initialize waves for this coin */
    if(!whaleWaves[c.s])whaleWaves[c.s]={waves:[],totalBuy:0,lastOB:0};
    var w=whaleWaves[c.s];
    var prevBuy=w.lastOB||0;
    var increase=buyVol-prevBuy;
    w.lastOB=buyVol;
    /* Detect new wave: significant increase in buy side */
    var threshold=c.p>1000?buyVol*0.15:buyVol*0.2; /* 15-20% increase = new wave */
    if(prevBuy>0&&increase>threshold&&increase>50000){
      /* New whale wave detected! */
      w.waves.push({amount:increase,price:c.p,time:Date.now(),ratio:ratio});
      w.totalBuy+=increase;
      /* Keep max 5 waves per coin */
      if(w.waves.length>5)w.waves=w.waves.slice(-5);
      /* Notify if 2+ waves */
      if(w.waves.length>=2){notify(c.s,'whale',w.waves.length)}
    }
    /* Clean old waves (>2 hours) */
    w.waves=w.waves.filter(function(wave){return Date.now()-wave.time<7200000});
    if(w.waves.length===0)delete whaleWaves[c.s];
  });
  localStorage.setItem('nxww10',JSON.stringify(whaleWaves))}
function whaleCard(r){
  var wt=getSigTime(r.s,'whale');
  var waves=whaleWaves[r.s]?whaleWaves[r.s].waves:[];
  var waveCount=waves.length;
  var totalWhaleBuy=waves.reduce(function(s,w){return s+w.amount},0)||r.v*0.05;
  var str=waveCount>=3?{t:lang==='ar'?'🔥 تجميع قوي جداً':'🔥 Very Strong',c:'str-strong'}:waveCount>=2?{t:lang==='ar'?'⚡ تجميع قوي':'⚡ Strong',c:'str-strong'}:totalWhaleBuy>5e6?{t:lang==='ar'?'قوي':'Strong',c:'str-normal'}:totalWhaleBuy>1e6?{t:lang==='ar'?'عادي':'Normal',c:'str-normal'}:{t:lang==='ar'?'ضعيف':'Weak',c:'str-weak'};
  var src=[];if(T[r.s])src.push('Binance');if(r.by)src.push('Bybit');if(CBP[r.s])src.push('Coinbase');
  var whaleIcons='🐋';if(waveCount>=3)whaleIcons='🐋🐋🐋';else if(waveCount>=2)whaleIcons='🐋🐋';
  /* Build wave details */
  var waveHTML='';
  if(waveCount>0){
    waveHTML='<div style="margin:6px 0;border-top:1px solid var(--bdr);padding-top:6px">';
    waves.forEach(function(wave,i){
      var isNew=Date.now()-wave.time<120000;
      waveHTML+='<div style="display:flex;align-items:center;gap:6px;padding:4px 0;font-size:9px'+(i<waves.length-1?';border-bottom:1px solid rgba(56,72,96,.15)':'')+'">'
        +'<span style="color:var(--neon);font-weight:700;width:16px">🐋</span>'
        +'<span style="font-family:var(--fm);font-weight:700;color:var(--t0);width:22px">#'+(i+1)+'</span>'
        +'<span style="font-family:var(--fm);font-weight:700;color:var(--neon);flex:1">'+fmt(wave.amount)+'</span>'
        +'<span style="font-family:var(--fm);color:var(--t2)">'+fP(wave.price)+'</span>'
        +'<span class="time-badge '+(isNew?'fresh':'')+'">⏱ '+timeAgo(wave.time).text+'</span>'
        +'</div>'});
    /* Pressure indicator */
    var firstPrice=waves[0].price;var lastPrice=waves[waves.length-1].price;
    var priceChange=firstPrice>0?((lastPrice-firstPrice)/firstPrice*100):0;
    var pressureUp=priceChange>0;
    waveHTML+='<div style="display:flex;justify-content:space-between;align-items:center;margin-top:6px;padding-top:6px;border-top:1px solid var(--bdr)">'
      +'<span style="font-size:9px;font-family:var(--fm);font-weight:700;color:var(--t0)">📊 '+(lang==='ar'?'إجمالي':'Total')+': '+fmt(totalWhaleBuy)+' | '+waveCount+' '+(lang==='ar'?'موجات':'waves')+'</span>'
      +'<span style="font-size:8px;font-family:var(--fm);font-weight:700;color:'+(pressureUp?'var(--up)':'var(--warn)')+'">'+(!pressureUp&&priceChange===0?(lang==='ar'?'تجميع صامت 🤫':'Silent acc 🤫'):(priceChange>=0?'↑':'↓')+Math.abs(priceChange).toFixed(1)+'%')+'</span>'
      +'</div>';
    waveHTML+='</div>'}
  return'<div class="whale-card" onclick="openCoin(\''+r.s+'\')">'
    +'<div class="whale-head"><div class="whale-sym">'+whaleIcons+' '+r.s+'/USDT <span class="str-badge '+str.c+'">'+str.t+'</span></div>'+timeBadge(wt)+'</div>'
    +'<div class="whale-grid"><div class="whale-item"><div class="whale-item-v" style="color:var(--neon)">'+fmt(totalWhaleBuy)+'</div><div class="whale-item-l">'+(lang==='ar'?'إجمالي الشراء':'Total Buy')+'</div></div><div class="whale-item"><div class="whale-item-v" style="color:var(--blue)">'+waveCount+'</div><div class="whale-item-l">'+(lang==='ar'?'موجات':'Waves')+'</div></div><div class="whale-item"><div class="whale-item-v" style="color:var(--up)">'+fP(r.p)+'</div><div class="whale-item-l">'+(lang==='ar'?'الحالي':'Current')+'</div></div><div class="whale-item"><div class="whale-item-v" style="color:'+(r.c>=0?'var(--up)':'var(--dn)')+'">'+(r.c>=0?'+':'')+r.c.toFixed(1)+'%</div><div class="whale-item-l">24H</div></div></div>'
    +waveHTML
    +'<div style="display:flex;justify-content:space-between;align-items:center;margin-top:4px"><div class="src-row">'+src.map(function(s){return'<span class="src-badge">'+s+'</span>'}).join('')+'</div><span style="font-family:var(--fm);font-size:9px;color:var(--t2)">Vol:'+fmt(r.v)+'</span></div></div>'}
function scanItem(r){var sc=r.score>=60?'background:var(--ud);color:var(--up)':r.score>=40?'background:var(--wd);color:var(--warn)':'background:rgba(56,72,96,.3);color:var(--t2)';return'<div class="'+(r.ultra?'scan-r ultra-r':'scan-r')+'" onclick="openCoin(\''+r.s+'\')"><div class="scan-h"><div class="scan-sym">'+(r.ultra?'⭐':r.confirmed?'🟢':'💎')+' '+r.s+' '+timeBadge(r.detectedAt)+'</div><span class="scan-score" style="'+sc+'">'+r.score+' · '+r.passed+'/'+r.total+'✓</span></div><div class="scan-det"><span>💰 <b>'+fP(r.p)+'</b></span><span>'+(r.c>=0?'+':'')+r.c.toFixed(1)+'%</span><span>'+fmt(r.v)+'</span>'+(r.cb?'<span>CB:'+fP(r.cb)+'</span>':'')+'</div><div class="scan-checks">'+r.tags.slice(0,5).map(function(x){return'<span class="scan-chk chk-y">'+x+'</span>'}).join('')+'</div><div class="prw"><div class="prb" style="width:'+Math.min(100,r.score)+'%;background:'+(r.ultra?'linear-gradient(90deg,var(--ultra),var(--dn))':r.score>=50?'var(--up)':'var(--warn)')+'"></div></div></div>'}
function frRow(s,d){var cls=d.rate>0.05?'dn':d.rate<-0.01?'up':'warn';var w=Math.min(48,Math.abs(d.rate)*500);return'<div class="fr-row"><span class="fr-sym">'+s+'</span><div class="fr-bar"><div class="fr-mid"></div><div class="fr-fill" style="'+(d.rate>=0?'left':'right')+':50%;width:'+w+'%;background:var(--'+cls+')"></div></div><div><div class="fr-val" style="color:var(--'+cls+')">'+(d.rate>=0?'+':'')+d.rate.toFixed(4)+'%</div><div class="fr-sub-t">'+(d.rate>0.05?(lang==='ar'?'⚠️ خطر':'⚠️ Danger'):d.rate<-0.01?(lang==='ar'?'فرصة':'Opportunity'):(lang==='ar'?'طبيعي':'Normal'))+'</div></div></div>'}
/* DASHBOARD */
async function loadDash(){
  await loadTk();initWS();await loadFutures();
  var fg=await fj('https://api.alternative.me/fng/?limit=1');if(fg&&fg.data){fgValue=+fg.data[0].value;document.getElementById('fgV').textContent=fgValue;document.getElementById('fgL').textContent=fg.data[0].value_classification;document.getElementById('pFG').textContent=fgValue}
  var gl=await fj(CG+'/global');if(gl&&gl.data){btcDom=gl.data.market_cap_percentage?gl.data.market_cap_percentage.btc:50;document.getElementById('btcD').textContent=btcDom.toFixed(1)+'%'}
  var h=calcHealth();var hc=h.score>=70?'up':h.score>=45?'warn':'dn';
  document.getElementById('mhScore').textContent=h.score;document.getElementById('mhScore').style.color='var(--'+hc+')';
  document.getElementById('mhLabel').textContent=h.score>=70?(lang==='ar'?'سوق صحي':'Healthy'):h.score>=45?(lang==='ar'?'محايد — حذر':'Neutral'):(lang==='ar'?'ضعيف':'Weak');
  document.getElementById('mhPt').style.left=h.score+'%';document.getElementById('pMH').textContent=h.score;
  document.getElementById('mhFactors').innerHTML=h.factors.map(function(f){return'<div class="mh-f"><div class="mh-f-v" style="color:var(--'+f.c+')">'+f.v+'</div><div class="mh-f-l">'+f.l+'</div></div>'}).join('');
  /* Stablecoin Flow */
  loadStableFlow();
  document.getElementById('warnBox').innerHTML=getWarnings().map(function(w){return'<div class="warn-box"><div class="w-ic">'+w.ic+'</div><div class="w-txt">'+w.txt+'</div></div>'}).join('');
  var bk=Object.values(T).filter(function(x){return x.c>=8}).length;document.getElementById('brkC').textContent=bk;document.getElementById('pBrk').textContent=bk;
  var cands=quickScan();var results=await deepAnalyze(cands);cache.scan=results;cache.scanTime=Date.now();detectWhaleWaves(results);
  var ultras=results.filter(function(r){return r.ultra});var conf=results.filter(function(r){return r.confirmed});
  document.getElementById('ultraL').innerHTML=ultras.length?ultras.slice(0,3).map(ultraCard).join(''):conf.length?conf.slice(0,2).map(ultraCard).join(''):'<div class="muted">'+t('no_ultra')+'</div>';
  document.getElementById('ulC').textContent=ultras.length||conf.length;document.getElementById('pUl').textContent=ultras.length||conf.length;document.getElementById('notifB').dataset.c=(ultras.length||conf.length).toString();
  /* ⚖️ L/S Professional */
  var lsC=['BTC','ETH','SOL','BNB','XRP','DOGE'].filter(function(s){return LS[s]});
  if(lsC.length){
    var avgLong=lsC.reduce(function(s,c){return s+LS[c].long},0)/lsC.length;
    var avgShort=100-avgLong;
    var sentiment=avgLong>=60?(lang==='ar'?'🟢 ضغط شراء قوي':'🟢 Strong Buy Pressure'):avgLong>=55?(lang==='ar'?'🟢 ميل للشراء':'🟢 Bullish Bias'):avgShort>=55?(lang==='ar'?'🔴 ميل للبيع':'🔴 Bearish Bias'):(lang==='ar'?'🟡 متوازن':'🟡 Balanced');
    var sentCol=avgLong>=55?'var(--up)':avgShort>=55?'var(--dn)':'var(--warn)';
    document.getElementById('dashLS').innerHTML='<div class="cd" style="padding:12px">'
      +'<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px"><span style="font-size:10px;font-weight:700;color:'+sentCol+'">'+sentiment+'</span><span style="font-family:var(--fm);font-size:9px;color:var(--t3)">L:'+avgLong.toFixed(0)+'% / S:'+avgShort.toFixed(0)+'%</span></div>'
      +lsC.map(function(s){var d=LS[s];var bg=COL[s]||'#888';
        var warn=d.ratio>1.8?'⚠️':d.ratio<0.6?'⚠️':'';
        var signal=d.long>=60?(lang==='ar'?'Long مفرط':'Excess L'):d.short>=55?(lang==='ar'?'ضغط Short':'Short P'):'';
        return'<div style="margin-bottom:10px">'
        +'<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">'
        +'<div style="display:flex;align-items:center;gap:6px"><div style="width:22px;height:22px;border-radius:7px;background:'+bg+'18;color:'+bg+';border:1px solid '+bg+'30;display:grid;place-items:center;font-size:8px;font-weight:800">'+s.slice(0,2)+'</div><span style="font-family:var(--fd);font-weight:700;font-size:12px">'+s+'</span></div>'
        +'<div style="display:flex;align-items:center;gap:4px"><span style="font-family:var(--fm);font-size:11px;font-weight:800;color:'+(d.ratio>1.5?'var(--warn)':d.ratio<0.7?'var(--dn)':'var(--t1)')+'">'+d.ratio.toFixed(2)+'</span>'+(warn?'<span style="font-size:8px">'+warn+'</span>':'')+'</div></div>'
        +'<div style="display:flex;height:10px;border-radius:5px;overflow:hidden;background:var(--bg2);position:relative"><div style="width:'+d.long+'%;background:linear-gradient(90deg,var(--up),rgba(0,255,136,.5));border-radius:5px 0 0 5px;transition:width .5s"></div><div style="width:'+d.short+'%;background:linear-gradient(90deg,rgba(255,56,96,.5),var(--dn));border-radius:0 5px 5px 0;transition:width .5s"></div></div>'
        +'<div style="display:flex;justify-content:space-between;margin-top:3px;font-size:9px;font-family:var(--fm)"><span style="color:var(--up);font-weight:700">🟢 Long '+d.long.toFixed(0)+'%</span>'+(signal?'<span style="font-size:7px;color:var(--warn);font-weight:700">'+signal+'</span>':'')+'<span style="color:var(--dn);font-weight:700">Short '+d.short.toFixed(0)+'% 🔴</span></div>'
        +'</div>'}).join('')+'</div>'}
  else{document.getElementById('dashLS').innerHTML='<div class="muted">'+t('scanning')+'</div>'}
  renderAcc('accCard');
  renderTopCoins();
  renderTop3();
  checkWatchlistAlerts();
}
/* SCANNER PAGE — uses cache for instant switch */
async function runScan(){if(cache.scan&&Date.now()-cache.scanTime<CACHE_TTL){renderScanResults(cache.scan);setTimeout(async function(){var c=quickScan();cache.scan=await deepAnalyze(c);cache.scanTime=Date.now();renderScanResults(cache.scan)},100);return}var c=quickScan();var r=await deepAnalyze(c);cache.scan=r;cache.scanTime=Date.now();renderScanResults(r)}
function renderScanResults(results){var mode=(document.querySelector('#fltM .flt-b.act')||{dataset:{m:'all'}}).dataset.m;var f=results;if(mode==='ultra')f=results.filter(function(r){return r.ultra||r.confirmed});else if(mode==='brk')f=results.filter(function(r){return r.c>=3&&r.score>=40});else if(mode==='fr')f=results.filter(function(r){return r.fr!=null}).sort(function(a,b){return Math.abs(b.fr||0)-Math.abs(a.fr||0)});document.getElementById('scanI').textContent='📊 '+Object.keys(T).length+' '+(lang==='ar'?'عملة':'coins')+' → ✅ '+f.length;document.getElementById('scanR').innerHTML=f.length?f.slice(0,30).map(scanItem).join(''):'<div class="empty"><div class="empty-ic">📡</div><div class="empty-tx">'+t('no_data')+'</div></div>'}
/* WHALE PAGE */
async function loadWhales(){var c=quickScan();var r=await deepAnalyze(c);cache.scan=r;cache.scanTime=Date.now();await detectWhaleWaves(r);renderWhaleResults(r)}
function renderWhaleResults(results){var w=results.filter(function(x){return x.tags.some(function(t){return t.includes('ACC')||t.includes('STEALTH')||t.includes('EARLY')||t.includes('BOTTOM')})||(x.v>5e7&&Math.abs(x.c)<3)||(x.checks.ob&&x.v>1e7)}).slice(0,15);
  /* Sort by wave count (most waves first) */
  w.sort(function(a,b){var wa=whaleWaves[a.s]?whaleWaves[a.s].waves.length:0;var wb=whaleWaves[b.s]?whaleWaves[b.s].waves.length:0;return wb-wa||b.score-a.score});
  var totalBuy=w.reduce(function(s,x){var ww=whaleWaves[x.s];return s+(ww?ww.totalBuy:x.v*0.05)},0);
  document.getElementById('whT').textContent=fmt(totalBuy);document.getElementById('whB').textContent=fmt(w.filter(function(x){return x.c>0}).reduce(function(s,x){var ww=whaleWaves[x.s];return s+(ww?ww.totalBuy:x.v*0.05)},0));document.getElementById('whS').textContent=fmt(w.filter(function(x){return x.c<0}).reduce(function(s,x){var ww=whaleWaves[x.s];return s+(ww?ww.totalBuy:x.v*0.05)},0));document.getElementById('whAL').innerHTML=w.length?w.map(whaleCard).join(''):'<div class="empty"><div class="empty-ic">🐋</div><div class="empty-tx">'+t('no_whale')+'</div></div>';renderAcc('whAccCard')}
/* INDICATORS PAGE */
async function loadInd(){loadFR()}
async function loadFR(){if(!Object.keys(FR).length)await loadFutures();document.getElementById('frList').innerHTML='<div class="muted">'+(lang==='ar'?'🔴 FR عالي = خطر | 🟢 FR سلبي = فرصة':'🔴 High FR = Risk | 🟢 Neg FR = Opportunity')+'</div>'+Object.entries(FR).filter(function(e){return WL.includes(e[0])}).sort(function(a,b){return Math.abs(b[1].rate)-Math.abs(a[1].rate)}).map(function(e){return frRow(e[0],e[1])}).join('')}
async function loadOI(){if(!Object.keys(OI).length)await loadFutures();document.getElementById('oiList').innerHTML='<div class="muted">'+(lang==='ar'?'📈 OI ↑ = حركة حقيقية':'📈 OI ↑ = Real move')+'</div>'+Object.entries(OI).sort(function(a,b){return b[1]-a[1]}).map(function(e){var s=e[0],v=e[1],d=T[s];return'<div class="fr-row"><span class="fr-sym">'+s+'</span><span style="font-family:var(--fm);font-size:11px;color:var(--neon);font-weight:700">'+fmt(v)+'</span><span class="cr-ch '+(d&&d.c>=0?'up':'dn')+'">'+(d?(d.c>=0?'+':'')+d.c.toFixed(1)+'%':'--')+'</span></div>'}).join('')}
async function loadCor(){var coins=['BTC','ETH','SOL','BNB','XRP','LINK','DOGE','ADA'];var prices={};var proms=coins.map(function(s){return fj(BN+'/klines?symbol='+s+'USDT&interval=1d&limit=14').then(function(kl){if(kl)prices[s]=kl.map(function(k){return+k[4]})}).catch(function(){})});await Promise.all(proms);function corr(a,b){var n=Math.min(a.length,b.length);var ma=a.slice(-n).reduce(function(s,v){return s+v},0)/n,mb=b.slice(-n).reduce(function(s,v){return s+v},0)/n;var num=0,da=0,db=0;for(var i=0;i<n;i++){var x=a[a.length-n+i]-ma,y=b[b.length-n+i]-mb;num+=x*y;da+=x*x;db+=y*y}return da&&db?num/Math.sqrt(da*db):0}var h='<div class="muted">🔗 Correlation (14D)</div><div style="display:grid;grid-template-columns:auto repeat('+coins.length+',1fr);gap:2px;font-size:8px;font-family:var(--fm)"><div></div>';coins.forEach(function(s){h+='<div style="text-align:center;font-weight:700">'+s+'</div>'});coins.forEach(function(a){h+='<div style="font-weight:700">'+a+'</div>';coins.forEach(function(b){if(!prices[a]||!prices[b]){h+='<div style="text-align:center">--</div>';return}var c=a===b?1:corr(prices[a],prices[b]);h+='<div style="text-align:center;padding:3px;border-radius:3px;background:'+(c>.7?'var(--ud)':c<-.3?'var(--dd)':'transparent')+';color:'+(c>.5?'var(--up)':c<-.3?'var(--dn)':'var(--t2)')+';font-weight:700">'+c.toFixed(2)+'</div>'})});h+='</div>';document.getElementById('corGrid').innerHTML=h}
/* COIN DETAIL */
async function openCoin(sym){curCoin=sym;curTF='1h';document.getElementById('sRes').classList.remove('show');document.getElementById('sInp').value='';var d=T[sym]||{p:0,c:0,v:0,h:0,l:0};document.getElementById('cmT').textContent=sym+'/USDT';document.getElementById('cmP').textContent=fP(d.p);document.getElementById('cmC').style.color=d.c>=0?'var(--up)':'var(--dn)';document.getElementById('cmC').textContent=(d.c>=0?'+':'')+d.c.toFixed(2)+'%';document.getElementById('cmSts').innerHTML='<div class="st"><div class="st-l">VOL</div><div class="st-v" style="color:var(--neon)">'+fmt(d.v)+'</div></div><div class="st"><div class="st-l">HIGH</div><div class="st-v" style="color:var(--up)">'+fP(d.h)+'</div></div><div class="st"><div class="st-l">LOW</div><div class="st-v" style="color:var(--dn)">'+fP(d.l)+'</div></div>';var ex='';var fr=FR[sym];if(fr)ex+='<div class="fr-row" style="margin-top:6px"><span>📊 FR</span><span class="fr-val" style="color:'+(fr.rate>0.05?'var(--dn)':fr.rate<-0.01?'var(--up)':'var(--warn)')+'">'+(fr.rate>=0?'+':'')+fr.rate.toFixed(4)+'%</span></div>';if(OI[sym])ex+='<div class="fr-row"><span>📈 OI</span><span class="fr-val" style="color:var(--neon)">'+fmt(OI[sym])+'</span></div>';if(LS[sym])ex+='<div class="fr-row"><span>⚖️ L/S</span><span class="fr-val">'+LS[sym].long.toFixed(0)+'%/'+LS[sym].short.toFixed(0)+'%</span></div>';if(d.by)ex+='<div class="fr-row"><span>Bybit</span><span class="fr-val">'+fP(d.by)+'</span></div>';if(CBP[sym])ex+='<div class="fr-row"><span>Coinbase</span><span class="fr-val">'+fP(CBP[sym])+'</span></div>';document.getElementById('cmExtra').innerHTML=ex;openMo('coinMo');document.querySelectorAll('.chart-tf').forEach(function(b){b.classList.remove('act');if(b.dataset.t2==='1h')b.classList.add('act')});drawChart(sym,'1h')}
function cTF(tf,btn){curTF=tf;document.querySelectorAll('.chart-tf').forEach(function(b){b.classList.remove('act')});btn.classList.add('act');drawChart(curCoin,tf)}
function tgI(ind,btn){inds[ind]=inds[ind]?0:1;btn.classList.toggle('act');drawChart(curCoin,curTF)}
async function drawChart(sym,tf){var cv=document.getElementById('chCv'),ctx=cv.getContext('2d');var dpr=window.devicePixelRatio||1;cv.width=cv.clientWidth*dpr;cv.height=280*dpr;ctx.scale(dpr,dpr);var W=cv.clientWidth,H=280;ctx.clearRect(0,0,W,H);var kl=await fj(BN+'/klines?symbol='+sym+'USDT&interval='+tf+'&limit=80');if(!kl||!kl.length){ctx.fillStyle='#4a5568';ctx.font='11px Syne';ctx.textAlign='center';ctx.fillText(t('no_data'),W/2,H/2);return}
  var data=kl.map(function(k){return{t:+k[0],o:+k[1],h:+k[2],l:+k[3],c:+k[4],v:+k[5]}});
  var mH=inds.rsi?H*.60:H-36;var priceW=52;var cw=(W-priceW-4)/data.length,ch=mH-32;var timeH=18;
  var maxP=Math.max.apply(null,data.map(function(d){return d.h}));var minP=Math.min.apply(null,data.map(function(d){return d.l}));
  var range=maxP-minP;if(range===0)range=maxP*0.01;maxP+=range*0.03;minP-=range*0.03;range=maxP-minP;
  var isDark=document.body.dataset.theme!=='light';
  var upC=isDark?'#00ff88':'#059669',dnC=isDark?'#ff3860':'#dc2626';
  var upCa=isDark?'rgba(0,255,136,':'rgba(5,150,105,',dnCa=isDark?'rgba(255,56,96,':'rgba(220,38,38,';
  var bgFill=isDark?'#060b14':'#f7f9fc';
  var yS=function(p){return 14+ch-((p-minP)/range)*ch};
  /* GRID */
  ctx.textAlign='right';
  for(var i=0;i<=5;i++){var y=14+ch/5*i;var price=maxP-range/5*i;ctx.strokeStyle='rgba(56,72,96,.1)';ctx.lineWidth=.5;ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(W-priceW,y);ctx.stroke();ctx.fillStyle='#6e82a0';ctx.font='8px Geist Mono';ctx.fillText(fP(price),W-2,y+3)}
  /* TIME AXIS */
  var timeY=mH+2;ctx.fillStyle='#4a5568';ctx.font='7px Geist Mono';ctx.textAlign='center';
  var step=tf==='1d'?7:tf==='4h'?6:tf==='15m'?10:8;
  for(var i=0;i<data.length;i+=step){var dt=new Date(data[i].t);var label=tf==='1d'?(dt.getMonth()+1)+'/'+dt.getDate():dt.getHours()+':'+('0'+dt.getMinutes()).slice(-2);var tx=2+i*cw+cw/2;ctx.fillText(label,tx,timeY+10);ctx.strokeStyle='rgba(56,72,96,.05)';ctx.lineWidth=.5;ctx.beginPath();ctx.moveTo(tx,14);ctx.lineTo(tx,mH);ctx.stroke()}
  /* VOLUME */
  if(inds.vol){var mV=Math.max.apply(null,data.map(function(d){return d.v}));data.forEach(function(d,i){var up=d.c>=d.o;var vH=Math.max(2,d.v/mV*28);var x=2+i*cw;var grd=ctx.createLinearGradient(0,mH-vH,0,mH);grd.addColorStop(0,up?upCa+'.12)':dnCa+'.12)');grd.addColorStop(1,up?upCa+'.01)':dnCa+'.01)');ctx.fillStyle=grd;ctx.fillRect(x+1,mH-vH,cw-2,vH)})}
  /* EMA */
  if(inds.sma&&data.length>=21){ctx.beginPath();ctx.strokeStyle='rgba(91,156,255,.6)';ctx.lineWidth=1.5;for(var i=20;i<data.length;i++){var avg=data.slice(i-20,i+1).reduce(function(s,d){return s+d.c},0)/21;var x=2+i*cw+cw/2;if(i===20)ctx.moveTo(x,yS(avg));else ctx.lineTo(x,yS(avg))};ctx.stroke()}
  /* S/R */
  if(inds.sr){var lows=data.map(function(d){return d.l}),highs=data.map(function(d){return d.h});for(var i=2;i<data.length-2;i++){if(lows[i]<lows[i-1]&&lows[i]<lows[i-2]&&lows[i]<lows[i+1]&&lows[i]<lows[i+2]){ctx.strokeStyle=upCa+'.2)';ctx.setLineDash([3,3]);ctx.lineWidth=.7;ctx.beginPath();ctx.moveTo(0,yS(lows[i]));ctx.lineTo(W-priceW,yS(lows[i]));ctx.stroke();ctx.setLineDash([]);ctx.fillStyle=upCa+'.3)';ctx.font='7px Geist Mono';ctx.textAlign='left';ctx.fillText('S',4,yS(lows[i])-3);ctx.textAlign='right'}if(highs[i]>highs[i-1]&&highs[i]>highs[i-2]&&highs[i]>highs[i+1]&&highs[i]>highs[i+2]){ctx.strokeStyle=dnCa+'.2)';ctx.setLineDash([3,3]);ctx.lineWidth=.7;ctx.beginPath();ctx.moveTo(0,yS(highs[i]));ctx.lineTo(W-priceW,yS(highs[i]));ctx.stroke();ctx.setLineDash([]);ctx.fillStyle=dnCa+'.3)';ctx.font='7px Geist Mono';ctx.textAlign='left';ctx.fillText('R',4,yS(highs[i])-3);ctx.textAlign='right'}}}
  /* CANDLES — hollow bullish + filled bearish + doji */
  var bw=Math.max(2,Math.min(cw*.75,12));var wickW=Math.max(1,bw>6?1.5:1);
  data.forEach(function(d,i){var x=2+i*cw+cw/2,up=d.c>=d.o;var col=up?upC:dnC;var top=yS(Math.max(d.o,d.c)),bot=yS(Math.min(d.o,d.c));var bodyH=bot-top;var isDoji=Math.abs(d.c-d.o)/Math.max(d.h-d.l,0.0001)<0.1;
    ctx.strokeStyle=col;ctx.lineWidth=wickW;ctx.beginPath();ctx.moveTo(x,yS(d.h));ctx.lineTo(x,yS(d.l));ctx.stroke();
    if(isDoji){var dy=yS((d.o+d.c)/2);ctx.strokeStyle=col;ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(x-bw/2,dy);ctx.lineTo(x+bw/2,dy);ctx.stroke()}
    else if(up){ctx.fillStyle=bgFill;ctx.fillRect(x-bw/2,top,bw,Math.max(2,bodyH));ctx.strokeStyle=col;ctx.lineWidth=1.2;ctx.strokeRect(x-bw/2,top,bw,Math.max(2,bodyH))}
    else{ctx.fillStyle=col;ctx.fillRect(x-bw/2,top,bw,Math.max(2,bodyH))}
    if(i===data.length-1){ctx.shadowColor=col;ctx.shadowBlur=6;ctx.fillStyle=up?col:col;ctx.fillRect(x-bw/2-1,top-1,bw+2,Math.max(4,bodyH+2));ctx.shadowBlur=0}});
  /* CURRENT PRICE LINE */
  var lastP=data[data.length-1].c;var lastUp=data[data.length-1].c>=data[data.length-1].o;var cpY=yS(lastP);
  ctx.strokeStyle=lastUp?upCa+'.4)':dnCa+'.4)';ctx.lineWidth=.8;ctx.setLineDash([4,3]);ctx.beginPath();ctx.moveTo(0,cpY);ctx.lineTo(W-priceW,cpY);ctx.stroke();ctx.setLineDash([]);
  ctx.fillStyle=lastUp?upC:dnC;var lbW=50,lbH=15;ctx.fillRect(W-priceW-1,cpY-lbH/2,lbW,lbH);ctx.fillStyle='#000';ctx.font='bold 8px Geist Mono';ctx.textAlign='center';ctx.fillText(fP(lastP),W-priceW+lbW/2-1,cpY+3);ctx.textAlign='right';
  /* OHLC INFO */
  var last=data[data.length-1];ctx.fillStyle='#6e82a0';ctx.font='7px Geist Mono';ctx.textAlign='left';ctx.fillText('O:'+fP(last.o)+' H:'+fP(last.h)+' L:'+fP(last.l)+' C:'+fP(last.c),4,10);ctx.textAlign='right';
  /* RSI */
  if(inds.rsi&&data.length>=14){var rsiY=mH+timeH+4,rsiH=H-rsiY-4;var closes=data.map(function(d){return d.c}),rsis=[];for(var i=14;i<closes.length;i++){var g=0,l=0;for(var j=i-13;j<=i;j++){var df=closes[j]-closes[j-1];if(df>0)g+=df;else l+=Math.abs(df)};rsis.push(100-100/(1+g/Math.max(l,.001)))};
    ctx.fillStyle='rgba(10,16,28,.4)';ctx.fillRect(0,rsiY-2,W-priceW,rsiH+4);ctx.fillStyle=dnCa+'.03)';ctx.fillRect(0,rsiY,W-priceW,rsiH*0.3);ctx.fillStyle=upCa+'.03)';ctx.fillRect(0,rsiY+rsiH*0.7,W-priceW,rsiH*0.3);
    ctx.strokeStyle=dnCa+'.12)';ctx.setLineDash([3,3]);ctx.lineWidth=.5;ctx.beginPath();ctx.moveTo(0,rsiY+rsiH*0.3);ctx.lineTo(W-priceW,rsiY+rsiH*0.3);ctx.stroke();ctx.strokeStyle=upCa+'.12)';ctx.beginPath();ctx.moveTo(0,rsiY+rsiH*0.7);ctx.lineTo(W-priceW,rsiY+rsiH*0.7);ctx.stroke();ctx.setLineDash([]);
    ctx.beginPath();ctx.strokeStyle='rgba(176,124,255,.8)';ctx.lineWidth=1.5;var off=data.length-rsis.length;rsis.forEach(function(v,i){var x=2+(i+off)*cw+cw/2,y=rsiY+rsiH-(v/100)*rsiH;if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y)});ctx.stroke();
    var lastRSI=rsis[rsis.length-1];ctx.fillStyle=lastRSI>70?dnC:lastRSI<30?upC:'#b07cff';ctx.font='bold 8px Geist Mono';ctx.textAlign='right';ctx.fillText('RSI '+lastRSI.toFixed(0),W-4,rsiY+10);ctx.fillStyle='#4a5568';ctx.font='7px Geist Mono';ctx.fillText('70',W-4,rsiY+rsiH*0.3+3);ctx.fillText('30',W-4,rsiY+rsiH*0.7+3)}}

/* HEATMAP */
async function loadHM(){if(!Object.keys(T).length)await loadTk();document.getElementById('hmG').innerHTML=Object.entries(T).sort(function(a,b){return b[1].v-a[1].v}).slice(0,30).map(function(e){var s=e[0],d=e[1],ch=d.c;var bg=ch>10?'rgba(0,255,136,.75)':ch>5?'rgba(0,255,136,.5)':ch>2?'rgba(0,255,136,.3)':ch>0?'rgba(0,255,136,.15)':ch>-2?'rgba(255,56,96,.15)':ch>-5?'rgba(255,56,96,.3)':ch>-10?'rgba(255,56,96,.5)':'rgba(255,56,96,.75)';return'<div class="hm-c" style="background:'+bg+'" onclick="openCoin(\''+s+'\')"><div class="hm-s">'+s+'</div><div class="hm-ch">'+(ch>=0?'+':'')+ch.toFixed(1)+'%</div></div>'}).join('')}
/* LIQUIDITY + ORDER BOOK */
async function loadLiq(){if(!Object.keys(T).length)await loadTk();document.getElementById('liqL').innerHTML=Object.entries(T).sort(function(a,b){return b[1].v-a[1].v}).slice(0,12).map(function(e,i){return coinRow(e[0],e[1],i+1)}).join('');var h='';var syms=['BTC','ETH','SOL','BNB','XRP'];var proms=syms.map(function(s){return fj(BN+'/depth?symbol='+s+'USDT&limit=10')});var obs=await Promise.all(proms);syms.forEach(function(s,si){var ob=obs[si];if(!ob)return;var bids=ob.bids.map(function(b){return+b[0]*+b[1]}),asks=ob.asks.map(function(a){return+a[0]*+a[1]});var bT=bids.reduce(function(a,b){return a+b},0),aT=asks.reduce(function(a,b){return a+b},0);var r=aT>0?bT/aT:1;var mx=Math.max.apply(null,bids.concat(asks));h+='<div class="cd" style="padding:8px"><div style="display:flex;justify-content:space-between;margin-bottom:4px"><span style="font-weight:700;font-family:var(--fd)">'+s+'</span><span style="font-size:9px;font-family:var(--fm);color:var(--'+(r>1.3?'up':r<.7?'dn':'warn')+')">'+(r>1.3?'BUY':r<.7?'SELL':'NEUTRAL')+' '+r.toFixed(2)+'x</span></div><div class="ob-v">'+bids.reverse().map(function(v){return'<div class="ob-b bid" style="height:'+Math.max(3,v/mx*100)+'%"></div>'}).join('')+'<div style="width:1px;background:var(--t3);height:100%"></div>'+asks.map(function(v){return'<div class="ob-b ask" style="height:'+Math.max(3,v/mx*100)+'%"></div>'}).join('')+'</div></div>'});document.getElementById('obS').innerHTML=h}
/* GEM FINDER — small caps with unusual activity */
async function loadGems(){
  if(!Object.keys(T).length)await loadTk();
  document.getElementById('gemL').innerHTML='<div class="ldr"><div class="ldr-d"></div><div class="ldr-d"></div><div class="ldr-d"></div></div>';
  /* Step 1: Filter small-cap coins (price < $1, volume $500K-$50M) */
  var candidates=Object.entries(T).filter(function(e){var d=e[1];return d.p>0&&d.p<1&&d.v>500000&&d.v<5e7}).sort(function(a,b){return b[1].v-a[1].v}).slice(0,40);
  /* Step 2: Fetch klines for top candidates to analyze volume spike */
  var gemResults=[];
  var proms=candidates.slice(0,20).map(function(e){var s=e[0];
    return fj(BN+'/klines?symbol='+s+'USDT&interval=1h&limit=12').then(function(kl){
      if(!kl||kl.length<6)return;
      var vols=kl.map(function(k){return+k[5]});
      var closes=kl.map(function(k){return+k[4]});
      /* Average volume of older candles (exclude last 2) */
      var oldVols=vols.slice(0,-2);
      var avgVol=oldVols.reduce(function(a,b){return a+b},0)/Math.max(1,oldVols.length);
      /* Recent volume (last 2 candles) */
      var recentVol=(vols[vols.length-1]+vols[vols.length-2])/2;
      var volMultiple=avgVol>0?recentVol/avgVol:1;
      /* Find when volume spike started */
      var spikeStartIdx=vols.length-1;
      for(var i=vols.length-1;i>=1;i--){if(vols[i]>avgVol*1.5)spikeStartIdx=i;else break}
      var spikeStartTime=+kl[spikeStartIdx][0];
      /* Price at spike start vs now */
      var priceAtSpike=+kl[spikeStartIdx][1];
      var priceNow=closes[closes.length-1];
      var gainSinceSpike=priceAtSpike>0?((priceNow-priceAtSpike)/priceAtSpike)*100:0;
      /* Classify timing */
      var timing,timingCls,timingLabel;
      if(gainSinceSpike<3){timing='early';timingCls='str-strong';timingLabel=lang==='ar'?'🟢 صيد مبكر — ادخل!':'🟢 Early — Enter now!'}
      else if(gainSinceSpike<8){timing='still';timingCls='str-normal';timingLabel=lang==='ar'?'🟡 لسا فيه فرصة — حذر':'🟡 Still time — Caution'}
      else{timing='late';timingCls='str-weak';timingLabel=lang==='ar'?'🔴 متأخر — راقب فقط':'🔴 Late — Watch only'}
      /* Score: high volume spike + early = best */
      var gemScore=0;
      if(volMultiple>=3)gemScore+=40;else if(volMultiple>=2)gemScore+=30;else if(volMultiple>=1.5)gemScore+=15;
      if(timing==='early')gemScore+=30;else if(timing==='still')gemScore+=15;
      if(T[s].c>0&&T[s].c<3)gemScore+=20; /* small positive = accumulating */
      else if(T[s].c>=3&&T[s].c<8)gemScore+=10;
      if(gemScore>=25)gemResults.push({s:s,p:T[s].p,c:T[s].c,v:T[s].v,volX:volMultiple,gainSinceSpike:gainSinceSpike,spikeTime:spikeStartTime,timing:timing,timingCls:timingCls,timingLabel:timingLabel,score:gemScore,priceAtSpike:priceAtSpike})
    }).catch(function(){})});
  await Promise.all(proms);
  /* Sort: early + high volume first */
  gemResults.sort(function(a,b){return b.score-a.score});
  /* Render */
  document.getElementById('gemL').innerHTML=gemResults.length?gemResults.map(function(g){
    /* Notify only for EARLY gems with high volume */
    if(g.timing==='early'&&g.volX>=2)notify(g.s,'gem',g.score);
    var src=[];if(T[g.s])src.push('Binance');if(T[g.s].by)src.push('Bybit');if(CBP[g.s])src.push('Coinbase');
    return'<div class="whale-card" onclick="openCoin(\''+g.s+'\')">'
    +'<div class="whale-head"><div class="whale-sym">💎 '+g.s+'/USDT <span class="str-badge '+g.timingCls+'">'+g.timingLabel+'</span></div>'+timeBadge(g.spikeTime)+'</div>'
    +'<div class="whale-grid">'
    +'<div class="whale-item"><div class="whale-item-v" style="color:var(--up)">'+fP(g.p)+'</div><div class="whale-item-l">'+(lang==='ar'?'السعر الحالي':'Current Price')+'</div></div>'
    +'<div class="whale-item"><div class="whale-item-v" style="color:var(--neon)">'+g.volX.toFixed(1)+'x</div><div class="whale-item-l">'+(lang==='ar'?'ضغط الحجم':'Vol Spike')+'</div></div>'
    +'<div class="whale-item"><div class="whale-item-v" style="color:'+(g.gainSinceSpike<3?'var(--up)':g.gainSinceSpike<8?'var(--warn)':'var(--dn)')+'">+'+(g.gainSinceSpike).toFixed(1)+'%</div><div class="whale-item-l">'+(lang==='ar'?'منذ بداية الحركة':'Since spike')+'</div></div>'
    +'<div class="whale-item"><div class="whale-item-v">'+fP(g.priceAtSpike)+'</div><div class="whale-item-l">'+(lang==='ar'?'سعر البداية':'Spike Price')+'</div></div>'
    +'</div>'
    +'<div style="margin-top:4px"><div class="prw"><div class="prb" style="width:'+Math.min(100,g.score)+'%;background:'+(g.timing==='early'?'var(--up)':g.timing==='still'?'var(--warn)':'var(--dn)')+'"></div></div></div>'
    +'<div style="display:flex;justify-content:space-between;align-items:center;margin-top:4px"><div class="src-row">'+src.map(function(s){return'<span class="src-badge">'+s+'</span>'}).join('')+'</div><span style="font-family:var(--fm);font-size:9px;color:var(--t2)">Vol:'+fmt(g.v)+'</span></div>'
    +'</div>'}).join(''):'<div class="empty"><div class="empty-ic">💎</div><div class="empty-tx">'+(lang==='ar'?'لا جواهر حالياً — السوق هادئ':'No gems now — Market quiet')+'</div></div>'}/* WATCHLIST */
var watchlist=JSON.parse(localStorage.getItem('nxwl10')||'[]');
function addWL(){var sym=document.getElementById('wlInp').value.toUpperCase().trim();if(!sym||watchlist.includes(sym))return;watchlist.push(sym);localStorage.setItem('nxwl10',JSON.stringify(watchlist));document.getElementById('wlInp').value='';renderWL()}
function rmWL(i){watchlist.splice(i,1);localStorage.setItem('nxwl10',JSON.stringify(watchlist));renderWL()}
function renderWL(){document.getElementById('wlList').innerHTML=watchlist.length?watchlist.map(function(sym,i){var d=T[sym];if(!d)return'<div class="fr-row"><span class="fr-sym">'+sym+'</span><span style="color:var(--t3);font-size:10px">'+(lang==='ar'?'غير متوفر':'Not found')+'</span><span style="font-size:7px;color:var(--t3);cursor:pointer" onclick="rmWL('+i+')">🗑</span></div>';
    return coinRow(sym,d,undefined)+'<div style="text-align:left;margin:-3px 0 5px"><span style="font-size:7px;color:var(--t3);cursor:pointer;padding:2px 6px" onclick="rmWL('+i+')">🗑 '+(lang==='ar'?'إزالة':'Remove')+'</span></div>'}).join(''):'<div class="empty"><div class="empty-ic">👁</div><div class="empty-tx">'+(lang==='ar'?'أضف عملات للمراقبة':'Add coins to watch')+'</div></div>'}
/* 📊 MARKET DIRECTION REPORT — Parallel + Error-Safe */
var reportCache={html:null,time:0};
var REPORT_TTL=4*3600000;
function calcEMA(arr,p){if(!arr||arr.length<p)return arr?arr[arr.length-1]:0;var k=2/(p+1),e=arr[0];for(var i=1;i<arr.length;i++)e=arr[i]*k+e*(1-k);return e}
async function loadReport(){
  if(reportCache.html&&Date.now()-reportCache.time<REPORT_TTL){document.getElementById('rptBody').innerHTML=reportCache.html;updateReportHeader();return}
  document.getElementById('rptBody').innerHTML='<div style="text-align:center;padding:30px"><div class="ldr"><div class="ldr-d"></div><div class="ldr-d"></div><div class="ldr-d"></div></div><div style="font-size:11px;color:var(--t2);margin-top:10px">'+(lang==='ar'?'جاري تحليل السوق...':'Analyzing market...')+'</div></div>';
  try{
    /* ALL requests in parallel */
    var results=await Promise.all([
      fj(BN+'/klines?symbol=BTCUSDT&interval=4h&limit=50'),
      fj(BN+'/klines?symbol=BTCUSDT&interval=1d&limit=30'),
      fj(BN+'/klines?symbol=ETHUSDT&interval=4h&limit=50'),
      fj(BN+'/klines?symbol=ETHUSDT&interval=1d&limit=30')
    ]);
    var coins=[
      {sym:'BTC',icon:'₿',kl4h:results[0],kl1d:results[1],cls:'btc'},
      {sym:'ETH',icon:'Ξ',kl4h:results[2],kl1d:results[3],cls:'eth'}
    ];
    var html='';var overallScore=0;
    for(var ci=0;ci<coins.length;ci++){
      var coin=coins[ci];
      if(!coin.kl4h||!coin.kl1d||coin.kl4h.length<20||coin.kl1d.length<7){html+='<div class="rpt-coin '+coin.cls+'"><div class="rpt-head"><div class="rpt-name"><span style="font-size:22px">'+coin.icon+'</span> '+coin.sym+'/USDT</div><div class="rpt-dir" style="background:var(--wd);color:var(--warn)">⏳</div></div><div style="text-align:center;padding:12px;color:var(--t3);font-size:11px">'+(lang==='ar'?'بيانات غير كافية':'Insufficient data')+'</div></div>';continue}
      var c4=coin.kl4h.map(function(k){return+k[4]});var h4=coin.kl4h.map(function(k){return+k[2]});var l4=coin.kl4h.map(function(k){return+k[3]});var v4=coin.kl4h.map(function(k){return+k[5]});
      var c1d=coin.kl1d.map(function(k){return+k[4]});var h1d=coin.kl1d.map(function(k){return+k[2]});var l1d=coin.kl1d.map(function(k){return+k[3]});
      var price=c4[c4.length-1];
      var rsi=calcRSI(c4);var macd=calcMACD(c4);
      var ema20=calcEMA(c4.slice(-20),20);var ema50=calcEMA(c4,50);
      var avgVol=v4.slice(-10,-2).reduce(function(a,b){return a+b},0)/Math.max(1,v4.slice(-10,-2).length);
      var recentVol=(v4[v4.length-1]+(v4[v4.length-2]||0))/2;var volTrend=avgVol>0?recentVol/avgVol:1;
      var resistance=Math.max.apply(null,h1d.slice(-14));var support=Math.min.apply(null,l1d.slice(-14));
      var recentHigh=Math.max.apply(null,h1d.slice(-7));var recentLow=Math.min.apply(null,l1d.slice(-7));
      var fRange=recentHigh-recentLow;if(fRange===0)fRange=price*0.03;
      var fib618Up=price+fRange*0.618;var fib100Up=price+fRange;var fib618Dn=price-fRange*0.618;var fib100Dn=price-fRange;
      /* Trend scoring */
      var ts=0;if(price>ema20)ts+=2;else ts-=2;if(price>ema50)ts+=2;else ts-=2;if(ema20>ema50)ts+=1;else ts-=1;if(macd.h>0)ts+=2;else ts-=2;if(macd.cross==='bull')ts+=2;if(macd.cross==='bear')ts-=2;if(rsi>55)ts+=1;else if(rsi<45)ts-=1;if(volTrend>1.3)ts+=1;
      var fr=FR[coin.sym];if(fr){if(fr.rate<0)ts+=1;if(fr.rate>0.05)ts-=1}
      var ls=LS[coin.sym];if(ls){if(ls.ratio>1.5)ts-=1;if(ls.ratio<0.8)ts+=1}
      overallScore+=ts;
      var ch4h=c4.length>=2?((price-c4[c4.length-2])/c4[c4.length-2]*100):0;
      var ch24=c4.length>=7?((price-c4[c4.length-7])/c4[c4.length-7]*100):0;
      var ch7d=c1d.length>=7?((price-c1d[c1d.length-7])/c1d[c1d.length-7]*100):0;
      /* Direction labels */
      var tDir,tCol,tBg,tIcon;
      if(ts>=4){tDir=lang==='ar'?'صعودي قوي':'Strong Bull';tCol='var(--up)';tBg='var(--ud)';tIcon='🟢🟢'}
      else if(ts>=2){tDir=lang==='ar'?'صعودي':'Bullish';tCol='var(--up)';tBg='var(--ud)';tIcon='🟢'}
      else if(ts<=-4){tDir=lang==='ar'?'هبوطي قوي':'Strong Bear';tCol='var(--dn)';tBg='var(--dd)';tIcon='🔴🔴'}
      else if(ts<=-2){tDir=lang==='ar'?'هبوطي':'Bearish';tCol='var(--dn)';tBg='var(--dd)';tIcon='🔴'}
      else{tDir=lang==='ar'?'محايد':'Neutral';tCol='var(--warn)';tBg='var(--wd)';tIcon='🟡'}
      /* Recommendation */
      var rec,recIcon;
      if(ts>=4){rec=lang==='ar'?'💰 شراء قوي — كل المؤشرات إيجابية. وقف خسارة '+fP(fib618Dn):'💰 Strong Buy — All indicators positive. Stop '+fP(fib618Dn);recIcon='💰'}
      else if(ts>=2){rec=lang==='ar'?'📈 شراء — اتجاه إيجابي. دخول تدريجي. وقف '+fP(support):'📈 Buy — Positive trend. Scale in. Stop '+fP(support);recIcon='📈'}
      else if(ts<=-4){rec=lang==='ar'?'⛔ بيع / تجنب — هبوط قوي. انتظر استقرار فوق '+fP(ema20):'⛔ Sell / Avoid — Strong decline. Wait above '+fP(ema20);recIcon='⛔'}
      else if(ts<=-2){rec=lang==='ar'?'⚠️ حذر — اتجاه سلبي. انتظر انعكاس':'⚠️ Caution — Negative trend. Wait for reversal';recIcon='⚠️'}
      else{rec=lang==='ar'?'⏳ انتظار — محايد. لا تتسرع':'⏳ Wait — Neutral. Don\'t rush';recIcon='⏳'}
      /* Build coin section */
      html+='<div class="rpt-coin '+coin.cls+'">'
        +'<div class="rpt-head"><div class="rpt-name"><span style="font-size:22px">'+coin.icon+'</span> '+coin.sym+'/USDT</div><div class="rpt-dir" style="background:'+tBg+';color:'+tCol+'">'+tIcon+' '+tDir+'</div></div>'
        +'<div style="text-align:center;margin:8px 0"><span style="font-family:var(--fm);font-size:26px;font-weight:800;color:var(--t0)">'+fP(price)+'</span></div>'
        +'<div class="rpt-grid"><div class="rpt-g"><div class="rpt-gv" style="color:'+(ch4h>=0?'var(--up)':'var(--dn)')+'">'+(ch4h>=0?'+':'')+ch4h.toFixed(2)+'%</div><div class="rpt-gl">4H</div></div><div class="rpt-g"><div class="rpt-gv" style="color:'+(ch24>=0?'var(--up)':'var(--dn)')+'">'+(ch24>=0?'+':'')+ch24.toFixed(2)+'%</div><div class="rpt-gl">24H</div></div><div class="rpt-g"><div class="rpt-gv" style="color:'+(ch7d>=0?'var(--up)':'var(--dn)')+'">'+(ch7d>=0?'+':'')+ch7d.toFixed(2)+'%</div><div class="rpt-gl">7D</div></div></div>'
        +'<div class="rpt-inds"><span class="rpt-ind" style="color:'+(rsi<30?'var(--up)':rsi>70?'var(--dn)':'var(--t1)')+'">📊 RSI: '+rsi.toFixed(0)+'</span><span class="rpt-ind" style="color:'+(macd.h>0?'var(--up)':'var(--dn)')+'">📈 MACD: '+(macd.h>0?(lang==='ar'?'إيجابي ✅':'Positive ✅'):(lang==='ar'?'سلبي ❌':'Negative ❌'))+'</span>'+(macd.cross!=='none'?'<span class="rpt-ind" style="color:'+(macd.cross==='bull'?'var(--up)':'var(--dn)')+'">🔀 '+(macd.cross==='bull'?(lang==='ar'?'تقاطع صعودي':'Bull Cross'):(lang==='ar'?'تقاطع هبوطي':'Bear Cross'))+'</span>':'')+'<span class="rpt-ind" style="color:'+(price>ema20?'var(--up)':'var(--dn)')+'">EMA20: '+(price>ema20?(lang==='ar'?'فوق ↑':'Above ↑'):(lang==='ar'?'تحت ↓':'Below ↓'))+'</span><span class="rpt-ind" style="color:'+(price>ema50?'var(--up)':'var(--dn)')+'">EMA50: '+(price>ema50?(lang==='ar'?'فوق ↑':'Above ↑'):(lang==='ar'?'تحت ↓':'Below ↓'))+'</span><span class="rpt-ind" style="color:'+(volTrend>1.3?'var(--neon)':'var(--t2)')+'">🔊 Vol: '+volTrend.toFixed(1)+'x</span>'+(fr?'<span class="rpt-ind" style="color:'+(fr.rate>0.05?'var(--dn)':fr.rate<-0.01?'var(--up)':'var(--t2)')+'">💰 FR: '+(fr.rate>=0?'+':'')+fr.rate.toFixed(4)+'%</span>':'')+(ls?'<span class="rpt-ind">⚖️ L/S: '+ls.ratio.toFixed(2)+'</span>':'')+(OI[coin.sym]?'<span class="rpt-ind" style="color:var(--neon)">📈 OI: '+fmt(OI[coin.sym])+'</span>':'')+'</div>'
        +'<div class="rpt-targets"><div class="rpt-tgt up"><div class="rpt-tgt-l">🎯 '+(lang==='ar'?'أهداف الصعود':'Upside Targets')+'</div><div class="rpt-tgt-v" style="color:var(--up)">'+fP(fib618Up)+'</div><div class="rpt-tgt-s" style="color:var(--neon)">'+fP(fib100Up)+'</div></div><div class="rpt-tgt dn"><div class="rpt-tgt-l">🛑 '+(lang==='ar'?'أهداف الهبوط':'Downside Targets')+'</div><div class="rpt-tgt-v" style="color:var(--dn)">'+fP(fib618Dn)+'</div><div class="rpt-tgt-s" style="color:var(--warn)">'+fP(fib100Dn)+'</div></div></div>'
        +'<div class="rpt-grid" style="grid-template-columns:1fr 1fr"><div class="rpt-g"><div class="rpt-gv" style="color:var(--dn)">'+fP(resistance)+'</div><div class="rpt-gl">🔴 '+(lang==='ar'?'المقاومة':'Resistance')+'</div></div><div class="rpt-g"><div class="rpt-gv" style="color:var(--up)">'+fP(support)+'</div><div class="rpt-gl">🟢 '+(lang==='ar'?'الدعم':'Support')+'</div></div></div>'
        +'<div class="rpt-adv" style="background:'+(ts>=2?'rgba(0,255,136,.05);border:1px solid rgba(0,255,136,.1)':ts<=-2?'rgba(255,56,96,.05);border:1px solid rgba(255,56,96,.1)':'rgba(255,184,0,.05);border:1px solid rgba(255,184,0,.1)')+'"><span style="font-size:18px;flex-shrink:0">'+recIcon+'</span><span>'+rec+'</span></div>'
        +'</div>';
    }
    /* Summary */
    var ovDir=overallScore>=6?(lang==='ar'?'🟢🟢 صعودي قوي':'🟢🟢 Strong Bull'):overallScore>=2?(lang==='ar'?'🟢 صعودي':'🟢 Bullish'):overallScore<=-6?(lang==='ar'?'🔴🔴 هبوطي قوي':'🔴🔴 Strong Bear'):overallScore<=-2?(lang==='ar'?'🔴 هبوطي':'🔴 Bearish'):(lang==='ar'?'🟡 محايد':'🟡 Neutral');
    var ovCol=overallScore>=2?'var(--up)':overallScore<=-2?'var(--dn)':'var(--warn)';
    html+='<div class="rpt-summary"><div style="text-align:center;margin-bottom:8px"><div style="font-family:var(--fd);font-weight:800;font-size:13px;color:var(--t0)">📋 '+(lang==='ar'?'ملخص السوق':'Market Summary')+'</div></div>'
      +'<div class="rpt-sum-row"><span>🧭 '+(lang==='ar'?'الاتجاه العام':'Overall Trend')+'</span><span style="font-weight:700;color:'+ovCol+'">'+ovDir+'</span></div>'
      +'<div class="rpt-sum-row"><span>😰 Fear & Greed</span><span style="font-weight:700;color:var(--warn)">'+fgValue+'</span></div>'
      +'<div class="rpt-sum-row"><span>₿ BTC Dom</span><span style="font-weight:700">'+btcDom.toFixed(1)+'%</span></div>'
      +'<div class="rpt-sum-row"><span>🔥 '+(lang==='ar'?'عملات صاعدة':'Rising')+'</span><span style="font-weight:700;color:var(--up)">'+Object.values(T).filter(function(x){return x.c>0}).length+'/'+Object.keys(T).length+'</span></div>'
      +'<div class="rpt-sum-row"><span>⏰ '+(lang==='ar'?'التحديث القادم':'Next Update')+'</span><span style="font-weight:700;color:var(--blue)">'+(lang==='ar'?'4 ساعات':'4 hours')+'</span></div></div>';
    html+='<div style="text-align:center;margin-top:10px;font-size:8px;color:var(--t3);font-family:var(--fm)">⚠️ '+(lang==='ar'?'تحليل فني — ليس نصيحة مالية':'Technical analysis — Not financial advice')+'</div>';
    reportCache.html=html;reportCache.time=Date.now();
    document.getElementById('rptBody').innerHTML=html;updateReportHeader();
  }catch(e){document.getElementById('rptBody').innerHTML='<div class="empty"><div class="empty-ic">📊</div><div class="empty-tx">'+(lang==='ar'?'خطأ — اضغط تحديث':'Error — Try refresh')+'</div></div><button class="rfr" onclick="reportCache.time=0;loadReport()">🔄</button>'}}
function updateReportHeader(){var t=document.getElementById('rptTime');if(t){var now=new Date();t.textContent=(lang==='ar'?'آخر تحديث: ':'Updated: ')+String(now.getHours()).padStart(2,'0')+':'+String(now.getMinutes()).padStart(2,'0')+(lang==='ar'?' — كل 4 ساعات':' — Every 4h')}var b=document.getElementById('rptBadge');if(b){b.textContent=lang==='ar'?'✅':'✅';b.style.background='var(--ud)';b.style.color='var(--up)'}}
/* PORTFOLIO */
var sP=function(){localStorage.setItem('nxp10',JSON.stringify(portfolio))};
function addPort(){var sym=document.getElementById('aSym').value.toUpperCase().trim(),amt=+document.getElementById('aAmt').value,pr=+document.getElementById('aPr').value;if(!sym||!amt)return;portfolio.push({sym:sym,amt:amt,bp:pr});sP();closeMo('addMo');renderPort()}
function rmPort(i){portfolio.splice(i,1);sP();renderPort()}
function renderPort(){var tV=0,tC=0;portfolio.forEach(function(p){var d=T[p.sym];if(d){tV+=d.p*p.amt;tC+=p.bp*p.amt}});var pnl=tC>0?((tV-tC)/tC*100):0;document.getElementById('pVal').textContent=tV>0?fmt(tV):'$0';var pE=document.getElementById('pCh');if(tC>0){pE.textContent=(pnl>=0?'+':'')+pnl.toFixed(2)+'%';pE.style.color=pnl>=0?'var(--up)':'var(--dn)'}else{pE.textContent=t('add_coins');pE.style.color='var(--t3)'};document.getElementById('pList').innerHTML=portfolio.length?portfolio.map(function(p,i){var d=T[p.sym],cp=d?d.p:0,v=cp*p.amt,pnl=p.bp>0?((cp-p.bp)/p.bp*100):0;var bg=COL[p.sym]||'#444';return'<div class="port-i"><div style="display:flex;align-items:center;gap:8px"><div class="cr-ic" style="background:'+bg+'0a;color:'+bg+';border:1px solid '+bg+'22;width:26px;height:26px;font-size:9px">'+p.sym.slice(0,2)+'</div><div><div class="cr-n">'+p.sym+'</div><div class="cr-sub">'+p.amt+' × '+fP(cp)+'</div></div></div><div style="text-align:left"><div class="cr-p">'+fmt(v)+'</div><div style="font-family:var(--fm);font-size:9px;font-weight:700;color:'+(pnl>=0?'var(--up)':'var(--dn)')+'">'+(p.bp>0?(pnl>=0?'+':'')+pnl.toFixed(1)+'%':'--')+'</div><div style="font-size:7px;color:var(--t3);cursor:pointer" onclick="rmPort('+i+')">🗑</div></div></div>'}).join(''):'<div class="empty"><div class="empty-ic">💼</div><div class="empty-tx">'+t('empty_port')+'</div></div>'}
function calcRisk(){var cap=+document.getElementById('rcCap').value,risk=+document.getElementById('rcRisk').value,entry=+document.getElementById('rcEntry').value,sl=+document.getElementById('rcSL').value,tp=+document.getElementById('rcTP').value;if(!cap||!entry||!sl){document.getElementById('rcRes').innerHTML='<div style="text-align:center;color:var(--t3);padding:12px;font-size:11px">'+t('enter_data')+'</div>';return};var rA=cap*(risk/100),slD=Math.abs(entry-sl),pos=slD>0?rA/slD:0,posV=pos*entry,rew=tp?pos*Math.abs(tp-entry):0,rr=tp&&rA>0?rew/rA:0,lev=cap>0?posV/cap:0;document.getElementById('rcRes').innerHTML='<div class="rc-row"><span>'+t('risk_amt')+'</span><span class="rc-val" style="color:var(--dn)">'+fmt(rA)+'</span></div><div class="rc-row"><span>'+t('pos_size')+'</span><span class="rc-val">'+pos.toFixed(4)+'</span></div><div class="rc-row"><span>'+t('pos_val')+'</span><span class="rc-val">'+fmt(posV)+'</span></div><div class="rc-row"><span>'+t('leverage')+'</span><span class="rc-val" style="color:'+(lev>10?'var(--dn)':lev>5?'var(--warn)':'var(--up)')+'">'+lev.toFixed(1)+'x</span></div>'+(tp?'<div class="rc-row"><span>'+t('exp_profit')+'</span><span class="rc-val" style="color:var(--up)">'+fmt(rew)+'</span></div><div class="rc-row"><span>⚖️ R/R</span><span class="rc-val" style="color:'+(rr>=2?'var(--up)':rr>=1?'var(--warn)':'var(--dn)')+'">1:'+rr.toFixed(1)+'</span></div>':'')+'<div class="rc-row"><span>'+t('sl_loss')+'</span><span class="rc-val" style="color:var(--dn)">-'+fmt(rA)+'</span></div>'}
/* 🪙 TOP COIN CARDS — BTC, ETH, SOL, SUI */
var TOP4=['BTC','ETH','SOL','SUI'];
var TOP4_ICONS={BTC:'₿',ETH:'Ξ',SOL:'◎',SUI:'💧'};
function renderTopCoins(){
  var el=document.getElementById('topCoins');if(!el)return;
  el.innerHTML=TOP4.map(function(s){var d=T[s];if(!d)return'';
    var chg=isNaN(d.c)?0:d.c;var up=chg>=0;var bg=COL[s]||'#888';
    var fr=FR[s];var frText=fr?(fr.rate>=0?'+':'')+fr.rate.toFixed(4)+'%':'--';
    var frCol=fr?(fr.rate>0.05?'var(--dn)':fr.rate<-0.01?'var(--up)':'var(--t2)'):'var(--t3)';
    return'<div class="coin-card '+(up?'up':'dn')+'" onclick="openCoin(\''+s+'\')">'
    +'<div class="coin-card-h">'
    +'<div class="coin-card-name"><div class="coin-card-ic" style="background:'+bg+'18;color:'+bg+';border:1px solid '+bg+'30">'+TOP4_ICONS[s]+'</div><span>'+s+'/USDT</span></div>'
    +'<div class="coin-card-ch" style="background:var(--'+(up?'ud':'dd')+');color:var(--'+(up?'up':'dn')+')">'+(up?'▲ +':'▼ ')+chg.toFixed(2)+'%</div>'
    +'</div>'
    +'<div class="coin-card-body"><div><div class="coin-card-price">'+fP(d.p)+'</div><div class="coin-card-spark">'+mkSpark(s)+'</div></div>'
    +'<div class="coin-card-info"><div>Vol: <b style="color:var(--neon)">'+fmt(d.v)+'</b></div><div>H: <b style="color:var(--up)">'+fP(d.h)+'</b></div><div>L: <b style="color:var(--dn)">'+fP(d.l)+'</b></div></div></div>'
    +'<div class="coin-card-vol"><span>FR: <b style="color:'+frCol+'">'+frText+'</b></span>'+(d.by?'<span>Bybit: <b>'+fP(d.by)+'</b></span>':'')+(CBP[s]?'<span>CB: <b>'+fP(CBP[s])+'</b></span>':'')+'</div>'
    +'</div>'}).join('')}
/* 🎯 TOP 3 BEST OPPORTUNITIES */
function renderTop3(){
  var el=document.getElementById('top3List');if(!el||!cache.scan)return;
  var opps=[];
  cache.scan.forEach(function(r){
    var priority=r.score;var type='';var icon='';var reason='';var conf=0;
    /* ULTRA signals get highest priority */
    if(r.ultra){type='ULTRA';icon='⭐';priority+=30;
      reason=lang==='ar'?'إشارة مؤكدة — '+r.passed+'/6 فحوصات':'Confirmed — '+r.passed+'/6 checks'}
    else if(r.confirmed){type=lang==='ar'?'إشارة قوية':'Strong Signal';icon='🟢';priority+=15;
      reason=lang==='ar'?'إشارة قوية — '+r.passed+'/6 فحوصات':'Strong — '+r.passed+'/6 checks'}
    else if(r.tags.some(function(t){return t.includes('EARLY')||t.includes('STEALTH')})){
      type=lang==='ar'?'صيد مبكر':'Early Catch';icon='💎';priority+=20;
      reason=lang==='ar'?'تجميع قبل الانفجار':'Accumulation before pump'}
    else if(r.c>=3&&r.c<10&&r.score>=40){type=lang==='ar'?'انفجار':'Breakout';icon='💥';
      reason=lang==='ar'?'بداية انفجار — لسا فيه فرصة':'Early breakout — still time'}
    else return;
    /* Whale wave bonus */
    var waves=whaleWaves[r.s]?whaleWaves[r.s].waves.length:0;
    if(waves>=3){priority+=20;reason+=(lang==='ar'?' | 🐋 3 موجات حيتان':' | 🐋 3 whale waves')}
    else if(waves>=2){priority+=10;reason+=(lang==='ar'?' | 🐋 موجتين':' | 🐋 2 waves')}
    /* FR bonus */
    if(FR[r.s]&&FR[r.s].rate<-0.01){priority+=8;reason+=(lang==='ar'?' | FR سلبي 🟢':' | Neg FR 🟢')}
    /* Late penalty */
    if(r.c>=10){priority-=15}
    if(r.c>=15){priority-=20}
    /* Confidence */
    conf=Math.min(99,Math.max(50,Math.round(50+priority*0.4)));
    /* Recommendation */
    var rec,recCol;
    if(conf>=90){rec=lang==='ar'?'💡 شراء قوي':'💡 Strong Buy';recCol='var(--up)'}
    else if(conf>=80){rec=lang==='ar'?'💡 فرصة ذهبية':'💡 Golden Opp';recCol='var(--neon)'}
    else if(conf>=70){rec=lang==='ar'?'💡 راقب':'💡 Watch';recCol='var(--warn)'}
    else{rec=lang==='ar'?'💡 حذر':'💡 Caution';recCol='var(--t2)'}
    opps.push({s:r.s,p:r.p,c:r.c,v:r.v,score:r.score,priority:priority,type:type,icon:icon,reason:reason,conf:conf,rec:rec,recCol:recCol,checks:r.checks,passed:r.passed,waves:waves,detectedAt:r.detectedAt})});
  opps.sort(function(a,b){return b.priority-a.priority});
  var top=opps.slice(0,3);
  var ranks=['gold','silver','bronze'];var rankIcons=['1️⃣','2️⃣','3️⃣'];
  el.innerHTML=top.length?top.map(function(o,i){
    var up=o.c>=0;var src=[];if(T[o.s])src.push(T[o.s].src==='BY'?'Bybit':'Binance');if(T[o.s]&&T[o.s].by)src.push('Bybit');if(CBP[o.s])src.push('Coinbase');
    return'<div class="top3-card '+ranks[i]+'" onclick="openCoin(\''+o.s+'\')">'
    +'<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">'
    +'<div style="display:flex;align-items:center;gap:8px"><div class="top3-rank" style="background:'+(i===0?'linear-gradient(135deg,#ffd700,#ff8c00)':i===1?'linear-gradient(135deg,#c0c0c0,#808080)':'linear-gradient(135deg,#cd7f32,#8b4513)')+';color:#fff">'+rankIcons[i]+'</div><div><div style="font-family:var(--fd);font-weight:800;font-size:14px;color:var(--t0)">'+o.icon+' '+o.s+'/USDT</div><div style="font-size:8px;font-family:var(--fm);color:var(--t2)">'+o.type+'</div></div></div>'
    +'<div class="top3-conf" style="background:'+(o.conf>=90?'var(--ud)':o.conf>=80?'var(--nd)':'var(--wd)')+';color:'+(o.conf>=90?'var(--up)':o.conf>=80?'var(--neon)':'var(--warn)')+'">'+(lang==='ar'?'ثقة':'Conf')+' '+o.conf+'%</div></div>'
    +'<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px"><span style="font-family:var(--fm);font-size:18px;font-weight:800;color:var(--t0)">'+fP(o.p)+'</span><span style="font-family:var(--fm);font-size:13px;font-weight:800;color:var(--'+(up?'up':'dn')+')">'+(up?'+':'')+o.c.toFixed(1)+'%</span></div>'
    +'<div style="display:flex;gap:4px;margin-bottom:6px;flex-wrap:wrap"><span style="font-size:7px;font-family:var(--fm);padding:2px 5px;border-radius:3px;background:var(--bg2);color:var(--t1)">Score:'+o.score+'</span><span style="font-size:7px;font-family:var(--fm);padding:2px 5px;border-radius:3px;background:var(--bg2);color:var(--t1)">'+o.passed+'/6✅</span>'+(o.waves>0?'<span style="font-size:7px;font-family:var(--fm);padding:2px 5px;border-radius:3px;background:var(--nd);color:var(--neon)">🐋'+o.waves+'</span>':'')+'<span style="font-size:7px;font-family:var(--fm);padding:2px 5px;border-radius:3px;background:var(--bg2);color:var(--t2)">'+src.join('·')+'</span></div>'
    +'<div style="display:flex;justify-content:space-between;align-items:center"><div style="font-size:9px;color:var(--t2);flex:1">'+o.reason+'</div><div style="font-size:10px;font-weight:700;color:'+o.recCol+'">'+o.rec+'</div></div>'
    +'<div style="margin-top:4px;display:flex;gap:8px;font-size:8px;font-family:var(--fm)"><span style="color:var(--up)">🎯 '+fP(o.p*1.08)+' — '+fP(o.p*1.15)+'</span><span style="color:var(--dn)">🛑 '+fP(o.p*0.93)+'</span></div>'
    +'</div>'}).join(''):'<div class="muted">'+(lang==='ar'?'لا فرص قوية حالياً — السوق هادئ':'No strong opportunities — Market quiet')+'</div>'}
/* 📈 MARKET MOVEMENT PAGE */
async function loadMarket(){loadStableFlow();loadReport()}
/* 🤖 DATA VALIDATOR + AUTO-REPAIR SYSTEM */
var validatorLog=[];var lastDataTime=Date.now();var validatorStatus='ok';
function addVLog(type,msg){validatorLog.unshift({type:type,msg:msg,time:Date.now()});if(validatorLog.length>30)validatorLog=validatorLog.slice(0,30)}
async function runValidator(){
  var issues=0,fixes=0;
  /* CHECK 1: Data Freshness — is T data updating? */
  var tkAge=Date.now()-lastDataTime;
  if(tkAge>120000){addVLog('🔴','البيانات قديمة '+Math.round(tkAge/60000)+' دقيقة — يعيد التحميل');issues++;try{await loadTk();lastDataTime=Date.now();fixes++;addVLog('🔧','تم إعادة تحميل البيانات ✅')}catch(e){addVLog('❌','فشل إعادة التحميل')}}
  else if(tkAge>90000){addVLog('🟡','البيانات عمرها '+Math.round(tkAge/60000)+' دقيقة');issues++}
  /* CHECK 2: WebSocket alive */
  if(!ws||ws.readyState!==1){addVLog('🔴','WebSocket غير متصل — يعيد الاتصال');issues++;initWS();fixes++;addVLog('🔧','أعاد اتصال WebSocket')}
  /* CHECK 3: Cross-Exchange Price Validation (BTC) */
  if(T.BTC&&T.BTC.by){var diff=Math.abs(T.BTC.p-T.BTC.by)/T.BTC.p*100;if(diff>2){addVLog('🔴','فرق BTC بين Binance/Bybit: '+diff.toFixed(1)+'% — غير طبيعي!');issues++}else{addVLog('✅','BTC Binance/Bybit متطابق ('+diff.toFixed(2)+'%)')}}
  if(T.BTC&&CBP.BTC){var cbDiff=Math.abs(T.BTC.p-CBP.BTC)/T.BTC.p*100;if(cbDiff>3){addVLog('🔴','فرق BTC Binance/Coinbase: '+cbDiff.toFixed(1)+'%');issues++;CBP.BTC=T.BTC.p;fixes++;addVLog('🔧','صحح سعر Coinbase')}else{addVLog('✅','BTC Coinbase متطابق ('+cbDiff.toFixed(2)+'%)')}}
  /* CHECK 4: Whale Signal Validation */
  if(cache.scan){var whales=cache.scan.filter(function(x){return x.tags.some(function(t){return t.includes('ACC')||t.includes('STEALTH')})});
    whales.slice(0,5).forEach(function(w){
      var realVol=T[w.s]?T[w.s].v:0;var estWhale=w.v*0.05;
      if(estWhale>realVol*0.2){addVLog('🟡','حوت '+w.s+': تقدير $'+fmt(estWhale)+' مبالغ مقارنة بالحجم $'+fmt(realVol));issues++}
      if(w.c>8){addVLog('🟡','حوت '+w.s+': صعد +'+w.c.toFixed(1)+'% — ممكن اكتشاف متأخر');issues++}
      else{addVLog('✅','حوت '+w.s+': +'+w.c.toFixed(1)+'% — اكتشاف مبكر ✅')}
    })}
  /* CHECK 5: Breakout Signal Timing */
  if(cache.scan){cache.scan.filter(function(r){return r.c>=8&&r.score>=40}).slice(0,3).forEach(function(r){
    var sigAge=Date.now()-r.detectedAt;var hrs=sigAge/3600000;
    if(r.c>=15&&hrs<0.5){addVLog('🟡','انفجار '+r.s+': +'+r.c.toFixed(0)+'% — اكتشاف متأخر (صعدت كثير)');issues++}
    else if(r.c<8){addVLog('✅','انفجار '+r.s+': +'+r.c.toFixed(1)+'% — توقيت جيد')}})}
  /* CHECK 6: Gem Signal Freshness */
  if(cache.scan){var gems=cache.scan.filter(function(r){return r.tags.some(function(t){return t.includes('EARLY')})&&r.c<3});
    if(gems.length>0)addVLog('✅','جواهر: '+gems.length+' إشارة مبكرة (<3%) — صيد ممتاز');
    var lateGems=cache.scan.filter(function(r){return r.c>=10&&r.tags.some(function(t){return t.includes('LATE')})});
    if(lateGems.length>0){addVLog('🟡','جواهر متأخرة: '+lateGems.length+' عملة فوق +10%');issues++}}
  /* CHECK 7: FR Data Completeness */
  var frCount=Object.keys(FR).length;
  if(frCount<10){addVLog('🟡','FR: فقط '+frCount+' عملة — يعيد التحميل');issues++;try{await loadFutures();fixes++;addVLog('🔧','أعاد تحميل Futures ✅')}catch(e){}}
  else{addVLog('✅','FR: '+frCount+' عملة محمّلة')}
  /* CHECK 8: Total Coins Count */
  var coinCount=Object.keys(T).length;
  if(coinCount<100){addVLog('🔴','عملات: '+coinCount+' فقط — المفروض 500+');issues++;try{await loadTk();lastDataTime=Date.now();fixes++;addVLog('🔧','أعاد تحميل العملات: '+Object.keys(T).length+' ✅')}catch(e){}}
  else{addVLog('✅','عملات: '+coinCount+' محمّلة')}
  /* STATUS */
  validatorStatus=issues===0?'ok':issues<=2?'warn':'error';
  updateValidatorUI(issues,fixes);
  return{issues:issues,fixes:fixes}}
function updateValidatorUI(issues,fixes){
  var el=document.getElementById('validatorDot');var el2=document.getElementById('validatorDot2');var st=document.getElementById('validatorStatus');
  var col=validatorStatus==='ok'?'var(--up)':validatorStatus==='warn'?'var(--warn)':'var(--dn)';
  var txt=validatorStatus==='ok'?(lang==='ar'?'✅ كل شي سليم':'✅ All clear'):validatorStatus==='warn'?(lang==='ar'?'⚠️ '+issues+' ملاحظة':'⚠️ '+issues+' issues'):(lang==='ar'?'🔴 '+issues+' مشكلة | '+fixes+' أُصلحت':'🔴 '+issues+' problems | '+fixes+' fixed');
  if(el){el.style.background=col;el.style.boxShadow='0 0 6px '+col}
  if(el2){el2.style.background=col;el2.style.boxShadow='0 0 6px '+col}
  if(st){st.textContent=txt;st.style.color=col}
  renderValidatorLog()}
function renderValidatorLog(){
  var el=document.getElementById('validatorPanel');if(!el)return;
  el.innerHTML=validatorLog.length?validatorLog.map(function(l){var a=timeAgo(l.time);return'<div style="display:flex;gap:6px;padding:4px 0;border-bottom:1px solid var(--bdr);font-size:9px"><span>'+l.type+'</span><span style="flex:1;color:var(--t1)">'+l.msg+'</span><span style="color:var(--t3);font-family:var(--fm);font-size:7px;flex-shrink:0">'+a.text+'</span></div>'}).join(''):'<div style="text-align:center;color:var(--t3);font-size:10px;padding:10px">🤖 '+(lang==='ar'?'لم يتم الفحص بعد':'Not scanned yet')+'</div>'}
/* 🎯 BYBIT TOP GAINERS — catch Bybit-only movers */
async function scanBybitGainers(){
  try{var by=await fj('https://api.bybit.com/v5/market/tickers?category=spot');if(!by||!by.result)return;
    var gainers=by.result.list.filter(function(x){return x.symbol.endsWith('USDT')&&+x.price24hPcnt*100>=3&&+x.turnover24h>50000}).sort(function(a,b){return+b.price24hPcnt-+a.price24hPcnt}).slice(0,20);
    gainers.forEach(function(x){var s=x.symbol.replace('USDT','');var chg=+x.price24hPcnt*100;
      if(!T[s]||T[s].src==='BY'){T[s]={p:+x.lastPrice,c:chg,v:+x.turnover24h,h:+x.highPrice24h,l:+x.lowPrice24h,src:'BY',by:+x.lastPrice}}
      if(chg>=5&&chg<=15){var k='by_'+s+'_'+new Date().getHours();if(!notifiedSet[k]){notifiedSet[k]=true;localStorage.setItem('nxnot10',JSON.stringify(notifiedSet));recSig(s,'breakout');if(chg<8)notify(s,'gem',0)}}})}catch(e){}}
/* INIT */
async function init(){document.getElementById('sInp').placeholder=t('search_ph');document.getElementById('notifB').dataset.c='0';
  loadProfile();loadToneUI();updateMenuLang();updateMenuTheme();
  if(tg){tg.setHeaderColor(document.body.dataset.theme==='dark'?'#060b14':'#f7f9fc');tg.setBackgroundColor(document.body.dataset.theme==='dark'?'#020408':'#f0f4f8')}
  await loadDash();renderPort();
  setInterval(async function(){try{await loadTk();await loadFutures();lastDataTime=Date.now();checkWatchlistAlerts();scanBybitGainers()}catch(e){}},30000);
  setInterval(async function(){if(document.getElementById('pg-dash').classList.contains('act'))await loadDash()},120000);
  setInterval(function(){if(!ws||ws.readyState!==1)initWS()},30000);
  setInterval(function(){notifiedSet={};localStorage.setItem('nxnot10','{}')},3600000);
  /* Data Validator — every 90 seconds */
  setTimeout(function(){runValidator()},10000);
  setInterval(function(){runValidator()},90000)}
init();
